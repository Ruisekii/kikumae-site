import {
  applyStructuredIncident,
  generateShelterAnalysis,
  type ShelterAnalysis,
  type ShelterIntake,
  type StructuredIncident,
} from '../../db/local-ai';
import { safetyGuard, type SafetyResult } from './safety-guard';
import { extractMultilingualIncidentHints } from './multilingual-incident';

/** 職員向け整理カードの出所。原文の証拠を必ず保持する。 */
export type OrganizationSource = 'user_selection' | 'user_text' | 'server_rule' | 'safety_rule' | 'ai_organized' | 'llm_extraction' | 'staff_edit';
export type EvidenceStatus = 'exact' | 'token' | 'not_found';

export type OrganizationItem = {
  value: string;
  source: OrganizationSource;
  confirmed: boolean;
  uncertain?: boolean;
  evidence: string | null;
  evidenceStatus: EvidenceStatus;
  messageId: string;
};

export type StaffOrganization = {
  schemaVersion: 'phase2e.v1';
  title: string;
  category: string;
  original: { messageId: string; originalText: string; originalLanguage: string; createdAt: number };
  facts: OrganizationItem[];
  requests: OrganizationItem[];
  context: OrganizationItem[];
  emotionalState: OrganizationItem[];
  uncertainPoints: OrganizationItem[];
  safetySignals: OrganizationItem[];
  missingInformation: string[];
  mode: 'evidence-bound' | 'llm-enriched' | 'fallback';
  status: 'complete' | 'fallback';
  organizedAt: number;
};

export interface StaffOrganizationProvider { organize(input: StaffOrganizationInput): StaffOrganization; }

export type StaffOrganizationInput = {
  body: string;
  originalLanguage?: string;
  messageId: string;
  createdAt?: number;
  intake?: ShelterIntake;
  structuredIncident?: StructuredIncident;
  analysis?: ShelterAnalysis;
  safety?: SafetyResult;
  mode?: 'evidence-bound' | 'llm-enriched' | 'fallback';
};

function evidenceFor(value: string, body: string): { evidence: string | null; evidenceStatus: EvidenceStatus } {
  if (value && body.includes(value)) return { evidence: value, evidenceStatus: 'exact' };
  const term = value.split(/[・、：:／/\s]+/).find((candidate) => candidate.length >= 2 && body.includes(candidate));
  return term ? { evidence: term, evidenceStatus: 'token' } : { evidence: null, evidenceStatus: 'not_found' };
}

function sourceFor(value: string, structured: StructuredIncident | undefined, field: keyof NonNullable<StructuredIncident['provenance']>): OrganizationSource {
  const source = structured?.provenance?.[field]?.source;
  if (source === 'user_selection' || source === 'user_text' || source === 'server_rule' || source === 'safety_rule' || source === 'llm_extraction' || source === 'staff_edit') return source;
  return value ? 'ai_organized' : 'user_text';
}

function item(value: unknown, body: string, messageId: string, source: OrganizationSource = 'ai_organized', confirmed = false, uncertain = false): OrganizationItem | null {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  if (!text) return null;
  return { value: text.slice(0, 240), source, confirmed, ...(uncertain ? { uncertain: true } : {}), ...evidenceFor(text, body), messageId };
}

