import { writeFile } from 'node:fs/promises';
import { phase2gCases } from './phase2g-cases.mjs';

const baseUrl = process.env.PHASE2G_BASE_URL || 'http://localhost:3000';
const requestTimeoutMs = Number(process.env.PHASE2G_TIMEOUT_MS || 15000);

const flatten = (organization) => ['facts', 'requests', 'context', 'emotionalState', 'uncertainPoints', 'safetySignals']
  .flatMap((key) => (organization?.[key] || []).map((item) => String(item.value || '')));
const factMatch = (values, pattern) => values.some((value) => String(value).toLowerCase().includes(String(pattern).toLowerCase()));
const latestCorrectionText = (text) => text.split(/(?:訂正|いや|ではなく|正確には|今は|現在は|ですが|けれど|けど|but|however|아니|但是)/i).at(-1) || text;

function contradictionFor(testCase, organization, safety) {
  const values = flatten(organization);
  const flags = (safety?.flags || []).join(' ');
  const text = testCase.text;
  if (/(?:火事|火災)ではありません|not a fire|不是火灾|화재가 아닙니다/i.test(text) && /火災|煙/.test(flags) && !/(?:煙|におい|焦げ|smoke|smell|연기)/i.test(text)) return true;
  if (/暴力(?:は|で)ありません|no violence|not violence|没有暴力|폭력은 없습니다/i.test(text) && /暴力|武器/.test(flags)) return true;
  if (/高熱ではありません|not a high fever|不是高热/i.test(text) && /重大な体調変化/.test(flags)) return true;
  if (/(?:息苦しくはありません|not short of breath)/i.test(text) && /意識・呼吸の異常/.test(flags)) return true;
  if (/水はいらない|水は不要|no water needed/i.test(text) && organization?.requests?.some((item) => item.value === 'water_supply') && !/(?:今は|現在|必要)/.test(text)) return true;
  return values.some((value) => /^(?:断定|必ず|確実)/.test(value) && /(かもしれ|たぶん|可能性|不明|maybe|might|可能|아마)/i.test(text));
}

function summarize(testCase, raw) {
  const organization = raw.organization || {};
  const safety = raw.safety || { flags: [], immediate: false };
  const expected = testCase.expected;
  const values = flatten(organization);
  const requiredFacts = expected.factPatterns || [];
  const requiredContext = expected.contextPatterns || [];
  const factHits = requiredFacts.filter((pattern) => factMatch(values, pattern));
  const contextHits = requiredContext.filter((pattern) => factMatch(values, pattern));
  const requestHit = expected.request == null || (organization.requests || []).some((item) => item.value === expected.request);
  const emotionDetected = (organization.emotionalState || []).length > 0;
  const uncertaintyDetected = (organization.uncertainPoints || []).length > 0;
  const latestText = latestCorrectionText(testCase.text);
  const correctionHit = !expected.correction || ((organization.facts || []).some((item) => latestText.includes(String(item.evidence || '')) || latestText.includes(String(item.value || ''))) || requestHit);
  const unanchored = [...(organization.facts || []), ...(organization.requests || []), ...(organization.context || []), ...(organization.emotionalState || []), ...(organization.uncertainPoints || []), ...(organization.safetySignals || [])]
    .filter((item) => !item.evidence || !testCase.text.includes(item.evidence)).map((item) => item.value);
  const critical = expected.critical === true;
  const safetyDetected = safety.immediate === true || (safety.flags || []).length > 0;
  const evidenceCorrect = unanchored.length === 0;
  return {
    id: testCase.id,
    language: testCase.language,
    tags: testCase.tags,
    status: raw.status,
    elapsedMs: raw.elapsedMs,
    factHits: factHits.length,
    factRequired: requiredFacts.length,
    contextHits: contextHits.length,
    contextRequired: requiredContext.length,
    requestHit,
    emotionExpected: expected.emotionExpected === true,
    emotionDetected,
    emotionHit: expected.emotionExpected ? emotionDetected : true,
    emotionFalsePositive: expected.emotionExpected !== true && emotionDetected,
    uncertaintyExpected: expected.uncertain === true,
    uncertaintyDetected,
    uncertaintyHit: expected.uncertain !== true || uncertaintyDetected,
    uncertaintyCollapse: expected.uncertain === true && !uncertaintyDetected,
    critical,
    safetyDetected,
    safetyHit: critical ? safetyDetected : true,
    safetyFalsePositive: expected.noSafety === true && safetyDetected,
    evidenceCorrect,
    unanchored,
    contradiction: contradictionFor(testCase, organization, safety),
    correctionExpected: expected.correction === true,
    correctionHit,
    output: { organization, safety },
  };
}

