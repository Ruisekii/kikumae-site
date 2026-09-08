import { mkdir, writeFile } from 'node:fs/promises';
import { phase2a5Cases, phase2a5CaseGroups } from './phase2a5-cases.mjs';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2A5_OUTPUT ?? 'docs/phase2a5-evaluation-latest.json';
const limit = Math.max(1, Math.min(phase2a5Cases.length, Number(process.env.PHASE2A5_LIMIT ?? phase2a5Cases.length)));
const cases = phase2a5Cases.slice(0, limit);

async function post(path, body, timeoutMs = 180000, rateKey = 'phase2a5-eval') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': rateKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json();
    return { status: response.status, elapsedMs: Math.round(performance.now() - started), data };
  } finally {
    clearTimeout(timer);
  }
}

function initialState(text) {
  return { language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [text], confidence: null, category: null };
}

function localRulesView(preview) {
  const analysis = preview?.analysis ?? {};
  const peopleMatch = String(analysis.peopleCount ?? '').match(/(\d+)\s*人/);
  const vulnerable = Array.isArray(analysis.vulnerablePeople) ? analysis.vulnerablePeople.find((value) => value && value !== '不明') : null;
  const urgency = analysis.urgencyCandidate === '高' ? 'high' : analysis.urgencyCandidate === '中' ? 'medium' : analysis.urgencyCandidate === '低' ? 'low' : 'unknown';
  return {
    location: analysis.location || null,
    target: peopleMatch || vulnerable ? { type: vulnerable === '子ども' ? 'child' : vulnerable === '乳児' ? 'infant' : vulnerable === '高齢者' ? 'adult' : null, count: peopleMatch ? Number(peopleMatch[1]) : null } : null,
    facts: Array.isArray(analysis.facts) ? analysis.facts : [],
    request: String(analysis.request ?? ''),
    urgency,
    safetyFlags: analysis.urgentReview ? ['rule_urgent_review'] : [],
    missingFields: Array.isArray(analysis.missingInformation) ? analysis.missingInformation : [],
  };
}

function compact(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s、。・!！?？「」『』()（）\[\]【】,.:;〜~ー\-]/g, '')
    .replace(/使用できません|使用出来ません|使用不可|使えません|使えない/g, '使えない')
    .replace(/ありません|ないです|無い|なくなりました|切れました/g, 'ない')
    .replace(/３９|三十九/g, '39')
    .replace(/度/g, '℃');
}

function semanticHit(actual, expected, source = '') {
  const a = compact(actual);
  const e = compact(expected);
  if (!a || !e) return false;
  if (a.includes(e) || e.includes(a)) return true;
  const aliases = [
    ['ぐったり', '反応が弱い', '意識', '起きない'],
    ['詰ま', '流れない', '使えない'],
    ['おむつ', '紙おむつ'],
    ['食事', 'ごはん', '食べ物'],
    ['水', '飲料水', '給水'],
    ['煙', 'けむり'],
    ['火', 'かじ', '火災'],
    ['怖い', '不安', '危険'],
    ['待', '遅れ'],
    ['暑い', '空調', '涼しい'],
    ['しゃべれない', '会話が続かない', '息'],
  ];
  return aliases.some((group) => group.some((item) => a.includes(compact(item))) && group.some((item) => e.includes(compact(item))))
    || (source && aliases.some((group) => group.some((item) => e.includes(compact(item)) && compact(source).includes(compact(item))) && a.length > 1));
}

function factCoverage(result, expected, source) {
  const expectedFacts = Array.isArray(expected.facts) ? expected.facts : [];
  const facts = Array.isArray(result?.facts) ? result.facts.map(String) : [];
  const hits = expectedFacts.filter((item) => facts.some((fact) => semanticHit(fact, item, source)));
  const sourceText = compact(source);
  const hallucinated = facts.filter((fact) => {
    const normalized = compact(fact);
    return !expectedFacts.some((item) => semanticHit(fact, item, source))
      && !(normalized.length >= 2 && (sourceText.includes(normalized) || normalized.includes(sourceText.slice(0, Math.min(12, sourceText.length)))));
  });
  return {
    expected: expectedFacts.length,
    hits: hits.length,
    omitted: expectedFacts.length - hits.length,
    omissionRate: expectedFacts.length ? (expectedFacts.length - hits.length) / expectedFacts.length : 0,
    hallucinated: hallucinated.length,
  };
}