function unique(items: Array<OrganizationItem | null>): OrganizationItem[] {
  const seen = new Set<string>();
  return items.filter((entry): entry is OrganizationItem => Boolean(entry)).filter((entry) => {
    const key = entry.value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 16);
}

function uncertaintyLabels(body: string): string[] {
  const labels: string[] = [];
  if (/(かもしれ|かも|たぶん|おそらく|気がする|ような|分からない|わからない|不明|と思[うい]|maybe|perhaps|might|not sure|也许|可能|不知道|아마|모르)/i.test(body)) labels.push('本人の表現に不確実さがあります');
  if (/(死ぬ|死んじゃ|最悪|終わり|見捨て)/.test(body) && !/(意識|呼吸|出血|火事|火災|殴|襲)/.test(body)) labels.push('強い表現は感情として記録し、生命危険の事実とは分けて確認が必要です');
  if (/(何回|何度|また|以前|さっきから|何回言|何度言|言っても|伝えた|three times|好几次|몇 번)/i.test(body)) labels.push('以前にも申し出た・繰り返し伝えた可能性があります');
  return labels;
}

function explicitTarget(body: string): { type: string; count: number } | undefined {
  const countMatches = Array.from(body.matchAll(/(\d{1,3})\s*(?:人|名|people|persons|명)/gi));
  const count = Number(countMatches.at(-1)?.[1] ?? 1);
  if (/(乳児|赤ちゃん|baby|babies|분유|婴儿)/i.test(body)) return { type: 'infant', count };
  if (/(子ども|こども|子供|child|children|kids|孩子|아이)/i.test(body)) return { type: 'child', count };
  if (/(母|父|高齢|お年寄り|mother|father|elderly|어머니|아버지)/i.test(body)) return { type: 'adult', count: 1 };
  return undefined;
}

function explicitLocation(body: string): string | undefined {
  const matches = Array.from(body.matchAll(/(体育館入口|体育館(?:の)?(?:北側|南側)?|北トイレ|南トイレ|調理室|救護所|受付(?:付近)?|北面|南面|北側|南側|kitchen|gymnasium|gym|reception|entrance|medical room|water station)/gi));
  return matches.at(-1)?.[1];
}

function explicitLocations(body: string): string[] {
  return Array.from(body.matchAll(/(体育館入口|体育館(?:の)?(?:北側|南側)?|北トイレ|南トイレ|調理室|救護所|受付(?:付近)?|北面|南面|kitchen|gymnasium|gym|reception|entrance|medical room|water station)/gi), (match) => match[1]).filter((value, index, values) => values.indexOf(value) === index).slice(0, 4);
}

function explicitFacts(body: string): string[] {
  const patterns = [
    /(?:3[89]|40)\s*(?:度|℃|°C|degrees?)/i, /ぐったり|意識(?:は|が)?(?:ある|ない|ぼんやり)|反応が弱い|起きません|起きない|呼吸(?:が|は)?(?:苦しい|できない)|息が苦しい|息苦しい|chest hurts|숨쉬기 어렵/i, /熱|fever/i,
    /水|飲料水|給水|water|drinking water|식수|饮用水/i, /食料|食事|ごはん|food|meal|음식/i,
    /毛布|blanket/i, /ミルク|おむつ|baby formula|infant formula|奶粉|분유/i, /トイレ|toilet|bathroom|화장실/i,
    /薬/i, /糖尿病|medicine|insulin|약/i, /今夜|今朝|朝から|昨日の夜|今日中|today|morning|tonight/i, /煙|火|火災|fire|smoke|flames|kitchen|화재/i, /暴力はありません|暴力ではありません|暴力|殴られそう|怒鳴|椅子を振り回|threatening|knife|violence|beaten|폭력/i,
    /使えません|使えない|使用できない|not working|cannot use/i, /言い合い|口論|argument|dispute/i, /充電|charging|charge|충전/i,
    /何も食べていない|no food|haven't eaten/i, /少しあります|一滴も|ほとんど|空です|タンク|補充|a little remains|some remains/i, /\d{1,3}\s*(?:枚|個|本|people|persons)/i, /焦げた|burning smell|strange smell/i, /血が止まりません|大量出血|heavy bleeding|bleeding won't stop/i, /歩けません|can't walk|cannot walk/i, /呼びかけても返事がありません|返事がありません|not responding/i, /何も食べて|朝から|昨日から|今日中|今夜|配布|遅すぎ|待たされ|なくなりそう|2本|6人/i, /つながりません|つながらない|電波|携帯電話|連絡/i, /寒くて|眠れません|お風呂|洗濯|受付時間|ルール|ペット|犬|家族|はぐれ|伝言|車いす|入口/i, /アレルギー|卵|生理用品|濡れて|着替え|備蓄品|配布場所/i, /北面|南面|不能使用|很脏|婴儿|厕所|奶粉|숨쉬기 어렵|어머니/i, /没有|없습니다|no drinking water/i,
  ];
  return patterns.flatMap((pattern) => { const match = body.match(pattern); return match?.[0] ? [match[0]] : []; });
}

function organizationTitle(analysis: ShelterAnalysis, structured?: StructuredIncident): string {
  if (structured?.request === 'medical_assistance' || analysis.request === 'medical_assistance' || analysis.issueCategory === '医療') return '医療・体調の相談';
  return analysis.title || '避難所での困りごと';
}

function requestCode(value: string | null | undefined, body: string, hinted?: string): string {
  if (hinted) return hinted;
  if (/water_supply|food_supply|medical_assistance|toilet_assistance|infant_supplies|fire_response|safety_assistance|general_assistance/.test(value ?? '')) return value as string;
  if (/火事ではありません|火災ではありません|not a fire|不是火灾|화재가 아닙니다/i.test(body)) return 'general_assistance';
  if (/暴力はありません|暴力ではありません|no violence|not violence|没有暴力|폭력은 없습니다/i.test(body)) return 'general_assistance';
  if (/火事|火災|煙|fire|smoke|flames|burning smell|화재|연기/.test(body)) return 'fire_response';
  if (/暴力|殴|刃物|武器|怒鳴|振り回|物を投げ|threatening|knife|violence|beaten|폭력/.test(body)) return 'safety_assistance';
  if (/トイレ/.test(body)) return 'toilet_assistance';
  if (/おむつ|ミルク|乳児|赤ちゃん/.test(body)) return 'infant_supplies';
  if (/水|飲料|給水/.test(body)) return 'water_supply';
  if (/食料|食事|ごはん|毛布/.test(body)) return 'food_supply';
  if (/医療|薬|熱|痛|苦し|呼吸|息苦し|意識|反応|起きない|起きません|返事がありません|けが|怪我|ぐったり|medicine|fever|chest|breath|medical|숨쉬기|\d{2}\s*(?:度|℃)/i.test(body)) return 'medical_assistance';
  return 'general_assistance';
}

export function organizeStaffIncident(input: StaffOrganizationInput): StaffOrganization {
  const body = input.body.trim().slice(0, 500);
  const intake = input.intake ?? {};
  const base = input.analysis ?? generateShelterAnalysis(body, intake);
  const analysis = input.structuredIncident ? applyStructuredIncident(base, input.structuredIncident) : base;
  const safety = input.safety ?? safetyGuard.inspect(body);
  const hints = extractMultilingualIncidentHints(body);
  const negatedSafety = /火事ではありません|火災ではありません|not a fire|不是火灾|화재가 아닙니다|暴力はありません|暴力ではありません|no violence|not violence|没有暴力|폭력은 없습니다/i.test(body);
  const messageId = input.messageId || 'message:unknown';
  const structured = input.structuredIncident;
  const originalLanguage = input.originalLanguage || structured?.language || 'ja';
  const source = (field: keyof NonNullable<StructuredIncident['provenance']>, value: string): OrganizationSource => sourceFor(value, structured, field);
  const facts = unique([
    ...analysis.facts.filter((fact) => !fact.startsWith('相談分類：')).map((fact) => item(fact, body, messageId, source('facts', fact))),
    ...(structured?.facts ?? []).map((fact) => item(fact, body, messageId, 'llm_extraction', false)),
    ...hints.facts.map((fact) => item(fact, body, messageId, 'user_text', false)),
    ...explicitFacts(body).map((fact) => item(fact, body, messageId, 'user_text', true)),
  ]);
  const effectiveLocation = structured?.location || hints.location || explicitLocation(body) || analysis.location || intake.location;
  const effectiveTarget = structured?.target || hints.target || explicitTarget(body);
  const targetLabel = /(赤ちゃん|乳児|baby|babies|분유)/i.test(body) ? '赤ちゃん' : /(子ども|こども|子供|child|children|kids|孩子|아이)/i.test(body) ? '子ども' : effectiveTarget?.type || (effectiveTarget as { ageGroup?: string } | undefined)?.ageGroup || '';
  const targetText = effectiveTarget?.count ? `${targetLabel ? `${targetLabel}・` : ''}${effectiveTarget.count}人` : analysis.peopleCount;
  const timeMatches = Array.from(body.matchAll(/昨日の夜|昨日から|今朝から|朝から|今夜|今日中|today|morning|tonight/gi)).map((match) => match[0]);
  const latestTime = timeMatches.at(-1) || analysis.lastReceivedAt;
  const context = unique([
    ...explicitLocations(body).map((location) => item(location, body, messageId, source('location', location), Boolean(intake.location))),
    item(effectiveLocation, body, messageId, source('location', effectiveLocation), Boolean(intake.location)),
    item(targetText, body, messageId, source('target', targetText), Boolean(intake.peopleCount)),
    ...analysis.vulnerablePeople.filter((value) => value !== '不明').map((value) => item(`配慮が必要な人：${value}`, body, messageId, 'user_text')),
    item(latestTime, body, messageId, source('time', latestTime)),
    ...uncertaintyLabels(body).filter((label) => label.includes('申し出')).map((label) => item(label, body, messageId, 'user_text', false, true)),
  ]);
  const operationalRequest = requestCode(structured?.request || analysis.request, body, negatedSafety ? undefined : hints.request);
  const requests = unique([item(operationalRequest, body, messageId, source('request', operationalRequest))]);
  const explicitAngerNegation = /怒って(?:は|い)?ません|怒りはありません|not angry/i.test(body);
  const emotionCue = !explicitAngerNegation && /怒|何回|何度|最悪|困る|困っています|何をして|焦り|助けて|怖い|不安|泣|疲れ|皮肉|素晴らしい対応|何時間|待てば|また同じ|大変|どうしたら|言い合い|ちゃんと仕事|気がします|angry|frustrat|upset|anxious|worried|help|ignore|three times|担心|着急|好几次|불안|화가|몇 번|도와/i.test(body);
  const emotions = unique([
    emotionCue ? item(/怒|何回|何度|最悪|焦り|助けて|angry|frustrat|upset|three times|好几次|몇 번/i.test(body) ? '不安・怒り・焦り' : analysis.emotion || '不安・困りごと', body, messageId, 'ai_organized') : null,
    emotionCue && analysis.emotionalIntensity === 'high' ? item('強い切迫感・怒り・焦り', body, messageId, 'ai_organized') : null,
    emotionCue && analysis.emotionalIntensity === 'medium' ? item('不安・焦り・つらさ', body, messageId, 'ai_organized') : null,
  ]);
  const uncertain = unique(uncertaintyLabels(body).map((label) => item(label, body, messageId, 'user_text', false, true)));
  const safetySignals = unique(safety.flags.map((flag) => item(flag, body, messageId, 'safety_rule')));
  const missingInformation = Array.from(new Set([...(structured?.missingFields ?? []), ...analysis.missingInformation])).slice(0, 12);
  return {
    schemaVersion: 'phase2e.v1', title: organizationTitle(analysis, structured), category: structured?.category || analysis.issueCategory,
    original: { messageId, originalText: body, originalLanguage, createdAt: input.createdAt ?? Date.now() },
    facts, requests, context, emotionalState: emotions, uncertainPoints: uncertain, safetySignals, missingInformation,
    mode: input.mode ?? 'evidence-bound', status: input.mode === 'fallback' ? 'fallback' : 'complete', organizedAt: Date.now(),
  };
}

export class EvidenceBoundStaffOrganizationProvider implements StaffOrganizationProvider {
  organize(input: StaffOrganizationInput): StaffOrganization { return organizeStaffIncident(input); }
}
