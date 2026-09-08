export type SafetyResult = {
  flags: string[];
  immediate: boolean;
};

export interface SafetyGuard {
  inspect(text: string): SafetyResult;
}

const SAFETY_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '意識・呼吸の異常', pattern: /(意識(?:が|は)?(?:ない|ありません|おかしい|ぼんやり)|呼吸(?:が|は)?(?:苦しい|苦しく|できない|できません|おかしい|止ま)|息(?:が|を)(?:できない|できません|苦しい|苦しく|しんど)|会話が続か(?:ない|りません)|しゃべれん|話せない|反応が弱い)/i },
  { label: '大量出血', pattern: /(大量出血|血が止ま(?:ら|りません)|出血が(?:ひど|多))/i },
  { label: '強い胸痛', pattern: /(強い胸痛|胸(?:が|の)(?:強く)?痛|胸を締め付け|胸が痛い)/i },
  { label: '火災・煙', pattern: /(火災|火事|煙|けむり|炎|燃えて|焦げ臭)/i },
  { label: '暴力・武器', pattern: /(暴力|殴ら|殴って|殴り合い|襲われ|武器|刃物|ナイフ|振り回|襲って|怖い人|危ない|物を投げ)/i },
  { label: '自傷・他害', pattern: /(自傷|自殺|死にたい|消えたい|殺す|他害|自分を傷つけ|もうどうでもいい)/i },
  { label: '重大な体調変化', pattern: /(ぐったり|倒れ|けいれん|痙攣|38度|39度|40度|高熱|救急|命に関わ|生命の危険|薬(?:が|も|は)?(?:今夜|今日|切れ|なく|ありません|ない)|インスリン|歩けません|歩けない|起きません|起きん|具合が悪い)/i },
  { label: '建物・閉じ込め', pattern: /(閉じ込め|返事がありません|壁が崩|崩れて.*危険|近づくと危険)/i },
];

// Safety Guard is intentionally deterministic and runs on the original input.
// These phrases are reviewed fallbacks for the resident languages currently
// available in the UI; staff translation is never used as the safety source.
const MULTILINGUAL_SAFETY_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '意識・呼吸の異常', pattern: /(?:unconscious|not conscious|can't breathe|cannot breathe|difficulty breathing|trouble breathing|short of breath|not breathing|stopped breathing|not responding|barely responsive|can't speak|cannot speak|chest hurts|息苦し|呼吸困难|无法呼吸|没有意识|失去意识|喘不过气|호흡이 어렵|숨을 쉴 수 없|숨쉬기 어렵|의식이 없|반응이 없)/i },
  { label: '大量出血', pattern: /(?:heavy bleeding|bleeding won't stop|cannot stop the bleeding|blood won't stop|大量出血|血止不住|出血不止|출혈이 멈추지)/i },
  { label: '強い胸痛', pattern: /(?:severe chest pain|chest pain|chest hurts|pressure in (?:my|the) chest|胸痛|胸口疼|胸が痛い|가슴 통증)/i },
  { label: '火災・煙', pattern: /(?:fire|smoke|flames|flame|burning smell|火灾|着火|浓烟|冒烟|看到.{0,4}火|火事|화재|연기|불이 났)/i },
  { label: '暴力・武器', pattern: /(?:violence|assault|being hit|beaten|weapon|knife|gun|attacked|threatening|throwing things|暴力|被打|武器|刀|有人攻击|폭력|흉기|칼|공격받)/i },
  { label: '自傷・他害', pattern: /(?:suicide|kill myself|hurt myself|self[- ]harm|harm someone|kill them|自杀|自残|伤害自己|자살|자해|죽고 싶|해치고 싶)/i },
  { label: '重大な体調変化', pattern: /(?:high fever|fever.{0,12}(?:39|40)|(?:39|40)\s*(?:°?C|degrees?)|seizure|convulsion|collapsed|passed out|can't walk|cannot walk|won't wake up|insulin|life[- ]threatening|medical emergency|高热|抽搐|昏迷|无法行走|胰岛素|39度|40度|고열|열이 나.{0,12}(?:축 처|기운이 없)|경련|쓰러|걷지 못|인슐린)/i },
  { label: '建物・閉じ込め', pattern: /(?:trapped|locked in|wall collapsed|building collapsed|unsafe to approach|被困|墙倒塌|无法出去|갇혔|벽이 무너|접근하면 위험)/i },
];

function hasActiveMatch(text: string, pattern: RegExp): boolean {
  const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  for (const match of text.matchAll(globalPattern)) {
    const index = match.index ?? 0;
    const after = text.slice(index + match[0].length, index + match[0].length + 18);
    const before = text.slice(Math.max(0, index - 8), index);
    const beforeEnd = before.slice(-6);
    if (/(?:では|じゃ|は|も)?(?:苦しく|でき)?(?:ない|ありません|なし)/.test(after)) continue;
    // Only a negation immediately before the matched safety phrase can
    // suppress it. Searching the whole preceding clause incorrectly treated
    // "息苦しくはないけど胸が痛い" as a negated chest-pain report.
    if (/(?:では|じゃ|は|も)?(?:苦しく|でき)?(?:ない|ありません|なし)$/.test(beforeEnd)) continue;
    // Do not alert on explicit negation in the supported resident
    // languages.  Keep positive forms such as "not breathing" intact: in
    // those cases the negation is part of the matched phrase itself, not a
    // separate negator immediately before the safety term.
    if (/(?:\b(?:not|no|without)\s+(?:a\s+)?$|(?:不是|没有|無|无|并非)\s*$|(?:아니|없|않|안)\s*$)/i.test(before)) continue;
    if (/(?:不是|没有|無|无|并非|아닙니다|아니에요|없습니다|없어요|않습니다|않아요)/i.test(after)) continue;
    if (/(?:さっき|先ほど).{0,12}(?:今は|いまは).{0,8}(?:大丈夫|問題ない|平気)/.test(text) && /息|呼吸/.test(match[0])) continue;
    return true;
  }
  return false;
}

export function detectSafetyFlags(text: string): SafetyResult {
  const multilingualNegation = /(?:no|without)\s+(?:difficulty|trouble)\s+breathing|not\s+short\s+of\s+breath/i.test(text);
  const rules = multilingualNegation ? MULTILINGUAL_SAFETY_RULES.filter((rule) => rule.label !== '意識・呼吸の異常') : MULTILINGUAL_SAFETY_RULES;
  const flags = [...SAFETY_RULES, ...rules].filter((rule) => hasActiveMatch(text, rule.pattern)).map((rule) => rule.label);
  return { flags: Array.from(new Set(flags)), immediate: flags.length > 0 };
}

export const safetyGuard: SafetyGuard = { inspect: detectSafetyFlags };
