export type SafetyResult = {
  flags: string[];
  immediate: boolean;
};

export interface SafetyGuard {
  inspect(text: string): SafetyResult;
}

const SAFETY_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '意識・呼吸の異常', pattern: /(意識(?:が|は)?(?:ない|ありません|おかしい|ぼんやり)|呼吸(?:が|は)?(?:苦しい|苦しく|できない|おかしい|止ま)|息(?:が|を)(?:できない|苦しい|苦しく|しんど)|会話が続か(?:ない|りません)|しゃべれん|話せない|反応が弱い)/i },
  { label: '大量出血', pattern: /(大量出血|血が止ま(?:ら|りません)|出血が(?:ひど|多))/i },
  { label: '強い胸痛', pattern: /(強い胸痛|胸(?:が|の)(?:強く)?痛|胸を締め付け)/i },
  { label: '火災・煙', pattern: /(火災|火事|煙|けむり|燃えて|焦げ臭)/i },
  { label: '暴力・武器', pattern: /(暴力|殴ら|殴って|殴り合い|襲われ|武器|刃物|ナイフ|振り回|襲って|怖い人|危ない|物を投げ)/i },
  { label: '自傷・他害', pattern: /(自傷|自殺|死にたい|消えたい|殺す|他害|自分を傷つけ|もうどうでもいい)/i },
  { label: '重大な体調変化', pattern: /(ぐったり|倒れ|けいれん|痙攣|38度|39度|40度|高熱|救急|命に関わ|生命の危険|薬が.*(?:今夜|今日|切れ|なく)|インスリン|歩けません|歩けない|起きません|起きん|具合が悪い)/i },
  { label: '建物・閉じ込め', pattern: /(閉じ込め|返事がありません|壁が崩|崩れて.*危険|近づくと危険)/i },
];

export function detectSafetyFlags(text: string): SafetyResult {
  const flags = SAFETY_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
  return { flags: Array.from(new Set(flags)), immediate: flags.length > 0 };
}

export const safetyGuard: SafetyGuard = { inspect: detectSafetyFlags };
