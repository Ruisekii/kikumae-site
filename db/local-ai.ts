/**
 * 外部サービスへ送信しない、Worker内のlocal-rules fallback。
 *
 * Sites版の標準経路は決定的な安全処理です。Phase 2では別のモデルゲートウェイ
 * をConversation / Incident Extractionへ接続できるようにし、ここはAI障害時と
 * 完全障害時のFallbackとして残します。どの経路でも人の承認なしに公開状態へ
 * 進みません。
 */

import type { Faq, RelatedFaq } from './repository';
import { resolveShelterZoneId, shelterLocationLabel } from '../lib/shelter-map-data';
import type { FourBStatus, IncidentProvenance } from '../app/lib/incident-schema';
import { detectSafetyFlags } from '../app/lib/safety-guard';

export type AiFaq = Faq;
export type AiRelatedFaq = RelatedFaq;

export const SHELTER_CATEGORIES = ['水・飲料', '食料・物資', '医療・薬', 'トイレ・衛生', '設備・充電', 'ペット', '安全・その他', 'その他'] as const;
export type ShelterCategory = typeof SHELTER_CATEGORIES[number];
export const ISSUE_CATEGORIES = ['水', '食料', '医療', '衛生', 'トイレ', '睡眠', '安全', 'ペット', 'バリアフリー', '充電・通信', '人間関係', 'その他'] as const;
export type IssueCategory = typeof ISSUE_CATEGORIES[number];
export type UrgencyLevel = 'critical' | 'high' | 'normal' | 'low';

export type ShelterIntake = {
  location?: string;
  issueLocation?: string;
  reporterLocation?: string;
  peopleCount?: string;
  resourceRemaining?: string;
  lastReceivedAt?: string;
  additionalDetails?: string;
};

/** Structured model output accepted by the persistence boundary. */
export type StructuredIncident = {
  language?: string;
  location?: string | null;
  target?: { type?: string | null; count?: number | null; ageGroup?: string | null } | null;
  facts?: string[];
  request?: string | null;
  urgency?: string;
  safetyFlags?: string[];
  missingFields?: string[];
  confidence?: number | null;
  category?: ShelterCategory | null;
  provenance?: IncidentProvenance;
  structuredComplete?: boolean;
  fourBRequested?: boolean;
  fourBStatus?: FourBStatus;
};

export type ShelterAnalysis = {
  title: string;
  overview: string;
  request: string;
  facts: string[];
  emotion: string;
  emotionalIntensity: 'low' | 'medium' | 'high';
  containsAbusiveLanguage: boolean;
  missingInformation: string[];
  urgencyCandidate: '高' | '中' | '低';
  urgencyLevel: UrgencyLevel;
  urgencyConfidence: number;
  urgentReview: boolean;
  category: ShelterCategory;
  issueCategory: IssueCategory;
  location: string;
  issueLocation: string;
  peopleCount: string;
  affectedPeople: string;
  vulnerablePeople: string[];
  resourceRemaining: string;
  lastReceivedAt: string;
};

const ALLOWED_PEOPLE_CHOICES = new Set(['1人', '2〜5人', '6〜10人', '6人以上', '11人以上', 'わからない']);
const ALLOWED_RESOURCE_CHOICES = new Set(['ほとんどない', '少しある', 'まだある', 'わからない']);
const ALLOWED_TIME_CHOICES = new Set(['今すぐ', '数時間以内', '今日中', '急がない', 'わからない', '今日', '昨日', 'それより前']);

/**
 * Public intake is untrusted browser data. Keep only values that the resident
 * UI can legitimately produce; free-form facts must still come from raw text.
 */
export function sanitizeShelterIntake(input: ShelterIntake = {}): ShelterIntake {
  const locationCandidate = typeof input.location === 'string' ? input.location.trim().slice(0, 80) : '';
  const locationId = resolveShelterZoneId(locationCandidate);
  const safePeople = typeof input.peopleCount === 'string' ? input.peopleCount.trim() : '';
  const safeResource = typeof input.resourceRemaining === 'string' ? input.resourceRemaining.trim() : '';
  const safeTime = typeof input.lastReceivedAt === 'string' ? input.lastReceivedAt.trim() : '';
  const safeQuantity = /^(?:[1-9]|[1-9][0-9])枚$/.test(safeResource) ? safeResource : '';
  return {
    location: locationId ? shelterLocationLabel(locationId) : '',
    issueLocation: locationId ? locationId : '',
    reporterLocation: locationId ? locationId : '',
    peopleCount: ALLOWED_PEOPLE_CHOICES.has(safePeople) || /^(?:[1-9]|[1-9][0-9])人$/.test(safePeople) ? safePeople : '',
    resourceRemaining: ALLOWED_RESOURCE_CHOICES.has(safeResource) ? safeResource : safeQuantity,
    lastReceivedAt: ALLOWED_TIME_CHOICES.has(safeTime) ? safeTime : '',
    additionalDetails: typeof input.additionalDetails === 'string' ? input.additionalDetails.trim().slice(0, 120) : '',
  };
}

function countFromPeopleLabel(value: string): number | null {
  const match = value.match(/^(\d{1,2})人$/);
  return match ? Number(match[1]) : null;
}

function safetyFlagCodes(labels: string[]): string[] {
  return Array.from(new Set(labels.flatMap((label) => {
    if (label.includes('火災')) return ['possible_fire'];
    if (label.includes('暴力')) return ['possible_violence'];
    if (label.includes('自傷')) return ['possible_self_harm'];
    if (label.includes('意識') || label.includes('胸') || label.includes('体調') || label.includes('出血') || label.includes('閉じ込め')) return ['possible_medical_emergency'];
    return [];
  })));
}

