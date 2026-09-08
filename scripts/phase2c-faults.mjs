import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2C_FAULT_OUTPUT ?? 'docs/phase2c-faults-latest.json';
const faults = ['ollama-down', 'conversation-down', 'extraction-down', 'timeout', 'invalid-json', 'network-disconnect'];

async function voiceFault(fault, mode) {
  const response = await fetch(`${baseUrl}/api/ai/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kikumae-eval-fault': fault, 'cf-connecting-ip': `phase2c-fault-${fault}-${mode}` }, body: JSON.stringify({ mode, text: mode === 'extract' ? '体育館Aで水がありません。' : '水がありません。', state: { language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [], confidence: null, category: null }, intake: {} }) });
  const data = await response.json();
  return { status: response.status, fallback: data.aiMode === 'local-rules' || data.telemetry?.fallback === true, safetyPreserved: Boolean(data.safety), data };
}

const rows = [];
for (const fault of faults) for (const mode of ['conversation', 'extract']) rows.push({ fault, mode, ...(await voiceFault(fault, mode)) });
const translationResponse = await fetch(`${baseUrl}/api/admin/translation-eval`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kikumae-eval-translation': '1', 'x-kikumae-eval-fault': 'translation-failure', 'cf-connecting-ip': 'phase2c-fault-translation' }, body: JSON.stringify({ text: 'She may have a fever.', language: 'en' }) });
const translationData = await translationResponse.json();
const translation = { status: translationResponse.status, data: translationData, sourcePreserved: translationData.originalText === 'She may have a fever.' };
const report = { generatedAt: new Date().toISOString(), baseUrl, rows, translation, nonServerFaults: { asrFailure: 'BrowserASRProvider reports onError and returns to the text path; requires device-level manual test.', ttsFailure: 'BrowserTTSProvider reports onError and returns to IDLE; requires device-level manual test.', networkDisconnect: 'server-side eval fault covers model lane; literal network switch-off is documented in offline audit.' } };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, voiceFallbacks: rows.filter((row) => row.fallback).length, voiceRows: rows.length, translationStatus: translation.data?.translationStatus }, null, 2));
