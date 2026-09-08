import { mkdir, writeFile } from 'node:fs/promises';
import { phase2cCases } from './phase2c-cases.mjs';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2C_SAFETY_OUTPUT ?? 'docs/phase2c-safety-multilingual-latest.json';
const rows = [];
for (const testCase of phase2cCases) {
  const response = await fetch(`${baseUrl}/api/ai/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kikumae-safety-only': '1', 'cf-connecting-ip': `phase2c-safety-recheck-${testCase.id}` }, body: JSON.stringify({ mode: 'extract', text: testCase.text, state: { language: testCase.language, originalText: [] }, intake: {} }) });
  const data = await response.json();
  rows.push({ id: testCase.id, language: testCase.language, critical: testCase.critical, actual: data.safety?.immediate === true, flags: data.safety?.flags ?? [], status: response.status });
}
const byLanguage = Object.fromEntries(['ja', 'en', 'zh', 'ko'].map((language) => {
  const subset = rows.filter((row) => row.language === language); const tp = subset.filter((row) => row.critical && row.actual).length; const fp = subset.filter((row) => !row.critical && row.actual).length; const fn = subset.filter((row) => row.critical && !row.actual).length;
  return [language, { cases: subset.length, truePositive: tp, falsePositive: fp, falseNegative: fn, recall: tp + fn ? tp / (tp + fn) : null, precision: tp + fp ? tp / (tp + fp) : null }];
}));
const report = { generatedAt: new Date().toISOString(), caseCount: rows.length, byLanguage, rows };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, byLanguage }, null, 2));