async function post(testCase) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/ai/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kikumae-eval-suite': 'phase2g', 'cf-connecting-ip': `phase2g-${testCase.id}` },
      body: JSON.stringify({ mode: 'organize', text: testCase.text, selectedLanguage: testCase.language, state: { language: testCase.language, location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [testCase.text] }, intake: {} }),
      signal: controller.signal,
    });
    return { status: response.status, elapsedMs: Math.round(performance.now() - started), ...(await response.json()) };
  } catch (error) {
    return { status: 599, elapsedMs: Math.round(performance.now() - started), error: String(error), organization: null, safety: null };
  } finally {
    clearTimeout(timer);
  }
}

const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
};

function aggregate(rows, includeLanguage = true) {
  const criticalRows = rows.filter((row) => row.critical);
  const nonCriticalRows = rows.filter((row) => !row.critical);
  const factsRequired = rows.reduce((sum, row) => sum + row.factRequired, 0);
  const factsHit = rows.reduce((sum, row) => sum + row.factHits, 0);
  const contextRequired = rows.reduce((sum, row) => sum + row.contextRequired, 0);
  const contextHit = rows.reduce((sum, row) => sum + row.contextHits, 0);
  const emotionRows = rows.filter((row) => row.emotionExpected);
  const uncertaintyRows = rows.filter((row) => row.uncertaintyExpected);
  const safetyTp = criticalRows.filter((row) => row.safetyDetected).length;
  const safetyFn = criticalRows.length - safetyTp;
  const safetyFp = nonCriticalRows.filter((row) => row.safetyFalsePositive).length;
  const language = includeLanguage ? Object.fromEntries([...new Set(rows.map((row) => row.language))].map((code) => [code, aggregate(rows.filter((row) => row.language === code), false)])) : undefined;
  return {
    caseCount: rows.length,
    httpSuccess: rows.filter((row) => row.status >= 200 && row.status < 300).length,
    facts: { hits: factsHit, required: factsRequired, preservationRate: factsRequired ? factsHit / factsRequired : null, omissionRate: factsRequired ? (factsRequired - factsHit) / factsRequired : null },
    context: { hits: contextHit, required: contextRequired, preservationRate: contextRequired ? contextHit / contextRequired : null },
    request: { correct: rows.filter((row) => row.requestHit).length, accuracy: rows.length ? rows.filter((row) => row.requestHit).length / rows.length : null },
    emotion: { expectedCases: emotionRows.length, detectedCases: rows.filter((row) => row.emotionDetected).length, recall: emotionRows.length ? emotionRows.filter((row) => row.emotionHit).length / emotionRows.length : null, overDetectionCases: rows.filter((row) => row.emotionFalsePositive).length },
    uncertainty: { expectedCases: uncertaintyRows.length, preservedCases: uncertaintyRows.filter((row) => row.uncertaintyHit).length, preservationRate: uncertaintyRows.length ? uncertaintyRows.filter((row) => row.uncertaintyHit).length / uncertaintyRows.length : null, collapseCases: rows.filter((row) => row.uncertaintyCollapse).length },
    correction: { expectedCases: rows.filter((row) => row.correctionExpected).length, handledCases: rows.filter((row) => row.correctionExpected && row.correctionHit).length },
    safety: { criticalCases: criticalRows.length, truePositive: safetyTp, falseNegative: safetyFn, falsePositive: safetyFp, recall: criticalRows.length ? safetyTp / criticalRows.length : null, precision: safetyTp + safetyFp ? safetyTp / (safetyTp + safetyFp) : null },
    hallucination: { unanchoredItems: rows.reduce((sum, row) => sum + row.unanchored.length, 0), affectedCases: rows.filter((row) => !row.evidenceCorrect).length },
    contradiction: { cases: rows.filter((row) => row.contradiction).length, rate: rows.length ? rows.filter((row) => row.contradiction).length / rows.length : null },
    evidence: { correctCases: rows.filter((row) => row.evidenceCorrect).length, correctnessRate: rows.length ? rows.filter((row) => row.evidenceCorrect).length / rows.length : null },
    latencyMs: { p50: percentile(rows.map((row) => row.elapsedMs), 0.5), p95: percentile(rows.map((row) => row.elapsedMs), 0.95), max: Math.max(...rows.map((row) => row.elapsedMs).filter(Number.isFinite), 0) },
    ...(language ? { byLanguage: language } : {}),
  };
}

