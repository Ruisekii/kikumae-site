import type { ShelterCategory } from '../../db/local-ai';

export type MultilingualIncidentHints = {
  category?: ShelterCategory;
  request?: string;
  facts: string[];
  target?: { type?: string; count?: number; ageGroup?: string };
  location?: string;
  urgent: boolean;
};

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

function countFromForeignText(text: string): number | undefined {
  const number = text.match(/\b(\d{1,3})\b\s*(?:people|person|children|child|kids|bab(?:y|ies)|adults?|family members?)/i);
  if (number?.[1]) return Number(number[1]);
  const word = text.match(/\b(one|two|three|four|five)\b\s*(?:people|person|children|child|kids|bab(?:y|ies)|adults?|family members?)/i);
  return word?.[1] ? NUMBER_WORDS[word[1].toLowerCase()] : undefined;
}

/** Conservative local hints for the resident languages when no model is available. */
export function extractMultilingualIncidentHints(value: string): MultilingualIncidentHints {
  const text = value.trim();
  const lower = text.toLocaleLowerCase();
  const facts: string[] = [];
  const add = (fact: string) => { if (!facts.includes(fact)) facts.push(fact); };
  let category: ShelterCategory | undefined;
  let request: string | undefined;

  if (/(toilet|bathroom|restroom|hygiene|toilet paper|トイレ|卫生|厕所|화장실|위생)/i.test(text)) { category = 'トイレ・衛生'; request = 'toilet_assistance'; add('トイレ・衛生に関する相談'); }
  else if (/(water|drinking water|thirsty|水|饮用水|식수)/i.test(text)) { category = '水・飲料'; request = 'water_supply'; add('飲料水に関する相談'); }
  else if (/(food|meal|hungry|baby formula|infant formula|食べ物|食料|奶粉|食物|음식|분유)/i.test(text)) { category = '食料・物資'; request = /formula|奶粉|分유/i.test(text) ? 'infant_supplies' : 'food_supply'; add('食料・物資に関する相談'); }
  else if (/(fever|sick|ill|pain|hurt|injur|medicine|doctor|medical|breath|chest|unconscious|not responding|热|痛|药|受伤|发烧|疼|药|发病|열|아프|약|부상|숨쉬기|어머니)/i.test(text)) { category = '医療・薬'; request = 'medical_assistance'; add('体調・医療に関する相談'); }
  else if (/(charge|charging|electricity|power|outlet|照明|充电|电源|충전|전기)/i.test(text)) { category = '設備・充電'; request = 'general_assistance'; add('設備・充電に関する相談'); }
  else if (/(fire|smoke|flames|burning smell|火灾|火事|화재|연기)/i.test(text)) { category = '安全・その他'; request = 'fire_response'; add('火災・煙に関する相談'); }
  else if (/(violence|weapon|knife|threatening|assault|unsafe|暴力|被打|폭력|흉기)/i.test(text)) { category = '安全・その他'; request = 'safety_assistance'; add('安全に関する相談'); }

  const count = countFromForeignText(text);
  const target = count ? { count } : /\b(?:my|the)\s+(?:daughter|son|child|baby|mother|father|parent)|\b(?:daughter|son|child|baby|mother|father)\b/i.test(text)
    ? { count: 1, ageGroup: /daughter|son|child|baby/i.test(lower) ? 'child' : 'adult' }
    : undefined;
  if (target) add('対象者がいる');

  const location = /\b(north|south|east|west)\s+(?:toilet|bathroom|restroom)\b/i.exec(text)?.[0]
    ?? /\b(gym|gymnasium|reception|entrance|medical room|water station|food distribution)\b/i.exec(text)?.[0];
  if (location) add(`場所：${location}`);

  const urgent = /(unconscious|can't breathe|cannot breathe|difficulty breathing|short of breath|not breathing|heavy bleeding|severe chest pain|high fever|seizure|convulsion|fire|smoke|violence|weapon|suicide|kill myself|self[- ]harm|life[- ]threatening|呼吸困难|失去意识|大量出血|火灾|暴力|자살|화재)/i.test(text);
  return { category, request, facts, target, location, urgent };
}