/**
 * Build the persisted incident only from server-side text/rules. A browser
 * supplied structuredIncident is deliberately not accepted here.
 */
export function buildServerCanonicalIncident(body: string, intake: ShelterIntake = {}, language = 'ja'): StructuredIncident {
  const safeIntake = sanitizeShelterIntake(intake);
  const analysis = generateShelterAnalysis(body, safeIntake);
  const safety = detectSafetyFlags(body);
  const count = countFromPeopleLabel(analysis.peopleCount);
  const vulnerable = analysis.vulnerablePeople.find((item) => item !== '不明');
  const urgency = safety.immediate || analysis.urgentReview ? 'critical' : analysis.urgencyCandidate === '高' ? 'high' : analysis.urgencyCandidate === '中' ? 'medium' : 'normal';
  const sourceFor = (value: unknown, source: 'user_selection' | 'user_text' | 'server_rule' | 'safety_rule', confirmed = false, messageId: string | null = null) => ({ value, source, confirmed, messageId, evidence: source === 'server_rule' ? null : body });
  return {
    language: language.slice(0, 12) || 'ja',
    location: analysis.location || null,
    target: count || vulnerable ? { type: vulnerable?.includes('子ども') ? 'child' : vulnerable?.includes('乳児') ? 'infant' : null, count, ageGroup: vulnerable ?? null } : null,
    facts: analysis.facts.filter((fact) => !fact.startsWith('相談分類：')).slice(0, 20),
    request: analysis.request || null,
    urgency,
    safetyFlags: safetyFlagCodes(safety.flags),
    missingFields: analysis.missingInformation.slice(0, 12),
    confidence: null,
    category: analysis.category,
    provenance: {
      ...(analysis.location ? { location: sourceFor(analysis.location, safeIntake.location ? 'user_selection' : 'server_rule', Boolean(safeIntake.location)) } : {}),
      ...((count || vulnerable) ? { target: sourceFor({ count, ageGroup: vulnerable ?? null }, safeIntake.peopleCount ? 'user_selection' : 'server_rule', Boolean(safeIntake.peopleCount)) } : {}),
      ...(analysis.request ? { request: sourceFor(analysis.request, 'server_rule') } : {}),
      ...(analysis.facts.length ? { facts: analysis.facts.slice(0, 20).map((fact) => sourceFor(fact, 'server_rule')) } : {}),
      ...(safety.flags.length ? { safetyFlags: sourceFor(safetyFlagCodes(safety.flags), 'safety_rule') } : {}),
      urgency: sourceFor(urgency, safety.flags.length ? 'safety_rule' : 'server_rule'),
    },
    structuredComplete: analysis.missingInformation.length === 0,
    fourBRequested: false,
    fourBStatus: 'not_needed',
  };
}

const PUNCTUATION = /[\s、。・!！?？「」『』()（）\[\]【】,.:;〜~ー\-]/g;
const KEYWORD_RE = /[一-龥]{2,}|[ァ-ヴー]{2,}|[a-zA-Z]{3,}/g;
const PERSONAL_DATA_PATTERN = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|www\.|(?:0\d{1,4}[-ー－ ]?\d{1,4}[-ー－ ]?\d{3,4})|〒\s?\d{3}[-ー－]?\d{4}|(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県).{0,24}(?:市|区|町|村|丁目|番地|号)|(?:学籍|生徒|社員)番号|(?:氏名|名前|住所|電話(?:番号)?|メール(?:アドレス)?|連絡先|郵便番号|口座|マイナンバー)\s*[:：])/i;
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '利用方法': ['使い', '利用', '方法', 'どこから', 'どうやって', '申し込み', '申込み', '見学', '参加', '予約', '訪問'],
  '申請・手続き': ['申請', '手続き', '提出', '精算', '登録', '変更', '申込', '申し込み'],
  '日程・場所': ['いつ', '日程', '日時', '曜日', '時間', '場所', '会議室', '締め日', '活動日'],
  '料金・費用': ['料金', '費用', '部費', 'お金', '金額', '価格', '無料', '有料', 'かかる'],
  'ルール・制度': ['ルール', '規則', '制度', '有給', '在宅', '服装', '条件', '対象', '初心者', '未経験', '初めて', 'はじめて'],
  '困りごと・トラブル': ['できない', 'つながらない', '忘れ', '不具合', '困っ', 'エラー', 'パスワード', '不安'],
};

const SHELTER_CATEGORY_KEYWORDS: Record<ShelterCategory, string[]> = {
  '水・飲料': ['水', '飲料', '給水', '脱水'],
  '食料・物資': ['食料', 'ごはん', '食事', '物資', 'おむつ', 'ミルク', '毛布', '衣類'],
  '医療・薬': ['医療', '病院', 'けが', '怪我', '薬', '持病', '体調', '熱', '痛い', '看護'],
  'トイレ・衛生': ['トイレ', '衛生', '手洗い', '入浴', '生理', '汚れ'],
  '設備・充電': ['充電', '電源', 'コンセント', '照明', '空調', '寒い', '暑い', '設備'],
  'ペット': ['ペット', '犬', '猫', '動物'],
  '安全・その他': ['火事', '火災', '暴力', '危険', '逃げ', '避難', '不審', '安全'],
  その他: [],
};

const URGENT_PATTERNS = /(意識|呼吸|出血|けが|怪我|救急|持病|薬がない|薬切れ|薬.{0,12}(?:明日|今夜|今日|なくな|切れ)|脱水|熱中症|水分(?:が|を)取れない|糖尿病.{0,12}(?:薬|インスリン)|火事|火災|煙|暴力|殴|襲|閉じ込め|倒れ|命|生命|危険|虐待)/i;
const HIGH_URGENCY_PATTERNS = /(足りない|ない|切れ|動けない|痛い|苦しい|使えない|使えません|壊れ|子ども|高齢|乳児|妊娠|一人で|困って)/i;

