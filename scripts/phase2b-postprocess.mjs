import { readFile, writeFile } from 'node:fs/promises';

const path = process.env.PHASE2B_OUTPUT ?? 'docs/phase2b-evaluation-latest.json';
const report = JSON.parse(await readFile(path, 'utf8'));
function percentile(values, p) { const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b); if (!sorted.length) return null; return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]; }
function summarize(items) {
  const paths = ['totalMs', 'httpHeadersMs', 'firstTokenMs', 'promptUntilFirstTokenMs', 'generationMs', 'bodyReadMs', 'jsonParseMs', 'normalizationMs', 'safetyGuardMs'];
  return Object.fromEntries(paths.map((pathName) => { const values = items.map((item) => item.telemetry?.[pathName] ?? item.telemetry?.modelTimings?.[pathName]).filter((value) => Number.isFinite(value)); return [pathName, { p50: percentile(values, 50), p90: percentile(values, 90), p95: percentile(values, 95), max: values.length ? Math.max(...values) : null }]; }));
}
report.conversation = report.conversation.map((item) => ({ ...item, latency: summarize(item.results) }));
await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ path, conversation: report.conversation.map((item) => ({ model: item.model, latency: item.latency })) }, null, 2));
