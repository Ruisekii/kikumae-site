import { readFile, writeFile } from 'node:fs/promises';
import { phase2fCases } from './phase2f-cases.mjs';

const baseUrl = process.env.PHASE2F_BASE_URL || 'http://localhost:3000';
const qwenModel = process.env.PHASE2F_QWEN_MODEL || 'qwen3.5:4b';
const qwenLimit = Math.min(phase2fCases.length, Math.max(0, Number(process.env.PHASE2F_QWEN_CASES || phase2fCases.length)));
const qwenIds = new Set((process.env.PHASE2F_QWEN_IDS || '').split(',').map((value) => value.trim()).filter(Boolean));
const skipQwen = process.env.PHASE2F_SKIP_QWEN === '1';
const requestTimeoutMs = Number(process.env.PHASE2F_TIMEOUT_MS || 120000);

const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};

const normalize = (value) => String(value ?? '').toLocaleLowerCase().replace(/[\s、。・!！?？「」『』()（）\[\]【】,.:;〜~ー\-]/g, '');

function matches(values, patterns) {
  return patterns.every((pattern) => values.some((value) => new RegExp(pattern, 'i').test(String(value))));
}

function flattenOrganization(organization) {
  const group = (name) => Array.isArray(organization?.[name]) ? organization[name] : [];
  return {
    facts: group('facts').map((item) => String(item.value ?? item)),
    context: group('context').map((item) => String(item.value ?? item)),
    requests: group('requests').map((item) => String(item.value ?? item)),
    emotion: group('emotionalState').map((item) => String(item.value ?? item)),
    uncertainty: group('uncertainPoints').map((item) => String(item.value ?? item)),
    safety: group('safetySignals').map((item) => String(item.value ?? item)),
    all: [...group('facts'), ...group('context'), ...group('requests'), ...group('emotionalState'), ...group('uncertainPoints'), ...group('safetySignals')],
    anchored: [...group('facts'), ...group('context'), ...group('requests'), ...group('emotionalState'), ...group('uncertainPoints'), ...group('safetySignals')].every((item) => item?.evidence && String(organization?.original?.originalText ?? '').includes(item.evidence)),
  };
}

function flattenIncident(incident, safety) {
  const target = incident?.target ? [incident.target.type, incident.target.ageGroup, incident.target.count ? `${incident.target.count}人` : ''].filter(Boolean) : [];
  return {
    facts: Array.isArray(incident?.facts) ? incident.facts.map(String) : [],
    context: [incident?.location, ...target].filter(Boolean).map(String),
    requests: incident?.request ? [String(incident.request)] : [],
    emotion: [],
    uncertainty: (Array.isArray(incident?.facts) ? incident.facts : []).filter((value) => /かもしれ|たぶん|可能性|maybe|perhaps|might|not sure|可能|也许|아마|모르/i.test(String(value))),
    safety: [...(Array.isArray(incident?.safetyFlags) ? incident.safetyFlags : []), ...(Array.isArray(safety?.flags) ? safety.flags : [])].map(String),
    all: [...(Array.isArray(incident?.facts) ? incident.facts : []), incident?.location, ...target, incident?.request, incident?.urgency].filter(Boolean).map(String),
    anchored: null,
  };
}

function supportedValue(value, text) {
  const fact = normalize(value);
  const source = normalize(text);
  if (!fact || fact.length < 2) return true;
  if (source.includes(fact)) return true;
  const aliases = [
    ['飲料水', '水', '給水', 'water', 'drinkingwater', '식수', '饮用水'],
    ['食事', '食料', 'ごはん', 'food', 'meal', '음식'],
    ['トイレ', '厕所', 'toilet', 'bathroom', '화장실'],
    ['おむつ', '紙おむつ', '奶粉', '분유', 'blanket', '毛布'],
    ['子ども', '子供', 'child', 'children', 'kids', '孩子', '아이'],
    ['赤ちゃん', '乳児', 'baby', '婴儿', '아이'],
    ['薬', 'medicine', 'insulin', '약'],
    ['煙', '火', '火事', '火災', 'smoke', 'fire', 'flames', '화재'],
    ['暴力', '殴', 'knife', 'weapon', 'violence', '폭력'],
    ['不安', '焦り', '怒り', '不満', 'anxious', 'worried', 'frustrat', '不安'],
  ];
  return aliases.some((group) => group.some((term) => fact.includes(normalize(term))) && group.some((term) => source.includes(normalize(term))));
}