export function isShelterQuestion(value: string): boolean {
  return /(避難所|避難|給水|飲料|物資|トイレ|充電|薬|医療|ペット|毛布|食料|水が|水の|困っている|困って)/.test(value);
}

export function categorizeShelterQuestion(value: string, requested = ''): ShelterCategory {
  if ((SHELTER_CATEGORIES as readonly string[]).includes(requested)) return requested as ShelterCategory;
  let best: ShelterCategory = 'その他'; let hits = 0;
  (Object.entries(SHELTER_CATEGORY_KEYWORDS) as [ShelterCategory, string[]][]).forEach(([category, words]) => {
    const count = words.filter((word) => value.includes(word)).length;
    if (count > hits) { best = category; hits = count; }
  });
  return best;
}

function emotionLabel(value: string): string {
  if (/(怒|何回|何度|いい加減|ふざけ|困る|最悪|いつまで|限界|見捨て)/.test(value)) return '強い不満・焦り';
  if (/(怖|恐|不安|心配|どうしよう|泣)/.test(value)) return '不安・心配';
  if (/(助けて|苦しい|痛い|つらい)/.test(value)) return '切迫感・つらさ';
  return '不安や困りごとがある';
}

function emotionalIntensity(value: string): 'low' | 'medium' | 'high' {
  if (/(死ね|消えろ|ふざけんな|ふざけるな|何回言|何度言|いい加減|最悪|怒鳴|許さ|どうなってる|限界|見捨て)/.test(value)) return 'high';
  if (/(怒|焦|不安|心配|怖|恐|困る|助けて|苦しい|つらい|泣)/.test(value)) return 'medium';
  return 'low';
}

function containsAbusiveLanguage(value: string): boolean {
  return /(死ね|消えろ|ふざけんな|ふざけるな|馬鹿|バカ|クソ|何回言わせ|いい加減にしろ)/i.test(value);
}

function extractLocation(value: string, intakeLocation: string): string {
  // 入力補助で確定した場所は、本文中の「受付へ伝えた」などの
  // 別の地名・動詞より優先する。既知情報を再推定して上書きしない。
  if (intakeLocation.trim()) return intakeLocation.trim().slice(0, 120);
  const match = value.match(/(体育館(?:北側|南側)?|北トイレ|南トイレ|受付(?:付近)?|救護スペース|駐車場|屋外)/);
  if (match?.[1]) return match[1];
  return '';
}

function extractAffectedPeople(value: string, intakePeople: string): string {
  if (intakePeople.trim()) return intakePeople.trim().slice(0, 80);
  const coupleChildren = value.match(/(?:夫婦|両親)\s*(?:と|、)\s*(?:子ども|こども|子供)\s*(\d{1,3})\s*(?:人|名)/);
  if (coupleChildren?.[1]) return `${Number(coupleChildren[1]) + 2}人`;
  const adultsChildren = value.match(/(?:大人|成人)\s*(\d{1,3})\s*(?:人|名).*?(?:子ども|こども|子供)\s*(\d{1,3})\s*(?:人|名)/) ?? value.match(/(?:子ども|こども|子供)\s*(\d{1,3})\s*(?:人|名).*?(?:大人|成人)\s*(\d{1,3})\s*(?:人|名)/);
  if (adultsChildren?.[1] && adultsChildren?.[2]) return `${Number(adultsChildren[1]) + Number(adultsChildren[2])}人`;
  const match = value.match(/(\d{1,3})\s*(?:人|名)/);
  return match?.[1] ? `${match[1]}人` : '';
}

function extractResourceRemaining(value: string, intakeValue: string): string {
  if (intakeValue.trim()) return intakeValue.trim().slice(0, 120);
  const quantity = value.match(/(\d{1,3})\s*(枚|個|本|箱|セット|人分)/);
  return quantity ? `${quantity[1]}${quantity[2]}` : '';
}

function extractLastReceivedAt(value: string, intakeValue: string): string {
  if (intakeValue.trim()) return intakeValue.trim().slice(0, 120);
  const time = value.match(/(昨日|一昨日|今朝|今晩|さっき|先ほど|数時間前|朝から|昼から|夜から)/);
  return time?.[1] ?? '';
}

function vulnerablePeople(value: string): string[] {
  const found: string[] = [];
  if (/(子ども|こども|乳児|赤ちゃん)/.test(value)) found.push('子ども');
  if (/(高齢|お年寄り)/.test(value)) found.push('高齢者');
  if (/(障害|車いす| wheelchair)/i.test(value)) found.push('障害者');
  if (/(妊婦|妊娠)/.test(value)) found.push('妊婦');
  if (/(持病|糖尿病|透析|喘息|ぜんそく)/.test(value)) found.push('持病あり');
  return found.length ? found : ['不明'];
}

function requestLabel(category: ShelterCategory, value: string): string {
  if (/(追加|配布|持ってき|届け|補充|足り|不足|ない|切れ)/.test(value)) {
    if (category === '水・飲料') return '飲料水の追加配布・補充';
    if (category === '食料・物資') return '食料・物資の追加配布・補充';
    if (category === '医療・薬') return '必要な医療・薬の支援';
    if (category === 'トイレ・衛生') return '清掃や衛生状態の改善';
  }
  if (category === '水・飲料') return '飲料水の配布場所・状況の確認';
  if (category === '食料・物資') return '食料・物資の配布状況の確認';
  if (category === '医療・薬') return '体調・薬についての支援';
  if (category === 'トイレ・衛生') return 'トイレ・衛生についての案内や対応';
  if (category === '設備・充電') return '利用できる設備や充電場所の案内';
  if (category === 'ペット') return 'ペットの受け入れ場所・ルールの案内';
  if (category === '安全・その他') return '安全状況の確認と必要な対応';
  return '相談内容の確認と必要な支援';
}