const rows = [];
for (const testCase of phase2gCases) {
  const raw = await post(testCase);
  rows.push(summarize(testCase, raw));
  console.log(`${rows.length}/${phase2gCases.length} ${testCase.id} ${raw.status} ${raw.elapsedMs}ms`);
}

const report = {
  schemaVersion: 'phase2g.v1',
  generatedAt: new Date().toISOString(),
  synthetic: true,
  personalData: false,
  baseUrl,
  caseCount: phase2gCases.length,
  evaluation: aggregate(rows),
  cases: rows,
  caveats: {
    evidence: 'Evidence correctness is a strict text-anchor check, not human semantic adjudication.',
    contradiction: 'Contradiction is a conservative rule-based boundary metric and requires human review for semantic meaning reversal.',
    correction: 'Correction handling is a heuristic based on the last clause and request continuity; it is not a substitute for labeled adjudication.',
  },
};
await writeFile('docs/phase2g-adversarial-latest.json', JSON.stringify(report, null, 2));
await writeFile('docs/phase2g-adversarial-latest.md', [
  '# Phase 2G adversarial evaluation',
  '',
  `- Cases: ${report.caseCount} synthetic cases`,
  `- Generated: ${report.generatedAt}`,
  `- HTTP success: ${report.evaluation.httpSuccess}/${report.evaluation.caseCount}`,
  `- Fact preservation: ${(report.evaluation.facts.preservationRate * 100).toFixed(1)}%`,
  `- Fact omission: ${(report.evaluation.facts.omissionRate * 100).toFixed(1)}%`,
  `- Request accuracy: ${(report.evaluation.request.accuracy * 100).toFixed(1)}%`,
  `- Emotion recall: ${(report.evaluation.emotion.recall * 100).toFixed(1)}%`,
  `- Emotion over-detection: ${report.evaluation.emotion.overDetectionCases} cases`,
  `- Uncertainty preservation: ${(report.evaluation.uncertainty.preservationRate * 100).toFixed(1)}%`,
  `- Safety recall / precision: ${(report.evaluation.safety.recall * 100).toFixed(1)}% / ${(report.evaluation.safety.precision * 100).toFixed(1)}%`,
  `- Unanchored items: ${report.evaluation.hallucination.unanchoredItems}`,
  `- Contradiction candidates: ${report.evaluation.contradiction.cases}`,
  `- Evidence correctness: ${(report.evaluation.evidence.correctnessRate * 100).toFixed(1)}%`,
  `- Latency P50 / P95 / max: ${report.evaluation.latencyMs.p50}ms / ${report.evaluation.latencyMs.p95}ms / ${report.evaluation.latencyMs.max}ms`,
  '',
  'These are synthetic, rule-assisted metrics. They do not prove human burden reduction or field safety.',
].join('\n'));
console.log(JSON.stringify(report.evaluation, null, 2));
