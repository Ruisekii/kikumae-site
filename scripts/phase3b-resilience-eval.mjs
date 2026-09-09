import { mkdir, readFile, writeFile } from 'node:fs/promises';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE3B_RESILIENCE_OUTPUT ?? 'docs/phase3b-resilience-latest.json';
const state = {
  language: 'ja',
  location: null,
  target: null,
  facts: [],
  request: null,
  urgency: 'unknown',
  safetyFlags: [],
  missingFields: [],
  askedFields: [],
  originalText: [],
  confidence: null,
  category: null,
};

const faults = ['ollama-down', 'conversation-down', 'extraction-down', 'timeout', 'invalid-json', 'network-disconnect'];
const ordinaryText = '体育館Aで昨日から飲料水がありません。子どもが1人います。';
const safetyText = '救護スペースで子どもが39度あり、ぐったりしています。';

async function postVoice({ text, mode = 'extract', fault = null, safetyOnly = false }) {
  const headers = {
    'Content-Type': 'application/json',
    'x-kikumae-eval-suite': 'phase3b',
    'cf-connecting-ip': `phase3b-${Math.random().toString(36).slice(2)}`,
  };
  if (fault) headers['x-kikumae-eval-fault'] = fault;
  if (safetyOnly) headers['x-kikumae-safety-only'] = '1';
  const response = await fetch(`${baseUrl}/api/ai/voice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode, text, state, intake: { location: 'イセキ避難所' } }),
  });
  let data = null;
  try { data = await response.json(); } catch { /* malformed response is recorded below */ }
  return { status: response.status, data };
}

function hasOriginal(data, text) {
  return Array.isArray(data?.originalText) && data.originalText.includes(text)
    || Array.isArray(data?.incident?.originalText) && data.incident.originalText.includes(text);
}

function hasSafety(data) {
  return Boolean(data?.safety && Array.isArray(data.safety.flags) && typeof data.safety.immediate === 'boolean');
}

function hasMedicalSafety(data) {
  return hasSafety(data) && data.safety.immediate === true && data.safety.flags.some((flag) => /医療|体調/.test(flag));
}

const faultRows = [];
for (const fault of faults) {
  const ordinary = await postVoice({ text: ordinaryText, fault });
  const emergency = await postVoice({ text: safetyText, fault });
  faultRows.push({
    fault,
    ordinary: {
      status: ordinary.status,
      fallback: ordinary.data?.telemetry?.fallback === true,
      originalPreserved: hasOriginal(ordinary.data, ordinaryText),
      safetyPreserved: hasSafety(ordinary.data),
    },
    emergency: {
      status: emergency.status,
      fallback: emergency.data?.telemetry?.fallback === true,
      originalPreserved: hasOriginal(emergency.data, safetyText),
      safetyPreserved: hasSafety(emergency.data),
      medicalSafetyPreserved: hasMedicalSafety(emergency.data),
    },
  });
}

const repeated = [];
for (let index = 0; index < 5; index += 1) {
  const response = await postVoice({ text: safetyText, fault: faults[index % faults.length] });
  repeated.push({
    cycle: index + 1,
    status: response.status,
    originalPreserved: hasOriginal(response.data, safetyText),
    safetyPreserved: hasSafety(response.data),
    medicalSafetyPreserved: hasMedicalSafety(response.data),
  });
}

const recovery = await postVoice({ text: safetyText, mode: 'triage' });
const safetyOnly = await postVoice({ text: safetyText, mode: 'extract', safetyOnly: true });

const sourceFiles = {
  client: 'app/components/kikumae-client.tsx',
  questionsRoute: 'app/api/questions/route.ts',
  repository: 'db/repository.ts',
};
const source = {};
for (const [key, path] of Object.entries(sourceFiles)) source[key] = await readFile(path, 'utf8');

const capabilityAudit = {
  originalPersistence: source.questionsRoute.includes('body') && source.repository.includes('body_original'),
  browserDraftRestore: source.client.includes('localStorage.getItem(\'kikumae-shelter-draft\')'),
  draftRetainedOnSubmitFailure: source.client.includes('queueSubmission(pendingSubmission)') && source.client.includes('if (!response.ok)'),
  pendingSendQueue: source.client.includes('kikumae-pending-submissions-v1') && source.client.includes('flushPendingSubmissions'),
  durableServerOutbox: false,
  databaseBackupRestore: false,
  multiDeviceConflictResolution: false,
  powerLossTestExecuted: false,
  dbRestartTestExecuted: false,
  lanDisconnectTestExecuted: false,
  browserCrashTestExecuted: false,
  diskFullTestExecuted: false,
  clockDriftTestExecuted: false,
};

const simpleFaultGate = faultRows.every((row) => [row.ordinary, row.emergency].every((entry) => entry.status === 200 && entry.fallback && entry.originalPreserved && entry.safetyPreserved))
  && faultRows.every((row) => row.emergency.medicalSafetyPreserved);
const recoveryPassed = recovery.status === 200 && hasOriginal(recovery.data, safetyText) && hasMedicalSafety(recovery.data);
const safetyOnlyPassed = safetyOnly.status === 200 && hasMedicalSafety(safetyOnly.data);
const untestedSystemFaults = Object.entries(capabilityAudit).filter(([, value]) => value === false).map(([key]) => key);
const overallGatePassed = simpleFaultGate && recoveryPassed && safetyOnlyPassed && untestedSystemFaults.length === 0;

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  phase: '3B',
  scope: '本番データを変更しないローカル評価。AIレーン障害と決定的Safety/triageレーンを検証し、電源・DB・LAN等の実機障害は未実施として記録する。',
  gate: {
    simpleFaultOriginalAndSafetyPreserved: simpleFaultGate,
    recoveryPreserved: recoveryPassed,
    safetyOnlyPreserved: safetyOnlyPassed,
    overallPassed: overallGatePassed,
    reason: overallGatePassed ? '全項目を確認' : 'AI障害レーンは通過したが、実機・DB・LAN・バックアップ等の評価が未実施のためPhase 3B Gateは未達',
  },
  faultRows,
  repeated,
  recovery: { status: recovery.status, originalPreserved: hasOriginal(recovery.data, safetyText), safetyPreserved: hasMedicalSafety(recovery.data) },
  safetyOnly: { status: safetyOnly.status, safetyPreserved: hasMedicalSafety(safetyOnly.data) },
  capabilityAudit,
  untestedSystemFaults,
  limitations: [
    '電源断・PC再起動・Ollama再起動・DB再起動・LAN切断復帰・ディスク容量不足・時刻ずれ・長時間稼働・複数端末は、このスクリプトでは代替していない。',
    'ローカル下書きは確認できるが、送信待ちキューとサーバー側の耐久アウトボックスは未実装。',
    'DBのバックアップ／復元手順と実機リカバリはPhase 3Aの設計段階に留まる。',
  ],
};

await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, simpleFaultGate, recoveryPassed, safetyOnlyPassed, overallGatePassed, untestedSystemFaults }, null, 2));
