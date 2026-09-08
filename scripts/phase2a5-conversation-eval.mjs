import { mkdir, writeFile } from 'node:fs/promises';
import { phase2a5Cases } from './phase2a5-cases.mjs';

const baseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const models = (process.env.PHASE2A5_CONVERSATION_MODELS ?? 'qwen3.5:2b,qwen3.5:4b').split(',').map((value) => value.trim()).filter(Boolean);
const cases = phase2a5Cases.filter((item) => ['water', 'toilet', 'medical', 'hard', 'insufficient', 'dialect-asr'].includes(item.group)).slice(0, Number(process.env.PHASE2A5_CONVERSATION_LIMIT ?? 20));
const outputPath = process.env.PHASE2A5_CONVERSATION_OUTPUT ?? 'docs/phase2a5-conversation-comparison.json';
const responseFormat = { type: 'json_schema', json_schema: { name: 'conversation_reply', strict: true, schema: { type: 'object', additionalProperties: false, required: ['reply', 'nextField', 'requiresConfirmation'], properties: { reply: { type: 'string' }, nextField: { type: ['string', 'null'], enum: ['場所', '人数', '残量', '最後に受け取った時刻', '追加確認', null] }, requiresConfirmation: { type: 'boolean' } } } } };
const system = [
  'あなたは避難所の相談受付を補助する低遅延の会話AIです。',
  '利用者の怒りや不安を否定せず、短く受け止めます。追加確認は一度に1項目だけです。',
  '「落ち着いて」「大丈夫」「安心して」、説教、推測、職員の判断の代行は禁止です。',
  '不足情報がある場合は場所を最優先にし、replyは短い日本語にしてください。JSONだけを返してください。',
].join('\n');

async function call(model, text) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.1, max_tokens: 180, reasoning_effort: 'none', response_format: responseFormat, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ text, missingFields: ['場所'], safety: {} }) }] }),
  });
  const data = await response.json();
  let parsed = null;
  try { parsed = JSON.parse(String(data.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()); } catch {}
  return { status: response.status, elapsedMs: Math.round(performance.now() - started), result: parsed, valid: Boolean(parsed?.reply && Object.prototype.hasOwnProperty.call(parsed, 'nextField') && typeof parsed.requiresConfirmation === 'boolean') };
}

const byModel = {};
for (const model of models) {
  const results = [];
  for (const testCase of cases) {
    const result = await call(model, testCase.text);
    results.push({ id: testCase.id, label: testCase.label, input: testCase.text, ...result });
    console.log(`${model} ${results.length}/${cases.length} ${testCase.label}: ${result.status} ${result.elapsedMs}ms`);
  }
  byModel[model] = { caseCount: results.length, validJson: results.filter((item) => item.valid).length, averageMs: Math.round(results.reduce((sum, item) => sum + item.elapsedMs, 0) / results.length), results };
}
const report = { generatedAt: new Date().toISOString(), baseUrl, cases: cases.length, byModel };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
const lines = ['# Phase 2A.5 Conversation 2B/4B比較', '', `ケース数: ${cases.length}`, '', '| モデル | JSON有効 | 平均応答(ms) |', '|---|---:|---:|', ...Object.entries(byModel).map(([model, value]) => `| ${model} | ${value.validJson}/${value.caseCount} | ${value.averageMs} |`), '', '会話品質はJSON形式・nextFieldの妥当性・短さ・利用者を刺激しない表現を人間確認する前提です。'];
await writeFile(outputPath.replace(/\.json$/i, '.md'), lines.join('\n'), 'utf8');
console.log(JSON.stringify(report, null, 2));
