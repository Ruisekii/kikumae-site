import { readFile, writeFile, mkdir } from 'node:fs/promises';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2H_OUTPUT ?? 'docs/phase2h-offline-audio-accessibility-latest.json';

async function source(path) {
  return readFile(path, 'utf8');
}

async function checkUrl(path) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
    const html = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      externalSrcHref: [...html.matchAll(/(?:src|href)=['"](https?:\/\/[^'"]+)/g)].map((match) => match[1]).slice(0, 20),
      hasShellText: /イセキ避難所|避難所/.test(html),
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

const [voice, client, proxy] = await Promise.all([
  source('app/lib/voice-conversation.ts'),
  source('app/components/kikumae-client.tsx'),
  source('proxy.ts'),
]);
const web = await checkUrl('/');
const safety = await fetch(`${baseUrl}/api/ai/voice`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-kikumae-safety-only': '1', 'cf-connecting-ip': 'phase2h-safety' },
  body: JSON.stringify({ mode: 'extract', text: '息ができません。入口です。', state: { language: 'ja', originalText: [] }, intake: {} }),
  signal: AbortSignal.timeout(10_000),
}).then(async (response) => ({ status: response.status, body: await response.json() })).catch((error) => ({ ok: false, error: String(error) }));

const report = {
  schemaVersion: 'phase2h.v1',
  generatedAt: new Date().toISOString(),
  baseUrl,
  literalNetworkSwitchOffPerformed: false,
  literalNetworkSwitchOffReason: 'OS全体の通信遮断は、ユーザーの通信と他タスクへ影響するため実施していない。localhost監査と障害注入を別試験として記録する。',
  web,
  safety,
  audio: {
    asr: {
      provider: 'BrowserASRProvider',
      implementation: voice.includes('SpeechRecognition') && voice.includes('webkitSpeechRecognition') ? 'SpeechRecognition / webkitSpeechRecognition' : 'not-found',
      processLocallyPropertyObserved: voice.includes('processLocally'),
      processLocallyValueUsedForTrustDecision: false,
      classification: 'offline-not-proven',
      reason: 'SpeechRecognitionの実装はブラウザ提供元に依存する。コードでprocessLocallyやローカル言語パックを確認できず、ネットワーク遮断実機試験も未実施。',
    },
    tts: {
      provider: 'BrowserTTSProvider',
      implementation: voice.includes('speechSynthesis') ? 'SpeechSynthesis' : 'not-found',
      classification: 'offline-not-proven',
      reason: 'OS/ブラウザの音声エンジンがオフラインで利用できるか、実機で確認していない。',
    },
    vad: {
      provider: 'BrowserVADProvider',
      implementation: voice.includes('AudioContext') && voice.includes('getUserMedia') ? 'AudioContext + getUserMedia energy threshold' : 'not-found',
      classification: 'conditional-offline',
      reason: 'ブラウザのマイク許可とAudioContextが必要。モデル型VADではない。',
    },
  },
  functions: [
    { name: 'Web UI', classification: web.ok && web.externalSrcHref?.length === 0 ? 'full-offline-local-ui' : 'conditional-offline', evidence: 'localhost応答とHTML外部src/href監査' },
    { name: 'Safety Guard', classification: safety.body?.safety?.immediate === true ? 'full-offline' : 'not-verified', evidence: 'Safety-only APIをlocalhostで実行' },
    { name: 'Conversation Qwen3.5 2B', classification: 'conditional-offline', evidence: '同一PC/LANのOllamaが必要。停止時はlocal-rules fallback' },
    { name: 'Incident Extraction Qwen3.5 4B', classification: 'conditional-offline', evidence: '同一PC/LANのOllamaが必要。停止時はlocal-rules fallback' },
    { name: '外国語→日本語翻訳', classification: 'conditional-offline', evidence: 'ローカルLLMが必要。失敗時も原文を保持してfailedとする' },
    { name: '職員画面', classification: 'conditional-offline', evidence: 'ローカルWeb/DBでの動作経路はあるが、実機ネットワーク遮断は未実施' },
  ],
  draftPersistence: {
    localStorageDraft: client.includes('kikumae-shelter-draft'),
    restoresOnLoad: client.includes('localStorage.getItem(\'kikumae-shelter-draft\')'),
    pendingSubmitQueue: false,
    classification: 'conditional-offline',
    risk: '送信中に通信が切れた場合は下書き復元が中心で、永続的な送信待ちキュー・重複排除・再送確認は未実装。',
  },
  accessibility: {
    publicControlsHaveTextOrAria: /aria-label|aria-live/.test(voice) && /<button/.test(client),
    reducedMotionRulePresent: (await source('app/globals.css')).includes('prefers-reduced-motion'),
    mobileBreakpointsPresent: (await source('app/globals.css')).includes('@media (max-width: 680px)'),
    largeTouchTargetEvidence: (await source('app/globals.css')).includes('min-height: 56px'),
    classification: 'static-review-needed',
    limitations: '実機のVoiceOver/TalkBack、色覚、拡大表示、キーボードのみ操作は未実施。',
  },
  securityHeaders: {
    cspPresent: proxy.includes('Content-Security-Policy'),
    frameDeny: proxy.includes("X-Frame-Options', 'DENY"),
    microphonePermissionScope: proxy.includes("microphone=(self)"),
  },
  evidence: ['docs/phase2c-offline-latest.json', 'docs/phase2c-faults-latest.json'],
  caveat: 'このレポートはコード監査とlocalhost試験であり、ネットワーク断・マイク許可・OS音声エンジンの実機合格を意味しない。',
};

await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, web, safety: { status: safety.status, immediate: safety.body?.safety?.immediate }, classifications: report.functions.map(({ name, classification }) => ({ name, classification })) }, null, 2));
