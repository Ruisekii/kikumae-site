import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2D_LOAD_OUTPUT ?? 'docs/phase2d-load-latest.json';
const levels = (process.env.PHASE2D_LOAD_LEVELS ?? '10,20').split(',').map((value) => Math.max(1, Number(value))).filter(Number.isFinite);
const timeoutMs = Number(process.env.PHASE2D_LOAD_TIMEOUT_MS ?? 180000);
const simpleText = '飲料水が足りません。体育館Aで4人が困っています。';
const baseState = { language: 'ja', location: '体育館A', target: { type: null, count: 4, ageGroup: null }, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [], confidence: null, category: null };

function percentile(values, p) { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1)] : null; }
function summarize(rows) {
  const elapsed = rows.map((row) => row.elapsedMs);
  const queue = rows.map((row) => row.payload?.telemetry?.modelTimings?.queueMs).filter(Number.isFinite);
  return { count: rows.length, httpSuccess: rows.filter((row) => row.status >= 200 && row.status < 300).length, timeout: rows.filter((row) => row.timeout).length, fallback: rows.filter((row) => row.payload?.telemetry?.fallback === true || row.payload?.aiMode === 'local-rules').length, elapsedMs: { p50: percentile(elapsed, 50), p95: percentile(elapsed, 95), max: elapsed.length ? Math.max(...elapsed) : null }, queueMs: { p50: percentile(queue, 50), p95: percentile(queue, 95), max: queue.length ? Math.max(...queue) : null, measured: queue.length > 0 } };
}
async function runOne(mode, level, index) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/ai/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `phase2d-load-${mode}-${level}-${index}` }, body: JSON.stringify({ mode, text: simpleText, state: baseState, intake: { location: '体育館A', peopleCount: '4人' }, selectedLanguage: 'ja' }), signal: controller.signal });
    return { status: response.status, elapsedMs: Math.round(performance.now() - started), payload: await response.json(), timeout: false };
  } catch (error) { return { status: 599, elapsedMs: Math.round(performance.now() - started), payload: { error: String(error) }, timeout: error?.name === 'AbortError' }; }
  finally { clearTimeout(timer); }
}
const runs = [];
for (const level of levels) {
  const triage = await Promise.all(Array.from({ length: level }, (_, index) => runOne('triage', level, index)));
  const conversation = await Promise.all(Array.from({ length: level }, (_, index) => runOne('conversation', level, index)));
  runs.push({ level, triage: summarize(triage), conversation: summarize(conversation), rows: { triage, conversation } });
  console.log(JSON.stringify({ level, triage: summarize(triage), conversation: summarize(conversation) }));
}
const report = { generatedAt: new Date().toISOString(), baseUrl, levels, note: 'Phase2D負荷試験は4B不要の構造化案件を使用。4Bの同時実行は避難所運用の必須経路から外し、別ジョブとして評価する。', runs };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, runs: runs.map((run) => ({ level: run.level, triage: run.triage, conversation: run.conversation })) }, null, 2));