function summarizeCase(testCase, raw, kind) {
  const expected = testCase.expected;
  const output = kind === 'fallback' ? flattenOrganization(raw.organization) : flattenIncident(raw.incident, raw.safety);
  const factualValues = [...output.facts, ...output.context, ...output.uncertainty];
  const allValues = [...factualValues, ...output.requests, ...output.safety];
  const factHits = (expected.factPatterns || []).filter((pattern) => matches(factualValues, [pattern]));
  const contextHits = (expected.contextPatterns || []).filter((pattern) => matches([...output.context, ...output.facts], [pattern]));
  const requestHit = expected.request == null || output.requests.includes(expected.request);
  const emotionExpected = (expected.emotionPatterns || []).length > 0;
  const emotionHit = !emotionExpected || kind === 'qwen' || (expected.emotionPatterns || []).some((pattern) => output.emotion.some((value) => new RegExp(pattern, 'i').test(String(value))));
  const emotionDetected = output.emotion.length > 0;
  const emotionFalsePositive = !emotionExpected && emotionDetected;
  const uncertaintyHit = !expected.uncertain || output.uncertainty.length > 0;
  const safetyDetected = output.safety.length > 0 || raw.safety?.immediate === true;
  const safetyHit = expected.critical ? safetyDetected : true;
  const safetyFalsePositive = !expected.critical && safetyDetected;
  const expectedSafetyLabels = expected.safetyLabels || [];
  const safetyLabelsHit = expectedSafetyLabels.length === 0 || expectedSafetyLabels.every((label) => output.safety.some((value) => String(value).includes(label)) || raw.safety?.flags?.includes(label));
  const contradiction = safetyFalsePositive || (expected.correction?.mustNotContain || []).some((pattern) => matches(allValues, [pattern]));
  const correctionHit = !expected.correction || (expected.correction.mustContain || []).every((pattern) => matches(allValues, [pattern]));
  const uncertaintyCollapse = expected.uncertain && kind === 'qwen' && output.uncertainty.length === 0;
  const hallucinatedValues = kind === 'fallback'
    ? output.all.filter((item) => item?.evidence && !testCase.text.includes(item.evidence)).map((item) => item.value)
    : output.facts.filter((item) => !supportedValue(item, testCase.text));
  const requiredFacts = expected.factPatterns || [];
  const requiredContext = expected.contextPatterns || [];
  return {
    id: testCase.id,
    kind,
    aiMode: raw.aiMode ?? null,
    status: raw.status,
    elapsedMs: raw.elapsedMs,
    factHits: factHits.length,
    factRequired: requiredFacts.length,
    contextHits: contextHits.length,
    contextRequired: requiredContext.length,
    requestHit,
    emotionExpected,
    emotionHit,
    emotionDetected,
    emotionFalsePositive,
    uncertaintyExpected: expected.uncertain,
    uncertaintyHit,
    uncertaintyCollapse,
    safetyExpected: expected.critical,
    safetyDetected,
    safetyHit,
    safetyFalsePositive,
    safetyLabelsHit,
    hallucinatedValues,
    contradiction,
    correctionExpected: Boolean(expected.correction),
    correctionHit,
    output: kind === 'fallback' ? { organization: raw.organization, safety: raw.safety } : { incident: raw.incident, safety: raw.safety },
  };
}