export function canonicalIssueCategory(category: ShelterCategory, value: string): IssueCategory {
  if (category === '水・飲料') return '水';
  if (category === '食料・物資') return '食料';
  if (category === '医療・薬') return '医療';
  if (category === 'トイレ・衛生') return value.includes('トイレ') ? 'トイレ' : '衛生';
  if (category === '設備・充電') return '充電・通信';
  if (category === 'ペット') return 'ペット';
  if (category === '安全・その他') return '安全';
  if (/(眠|寝|毛布|寒い|暑い)/.test(value)) return '睡眠';
  if (/(車いす|段差|バリアフリー|障害)/i.test(value)) return 'バリアフリー';
  if (/(家族|近所|人間関係|けんか|騒|話し合い)/.test(value)) return '人間関係';
  return 'その他';
}

export function urgencyLevel(urgentReview: boolean, candidate: '高' | '中' | '低'): UrgencyLevel {
  return urgentReview ? 'critical' : candidate === '高' ? 'high' : candidate === '中' ? 'normal' : 'low';
}

export function redactSensitiveInformation(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[連絡先を非表示]')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[URLを非表示]')
    .replace(/(?:0\d{1,4}[-ー－ ]?\d{1,4}[-ー－ ]?\d{3,4})/g, '[電話番号を非表示]')
    .replace(/〒\s?\d{3}[-ー－]?\d{4}/g, '[郵便番号を非表示]')
    .replace(/(?:氏名|名前|住所|電話(?:番号)?|メール(?:アドレス)?|連絡先)\s*[:：]\s*[^、。\n]+/g, (match) => `${match.split(/[:：]/)[0]}：[個人情報を非表示]`)
    .slice(0, 500);
}

function shelterCategorySubject(category: string): string {
  if (category === '水・飲料' || category === '水') return '飲料水';
  if (category === '食料・物資' || category === '食料') return '食事・物資';
  if (category === '医療・薬' || category === '医療') return '体調・薬';
  if (category === 'トイレ・衛生' || category === 'トイレ') return 'トイレ';
  if (category === '衛生') return '衛生';
  if (category === '設備・充電' || category === '充電・通信') return '設備・充電';
  if (category === 'ペット') return 'ペット';
  if (category === '睡眠') return '寝る場所';
  if (category === '安全・その他' || category === '安全') return '安全';
  if (category === 'バリアフリー') return '移動・バリアフリー';
  if (category === '人間関係') return '騒音・人間関係';
  return '避難所の案内・対応';
}

/**
 * 避難所案件の見出しは、原文の一部を切り取るのではなく、
 * 「何が起きているか」を短い業務用ラベルへ正規化する。
 * 職員が最初に見る場所へ感情的な原文を流し込まないための境界。
 */
function shelterIssueSubject(category: ShelterCategory, value: string): string {
  if (category === '水・飲料') return /(配布|給水|どこ|いつ|受け取)/.test(value) && !/(足り|不足|ない|切れ|一滴も)/.test(value) ? '給水・配布案内' : '飲料水不足';
  if (category === '食料・物資') {
    if (/毛布/.test(value)) return '毛布の追加配布';
    if (/(いつ|時間|配布|受け取|どこ)/.test(value) && !/(足り|不足|ない|切れ)/.test(value)) return '食事配布の案内';
    if (/(おむつ|ミルク)/.test(value)) return '育児用品の不足';
    return '食料・物資不足';
  }
  if (category === '医療・薬') {
    if (/(薬|糖尿病|インスリン|持病)/.test(value)) return '薬の不足・医療支援';
    if (/(熱|痛|苦し|体調|けが|怪我)/.test(value)) return '体調不良・医療支援';
    return '救護案内';
  }
  if (category === 'トイレ・衛生') {
    if (/(入浴|着替え)/.test(value)) return '入浴・着替え案内';
    if (/(汚|詰|壊|使え|使えません)/.test(value)) return 'トイレの使用・衛生';
    return 'トイレ・衛生案内';
  }
  if (category === '設備・充電') {
    if (/(充電|電源|コンセント)/.test(value)) return '充電場所・利用状況';
    if (/(寒|暑|空調|照明)/.test(value)) return '避難所設備の不具合';
    return '設備利用の案内';
  }
  if (category === 'ペット') return 'ペットの受け入れ・ルール';
  if (category === '安全・その他') {
    if (/(怒鳴|騒|眠れ|怖|不審|暴力|危険)/.test(value)) return '夜間の安全・騒音';
    if (/(掲示|お知らせ|更新|情報)/.test(value)) return '最新情報の案内';
    return '安全確認';
  }
  return '避難所の案内・対応';
}

function shelterRequestLabel(category: ShelterCategory, value: string): string {
  if (category === '食料・物資' && /(いつ|時間|配布|受け取|どこ)/.test(value) && !/(足り|不足|ない|切れ)/.test(value)) return '食事配布時間・場所の案内';
  if (category === '食料・物資' && /毛布/.test(value)) return '毛布の追加配布・在庫確認';
  if (category === 'トイレ・衛生' && /(入浴|着替え)/.test(value)) return '入浴・着替えの場所と時間の案内';
  if (category === '設備・充電' && /(充電|電源|コンセント)/.test(value)) return '充電場所と利用時間の案内';
  if (category === '安全・その他' && /(怒鳴|騒|眠れ|怖|不審|暴力|危険)/.test(value)) return '夜間の安全確認と環境改善';
  if (category === '安全・その他' && /(掲示|お知らせ|更新|情報)/.test(value)) return '最新のお知らせと更新時刻の案内';
  return requestLabel(category, value);
}

