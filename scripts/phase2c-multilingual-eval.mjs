import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { phase2cCases } from './phase2c-cases.mjs';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2C_MULTILINGUAL_OUTPUT ?? 'docs/phase2c-multilingual-latest.json';
const limitPerLanguage = Math.max(1, Number(process.env.PHASE2C_LANGUAGE_LIMIT ?? 10));
const languages = ['ja', 'en', 'zh', 'ko'];

function initialState() {
  return { language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [], confidence: null, category: null };
}

async function post(path, body, headers = {}, timeoutMs = 180000, key = 'phase2c') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `${key}-${Math.random().toString(36).slice(2)}`, ...headers }, body: JSON.stringify(body), signal: controller.signal });
    return { status: response.status, elapsedMs: Math.round(performance.now() - started), data: await response.json() };
  } catch (error) {
    return { status: 599, elapsedMs: Math.round(performance.now() - started), data: { error: error instanceof Error ? error.message : String(error) } };
  } finally { clearTimeout(timer); }
}

function normalized(value) {
  return String(value ?? '').toLocaleLowerCase().replace(/[\s、。・!！?？「」『』()（）\[\]【】,.:;〜~ー\-]/g, '');
}

function hit(actual, expected) {
  const a = normalized(actual); const e = normalized(expected);
  return Boolean(a && e && (a.includes(e) || e.includes(a)));
}

function factsHit(actual, expected) {
  const facts = Array.isArray(actual) ? actual.map(normalized) : [];
  return (expected ?? []).filter((item) => {
    const e = normalized(item);
    return facts.some((fact) => fact.includes(e) || e.includes(fact) || (e.includes('water') && /water|水|饮料|식수/.test(fact)) || (e.includes('fever') && /fever|发烧|열|39/.test(fact)) || (e.includes('煙') && /煙|smoke|火|연기/.test(fact)) || (e.includes('fire') && /fire|火|화재|불/.test(fact)) || (e.includes('breath') && /breath|呼吸|숨/.test(fact)) || (e.includes('diaper') && /diaper|尿布|기저귀|おむつ/.test(fact)));
  }).length;
}

function safetyFlags(data) {
  const flags = new Set();
  for (const flag of [...(data?.safety?.flags ?? []), ...(data?.incident?.safetyFlags ?? [])]) {
    const value = String(flag);
    if (/火災|煙|fire|smoke|火灾|화재|연기/i.test(value)) flags.add('possible_fire');
    if (/暴力|武器|violence|knife|폭력|흉기/i.test(value)) flags.add('possible_violence');
    if (/意識|呼吸|体調|医療|medical|breath|conscious|意识|呼吸|의식|호흡/i.test(value)) flags.add('possible_medical_emergency');
  }
  return flags;
}

function extractionScore(extraction, expected) {
  const actual = extraction?.incident;
  const target = expected.target === null
    ? actual?.target == null
    : actual?.target?.count === expected.target.count && (!expected.target.type || actual?.target?.type === expected.target.type);
  const expectedFlags = new Set(expected.safetyFlags ?? []);
  const actualFlags = safetyFlags(extraction.data);
  const flags = [...expectedFlags].every((flag) => actualFlags.has(flag));
  const facts = factsHit(actual?.facts, expected.facts) === (expected.facts ?? []).length;
  return {
    schema: Boolean(actual && (actual.location === null || typeof actual.location === 'string') && Array.isArray(actual.facts) && Array.isArray(actual.safetyFlags) && Array.isArray(actual.missingFields) && Array.isArray(actual.originalText)),
    location: expected.location === null ? actual?.location == null : hit(actual?.location, expected.location),
    target, request: actual?.request === expected.request, urgency: actual?.urgency === expected.urgency,
    safetyFlags: flags, missingFields: (expected.missingFields ?? []).every((field) => actual?.missingFields?.includes(field)), facts,
  };
}

function languageLeak(language, reply) {
  if (!reply) return true;
  if (language === 'en' || language === 'ko') return /[ぁ-ゖァ-ヺ]/u.test(reply);
  if (language === 'zh') return /[ぁ-ゖァ-ヺㄱ-ㅎㅏ-ㅣ가-힣]/u.test(reply);
  return false;
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1)] : null;
}

function timing(rows) {
  const values = rows.map((row) => row.data?.telemetry?.totalMs ?? row.elapsedMs).filter(Number.isFinite);
  return { p50: percentile(values, 50), p95: percentile(values, 95), max: values.length ? Math.max(...values) : null };
}

