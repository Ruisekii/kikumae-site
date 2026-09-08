import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { phase2a5Cases } from './phase2a5-cases.mjs';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2B_OUTPUT ?? 'docs/phase2b-evaluation-latest.json';
const limit = Math.max(1, Math.min(phase2a5Cases.length, Number(process.env.PHASE2B_LIMIT ?? phase2a5Cases.length)));
const cases = phase2a5Cases.slice(0, limit);
const extractionModels = (process.env.PHASE2B_EXTRACTION_MODELS ?? 'qwen3.5:2b,qwen3.5:4b').split(',').map((value) => value.trim()).filter(Boolean);
const conversationModels = (process.env.PHASE2B_CONVERSATION_MODELS ?? 'qwen3.5:2b,qwen3.5:4b').split(',').map((value) => value.trim()).filter(Boolean);
const promptVariants = (process.env.PHASE2B_PROMPT_VARIANTS ?? 'full,compact').split(',').map((value) => value.trim()).filter((value) => value === 'full' || value === 'compact');
const conversationCases = cases.filter((item) => ['water', 'toilet', 'medical', 'hard', 'insufficient', 'dialect-asr'].includes(item.group)).slice(0, Number(process.env.PHASE2B_CONVERSATION_LIMIT ?? 20));

function initialState(text) {
  return { language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [text], confidence: null, category: null };
}

async function post(path, body, headers = {}, timeoutMs = 180000, rateKey = 'phase2b-eval') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': rateKey, ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json();
    return { status: response.status, elapsedMs: Math.round(performance.now() - started), data };
  } catch (error) {
    return { status: 599, elapsedMs: Math.round(performance.now() - started), data: { error: error instanceof Error ? error.message : String(error) } };
  } finally { clearTimeout(timer); }
}

function compact(value) {
  return String(value ?? '').toLowerCase().replace(/[\s、。・!！?？「」『』()（）\[\]【】,.:;〜~ー\-]/g, '').replace(/使用できません|使用出来ません|使用不可|使えません|使えない/g, '使えない').replace(/ありません|ないです|無い|なくなりました|切れました/g, 'ない').replace(/３９|三十九/g, '39').replace(/度/g, '℃');
}

function semanticHit(actual, expected, source = '') {
  const a = compact(actual); const e = compact(expected); if (!a || !e) return false;
  if (a.includes(e) || e.includes(a)) return true;
  const aliases = [['ぐったり', '反応が弱い', '意識', '起きない'], ['詰ま', '流れない', '使えない'], ['おむつ', '紙おむつ'], ['食事', 'ごはん', '食べ物'], ['水', '飲料水', '給水'], ['煙', 'けむり'], ['火', 'かじ', '火災'], ['怖い', '不安', '危険'], ['待', '遅れ'], ['暑い', '空調', '涼しい'], ['しゃべれない', '会話が続かない', '息']];
  return aliases.some((group) => group.some((item) => a.includes(compact(item))) && group.some((item) => e.includes(compact(item)))) || (source && aliases.some((group) => group.some((item) => e.includes(compact(item)) && compact(source).includes(compact(item))) && a.length > 1));
}

function factCoverage(result, expected, source) {
  const expectedFacts = Array.isArray(expected.facts) ? expected.facts : [];
  const facts = Array.isArray(result?.facts) ? result.facts.map(String) : [];
  const hits = expectedFacts.filter((item) => facts.some((fact) => semanticHit(fact, item, source)));
  const sourceText = compact(source);
  const hallucinated = facts.filter((fact) => { const normalized = compact(fact); return !expectedFacts.some((item) => semanticHit(fact, item, source)) && !(normalized.length >= 2 && (sourceText.includes(normalized) || normalized.includes(sourceText.slice(0, Math.min(12, sourceText.length))))); });
  return { expected: expectedFacts.length, hits: hits.length, omitted: expectedFacts.length - hits.length, omissionRate: expectedFacts.length ? (expectedFacts.length - hits.length) / expectedFacts.length : 0, hallucinated: hallucinated.length };
}

function safetyFlags(value) {
  const flags = new Set();
  for (const flag of Array.isArray(value?.flags) ? value.flags : []) {
    if (/火災|煙/.test(String(flag))) flags.add('possible_fire');
    if (/暴力|武器/.test(String(flag))) flags.add('possible_violence');
    if (/自傷|自殺/.test(String(flag))) flags.add('possible_self_harm');
    if (/意識|呼吸|医療|体調|胸痛|出血/.test(String(flag))) flags.add('possible_medical_emergency');
  }
  for (const flag of Array.isArray(value?.safetyFlags) ? value.safetyFlags : []) flags.add(String(flag));
  return flags;
}