function structuredShelterOverview(title: string, request: string, peopleCount: string, resourceRemaining: string, lastReceivedAt: string, vulnerable: string[]): string {
  const details = [
    peopleCount ? `対象：${peopleCount}` : '',
    resourceRemaining ? `状況：${resourceRemaining}` : '',
    lastReceivedAt ? `時期：${lastReceivedAt}` : '',
    vulnerable.filter((item) => item !== '不明').length ? `要配慮者：${vulnerable.filter((item) => item !== '不明').join('・')}` : '',
  ].filter(Boolean);
  return `${title}${details.length ? `（${details.join('／')}）` : ''}。${request}。`;
}

function shelterDetail(value: string, location: string): string {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const inlineExplicit = value.match(/困っていること\s*[:：]\s*(.*?)(?=\s+(?:場所|対象人数|人数|補足|残量・不足状況|最後に受け取った時刻)\s*[:：]|$)/);
  const explicit = lines.find((line) => /^困っていること\s*[:：]/.test(line));
  const detail = (inlineExplicit?.[1] ?? (explicit ? explicit.replace(/^困っていること\s*[:：]\s*/, '') : lines
    .filter((line) => !/^(困りごとの種類|場所|対象人数|人数|補足|残量・不足状況|最後に受け取った時刻)\s*[:：]/.test(line))
    .join(' ')))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。.!！?？]+$/, '');
  if (!detail) return '';
  if (location) {
    const escapedLocation = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return detail.replace(new RegExp(`^${escapedLocation}(?:の|で)?`), '').trim();
  }
  return detail;
}

/** 一覧で一読できる「メール件名」形式の課題タイトルを作る。個人情報は必ず除去済みの本文から作成する。 */
export function buildShelterIssueTitle(category: string, location: string, value: string, fallback = ''): string {
  const safeValue = redactSensitiveInformation(value.trim());
  const safeLocation = location.trim().replace(/\s+/g, ' ').slice(0, 80);
  const detail = shelterDetail(safeValue, safeLocation) || fallback.trim().replace(/\s+/g, ' ').replace(/[。.!！?？]+$/, '');
  const subject = (detail || shelterCategorySubject(category)).slice(0, 52);
  const prefix = safeLocation || shelterCategorySubject(category);
  return `${prefix}：${subject}`.slice(0, 72);
}

export function isGenericShelterIssueTitle(title: string): boolean {
  return /(?:避難所での困りごと|の困りごと|飲料水不足$|物資不足$|(?:医療・薬|トイレ・衛生|設備・充電|ペット)の相談$)/.test(title.trim());
}

function shelterTitle(category: ShelterCategory, location: string, value: string, fallback = ''): string {
  const subject = shelterIssueSubject(category, value);
  return `${location ? `${location}の` : ''}${subject}`.slice(0, 72);
}

export function generateShelterAnalysis(value: string, intake: ShelterIntake = {}): ShelterAnalysis {
  const rawText = value.trim().replace(/\r?\n/g, ' ');
  // Keep the original report separately, but never copy common contact data
  // into derived titles, facts, locations, or reply context.
  const text = redactSensitiveInformation(rawText);
  const rawLocation = extractLocation(text, intake.issueLocation ?? intake.location ?? '');
  const location = shelterLocationLabel(rawLocation);
  const issueLocation = resolveShelterZoneId(rawLocation) || rawLocation;
  const peopleCount = extractAffectedPeople(text, intake.peopleCount ?? '');
  const resourceRemaining = extractResourceRemaining(text, intake.resourceRemaining ?? '');
  const lastReceivedAt = extractLastReceivedAt(text, intake.lastReceivedAt ?? '');
  const additionalDetails = intake.additionalDetails?.trim().slice(0, 120) ?? '';
  const category = categorizeShelterQuestion(text);
  const issueCategory = canonicalIssueCategory(category, text);
  const facts: string[] = [];
  if (location) facts.push(`場所：${location}`);
  if (peopleCount) facts.push(`人数：${peopleCount}`);
  if (resourceRemaining) facts.push(`残量・不足状況：${resourceRemaining}`);
  if (lastReceivedAt) facts.push(`最後に受け取った時刻：${lastReceivedAt}`);
  if (additionalDetails) facts.push(`追加確認：${additionalDetails}`);
  if (category !== 'その他') facts.push(`相談分類：${category}`);
  if (/(子ども|こども|乳児|赤ちゃん)/.test(text)) facts.push('子どもを含む可能性');
  if (/(高齢|お年寄り)/.test(text)) facts.push('高齢者を含む可能性');
  if (/(何回|何度|また|もう一度)/.test(text)) facts.push('以前にも申し出た可能性');
  const missingInformation: string[] = [];
  if (!location) missingInformation.push('場所');
  if (!peopleCount && /(水|食料|物資|薬|トイレ|毛布|足り|不足|ない|切れ)/.test(text)) missingInformation.push('人数');
  if (!resourceRemaining && /(水|食料|物資|薬|足り|不足|ない|切れ)/.test(text)) missingInformation.push('残量');
  if (!lastReceivedAt && /(水|食料|物資|薬|毛布|届|来ない|配布|足り|不足)/.test(text)) missingInformation.push('最後に受け取った時刻');
  const urgentReview = URGENT_PATTERNS.test(text);
  const urgencyCandidate: '高' | '中' | '低' = urgentReview ? '高' : HIGH_URGENCY_PATTERNS.test(text) ? '中' : '低';
  const request = shelterRequestLabel(category, text);
  const emotion = emotionLabel(text);
  const title = shelterTitle(category, location, text, request);
  const vulnerable = vulnerablePeople(text);
  const overview = structuredShelterOverview(title, request, peopleCount, resourceRemaining, lastReceivedAt, vulnerable);
  const confidence = urgentReview ? 0.78 : HIGH_URGENCY_PATTERNS.test(text) ? 0.66 : 0.54;
  return {
    title, overview, request, facts: [`困りごと：${shelterIssueSubject(category, text)}`, ...facts], emotion, emotionalIntensity: emotionalIntensity(text),
    containsAbusiveLanguage: containsAbusiveLanguage(text), missingInformation, urgencyCandidate,
    urgencyLevel: urgencyLevel(urgentReview, urgencyCandidate), urgencyConfidence: confidence,
    urgentReview, category, issueCategory, location, issueLocation, peopleCount, affectedPeople: peopleCount,
    vulnerablePeople: vulnerable, resourceRemaining, lastReceivedAt,
  };
}