function canonicalSafety(value) {
  const flags = new Set();
  if (!value || typeof value !== 'object') return flags;
  for (const flag of Array.isArray(value.flags) ? value.flags : []) {
    if (/火災|煙/.test(String(flag))) flags.add('possible_fire');
    if (/暴力|武器/.test(String(flag))) flags.add('possible_violence');
    if (/自傷|自殺/.test(String(flag))) flags.add('possible_self_harm');
    if (/意識|呼吸|医療/.test(String(flag))) flags.add('possible_medical_emergency');
  }
  for (const flag of Array.isArray(value.safetyFlags) ? value.safetyFlags : []) flags.add(String(flag));
  return flags;
}

function schemaValid(value) {
  return Boolean(value && typeof value === 'object'
    && (value.location === null || typeof value.location === 'string')
    && (value.target === null || (value.target && typeof value.target === 'object'))
    && Array.isArray(value.facts)
    && Array.isArray(value.safetyFlags)
    && Array.isArray(value.missingFields)
    && Array.isArray(value.askedFields)
    && ['unknown', 'low', 'medium', 'high'].includes(value.urgency)
    && typeof value.originalText !== 'undefined');
}

function score(result, expected, source, safety) {
  const fact = factCoverage(result, expected, source);
  const checks = {
    location: expected.location === null ? (result?.location ?? null) === null : result?.location === expected.location,
    target: expected.target === null
      ? (result?.target ?? null) === null
      : result?.target?.count === expected.target.count && (expected.target.type === null || result?.target?.type === expected.target.type),
    request: result?.request === expected.request,
    urgency: result?.urgency === expected.urgency,
    missingFields: (expected.missingFields ?? []).every((field) => Array.isArray(result?.missingFields) && result.missingFields.includes(field)),
    safetyFlags: (expected.safetyFlags ?? []).every((flag) => canonicalSafety(safety).has(flag) || (Array.isArray(result?.safetyFlags) && result.safetyFlags.includes(flag))),
    facts: fact.omitted === 0,
    schema: schemaValid(result),
  };
  return { checks, passed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length, exact: Object.values(checks).every(Boolean), fact };
}

