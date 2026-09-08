import { mkdir, writeFile } from 'node:fs/promises';
import { phase2a5Cases } from './phase2a5-cases.mjs';

const baseUrl = process.env.KIKUMAE_LOCAL_URL ?? 'http://localhost:3000';
const outputPath = process.env.PHASE2B_SAFETY_110_OUTPUT ?? 'docs/phase2b-safety-110-latest.json';

async function check(testCase, index) {
  const response = await fetch(`${baseUrl}/api/ai/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `phase2b-safety-110-${index}`, 'x-kikumae-safety-only': '1' },
    body: JSON.stringify({ mode: 'extract', text: testCase.text, state: { language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown', safetyFlags: [], missingFields: [], askedFields: [], originalText: [], confidence: null, category: null }, intake: {} }),
  });
  const data = await response.json();
  return { id: testCase.id, input: testCase.text, expected: testCase.expected.critical === true, actual: data.safety?.immediate === true, flags: data.safety?.flags ?? [], status: response.status };
}

const rows = [];
for (let index = 0; index < phase2a5Cases.length; index += 1) rows.push(await check(phase2a5Cases[index], index));
const truePositive = rows.filter((row) => row.expected && row.actual).length;
const falsePositive = rows.filter((row) => !row.expected && row.actual).length;
const falseNegative = rows.filter((row) => row.expected && !row.actual).length;
const report = { generatedAt: new Date().toISOString(), caseCount: rows.length, truePositive, falsePositive, falseNegative, recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null, precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null, rows };
await mkdir(outputPath.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, ...report, rows: undefined }, null, 2));