/**
 * Apply validated Incident Extraction fields to the existing shelter analysis.
 * Rule analysis remains the fallback for fields the model did not provide;
 * model text is never allowed to replace the original resident message.
 */
export function applyStructuredIncident(analysis: ShelterAnalysis, incident: StructuredIncident): ShelterAnalysis {
  const category = incident.category && SHELTER_CATEGORIES.includes(incident.category) ? incident.category : analysis.category;
  const location = typeof incident.location === 'string' && incident.location.trim() ? incident.location.trim().slice(0, 120) : analysis.location;
  const count = incident.target?.count && incident.target.count > 0 ? `${Math.round(incident.target.count)}人` : analysis.peopleCount;
  const facts = Array.isArray(incident.facts) && incident.facts.length
    ? Array.from(new Set(incident.facts.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))).slice(0, 20)
    : analysis.facts;
  const request = typeof incident.request === 'string' && incident.request.trim() ? incident.request.trim().slice(0, 160) : analysis.request;
  const urgency = typeof incident.urgency === 'string' ? incident.urgency : '';
  const urgentReview = analysis.urgentReview || (incident.safetyFlags?.length ?? 0) > 0 || urgency === 'critical';
  const urgencyCandidate: '高' | '中' | '低' = urgentReview || urgency === 'high' ? '高' : urgency === 'medium' ? '中' : urgency === 'low' || urgency === 'normal' ? '低' : analysis.urgencyCandidate;
  const missingInformation = Array.isArray(incident.missingFields)
    ? Array.from(new Set(incident.missingFields.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))).slice(0, 12)
    : analysis.missingInformation;
  const confidence = typeof incident.confidence === 'number' && Number.isFinite(incident.confidence) ? Math.max(0, Math.min(1, incident.confidence)) : analysis.urgencyConfidence;
  return {
    ...analysis,
    category,
    issueCategory: canonicalIssueCategory(category, analysis.title),
    location,
    issueLocation: resolveShelterZoneId(location) || location,
    peopleCount: count,
    affectedPeople: count,
    facts,
    request,
    missingInformation,
    urgencyCandidate,
    urgencyLevel: urgencyLevel(urgentReview, urgencyCandidate),
    urgencyConfidence: confidence,
    urgentReview,
    overview: analysis.overview,
  };
}

export function shelterFollowUp(key: string, category: ShelterCategory): { question: string; options: string[] } {
  if (key === '場所') return { question: '避難所のどのあたりにいますか？（例：1階、受付の近く）', options: [] };
  if (key === '人数') return { question: '何人くらいで困っていますか？', options: ['1人', '2〜5人', '6人以上', 'わからない'] };
  if (key === '残量') return { question: category === '水・飲料' ? '飲み水はあとどのくらいありますか？' : '必要なものはあとどのくらいありますか？', options: ['ほとんどない', '少しある', 'まだある', 'わからない'] };
  return { question: '最後に受け取ったのはいつごろですか？', options: ['今日', '昨日', 'それより前', 'わからない'] };
}
const SYNONYM_GROUPS = [
  ['見学', '体験', '訪問'], ['予約', '急に', 'アポ', 'いきなり'],
  ['初心者', '未経験', '初めて', 'はじめて'], ['部費', '費用', 'お金', '料金'],
  ['活動日', '曜日', '日時', '時間', 'いつ'], ['持ち物', '道具', '必要'],
  ['入部', '参加', '入り'], ['一人', '1人', 'ひとり'],
  ['水', '飲料水', 'お水'], ['薬', 'くすり'],
];

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(PUNCTUATION, '');
}