function summarizeSafety(results) {
  let tp = 0, fp = 0, fn = 0;
  for (const item of results) {
    const expected = item.expected.critical === true;
    // This metric is intentionally for the independent Safety Guard lane.
    // Model-generated flags are reported separately in each case and must not
    // hide a Guard miss or turn a Guard-correct case into a false positive.
    const predicted = item.qwen.safety?.immediate === true;
    if (expected && predicted) tp += 1;
    if (!expected && predicted) fp += 1;
    if (expected && !predicted) fn += 1;
  }
  return {
    criticalCases: tp + fn,
    truePositive: tp,
    falsePositive: fp,
    missed: fn,
    recall: tp + fn ? tp / (tp + fn) : null,
    precision: tp + fp ? tp / (tp + fp) : null,
  };
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

const results = [];
for (const testCase of cases) {
  const rateKey = `phase2a5-${testCase.id}`;
  const preview = await post('/api/questions/preview', { body: testCase.text, intake: testCase.intake }, 180000, rateKey);
  const extraction = await post('/api/ai/voice', { mode: 'extract', text: testCase.text, state: initialState(testCase.text), intake: testCase.intake }, 180000, rateKey);
  const local = localRulesView(preview.data);
  const qwen = extraction.data?.incident ?? null;
  results.push({
    id: testCase.id,
    label: testCase.label,
    group: testCase.group,
    input: testCase.text,
    expected: testCase.expected,
    localRules: { result: local, elapsedMs: preview.elapsedMs, score: score(local, testCase.expected, testCase.text, preview.data?.safety) },
    qwen: { result: qwen, elapsedMs: extraction.elapsedMs, status: extraction.status, aiMode: extraction.data?.aiMode ?? null, safety: extraction.data?.safety ?? null, score: score(qwen, testCase.expected, testCase.text, extraction.data?.safety) },
  });
  console.log(`${results.length}/${cases.length} ${testCase.label}: Qwen ${extraction.status} ${extraction.elapsedMs}ms`);
}

const qwenResults = results.map((item) => item.qwen);
const omissionTotal = qwenResults.reduce((sum, item) => sum + item.score.fact.expected, 0);
const omissionCount = qwenResults.reduce((sum, item) => sum + item.score.fact.omitted, 0);
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  model: process.env.AI_EXTRACTION_MODEL ?? 'qwen3.5:4b',
  caseCount: results.length,
  groups: phase2a5CaseGroups,
  qwenExact: qwenResults.filter((item) => item.score.exact).length,
  localRulesExact: results.filter((item) => item.localRules.score.exact).length,
  qwenHttpSuccess: qwenResults.filter((item) => item.status >= 200 && item.status < 300).length,
  qwenAverageMs: average(qwenResults.map((item) => item.elapsedMs)),
  qwenMinMs: Math.min(...qwenResults.map((item) => item.elapsedMs)),
  qwenMaxMs: Math.max(...qwenResults.map((item) => item.elapsedMs)),
  safety: summarizeSafety(results),
  factMetrics: { expectedFacts: omissionTotal, omittedFacts: omissionCount, importantFactOmissionRate: omissionTotal ? omissionCount / omissionTotal : null, hallucinatedFacts: qwenResults.reduce((sum, item) => sum + item.score.fact.hallucinated, 0) },
  fieldMetrics: Object.fromEntries(['location', 'target', 'request', 'urgency', 'missingFields', 'facts'].map((key) => [key, { correct: qwenResults.filter((item) => item.score.checks[key]).length, total: results.length, accuracy: qwenResults.length ? qwenResults.filter((item) => item.score.checks[key]).length / results.length : null }])),
  results,
};
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
const markdownPath = outputPath.replace(/\.json$/i, '.md');
const lines = [
  '# Phase 2A.5 固定評価結果',
  '',
  `生成日時: ${report.generatedAt}`,
  `モデル: ${report.model}`,
  `ケース数: ${report.caseCount} / グループ数: ${report.groups.length}`,
  `Qwen HTTP成功: ${report.qwenHttpSuccess}/${report.caseCount} / 完全一致: ${report.qwenExact}/${report.caseCount} / local-rules完全一致: ${report.localRulesExact}/${report.caseCount}`,
  `Qwen応答時間: 平均 ${report.qwenAverageMs}ms / 最短 ${report.qwenMinMs}ms / 最長 ${report.qwenMaxMs}ms`,
  `重要事実の取りこぼし率: ${(report.factMetrics.importantFactOmissionRate * 100).toFixed(1)}% (${report.factMetrics.omittedFacts}/${report.factMetrics.expectedFacts})`,
  `Safety critical: recall ${(report.safety.recall * 100).toFixed(1)}% / precision ${(report.safety.precision * 100).toFixed(1)}% / missed ${report.safety.missed} / false positive ${report.safety.falsePositive}`,
  '',
  '| ケース | グループ | Qwen | local-rules | 抽出(ms) | 取りこぼし |',
  '|---|---|---:|---:|---:|---:|',
  ...results.map((item) => `| ${item.label} | ${item.group} | ${item.qwen.score.passed}/${item.qwen.score.total} | ${item.localRules.score.passed}/${item.localRules.score.total} | ${item.qwen.elapsedMs} | ${item.qwen.score.fact.omitted}/${item.qwen.score.fact.expected} |`),
  '',
  '## 指標の定義',
  '',
  '- 完全一致: location / target / request / urgency / missingFields / safetyFlags / facts の全チェックが通ったケース。',
  '- 重要事実の取りこぼし率: 期待factsのうち、意味的に一致する抽出factsが見つからなかった割合。',
  '- hallucinatedFacts: 期待factsまたは入力文との意味的な対応が確認できない抽出facts。評価用の近似指標であり、人間レビューを置き換えない。',
  '- critical: 固定データで生命・火災・暴力等のSafety Guard確認が必要と定義したケース。',
  '',
];
await writeFile(markdownPath, lines.join('\n'), 'utf8');
console.log(JSON.stringify({ outputPath, caseCount: report.caseCount, qwenExact: report.qwenExact, localRulesExact: report.localRulesExact, safety: report.safety }, null, 2));
