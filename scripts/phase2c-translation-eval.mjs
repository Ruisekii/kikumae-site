import { mkdir, writeFile } from 'node:fs/promises';
import { phase2cTranslationCases } from './phase2c-cases.mjs';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2C_TRANSLATION_OUTPUT ?? 'docs/phase2c-translation-latest.json';

function compact(text) { return text.replace(/\s+/g, ''); }
function containsAny(text, values) { return values.some((value) => compact(text).toLocaleLowerCase().includes(compact(value).toLocaleLowerCase())); }
function preserved(text, checks) {
  const compactText = compact(text);
  const numbers = (checks.numbers ?? []).every((value) => compactText.includes(value.replace(':', '')) || (value.endsWith(':00') && compactText.includes(`${value.split(':')[0]}時`)) || value.split(':').every((part) => part === '00' || compactText.includes(part)));
  const uncertainty = !checks.uncertainty || /かもしれ|可能性|疑い|不確か|たぶん|かも|ようで|ようです|らしい|そうです|確信していません|確定していない/.test(text);
  const negation = !checks.negation || /ない|ありません|なし|ではありません|ではない|未確認|不明|いません|確信していません|確定していない/.test(text);
  const symptoms = (checks.symptoms ?? []).every((value) => containsAny(text, value === 'fever' ? ['発熱', '熱'] : value === 'fire' ? ['火災', '火事', '火'] : value === 'smoke' ? ['煙'] : value === 'breath' ? ['呼吸', '息'] : value === '약' ? ['薬'] : value === '열' ? ['熱', '発熱'] : value === '전기 냄새' ? ['電気', '臭い'] : value === '发烧' ? ['発熱', '熱'] : value === '烟' ? ['煙'] : [value]));
  const locationAliases = checks.location === 'Zone A' ? ['ゾーンA', 'Aゾーン', 'A'] : checks.location === '体育馆B' ? ['体育館B', '体育館 B', '体育館'] : checks.location === 'B구역' ? ['B区画', 'B区域', 'B'] : [checks.location ?? ''];
  const location = !checks.location || locationAliases.some((value) => compactText.includes(compact(value))) || (checks.location === 'extinguisher' && /消火器/.test(text));
  return { numbers, uncertainty, negation, symptoms, location, passed: numbers && uncertainty && negation && symptoms && location };
}

const rows = [];
for (const testCase of phase2cTranslationCases) {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/admin/translation-eval`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kikumae-eval-translation': '1', 'cf-connecting-ip': `phase2c-translation-${testCase.id}` }, body: JSON.stringify({ text: testCase.text, language: testCase.language }) });
    const data = await response.json();
    const translatedText = data.translatedTextJa ?? '';
    rows.push({ ...testCase, status: response.status, elapsedMs: Math.round(performance.now() - started), result: data, preservation: preserved(translatedText, testCase.checks) });
  } catch (error) { rows.push({ ...testCase, status: 599, elapsedMs: Math.round(performance.now() - started), error: String(error), preservation: { passed: false } }); }
  console.log(`${testCase.id}: ${rows.at(-1).status}`);
}
const translated = rows.filter((row) => row.result?.translationStatus === 'translated');
const report = { generatedAt: new Date().toISOString(), baseUrl, caseCount: rows.length, translationSuccess: translated.length, preservationPassed: rows.filter((row) => row.preservation.passed).length, rows };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, caseCount: report.caseCount, translationSuccess: report.translationSuccess, preservationPassed: report.preservationPassed }, null, 2));