function bigrams(value: string): Map<string, number> {
  const text = normalize(value);
  const grams = new Map<string, number>();
  for (let index = 0; index < text.length - 1; index += 1) {
    const gram = text.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  if (text.length === 1) grams.set(text, 1);
  return grams;
}

function cosineSimilarity(a: string, b: string): number {
  const ga = bigrams(a); const gb = bigrams(b);
  if (!ga.size || !gb.size) return 0;
  let dot = 0; let na = 0; let nb = 0;
  ga.forEach((value, key) => { dot += value * (gb.get(key) ?? 0); na += value * value; });
  gb.forEach((value) => { nb += value * value; });
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function keywords(value: string): Set<string> {
  const text = value.normalize('NFKC');
  const found = new Set(text.match(KEYWORD_RE) ?? []);
  ['いつ', '急に', '一人', '1人', 'ひとり', 'はじめて', '初めて', 'お金', 'くすり', '水', '薬', '熱', '火'].forEach((hint) => { if (text.includes(hint)) found.add(hint); });
  const expanded = new Set(found);
  found.forEach((word) => SYNONYM_GROUPS.forEach((group) => { if (group.includes(word)) group.forEach((synonym) => expanded.add(synonym)); }));
  return expanded;
}

function keywordScore(a: string, b: string): number {
  const ka = keywords(a); const kb = keywords(b);
  if (!ka.size || !kb.size) return 0;
  let intersection = 0; ka.forEach((word) => { if (kb.has(word)) intersection += 1; });
  return intersection ? (intersection / Math.min(ka.size, kb.size)) * (0.5 + 0.5 * Math.min(intersection, 2) / 2) : 0;
}

export function combinedSimilarity(query: string, target: string): number {
  return Math.max(cosineSimilarity(query, target), keywordScore(query, target) * 0.8);
}

export function searchFaqs(query: string, faqs: AiFaq[], limit = 5): AiRelatedFaq[] {
  if (!query.trim()) return [];
  return faqs
    .map((faq) => {
      const keywordHit = Math.max(keywordScore(query, faq.question), keywordScore(query, faq.answer));
      const score = keywordHit > 0 ? Math.max(combinedSimilarity(query, faq.question), combinedSimilarity(query, faq.answer) * 0.9) : 0;
      return { ...faq, score };
    })
    .filter((faq) => faq.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((faq) => ({ ...faq, score: Math.round(faq.score * 1000) / 1000 }));
}

export function containsPii(value: string): boolean { return PERSONAL_DATA_PATTERN.test(value); }

export function categorizeQuestion(value: string, requested = ''): string {
  if (Object.prototype.hasOwnProperty.call(CATEGORY_KEYWORDS, requested) || (SHELTER_CATEGORIES as readonly string[]).includes(requested)) return requested;
  if (isShelterQuestion(value)) return categorizeShelterQuestion(value);
  let best = 'その他'; let hits = 0;
  Object.entries(CATEGORY_KEYWORDS).forEach(([category, words]) => {
    const count = words.filter((word) => value.includes(word)).length;
    if (count > hits) { best = category; hits = count; }
  });
  return best;
}

const CASUAL_TAIL = /(かな[ぁあ]?|ですかね|でしょうか|ですか|なんだけど|んだけど|んですけど|けど|かも)[?？。!！]*$/;

export function generateLocalSummary(value: string): string {
  const text = value.trim().replace(/\r?\n/g, ' ');
  const hints: string[] = [];
  if (/(見学|体験)/.test(text)) hints.push('見学を希望している');
  if (/(急に|予約|アポ|いきなり)/.test(text)) hints.push('予約なしで訪問しても問題ないか知りたい');
  if (/(初心者|未経験|初めて|はじめて)/.test(text)) hints.push('初心者でも参加できるか知りたい');
  if (/(部費|お金|費用)/.test(text)) hints.push('費用がどのくらいかかるか知りたい');
  if (/(活動日|いつ|曜日|時間)/.test(text)) hints.push('活動の日時を知りたい');
  if (/(持ち物|必要なもの|道具)/.test(text)) hints.push('必要な持ち物を知りたい');
  if (/(一人|1人|ひとり)/.test(text)) hints.push('一人での参加・見学が可能か知りたい');
  if (hints.length) return `${Array.from(new Set(hints)).join('、')}。`;
  const core = text.replace(CASUAL_TAIL, '').slice(0, 60);
  return `「${core}」について知りたい。`;
}

export function generateLocalDraft(summary: string, original: string, related: AiRelatedFaq[]): string {
  if (!related.length) return 'この質問に対応する承認済みFAQが見つかりませんでした。\nAIは推測せず、管理者が確認できる範囲で案内を整えます。';
  const answers = Array.from(new Set(related.map((faq) => faq.answer.trim()))).join('\n');
  return answers;
}

export type ShelterReplyContext = {
  category: ShelterCategory;
  location?: string;
  peopleCount?: string;
  resourceRemaining?: string;
  lastReceivedAt?: string;
  emotion?: string;
  missingInformation?: string[];
  urgentReview?: boolean;
};

function shelterReplyOpening(category: ShelterCategory, original: string): string {
  const family = /(子ども|こども|乳児|赤ちゃん)/.test(original) ? 'お子さんもいる中で、' : '';
  const emotion = /(怒|何回|いい加減|困る|最悪|いつまで)/.test(original)
    ? '不安や焦りを感じる状況なのですね。'
    : /(怖|恐|不安|心配|どうしよう|泣|助けて|苦しい|痛い|つらい)/.test(original)
      ? 'とても心配な状況なのですね。'
      : 'お困りの状況なのですね。';
  const topic = category === '水・飲料' ? '飲料水が足りず'
    : category === '食料・物資' ? '食料や必要な物資が足りず'
      : category === '医療・薬' ? '体調や薬について心配があり'
        : category === 'トイレ・衛生' ? 'トイレや衛生面で困っていて'
          : category === '設備・充電' ? '設備や充電について困っていて'
            : category === 'ペット' ? 'ペットのことで心配があり'
              : category === '安全・その他' ? '安全について心配があり'
                : '避難所で困っていることがあり';
  return `${topic}、${family}${emotion}`;
}

function shelterReplyAction(category: ShelterCategory): string {
  if (category === '水・飲料') return '避難所スタッフが飲料水の配布状況と在庫を確認します。';
  if (category === '食料・物資') return '避難所スタッフが配布状況と必要な物資を確認します。';
  if (category === '医療・薬') return '避難所スタッフが体調と必要な支援を確認します。';
  if (category === 'トイレ・衛生') return '避難所スタッフが利用できる場所と衛生面の状況を確認します。';
  if (category === '設備・充電') return '避難所スタッフが利用できる設備と案内を確認します。';
  if (category === 'ペット') return '避難所スタッフが受け入れ場所とルールを確認します。';
  if (category === '安全・その他') return '避難所スタッフが安全の状況を確認します。';
  return '避難所スタッフが状況を確認します。';
}

/**
 * 避難所相談用の返信案。FAQの回答をそのまま返すだけではなく、
 * 相談本文の感情を受け止め、分析済みの事実と不足情報をつなげます。
 * 重要な判断や送信は必ず職員が確認します。
 */
export function generateShelterReplyDraft(context: ShelterReplyContext, original: string, related: AiRelatedFaq[]): string {
  const category = context.category;
  const lines = [
    shelterReplyOpening(category, original),
    'ご相談を受け付けました。',
    shelterReplyAction(category),
  ];
  if (context.location) lines.push(`場所は「${context.location}」として確認します。`);
  const faq = related.find((item) => item.category === category)?.answer.trim();
  if (faq) lines.push(faq);
  const missing = Array.from(new Set(context.missingInformation ?? [])).slice(0, 3);
  if (missing.length) lines.push(`差し支えなければ、${missing.join('、')}を分かる範囲で教えてください。`);
  if (context.urgentReview || category === '医療・薬' || category === '安全・その他') {
    lines.push('体調の急な悪化、けが、火災、暴力など緊急の場合は、返信を待たず近くのスタッフまたは受付へ知らせてください。');
  } else {
    lines.push('確認できた内容は、対応状況を更新してお知らせします。');
  }
  return lines.join('\n\n');
}

export function generateShelterAlternativeDrafts(context: ShelterReplyContext, original: string, related: AiRelatedFaq[]): string[] {
  const base = generateShelterReplyDraft(context, original, related);
  const short = [
    shelterReplyOpening(context.category, original),
    shelterReplyAction(context.category),
    context.missingInformation?.length ? `確認のため、${context.missingInformation.slice(0, 2).join('、')}を教えてください。` : '確認できた内容は対応状況でお知らせします。',
    '緊急の場合は、近くのスタッフまたは受付へ直接知らせてください。',
  ].join('\n\n');
  return [base, short, '職員が内容を確認してから、対応状況と案内をお知らせします。'];
}

export function generateAlternativeDrafts(summary: string, original: string, related: AiRelatedFaq[]): string[] {
  const text = original.trim();
  const topic = summary || generateLocalSummary(text);
  const basis = related.length ? related[0].answer.trim() : '';
  if (basis) return [
    basis,
    `ご質問ありがとうございます。${basis}\n\n必要な点を確認しやすいよう、まずは上記の案内をご覧ください。`,
    `現時点では、承認済みFAQにある次の案内が参考になります。\n\n${basis}\n\n状況に応じて、管理者が補足を追記できます。`,
  ];
  if (/(勉強|学習|学び|練習)/.test(text)) return [
    '勉強を始めたいなら、まず今日やる内容を1つだけ決めて、10〜20分程度から始めるのがおすすめです。最初から長時間やろうとせず、小さく始めると続けやすくなります。',
    '勉強を続けたい場合は、毎日同じ時間・同じ場所で始めるようにすると習慣にしやすくなります。まずは短い時間でも毎日続けることを意識してみてください。',
    '質問内容だけでは具体的な教科や目的までは分からないため、一般的な方法になりますが、「何をするかを1つ決める → 短時間だけ始める → 終わったら次にやることを決める」という流れがおすすめです。より具体的な内容については、教科や困っていることを含めて新しく質問できます。',
  ];
  if (/(費用|料金|部費|お金)/.test(text)) return [
    '費用について知りたい場合は、最新の公式案内に記載された金額や支払い方法を確認するのが確実です。',
    '費用は内容や時期によって変わることがあるため、案内に書かれている基本料金と、追加費用があるかを分けて確認すると分かりやすくなります。',
    'この質問だけでは具体的な金額を断定できません。管理者が確認できる最新情報を案内します。必要なら、知りたい費用の種類を含めて新しく質問できます。',
  ];
  if (/(見学|参加|活動|行|行け|入る|初心者)/.test(text)) return [
    '参加や見学を考えている場合は、まず公開されている案内を確認し、無理のない範囲で参加方法を確認してみてください。',
    '初めての場合は、日時・場所・持ち物などの基本情報を確認してから、無理のないタイミングで参加するのがおすすめです。組織固有の条件は管理者が確認して案内します。',
    '質問内容から一般的に案内できる範囲では、公開情報を確認して参加方法を整理するのがよいでしょう。具体的な日時や条件は、管理者が確認した最新情報を案内します。必要なら、知りたい条件を含めて新しく質問できます。',
  ];
  return [
    `ご質問の「${text.slice(0, 80)}」について、現時点で分かる範囲では、まず公開されている案内や手順を確認するのがおすすめです。`,
    `${topic}については、目的と現在分かっている条件を整理し、確認できる情報から順に進めると判断しやすくなります。組織固有の情報は管理者が確認して案内します。`,
    `この質問だけでは固有の日時・料金・規則などを断定できないため、確認できる範囲の一般的な案内です。必要なら、知りたい条件を含めて新しく質問できます。`,
  ];
}

export function generateFaqCandidate(question: string, answer: string, category: string): { q: string; a: string; category: string } {
  const base = generateLocalSummary(question)
    .replace(/知りたい。$/, '')
    .replace(/[「」]/g, '')
    .replace(/について$/, '')
    .trim()
    .slice(0, 50);
  const q = /[か?？]$/.test(base) ? `${base}${base.endsWith('か') ? '？' : ''}` : `${base}について教えてください。`;
  return { q, a: answer.trim().slice(0, 1000), category: categorizeQuestion(question, category) };
}
