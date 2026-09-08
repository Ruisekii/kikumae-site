import { mkdir, writeFile } from 'node:fs/promises';
import { phase2dCases } from './phase2d-cases.mjs';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2D_EVAL_OUTPUT ?? 'docs/phase2d-evaluation-latest.json';
const conversationLimit = Math.max(0, Number(process.env.PHASE2D_CONVERSATION_CASES ?? 6));
const extractionLimit = Math.max(0, Number(process.env.PHASE2D_EXTRACTION_CASES ?? 1));
const timeoutMs = Number(process.env.PHASE2D_TIMEOUT_MS ?? 180000);
let requestNumber = 0;

function stateFor(testCase) {
  const intake = testCase.intake ?? {};
  const people = Number(String(intake.peopleCount ?? '').match(/\d+/)?.[0] ?? NaN);
  return {
    language: 'ja', location: intake.location ?? null,
    target: Number.isFinite(people) ? { type: null, count: people, ageGroup: null } : null,
    facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [], confidence: null, category: null,
  };
}

async function post(path, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `phase2d-eval-${requestNumber++}`, ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const payload = await response.json();
    return { status: response.status, elapsedMs: Math.round(performance.now() - started), payload };
  } catch (error) {
    return { status: 599, elapsedMs: Math.round(performance.now() - started), payload: { error: String(error), timeout: error?.name === 'AbortError' } };
  } finally { clearTimeout(timer); }
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1)] : null;
}

function compare(testCase, result) {
  const incident = result.payload?.incident ?? {};
  const expected = testCase.expected ?? {};
  const requestMatch = expected.request == null || incident.request === expected.request;
  const locationMatch = expected.location === undefined || incident.location === expected.location;
  const countMatch = expected.count === undefined || incident.target?.count === expected.count;
  const safetyMatch = expected.safety === undefined || Boolean(result.payload?.safety?.immediate) === expected.safety;
  const gateMatch = expected.fourB === undefined || Boolean(result.payload?.extraction?.useExtraction) === expected.fourB;
  return { requestMatch, locationMatch, countMatch, safetyMatch, gateMatch, passed: requestMatch && locationMatch && countMatch && safetyMatch && gateMatch };
}

const cases = [];
for (const testCase of phase2dCases) {
  const result = await post('/api/ai/voice', { mode: 'triage', text: testCase.text, state: stateFor(testCase), intake: testCase.intake ?? {}, selectedLanguage: 'ja' });
  cases.push({ id: testCase.id, text: testCase.text, expected: testCase.expected, result, comparison: compare(testCase, result) });
}

const conversationCases = [];
for (const testCase of phase2dCases.slice(0, conversationLimit)) {
  const result = await post('/api/ai/voice', { mode: 'conversation', text: testCase.text, state: stateFor(testCase), intake: testCase.intake ?? {}, selectedLanguage: 'ja' });
  conversationCases.push({ id: testCase.id, result });
}

const extractionCases = [];
for (const item of cases.filter((item) => item.result.payload?.extraction?.useExtraction).slice(0, extractionLimit)) {
  const sourceCase = phase2dCases.find((testCase) => testCase.id === item.id);
  const result = await post('/api/ai/voice', { mode: 'extract', text: item.text, state: stateFor(sourceCase ?? {}), intake: sourceCase?.intake ?? {}, selectedLanguage: 'ja' });
  extractionCases.push({ id: item.id, result });
}

const triageLatencies = cases.map((item) => item.result.elapsedMs);
const conversationLatencies = conversationCases.map((item) => item.result.elapsedMs);
const extractionLatencies = extractionCases.map((item) => item.result.elapsedMs);
const passed = cases.filter((item) => item.comparison.passed).length;
const gateExpected = cases.filter((item) => item.expected.fourB !== undefined);
const gateCorrect = gateExpected.filter((item) => item.comparison.gateMatch).length;
const report = {
  generatedAt: new Date().toISOString(), baseUrl,
  fixedCaseCount: phase2dCases.length,
  gate: {
    fourBUseRate: cases.filter((item) => item.result.payload?.extraction?.useExtraction).length / cases.length,
    fourBFreeCompletionRate: cases.filter((item) => !item.result.payload?.extraction?.useExtraction && item.comparison.passed).length / cases.filter((item) => !item.result.payload?.extraction?.useExtraction).length,
    explicitGateAccuracy: gateExpected.length ? gateCorrect / gateExpected.length : null,
    gateExpectedCases: gateExpected.length,
  },
  quality: {
    triageCasesPassed: passed, triageCasesTotal: cases.length,
    requestRetention: cases.filter((item) => item.comparison.requestMatch).length / cases.length,
    locationRetention: cases.filter((item) => item.comparison.locationMatch).length / cases.length,
    targetCountRetention: cases.filter((item) => item.comparison.countMatch).length / cases.length,
    safetyImmediateAccuracy: cases.filter((item) => item.comparison.safetyMatch).length / cases.length,
  },
  latencyMs: {
    safetyAndCardFirst: { p50: percentile(triageLatencies, 50), p95: percentile(triageLatencies, 95), max: Math.max(...triageLatencies) },
    conversation: { count: conversationCases.length, p50: percentile(conversationLatencies, 50), p95: percentile(conversationLatencies, 95), max: conversationLatencies.length ? Math.max(...conversationLatencies) : null },
    conditionalExtraction: { count: extractionCases.length, p50: percentile(extractionLatencies, 50), p95: percentile(extractionLatencies, 95), max: extractionLatencies.length ? Math.max(...extractionLatencies) : null },
  },
  conversation: conversationCases,
  conditionalExtraction: extractionCases,
  cases,
};
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, gate: report.gate, quality: report.quality, latencyMs: report.latencyMs }, null, 2));
