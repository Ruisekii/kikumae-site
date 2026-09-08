import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2C_LOAD_OUTPUT ?? 'docs/phase2c-load-latest.json';
const levels = (process.env.PHASE2C_LOAD_LEVELS ?? '1,3,5,10').split(',').map((value) => Math.max(1, Number(value))).filter(Number.isFinite);
const timeoutMs = Number(process.env.PHASE2C_LOAD_TIMEOUT_MS ?? 180000);

function state() { return { language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [], confidence: null, category: null }; }

async function systemSnapshot() {
  const fallback = { cpuPercent: null, memoryUsedPercent: null, memoryAvailableGiB: null, gpu: 'unknown', vramGiB: null };
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', "$os=Get-CimInstance Win32_OperatingSystem; $cpu=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; [pscustomobject]@{cpuPercent=$cpu; memoryUsedPercent=[math]::Round((1-($os.FreePhysicalMemory/$os.TotalVisibleMemorySize))*100,1); memoryAvailableGiB=[math]::Round($os.FreePhysicalMemory/1MB,2)} | ConvertTo-Json -Compress"], { timeout: 10000 });
    return { ...fallback, ...JSON.parse(stdout.trim()) };
  } catch { return fallback; }
}

async function runOne(kind, index, level) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const text = kind === 'conversation' ? '水が足りません。体育館Aで4人が困っています。' : '体育館Aで飲み水がなく、4人が昨日から待っています。';
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/ai/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `phase2c-load-${kind}-${level}-${index}` }, body: JSON.stringify({ mode: kind === 'conversation' ? 'conversation' : 'extract', text, state: state(), intake: {}, selectedLanguage: 'ja' }), signal: controller.signal });
    const data = await response.json();
    const elapsedMs = Math.round(performance.now() - started);
    const telemetry = data.telemetry ?? {};
    return { status: response.status, elapsedMs, fallback: data.aiMode === 'local-rules' || telemetry.fallback === true, timeout: false, telemetry, clientOverheadMs: Number.isFinite(telemetry.totalMs) ? Math.max(0, elapsedMs - telemetry.totalMs) : null };
  } catch (error) {
    return { status: 599, elapsedMs: Math.round(performance.now() - started), fallback: false, timeout: error?.name === 'AbortError', error: String(error) };
  } finally { clearTimeout(timer); }
}

function percentile(values, p) { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1)] : null; }
function summarize(rows) {
  const values = rows.map((row) => row.elapsedMs);
  const telemetry = rows.map((row) => row.telemetry?.totalMs).filter(Number.isFinite);
  const queueProxy = rows.map((row) => row.clientOverheadMs).filter(Number.isFinite);
  return { count: rows.length, httpSuccess: rows.filter((row) => row.status >= 200 && row.status < 300).length, timeout: rows.filter((row) => row.timeout).length, fallback: rows.filter((row) => row.fallback).length, elapsedMs: { p50: percentile(values, 50), p95: percentile(values, 95), max: values.length ? Math.max(...values) : null }, serverTotalMs: { p50: percentile(telemetry, 50), p95: percentile(telemetry, 95), max: telemetry.length ? Math.max(...telemetry) : null }, clientOverheadProxyMs: { p50: percentile(queueProxy, 50), p95: percentile(queueProxy, 95), max: queueProxy.length ? Math.max(...queueProxy) : null }, queueMeasurement: 'not exposed by Ollama OpenAI-compatible API; client overhead is reported separately' };
}

const runs = [];
for (const level of levels) {
  const before = await systemSnapshot();
  const conversation = await Promise.all(Array.from({ length: level }, (_, index) => runOne('conversation', index, level)));
  const afterConversation = await systemSnapshot();
  const extraction = await Promise.all(Array.from({ length: level }, (_, index) => runOne('extraction', index, level)));
  const after = await systemSnapshot();
  const run = { level, before, afterConversation, after, conversation: summarize(conversation), extraction: summarize(extraction), rows: { conversation, extraction } };
  runs.push(run);
  console.log(JSON.stringify({ level, conversation: run.conversation, extraction: run.extraction }));
}
const report = { generatedAt: new Date().toISOString(), baseUrl, levels, modelConfig: { conversation: process.env.AI_CONVERSATION_MODEL ?? 'server-configured', extraction: process.env.AI_EXTRACTION_MODEL ?? 'server-configured' }, runs };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, runs: runs.map((run) => ({ level: run.level, conversation: run.conversation, extraction: run.extraction })) }, null, 2));
