import { mkdir, writeFile } from 'node:fs/promises';
import { phase2cConversationCases } from './phase2c-conversation-cases.mjs';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2C_CONVERSATION_OUTPUT ?? 'docs/phase2c-conversation-latest.json';
const model = process.env.PHASE2C_CONVERSATION_MODEL ?? 'qwen3.5:2b';

function state() { return { language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [], confidence: null, category: null }; }
function percentile(values, p) { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1)] : null; }
const rows = [];
for (let index = 0; index < phase2cConversationCases.length; index += 1) {
  const [id, text] = phase2cConversationCases[index];
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/ai/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `phase2c-conversation-expanded-${index}`, 'x-kikumae-eval-model': model }, body: JSON.stringify({ mode: 'conversation', text, state: state(), intake: {}, selectedLanguage: 'ja' }) });
    const data = await response.json();
    const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
    const forbidden = /落ち着いて|深呼吸|大丈夫です|安心してください/.test(reply);
    rows.push({ id, text, status: response.status, elapsedMs: Math.round(performance.now() - started), aiMode: data.aiMode, reply, nextField: data.nextField ?? null, valid: response.status >= 200 && response.status < 300 && Boolean(reply) && !forbidden, forbidden, telemetry: data.telemetry ?? null });
  } catch (error) { rows.push({ id, text, status: 599, elapsedMs: Math.round(performance.now() - started), valid: false, error: String(error) }); }
  console.log(`${index + 1}/${phase2cConversationCases.length} ${id}: ${rows.at(-1).status}`);
}
const report = { generatedAt: new Date().toISOString(), baseUrl, model, caseCount: rows.length, httpSuccess: rows.filter((row) => row.status >= 200 && row.status < 300).length, valid: rows.filter((row) => row.valid).length, forbiddenPhraseCases: rows.filter((row) => row.forbidden).length, latency: { p50: percentile(rows.map((row) => row.elapsedMs), 50), p95: percentile(rows.map((row) => row.elapsedMs), 95), max: Math.max(...rows.map((row) => row.elapsedMs)) }, rows };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, caseCount: report.caseCount, httpSuccess: report.httpSuccess, valid: report.valid, latency: report.latency }, null, 2));
