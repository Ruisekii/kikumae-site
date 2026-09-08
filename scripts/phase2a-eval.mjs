import { mkdir, writeFile } from 'node:fs/promises';
import { phase2aCases } from './phase2a-cases.mjs';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2A_OUTPUT ?? 'docs/phase2a-evaluation-latest.json';

async function post(path, body, timeoutMs = 150000, rateKey = 'phase2a-eval') {
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

function factHit(facts, expected) {
  return expected.every((needle) => facts.some((fact) => String(fact).includes(needle.replace('℃', '度')) || String(fact).includes(needle)));
}

function score(result, expected) {
  const checks = [];
  if (expected.location !== null) checks.push(result?.location === expected.location);
  if (expected.target) checks.push(result?.target?.count === expected.target.count && (expected.target.type === null || result?.target?.type === expected.target.type));
  checks.push(factHit(Array.isArray(result?.facts) ? result.facts : [], expected.facts));
  if (expected.request) checks.push(result?.request === expected.request || String(result?.request ?? '').includes(expected.request));
  checks.push(result?.urgency === expected.urgency);
  checks.push(expected.safetyFlags.every((flag) => Array.isArray(result?.safetyFlags) && result.safetyFlags.includes(flag)));
  checks.push(expected.missingFields.every((field) => Array.isArray(result?.missingFields) && result.missingFields.includes(field)));
  return { passed: checks.filter(Boolean).length, total: checks.length, exact: checks.length > 0 && checks.every(Boolean) };
}

const results = [];
for (const testCase of phase2aCases) {
  const rateKey = `phase2a-${testCase.id}`;
  const preview = await post('/api/questions/preview', { body: testCase.text, intake: testCase.intake }, 150000, rateKey);
  const extraction = await post('/api/ai/voice', { mode: 'extract', text: testCase.text, state: initialState(testCase.text), intake: testCase.intake }, 150000, rateKey);
  const conversation = await post('/api/ai/voice', { mode: 'conversation', text: testCase.text, state: initialState(testCase.text), intake: testCase.intake }, 150000, rateKey);
  const local = localRulesView(preview.data);
  const qwen = extraction.data?.incident ?? null;
  results.push({
    id: testCase.id,
    label: testCase.label,
    input: testCase.text,
    expected: testCase.expected,
    localRules: { result: local, elapsedMs: preview.elapsedMs, score: score(local, testCase.expected) },
    qwen: { result: qwen, elapsedMs: extraction.elapsedMs, status: extraction.status, aiMode: extraction.data?.aiMode ?? null, score: score(qwen, testCase.expected) },
    conversation: { result: conversation.data?.reply ? { reply: conversation.data.reply, nextField: conversation.data.nextField, requiresConfirmation: conversation.data.requiresConfirmation } : null, elapsedMs: conversation.elapsedMs, status: conversation.status, aiMode: conversation.data?.aiMode ?? null },
  });
  console.log(`${testCase.label}: Qwen ${extraction.status} ${extraction.elapsedMs}ms, local-rules ${preview.elapsedMs}ms`);
}

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  model: process.env.AI_EXTRACTION_MODEL ?? 'qwen3.5:4b',
  caseCount: results.length,
  qwenExact: results.filter((item) => item.qwen.score.exact).length,
  localRulesExact: results.filter((item) => item.localRules.score.exact).length,
  qwenElapsedMs: results.map((item) => item.qwen.elapsedMs),
  conversationElapsedMs: results.map((item) => item.conversation.elapsedMs),
  results,
};
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
const markdownPath = outputPath.replace(/\.json$/i, '.md');
const lines = [
  '# Phase 2A 評価結果',
  '',
  `生成日時: ${report.generatedAt}`, 
  `モデル: ${report.model}`, 
  `ケース数: ${report.caseCount} / Qwen完全一致: ${report.qwenExact} / local-rules完全一致: ${report.localRulesExact}`,
  '',
  '| ケース | Qwen | local-rules | Qwen抽出(ms) | 会話(ms) |',
  '|---|---:|---:|---:|---:|',
  ...results.map((item) => `| ${item.label} | ${item.qwen.score.passed}/${item.qwen.score.total} | ${item.localRules.score.passed}/${item.localRules.score.total} | ${item.qwen.elapsedMs} | ${item.conversation.elapsedMs} |`),
  '',
  '## ケース別の抽出結果',
  '',
  ...results.flatMap((item) => [
    `### ${item.label}`,
    `入力: ${item.input}`,
    `期待: \`${JSON.stringify(item.expected)}\``,
    `local-rules: \`${JSON.stringify(item.localRules.result)}\``,
    `Qwen: \`${JSON.stringify(item.qwen.result)}\``,
    `会話応答: \`${JSON.stringify(item.conversation.result)}\``,
    '',
  ]),
];
await writeFile(markdownPath, lines.join('\n'), 'utf8');
console.log(JSON.stringify({ outputPath, caseCount: report.caseCount, qwenExact: report.qwenExact, localRulesExact: report.localRulesExact }, null, 2));