function aggregate(kind, rows, cases) {
  const caseCount = cases.length;
  const factRequired = rows.reduce((sum, row) => sum + row.factRequired, 0);
  const factHits = rows.reduce((sum, row) => sum + row.factHits, 0);
  const contextRequired = rows.reduce((sum, row) => sum + row.contextRequired, 0);
  const contextHits = rows.reduce((sum, row) => sum + row.contextHits, 0);
  const criticalRows = rows.filter((row) => row.safetyExpected);
  const nonCriticalRows = rows.filter((row) => !row.safetyExpected);
  const tp = criticalRows.filter((row) => row.safetyDetected).length;
  const fn = criticalRows.filter((row) => !row.safetyDetected).length;
  const fp = nonCriticalRows.filter((row) => row.safetyFalsePositive).length;
  const correctionRows = rows.filter((row) => row.correctionExpected);
  const emotionRows = rows.filter((row) => row.emotionExpected);
  return {
    kind,
    caseCount,
    httpSuccess: rows.filter((row) => row.status >= 200 && row.status < 300).length,
    fieldMetrics: {
      facts: { hits: factHits, required: factRequired, retentionRate: factRequired ? factHits / factRequired : null },
      context: { hits: contextHits, required: contextRequired, retentionRate: contextRequired ? contextHits / contextRequired : null },
      request: { correct: rows.filter((row) => row.requestHit).length, total: caseCount, accuracy: caseCount ? rows.filter((row) => row.requestHit).length / caseCount : null },
      emotion: kind === 'qwen' ? { supported: false, reason: 'Incident Extraction schema has no emotionalState field' } : { supported: true, expectedCases: emotionRows.length, detectedCases: rows.filter((row) => row.emotionDetected).length, expectedHitCases: emotionRows.filter((row) => row.emotionHit).length, recall: emotionRows.length ? emotionRows.filter((row) => row.emotionHit).length / emotionRows.length : null, falsePositiveCases: rows.filter((row) => row.emotionFalsePositive).length },
      uncertainty: { expectedCases: rows.filter((row) => row.uncertaintyExpected).length, preservedCases: rows.filter((row) => row.uncertaintyExpected && row.uncertaintyHit).length, preservedRate: rows.filter((row) => row.uncertaintyExpected).length ? rows.filter((row) => row.uncertaintyExpected && row.uncertaintyHit).length / rows.filter((row) => row.uncertaintyExpected).length : null, collapseCases: rows.filter((row) => row.uncertaintyCollapse).length },
      correctionHandling: { expected: correctionRows.length, correct: correctionRows.filter((row) => row.correctionHit).length, accuracy: correctionRows.length ? correctionRows.filter((row) => row.correctionHit).length / correctionRows.length : null },
    },
    safety: { criticalCases: criticalRows.length, truePositive: tp, falseNegative: fn, falsePositive: fp, recall: criticalRows.length ? tp / criticalRows.length : null, precision: tp + fp ? tp / (tp + fp) : null, expectedLabelHitRate: criticalRows.length ? criticalRows.filter((row) => row.safetyLabelsHit).length / criticalRows.length : null },
    hallucination: { count: rows.reduce((sum, row) => sum + row.hallucinatedValues.length, 0), ratePerCase: caseCount ? rows.filter((row) => row.hallucinatedValues.length > 0).length / caseCount : null },
    omission: { importantFactsOmitted: factRequired - factHits, rate: factRequired ? (factRequired - factHits) / factRequired : null },
    contradiction: { cases: rows.filter((row) => row.contradiction).length, rate: caseCount ? rows.filter((row) => row.contradiction).length / caseCount : null },
    latencyMs: { p50: percentile(rows.map((row) => row.elapsedMs), 50), p95: percentile(rows.map((row) => row.elapsedMs), 95), max: Math.max(...rows.map((row) => row.elapsedMs).filter(Number.isFinite), 0) },
    evidenceAnchoredRate: kind === 'fallback' ? rows.filter((row) => row.output.organization && flattenOrganization(row.output.organization).anchored).length / Math.max(1, caseCount) : null,
  };
}

