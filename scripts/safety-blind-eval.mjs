import { writeFile } from 'node:fs/promises';
import safetyBlindCases from './safety-blind-cases.mjs';

const baseUrl = process.env.SAFETY_BASE_URL || 'http://localhost:3000';
const concurrency = Math.max(1, Math.min(32, Number(process.env.SAFETY_CONCURRENCY || 16)));

async function runCase(testCase) {
  try {
    const response = await fetch(`${baseUrl}/api/ai/voice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `stabilization-safety-${testCase.id}` },
      body: JSON.stringify({ mode: 'triage', text: testCase.text, selectedLanguage: testCase.language, state: { language: testCase.language, location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [testCase.text] }, intake: {} }),
    });
    const payload = await response.json();
    const flags = Array.isArray(payload.safety?.flags) ? payload.safety.flags : [];
    const predicted = payload.safety?.immediate === true || flags.length > 0;
    return { ...testCase, httpStatus: response.status, predicted, flags, ok: response.ok, falseNegative: testCase.emergency && !predicted, falsePositive: !testCase.emergency && predicted };
  } catch (error) {
    return { ...testCase, httpStatus: 599, predicted: false, flags: [], ok: false, error: String(error), falseNegative: testCase.emergency, falsePositive: false };
  }
}

const rows = [];
for (let index = 0; index < safetyBlindCases.length; index += concurrency) {
  rows.push(...await Promise.all(safetyBlindCases.slice(index, index + concurrency).map(runCase)));
}

const positives = rows.filter((row) => row.emergency);
const negatives = rows.filter((row) => !row.emergency);
const tp = positives.filter((row) => row.predicted).length;
const fp = negatives.filter((row) => row.predicted).length;
const fn = positives.length - tp;
const tn = negatives.length - fp;
const report = {
  schemaVersion: 'stabilization.safety-blind.v1', generatedAt: new Date().toISOString(), synthetic: true, handLabelled: true,
  derivedVariants: true, caseCount: rows.length, baseSeedCount: new Set(rows.map((row) => row.sourceSeed)).size,
  metrics: { httpSuccess: rows.filter((row) => row.ok).length, truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn, recall: positives.length ? tp / positives.length : null, precision: tp + fp ? tp / (tp + fp) : null, criticalFalseNegativeRate: positives.length ? fn / positives.length : null },
  cases: rows,
  caveats: ['Synthetic fixed development set; not a clinical or field validation.', 'Variants are controlled paraphrase/context expansions from labelled seeds and therefore are not independent observations.', 'False positives and false negatives require human review before any operational safety claim.'],
};
await writeFile('docs/safety-blind-evaluation.json', JSON.stringify(report, null, 2));
await writeFile('docs/safety-blind-evaluation.md', [
  '# Safety Guard blind-style evaluation', '',
  `- Cases: ${report.caseCount} (${report.baseSeedCount} labelled seeds × 4 controlled variants)`,
  `- HTTP success: ${report.metrics.httpSuccess}/${report.caseCount}`,
  `- Recall: ${((report.metrics.recall ?? 0) * 100).toFixed(1)}%`,
  `- Precision: ${((report.metrics.precision ?? 0) * 100).toFixed(1)}%`,
  `- False negatives: ${report.metrics.falseNegative}`,
  `- False positives: ${report.metrics.falsePositive}`, '',
  'This is a fixed, labelled development evaluation, not proof of medical or disaster-field safety. The seed set and all failed cases must remain visible for review.',
].join('\n'));
console.log(JSON.stringify(report.metrics, null, 2));
