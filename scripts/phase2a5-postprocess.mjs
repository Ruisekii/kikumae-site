import { readFile, writeFile } from 'node:fs/promises';

const jsonPath = process.env.PHASE2A5_OUTPUT ?? 'docs/phase2a5-evaluation-latest.json';
const report = JSON.parse(await readFile(jsonPath, 'utf8'));

const safetyRules = [
  ['意識・呼吸の異常', /(意識(?:が|は)?(?:ない|ありません|おかしい|ぼんやり)|呼吸(?:が|は)?(?:苦しい|苦しく|できない|おかしい|止ま)|息(?:が|を)(?:できない|苦しい|苦しく|しんど)|会話が続か(?:ない|りません)|しゃべれん|話せない|反応が弱い)/i],
  ['大量出血', /(大量出血|血が止ま(?:ら|りません)|出血が(?:ひど|多))/i],
  ['強い胸痛', /(強い胸痛|胸(?:が|の)(?:強く)?痛|胸を締め付け)/i],
  ['火災・煙', /(火災|火事|煙|けむり|燃えて|焦げ臭)/i],
  ['暴力・武器', /(暴力|殴ら|殴って|殴り合い|襲われ|武器|刃物|ナイフ|振り回|襲って|怖い人|危ない|物を投げ)/i],
  ['自傷・他害', /(自傷|自殺|死にたい|消えたい|殺す|他害|自分を傷つけ|もうどうでもいい)/i],
  ['重大な体調変化', /(ぐったり|倒れ|けいれん|痙攣|38度|39度|40度|高熱|救急|命に関わ|生命の危険|薬が.*(?:今夜|今日|切れ|なく)|インスリン|歩けません|歩けない|起きません|起きん|具合が悪い)/i],
  ['建物・閉じ込め', /(閉じ込め|返事がありません|壁が崩|崩れて.*危険|近づくと危険)/i],
];

function detect(text) {
  const flags = safetyRules.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  return { flags: [...new Set(flags)], immediate: flags.length > 0 };
}

function schemaValid(value) {
  return Boolean(value && typeof value === 'object'
    && (value.location === null || typeof value.location === 'string')
    && (value.target === null || (value.target && typeof value.target === 'object'))
    && Array.isArray(value.facts) && Array.isArray(value.safetyFlags)
    && Array.isArray(value.missingFields) && Array.isArray(value.askedFields)
    && ['unknown', 'low', 'medium', 'high'].includes(value.urgency)
    && Array.isArray(value.originalText));
}

let tp = 0, fp = 0, fn = 0;
for (const item of report.results) {
  const safetyGuard = detect(item.input);
  item.qwen.safetyGuard = safetyGuard;
  item.qwen.schemaValid = schemaValid(item.qwen.result);
  const expected = item.expected.critical === true;
  if (expected && safetyGuard.immediate) tp += 1;
  if (!expected && safetyGuard.immediate) fp += 1;
  if (expected && !safetyGuard.immediate) fn += 1;
}
report.safety = {
  criticalCases: tp + fn,
  truePositive: tp,
  falsePositive: fp,
  missed: fn,
  recall: tp + fn ? tp / (tp + fn) : null,
  precision: tp + fp ? tp / (tp + fp) : null,
  definition: 'Safety Guard only; model-generated flags are retained per case but excluded from this lane metric.',
};
report.schemaValid = report.results.filter((item) => item.qwen.schemaValid).length;
report.schemaInvalid = report.results.length - report.schemaValid;
await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
const mdPath = jsonPath.replace(/\.json$/i, '.md');
const lines = [
  '# Phase 2A.5 固定評価結果', '',
  `生成日時: ${report.generatedAt}`,
  `モデル: ${report.model}`,
  `ケース数: ${report.caseCount} / グループ数: ${report.groups.length}`,
  `Qwen HTTP成功: ${report.qwenHttpSuccess}/${report.caseCount} / 完全一致: ${report.qwenExact}/${report.caseCount} / local-rules完全一致: ${report.localRulesExact}/${report.caseCount}`,
  `JSON Schema形状確認: ${report.schemaValid}/${report.caseCount}`,
  `Qwen応答時間: 平均 ${report.qwenAverageMs}ms / 最短 ${report.qwenMinMs}ms / 最長 ${report.qwenMaxMs}ms`,
  `重要事実の取りこぼし率: ${(report.factMetrics.importantFactOmissionRate * 100).toFixed(1)}% (${report.factMetrics.omittedFacts}/${report.factMetrics.expectedFacts})`,
  `Safety Guard: recall ${(report.safety.recall * 100).toFixed(1)}% / precision ${(report.safety.precision * 100).toFixed(1)}% / missed ${report.safety.missed} / false positive ${report.safety.falsePositive}`,
  '', '| ケース | グループ | Qwen | local-rules | 抽出(ms) | 取りこぼし |', '|---|---|---:|---:|---:|---:|',
  ...report.results.map((item) => `| ${item.label} | ${item.group} | ${item.qwen.score.passed}/${item.qwen.score.total} | ${item.localRules.score.passed}/${item.localRules.score.total} | ${item.qwen.elapsedMs} | ${item.qwen.score.fact.omitted}/${item.qwen.score.fact.expected} |`),
  '', '## 指標の定義', '',
  '- 完全一致: location / target / request / urgency / missingFields / safetyFlags / facts の全チェックが通ったケース。',
  '- JSON Schema形状確認: 正規化後Incident JSONの必須配列・値域を確認した件数。',
  '- 重要事実の取りこぼし率: 期待factsのうち、意味的に一致する抽出factsが見つからなかった割合。',
  '- Safety Guardのrecall/precisionは、LLMの旗振りではなく入力文へ独立レーンを適用した値。',
  '- hallucinatedFactsは入力文・期待factsとの対応が確認できない抽出factsの近似値で、人間レビューを置き換えない。',
];
await writeFile(mdPath, lines.join('\n'), 'utf8');
console.log(JSON.stringify({ cases: report.caseCount, safety: report.safety, schemaValid: report.schemaValid }, null, 2));
