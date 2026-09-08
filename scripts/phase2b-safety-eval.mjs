import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2B_SAFETY_OUTPUT ?? 'docs/phase2b-safety-latest.json';
const cases = [
  ['息ができない', true],
  ['さっき息苦しかったが今は大丈夫です', false],
  ['火事です。調理室から煙が出ています', true],
  ['火事ではありません。焦げたにおいもありません', false],
  ['殴られそうで怖いです', true],
  ['暴力ではありません。大きな声で相談しています', false],
  ['高熱でぐったりしています', true],
  ['高熱ではないですが、少しだるいです', false],
  ['意識はあります。会話もできます', false],
  ['呼吸が苦しくありません', false],
  ['子どもが39度でぐったりしています', true],
  ['壁が崩れて近づくと危険です', true],
  ['トイレが汚れていて困っています', false],
  ['夜に大声で騒いでいて眠れません', false],
  ['薬が今夜で切れます', true],
  ['煙たいですが火は見えていません', true],
];

const rows = [];
for (const [text, expected] of cases) {
  const started = performance.now();
  let status = 599; let data = {};
  try {
    const response = await fetch(`${baseUrl}/api/ai/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `phase2b-safety-${rows.length}`, 'x-kikumae-safety-only': '1' }, body: JSON.stringify({ mode: 'extract', text, state: { language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [text], confidence: null, category: null }, intake: {} }) });
    status = response.status; data = await response.json();
  } catch (error) { data = { error: error instanceof Error ? error.message : String(error) }; }
  const actual = data?.safety?.immediate === true;
  rows.push({ text, expected, actual, correct: expected === actual, status, flags: data?.safety?.flags ?? [], elapsedMs: Math.round(performance.now() - started) });
  console.log(`${rows.length}/${cases.length} ${expected === actual ? 'OK' : 'NG'} ${text} => ${actual ? '発火' : '非発火'}`);
}
const tp = rows.filter((row) => row.expected && row.actual).length;
const fp = rows.filter((row) => !row.expected && row.actual).length;
const fn = rows.filter((row) => row.expected && !row.actual).length;
const report = { generatedAt: new Date().toISOString(), caseCount: rows.length, correct: rows.filter((row) => row.correct).length, falsePositive: fp, falseNegative: fn, recall: tp + fn ? tp / (tp + fn) : null, precision: tp + fp ? tp / (tp + fp) : null, rows };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