function schemaValid(value) {
  return Boolean(value && typeof value === 'object' && (value.location === null || typeof value.location === 'string') && (value.target === null || typeof value.target === 'object') && Array.isArray(value.facts) && Array.isArray(value.safetyFlags) && Array.isArray(value.missingFields) && Array.isArray(value.askedFields) && ['unknown', 'low', 'medium', 'high'].includes(value.urgency) && Array.isArray(value.originalText));
}

function score(result, expected, source, safety) {
  const fact = factCoverage(result, expected, source);
  const checks = {
    location: expected.location === null ? (result?.location ?? null) === null : result?.location === expected.location,
    target: expected.target === null ? (result?.target ?? null) === null : result?.target?.count === expected.target.count && (expected.target.type === null || result?.target?.type === expected.target.type),
    request: expected.request === undefined ? true : result?.request === expected.request,
    urgency: expected.urgency === undefined ? true : result?.urgency === expected.urgency,
    missingFields: (expected.missingFields ?? []).every((field) => Array.isArray(result?.missingFields) && result.missingFields.includes(field)),
    safetyFlags: (expected.safetyFlags ?? []).every((flag) => safetyFlags(safety).has(flag) || (Array.isArray(result?.safetyFlags) && result.safetyFlags.includes(flag))),
    facts: fact.omitted === 0,
    schema: schemaValid(result),
  };
  return { checks, passed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length, exact: Object.values(checks).every(Boolean), fact };
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function timingSummary(items) {
  const paths = ['elapsedMs', 'totalMs', 'httpHeadersMs', 'firstTokenMs', 'promptUntilFirstTokenMs', 'generationMs', 'bodyReadMs', 'jsonParseMs', 'normalizationMs', 'safetyGuardMs'];
  return Object.fromEntries(paths.map((path) => {
    const values = items.map((item) => { const telemetry = item.data?.telemetry ?? item.telemetry; return path === 'elapsedMs' ? item.elapsedMs : telemetry?.[path] ?? telemetry?.modelTimings?.[path]; }).filter((value) => Number.isFinite(value));
    return [path, { p50: percentile(values, 50), p90: percentile(values, 90), p95: percentile(values, 95), max: values.length ? Math.max(...values) : null }];
  }));
}

function safetySummary(results) {
  let tp = 0; let fp = 0; let fn = 0;
  for (const item of results) { const expected = item.expected.critical === true; const predicted = item.data?.safety?.immediate === true; if (expected && predicted) tp += 1; if (!expected && predicted) fp += 1; if (expected && !predicted) fn += 1; }
  return { criticalCases: tp + fn, truePositive: tp, falsePositive: fp, missed: fn, recall: tp + fn ? tp / (tp + fn) : null, precision: tp + fp ? tp / (tp + fp) : null };
}

function summarizeExtraction(model, prompt, results) {
  const successful = results.filter((item) => item.status >= 200 && item.status < 300);
  const expectedFacts = results.reduce((sum, item) => sum + item.score.fact.expected, 0);
  const omittedFacts = results.reduce((sum, item) => sum + item.score.fact.omitted, 0);
  return {
    model, promptVariant: prompt, caseCount: results.length, httpSuccess: successful.length, schemaValid: successful.filter((item) => item.score.checks.schema).length,
    exact: successful.filter((item) => item.score.exact).length, fallback: results.filter((item) => item.data?.aiMode === 'local-rules' || item.data?.telemetry?.fallback === true).length,
    factMetrics: { expectedFacts, omittedFacts, importantFactOmissionRate: expectedFacts ? omittedFacts / expectedFacts : null, hallucinatedFacts: results.reduce((sum, item) => sum + item.score.fact.hallucinated, 0) },
    fieldMetrics: Object.fromEntries(['location', 'target', 'request', 'urgency', 'missingFields', 'facts'].map((key) => { const correct = results.filter((item) => item.score.checks[key]).length; return [key, { correct, total: results.length, accuracy: results.length ? correct / results.length : null }]; })),
    safety: safetySummary(results), latency: timingSummary(results), results,
  };
}

async function evaluateExtraction(model, prompt) {
  const results = [];
  for (const testCase of cases) {
    const response = await post('/api/ai/voice', { mode: 'extract', text: testCase.text, state: initialState(testCase.text), intake: testCase.intake }, { 'x-kikumae-eval-model': model, 'x-kikumae-eval-prompt': prompt }, 180000, `phase2b-${model}-${prompt}-${testCase.id}`);
    const incident = response.data?.incident ?? null;
    results.push({ id: testCase.id, label: testCase.label, group: testCase.group, input: testCase.text, expected: testCase.expected, status: response.status, elapsedMs: response.elapsedMs, data: { incident, aiMode: response.data?.aiMode ?? null, safety: response.data?.safety ?? null, telemetry: response.data?.telemetry ?? null }, score: score(incident, testCase.expected, testCase.text, response.data?.safety) });
    console.log(`extract ${model}/${prompt} ${results.length}/${cases.length} ${testCase.label}: ${response.status} ${response.elapsedMs}ms`);
  }
  return summarizeExtraction(model, prompt, results);
}

async function evaluateConversation(model) {
  const results = [];
  for (const testCase of conversationCases) {
    const response = await post('/api/ai/voice', { mode: 'conversation', text: testCase.text, state: initialState(testCase.text), intake: testCase.intake }, { 'x-kikumae-eval-model': model }, 180000, `phase2b-conversation-${model}-${testCase.id}`);
    const reply = typeof response.data?.reply === 'string' ? response.data.reply : '';
    const nextField = response.data?.nextField ?? null;
    const validNextField = nextField === null || ['場所', '人数', '残量', '最後に受け取った時刻', '追加確認'].includes(nextField);
    results.push({ id: testCase.id, label: testCase.label, status: response.status, elapsedMs: response.elapsedMs, replyLength: reply.length, nextField, valid: response.data?.ok === true && validNextField && reply.length > 0, telemetry: response.data?.telemetry ?? null });
    console.log(`conversation ${model} ${results.length}/${conversationCases.length} ${testCase.label}: ${response.status} ${response.elapsedMs}ms`);
  }
  return { model, caseCount: results.length, httpSuccess: results.filter((item) => item.status >= 200 && item.status < 300).length, valid: results.filter((item) => item.valid).length, avgReplyLength: results.length ? Math.round(results.reduce((sum, item) => sum + item.replyLength, 0) / results.length) : null, latency: timingSummary(results), results };
}

async function loadBaseline() {
  try { return JSON.parse(await readFile('docs/phase2a5-evaluation-latest.json', 'utf8')); } catch { return null; }
}

const extraction = [];
for (const model of extractionModels) for (const prompt of promptVariants) extraction.push(await evaluateExtraction(model, prompt));
const conversation = [];
for (const model of conversationModels) conversation.push(await evaluateConversation(model));
const report = { generatedAt: new Date().toISOString(), baseUrl, fixedCaseCount: phase2a5Cases.length, evaluatedCaseCount: cases.length, extraction, conversation, baselinePhase2a5: await loadBaseline(), comparisonContract: { models: extractionModels, promptVariants, conversationModels, originalTextIsSourceOfTruth: true, safetyGuardIsIndependent: true } };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
const markdownPath = outputPath.replace(/\.json$/i, '.md');
const lines = ['# Phase 2B 評価結果', '', `生成日時: ${report.generatedAt}`, `固定評価セット: ${phase2a5Cases.length}件 / 今回評価: ${cases.length}件`, '', '## Extraction'];
for (const item of extraction) lines.push(`- ${item.model} / ${item.promptVariant}: HTTP ${item.httpSuccess}/${item.caseCount}, Schema ${item.schemaValid}/${item.caseCount}, 完全一致 ${item.exact}/${item.caseCount}, 重要事実取りこぼし ${(item.factMetrics.importantFactOmissionRate * 100).toFixed(1)}%, fallback ${item.fallback}件, total P50/P90/P95/max ${item.latency.totalMs.p50}/${item.latency.totalMs.p90}/${item.latency.totalMs.p95}/${item.latency.totalMs.max}ms`);
lines.push('', '## Conversation');
for (const item of conversation) lines.push(`- ${item.model}: HTTP ${item.httpSuccess}/${item.caseCount}, 契約有効 ${item.valid}/${item.caseCount}, total P50/P90/P95/max ${item.latency.totalMs.p50}/${item.latency.totalMs.p90}/${item.latency.totalMs.p95}/${item.latency.totalMs.max}ms`);
lines.push('', '## 補足', '', '- totalはAPI応答全体、modelTimingsはHTTPヘッダー受信・first token・prompt待ち・生成・JSON parse・補正を分離した値です。', '- Ollamaのserver-side prompt_eval_duration / eval_durationが返る場合はmodelTimingsにも記録します。', '- 重要案件の最終判断・返信送信は引き続き職員が行います。');
await writeFile(markdownPath, lines.join('\n') + '\n', 'utf8');
console.log(JSON.stringify({ outputPath, extraction: extraction.map((item) => ({ model: item.model, promptVariant: item.promptVariant, httpSuccess: item.httpSuccess, exact: item.exact, latency: item.latency.totalMs })), conversation: conversation.map((item) => ({ model: item.model, valid: item.valid, latency: item.latency.totalMs })) }, null, 2));
