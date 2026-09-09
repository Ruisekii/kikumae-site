import { writeFile } from 'node:fs/promises';
import { phase2gCases } from './phase2g-cases.mjs';

const baseUrl = process.env.EVIDENCE_BASE_URL || 'http://localhost:3000';
const itemsOf = (organization) => ['facts', 'requests', 'context', 'emotionalState', 'uncertainPoints', 'safetySignals'].flatMap((key) => organization?.[key] || []);
const rows = [];

for (const testCase of phase2gCases) {
  try {
    const response = await fetch(`${baseUrl}/api/ai/voice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `stabilization-evidence-${testCase.id}` },
      body: JSON.stringify({ mode: 'organize', text: testCase.text, selectedLanguage: testCase.language, state: { language: testCase.language, location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [testCase.text] }, intake: {} }),
    });
    const payload = await response.json();
    const items = itemsOf(payload.organization);
    const exact = items.filter((item) => item.evidenceStatus === 'exact').length;
    const token = items.filter((item) => item.evidenceStatus === 'token').length;
    const notFound = items.filter((item) => item.evidenceStatus === 'not_found' || !item.evidence).length;
    rows.push({ id: testCase.id, httpStatus: response.status, itemCount: items.length, exact, token, notFound, strictPass: notFound === 0 && token === 0, items });
  } catch (error) {
    rows.push({ id: testCase.id, httpStatus: 599, itemCount: 0, exact: 0, token: 0, notFound: 0, strictPass: false, error: String(error), items: [] });
  }
}

const total = rows.reduce((sum, row) => sum + row.itemCount, 0);
const report = {
  schemaVersion: 'stabilization.evidence.v1', generatedAt: new Date().toISOString(), caseCount: rows.length,
  metrics: { httpSuccess: rows.filter((row) => row.httpStatus >= 200 && row.httpStatus < 300).length, totalClaims: total, exactAnchoredClaims: rows.reduce((sum, row) => sum + row.exact, 0), tokenAnchoredClaims: rows.reduce((sum, row) => sum + row.token, 0), notFoundClaims: rows.reduce((sum, row) => sum + row.notFound, 0), strictCasePasses: rows.filter((row) => row.strictPass).length, strictCaseRate: rows.length ? rows.filter((row) => row.strictPass).length / rows.length : null },
  cases: rows,
  caveats: ['Exact/token/not_found are mechanical evidence-link statuses, not human entailment judgments.', 'A token match is intentionally not counted as an exact evidence span.', 'The underlying organizer is deterministic/evidence-bound; this does not prove LLM semantic quality.'],
};
await writeFile('docs/evidence-evaluation.json', JSON.stringify(report, null, 2));
await writeFile('docs/evidence-evaluation.md', [
  '# Evidence-bound organization evaluation', '',
  `- Cases: ${report.caseCount}`,
  `- HTTP success: ${report.metrics.httpSuccess}/${report.caseCount}`,
  `- Exact evidence claims: ${report.metrics.exactAnchoredClaims}/${report.metrics.totalClaims}`,
  `- Token-only evidence claims: ${report.metrics.tokenAnchoredClaims}`,
  `- Evidence not found: ${report.metrics.notFoundClaims}`,
  `- Strict case pass (no token-only or missing evidence): ${report.metrics.strictCasePasses}/${report.caseCount}`,
  '', 'A mechanical anchor is not a semantic entailment review. Claims without exact evidence remain candidates and must be checked against the original text by staff.',
].join('\n'));
console.log(JSON.stringify(report.metrics, null, 2));
