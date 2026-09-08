import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2C_OFFLINE_OUTPUT ?? 'docs/phase2c-offline-latest.json';

async function localSmoke() {
  const result = { webUi: null, safetyGuard: null, externalRequestsInHtml: null };
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(10000) });
    const html = await response.text();
    result.webUi = { status: response.status, ok: response.ok };
    result.externalRequestsInHtml = [...html.matchAll(/(?:src|href)=['"](https?:\/\/[^'"]+)/g)].map((match) => match[1]).slice(0, 20);
  } catch (error) { result.webUi = { ok: false, error: String(error) }; }
  try {
    const response = await fetch(`${baseUrl}/api/ai/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kikumae-safety-only': '1', 'cf-connecting-ip': 'phase2c-offline-safety' }, body: JSON.stringify({ mode: 'extract', text: '息ができません。入口です。', state: { language: 'ja', originalText: [] }, intake: {} }) });
    const data = await response.json();
    result.safetyGuard = { status: response.status, immediate: data.safety?.immediate === true, flags: data.safety?.flags ?? [] };
  } catch (error) { result.safetyGuard = { ok: false, error: String(error) }; }
  return result;
}

const smoke = await localSmoke();
const report = {
  generatedAt: new Date().toISOString(), baseUrl,
  literalNetworkSwitchOffPerformed: false,
  literalNetworkSwitchOffReason: 'OS全体のネットワーク遮断は、利用者の通信・他タスクを壊すため、この評価では実施していません。localhost限定の静的監査とローカルSafety実機呼び出しを行い、完全オフライン合格とは判定していません。',
  smoke,
  functions: [
    { name: 'Web UI', classification: smoke.webUi?.ok && !(smoke.externalRequestsInHtml?.length) ? 'full-offline-local-ui' : 'conditional-offline', evidence: 'localhostで応答。HTMLに検出できる外部src/hrefを確認。ブラウザ拡張・CDNキャッシュは別途確認が必要。' },
    { name: 'Safety Guard', classification: smoke.safetyGuard?.immediate ? 'full-offline' : 'not-verified', evidence: 'サーバー内の決定的ルールをlocalhostで実行。LLM・翻訳に依存しない。' },
    { name: 'Conversation Qwen3.5 2B', classification: 'conditional-offline', evidence: 'Ollamaを同一PC/避難所LANに置き、モデルがロード済みの場合のみ。公開サイトからlocalhostへは接続しない。' },
    { name: 'Incident Extraction Qwen3.5 4B', classification: 'conditional-offline', evidence: 'Ollamaを同一PC/避難所LANに置いた場合のみ。モデル停止時はlocal-rulesへFallback。' },
    { name: '外国語→日本語翻訳', classification: 'conditional-offline', evidence: 'Qwen利用時はローカルLLMに依存し、失敗時は原文を保持して翻訳失敗扱い。' },
    { name: '音声認識', classification: 'offline-not-proven', evidence: 'BrowserASRProvider（SpeechRecognition / webkitSpeechRecognition）。processLocallyがtrueと確認できない場合は完全ローカルと表示しない。実ブラウザの実測が必要。' },
    { name: '音声読み上げ', classification: 'offline-not-proven', evidence: 'BrowserTTSProvider（SpeechSynthesis）。OS/ブラウザ音声エンジンのオフライン可否をこのサーバー監査だけでは保証できない。' },
    { name: '職員画面', classification: 'conditional-offline', evidence: 'ローカルWeb/DBで動作可能。ただし公開Cloudflare環境のデータ同期・認証はオンライン依存。' },
  ],
};
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, smoke, functions: report.functions.map(({ name, classification }) => ({ name, classification })) }, null, 2));