const cases = languages.flatMap((language) => phase2cCases.filter((item) => item.language === language).slice(0, limitPerLanguage));
let rows = [];
try { rows = JSON.parse(await readFile(`${outputPath}.partial`, 'utf8')).rows ?? []; } catch { rows = []; }
async function checkpoint() {
  await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
  await writeFile(`${outputPath}.partial`, JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, rows }, null, 2), 'utf8');
}
for (const testCase of cases) {
  if (rows.some((row) => row.id === testCase.id)) continue;
  const safety = await post('/api/ai/voice', { mode: 'extract', text: testCase.text, state: initialState(), intake: {}, selectedLanguage: testCase.language }, { 'x-kikumae-safety-only': '1' }, 30000, `phase2c-safety-${testCase.id}`);
  const extraction = await post('/api/ai/voice', { mode: 'extract', text: testCase.text, state: { ...initialState(), language: testCase.language }, intake: {}, selectedLanguage: testCase.language }, {}, 180000, `phase2c-extract-${testCase.id}`);
  const conversation = await post('/api/ai/voice', { mode: 'conversation', text: testCase.text, state: { ...initialState(), language: testCase.language }, intake: {}, selectedLanguage: testCase.language }, {}, 180000, `phase2c-conversation-${testCase.id}`);
  const reply = typeof conversation.data?.reply === 'string' ? conversation.data.reply : '';
  rows.push({ id: testCase.id, language: testCase.language, label: testCase.label, input: testCase.text, expected: testCase.expected, critical: testCase.critical, safety: { status: safety.status, actual: safety.data?.safety?.immediate === true, flags: safety.data?.safety?.flags ?? [] }, extraction: { status: extraction.status, elapsedMs: extraction.elapsedMs, incident: extraction.data?.incident ?? null, data: extraction.data ?? null }, conversation: { status: conversation.status, elapsedMs: conversation.elapsedMs, reply, nextField: conversation.data?.nextField ?? null, valid: conversation.status >= 200 && conversation.status < 300 && Boolean(reply) && !languageLeak(testCase.language, reply), languageLeak: languageLeak(testCase.language, reply) } });
  await checkpoint();
  console.log(`${testCase.id}: safety=${safety.status} extraction=${extraction.status} conversation=${conversation.status}`);
}

try {
  const safetyRows = JSON.parse(await readFile('docs/phase2c-safety-multilingual-latest.json', 'utf8')).rows ?? [];
  const safetyById = new Map(safetyRows.map((row) => [row.id, row]));
  for (const row of rows) {
    const safety = safetyById.get(row.id);
    if (safety) row.safety = { status: safety.status, actual: safety.actual, flags: safety.flags };
  }
} catch { /* the main report remains usable without the optional recheck */ }

const byLanguage = Object.fromEntries(languages.map((language) => {
  const subset = rows.filter((row) => row.language === language);
  const critical = subset.filter((row) => row.critical);
  const tp = critical.filter((row) => row.safety.actual).length;
  const fp = subset.filter((row) => !row.critical && row.safety.actual).length;
  const fn = critical.filter((row) => !row.safety.actual).length;
  const scores = subset.map((row) => extractionScore(row.extraction, row.expected));
  const fieldNames = ['schema', 'location', 'target', 'request', 'urgency', 'safetyFlags', 'missingFields', 'facts'];
  return [language, { cases: subset.length, safety: { truePositive: tp, falsePositive: fp, falseNegative: fn, recall: tp + fn ? tp / (tp + fn) : null, precision: tp + fp ? tp / (tp + fp) : null }, conversation: { valid: subset.filter((row) => row.conversation.valid).length, languageLeak: subset.filter((row) => row.conversation.languageLeak).length, latency: timing(subset.map((row) => ({ data: { telemetry: { totalMs: row.conversation.elapsedMs } }, elapsedMs: row.conversation.elapsedMs }))) }, extraction: { schema: scores.filter((score) => score.schema).length, fieldAccuracy: Object.fromEntries(fieldNames.map((name) => [name, scores.filter((score) => score[name]).length / (scores.length || 1)])), latency: timing(subset.map((row) => ({ data: { telemetry: { totalMs: row.extraction.data?.telemetry?.totalMs } }, elapsedMs: row.extraction.elapsedMs }))) } }];
}));

const report = { generatedAt: new Date().toISOString(), baseUrl, casesPerLanguage: limitPerLanguage, languages, rows, byLanguage };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, byLanguage: report.byLanguage }, null, 2));