async function post(testCase, mode, headers = {}) {
  const state = { language: testCase.language, location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [] };
  const body = { mode, text: testCase.text, selectedLanguage: testCase.language, state, intake: {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/ai/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kikumae-eval-suite': 'phase2e', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json();
    return { status: response.status, elapsedMs: Math.round(performance.now() - started), aiMode: data.aiMode, safety: data.safety, organization: data.organization, incident: data.incident, telemetry: data.telemetry, data };
  } catch (error) {
    return { status: 599, elapsedMs: Math.round(performance.now() - started), aiMode: 'request-failed', safety: null, error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function evaluateFallback() {
  const rows = [];
  for (const testCase of phase2fCases) {
    const raw = await post(testCase, 'organize');
    const row = summarizeCase(testCase, raw, 'fallback');
    rows.push(row);
    console.log(`fallback ${rows.length}/${phase2fCases.length} ${testCase.id}: ${raw.status} ${raw.elapsedMs}ms`);
  }
  return { summary: aggregate('fallback', rows, phase2fCases), rows };
}

async function evaluateQwen() {
  const cases = qwenIds.size ? phase2fCases.filter((testCase) => qwenIds.has(testCase.id)).slice(0, qwenLimit) : phase2fCases.slice(0, qwenLimit);
  const rows = [];
  for (const testCase of cases) {
    const raw = await post(testCase, 'extract', { 'x-kikumae-eval-model': qwenModel, 'x-kikumae-eval-prompt': 'full' });
    const row = summarizeCase(testCase, raw, 'qwen');
    rows.push(row);
    console.log(`qwen ${rows.length}/${cases.length} ${testCase.id}: ${raw.status} ${raw.elapsedMs}ms ${raw.aiMode ?? ''}`);
  }
  return { model: qwenModel, requestedCases: cases.length, summary: aggregate('qwen', rows, cases), rows };
}

const fallback = await evaluateFallback();
let previousQwen = null;
if (skipQwen && process.env.PHASE2F_REUSE_QWEN === '1') {
  try { previousQwen = JSON.parse(await readFile('docs/phase2f-stress-evaluation-latest.json', 'utf8')).qwen ?? null; } catch { previousQwen = null; }
}
const qwen = skipQwen ? (previousQwen ?? { skipped: true, reason: 'PHASE2F_SKIP_QWEN=1' }) : await evaluateQwen();
const report = {
  schemaVersion: 'phase2f.v1',
  generatedAt: new Date().toISOString(),
  baseUrl,
  fixedCaseCount: phase2fCases.length,
  evaluationSet: { synthetic: true, personalData: false, cases: phase2fCases.map(({ id, language, tags, expected }) => ({ id, language, tags, expected })) },
  fallback,
  qwen,
  interpretation: {
    fallback: 'Phase 2E evidence-bound staff organization, equivalent to the public demo processing lane.',
    qwen: 'Qwen is evaluated as optional Incident Extraction. Its schema does not contain emotionalState, so emotion quality is not claimed for this lane.',
    hallucination: 'Heuristic metric: evidence anchors for fallback and conservative alias checks for Qwen. It is not a human semantic adjudication.',
  },
};
await writeFile('docs/phase2f-stress-evaluation-latest.json', JSON.stringify(report, null, 2), 'utf8');
const comparison = {
  schemaVersion: 'phase2f.v1',
  generatedAt: report.generatedAt,
  cases: phase2fCases.length,
  localEvaluation: { qwenModel, qwenCases: qwen.requestedCases ?? 0, qwenSummary: qwen.summary ?? null, fallbackSummary: fallback.summary },
  publicDemo: { mode: 'fallback', source: 'evidence-bound staff organization', summary: fallback.summary },
  caveats: report.interpretation,
};
await writeFile('docs/phase2f-qwen-vs-fallback.json', JSON.stringify(comparison, null, 2), 'utf8');
console.log(JSON.stringify({ fallback: fallback.summary, qwen: qwen.summary ?? qwen }, null, 2));
