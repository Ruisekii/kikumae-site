export type SafetyResult = {
  flags: string[];
  immediate: boolean;
};

export interface SafetyGuard {
  inspect(text: string): SafetyResult;
}

const SAFETY_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '意識・呼吸の異常', pattern: /(意識(?:が|は)?(?:ない|ありません|おかしい)|呼吸(?:が|は)?(?:苦しい|できない|おかしい|止ま)|息(?:が|を)(?:できない|苦しい))/i },
  { label: '大量出血', pattern: /(大量出血|血が止まら|出血が(?:ひど|多))/i },
  { label: '強い胸痛', pattern: /(強い胸痛|胸(?:が|の)(?:強く)?痛|胸を締め付け)/i },
  { label: '火災・煙', pattern: /(火災|火事|煙が|燃えて|焦げ臭)/i },
  { label: '暴力・武器', pattern: /(暴力|殴ら|殴って|襲われ|武器|刃物|ナイフ)/i },
  { label: '自傷・他害', pattern: /(自傷|自殺|死にたい|消えたい|殺す|他害|自分を傷つけ)/i },
  { label: '重大な体調変化', pattern: /(ぐったり|倒れ|けいれん|痙攣|39度|40度|高熱|救急|命に関わ|生命の危険)/i },
];

export function detectSafetyFlags(text: string): SafetyResult {
  const flags = SAFETY_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
  return { flags: Array.from(new Set(flags)), immediate: flags.length > 0 };
}

export const safetyGuard: SafetyGuard = { inspect: detectSafetyFlags };

