/**
 * 外部サービスへ送信しない、Worker内のローカル補助AI。
 *
 * Sites版ではランタイムからOllamaへ接続できないため、決定的な安全な
 * ルールモデルを標準実装にしています。ローカル版は同じ責務のOllama
 * アダプターへ差し替えられるよう、要約・回答案・FAQ候補を関数境界で
 * 分離しています。どの経路でも人の承認なしに公開状態へ進みません。
 */

import type { Faq, RelatedFaq } from './repository';

export type AiFaq = Faq;
export type AiRelatedFaq = RelatedFaq;

export const SHELTER_CATEGORIES = ['水・飲料', '食料・物資', '医療・薬', 'トイレ・衛生', '設備・充電', 'ペット', '安全・その他', 'その他'] as const;
export type ShelterCategory = typeof SHELTER_CATEGORIES[number];

export type ShelterIntake = {
  location?: string;
  peopleCount?: string;
  resourceRemaining?: string;
  lastReceivedAt?: string;
};

export type ShelterAnalysis = {
  title: string;
  overview: string;
  facts: string[];
  emotion: string;
  missingInformation: string[];
  urgencyCandidate: '高' | '中' | '低';
  urgentReview: boolean;
  category: ShelterCategory;
  location: string;
  peopleCount: string;
  resourceRemaining: string;
  lastReceivedAt: string;
};

const PUNCTUATION = /[\s、。・!！?？「」『』()（）\[\]【】,.:;〜~ー\-]/g;
const KEYWORD_RE = /[一-龥]{2,}|[ァ-ヴー]{2,}|[a-zA-Z]{3,}/g;

/**
 * 個人情報として扱う種別ごとの検出パターン。
 * containsPii() はこの一覧のいずれかに一致するかどうかを判定し（旧
 * PERSONAL_DATA_PATTERN と一致条件は同じ）、maskPii()/detectPiiTypes() は
 * 種別ごとの伏字化・フラグ付けに使う。ラベル系（「氏名:」など）とURLは、
 * マスク時に値の部分まで伏字化できるよう一致範囲を値側へ広げているが、
 * これは containsPii() の真偽判定には影響しない（一致自体はラベル部分で
 * 成立するため）。
 */
const PII_CATEGORIES: { type: string; label: string; source: string }[] = [
  { type: 'email', label: 'メールアドレス', source: '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}' },
  { type: 'url', label: 'URL', source: '(?:https?:\\/\\/|www\\.)\\S*' },
  { type: 'phone', label: '電話番号', source: '0\\d{1,4}[-ー－ ]?\\d{1,4}[-ー－ ]?\\d{3,4}' },
  { type: 'postal_code', label: '郵便番号', source: '〒\\s?\\d{3}[-ー－]?\\d{4}' },
  { type: 'address', label: '住所', source: '(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県).{0,24}(?:市|区|町|村|丁目|番地|号)' },
  { type: 'id_number', label: '学籍・社員番号', source: '(?:学籍|生徒|社員)番号' },
  { type: 'labeled_field', label: '個人情報の記載', source: '(?:氏名|名前|住所|電話(?:番号)?|メール(?:アドレス)?|連絡先|郵便番号|口座|マイナンバー)\\s*[:：]\\s*\\S*' },
];

/** UI表示用のラベル辞書（値そのものは含まない、種別コード→日本語ラベルのみ）。 */
export const PII_TYPE_LABELS: Record<string, string> = Object.fromEntries(PII_CATEGORIES.map(({ type, label }) => [type, label]));
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

const URGENT_PATTERNS = /(意識|呼吸|出血|けが|怪我|救急|持病|薬がない|薬切れ|火事|火災|煙|暴力|殴|襲|閉じ込め|倒れ|命|生命|危険|虐待)/i;
const HIGH_URGENCY_PATTERNS = /(足りない|ない|切れ|動けない|痛い|苦しい|子ども|高齢|乳児|妊娠|一人で|困って)/i;

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
  if (/(怒|何回|いい加減|ふざけ|困る|最悪|いつまで)/.test(value)) return '強い不満・焦り';
  if (/(怖|恐|不安|心配|どうしよう|泣)/.test(value)) return '不安・心配';
  if (/(助けて|苦しい|痛い|つらい)/.test(value)) return '切迫感・つらさ';
  return '不安や困りごとがある';
}

function shelterTitle(category: ShelterCategory, location: string, value: string): string {
  const place = location ? `${location}の` : '';
  const topic = category === '水・飲料' ? '飲料水不足' : category === '医療・薬' ? '医療・薬の相談' : category === '食料・物資' ? '物資不足' : category === 'トイレ・衛生' ? 'トイレ・衛生の相談' : category === '設備・充電' ? '設備・充電の相談' : category === 'ペット' ? 'ペットの相談' : '避難所での困りごと';
  if (!location && category === 'その他') return value.trim().replace(/\s+/g, ' ').slice(0, 34);
  return `${place}${topic}`;
}

export function generateShelterAnalysis(value: string, intake: ShelterIntake = {}): ShelterAnalysis {
  const text = value.trim().replace(/\r?\n/g, ' ');
  const location = intake.location?.trim().slice(0, 120) ?? '';
  const peopleCount = intake.peopleCount?.trim().slice(0, 80) ?? '';
  const resourceRemaining = intake.resourceRemaining?.trim().slice(0, 120) ?? '';
  const lastReceivedAt = intake.lastReceivedAt?.trim().slice(0, 120) ?? '';
  const category = categorizeShelterQuestion(text);
  const facts: string[] = [];
  if (location) facts.push(`場所：${location}`);
  if (peopleCount) facts.push(`人数：${peopleCount}`);
  if (resourceRemaining) facts.push(`残量・不足状況：${resourceRemaining}`);
  if (lastReceivedAt) facts.push(`最後に受け取った時刻：${lastReceivedAt}`);
  if (category !== 'その他') facts.push(`相談分類：${category}`);
  if (/(子ども|こども|乳児|赤ちゃん)/.test(text)) facts.push('子どもを含む可能性');
  if (/(高齢|お年寄り)/.test(text)) facts.push('高齢者を含む可能性');
  if (/(何回|何度|また|もう一度)/.test(text)) facts.push('以前にも申し出た可能性');
  const missingInformation: string[] = [];
  if (!location) missingInformation.push('場所');
  if (!peopleCount && /(水|食料|物資|薬|トイレ|毛布|足り|不足|ない|切れ)/.test(text)) missingInformation.push('人数');
  if (!resourceRemaining && /(水|食料|物資|薬|足り|不足|ない|切れ)/.test(text)) missingInformation.push('残量');
  if (!lastReceivedAt && /(水|食料|物資|薬|届|来ない|配布)/.test(text)) missingInformation.push('最後に受け取った時刻');
  const urgentReview = URGENT_PATTERNS.test(text);
  const urgencyCandidate: '高' | '中' | '低' = urgentReview ? '高' : HIGH_URGENCY_PATTERNS.test(text) ? '中' : '低';
  const overview = `${shelterTitle(category, location, text)}。${emotionLabel(text)}状況として受け止め、対応に必要な情報を確認します。`;
  return { title: shelterTitle(category, location, text), overview, facts, emotion: emotionLabel(text), missingInformation, urgencyCandidate, urgentReview, category, location, peopleCount, resourceRemaining, lastReceivedAt };
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
  // 避難所の相談で頻出する1文字語の表記ゆれ（かな表記のみで漢字を含まない語も拾えるようにする）
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

// KEYWORD_RE は漢字2文字以上／カタカナ2文字以上／英字3文字以上しか拾わないため、
// 「水」「薬」のような1文字の重要語はここで個別にヒントとして拾う（第2ラウンドで追加）。
// 避難所の相談で特に頻出し、かつ他の語と混同しにくいものだけを最小限で追加した
// （実測: 「水がほしいです」「薬がなくて困っています」が"related":[]になる退行を確認して対応）。
// 「傷」「寒」「暑」「便」等の追加は、単独では意味が広がりすぎる／実測で崩れるケースが
// 未確認のため今回は見送った（詳細は報告参照）。
const SHELTER_ONE_CHAR_HINTS = ['水', '薬', '熱', '火'];

function keywords(value: string): Set<string> {
  const text = value.normalize('NFKC');
  const found = new Set(text.match(KEYWORD_RE) ?? []);
  ['いつ', '急に', '一人', '1人', 'ひとり', 'はじめて', '初めて', 'お金', 'くすり', ...SHELTER_ONE_CHAR_HINTS].forEach((hint) => { if (text.includes(hint)) found.add(hint); });
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

// 日本語のbigram cosineは「です」「ます」「ください」等の助詞・語尾だけでも
// 0.2を超えてしまい、内容が無関係なFAQでも「近い案内」として通ってしまう。
// そのため、まずキーワード（キーワード抽出はkeywords()を参照）が1語も
// 一致しないFAQは、cosineがいくら高くても候補から除外する。
// 閾値は実測（curlで/api/questions/previewを直接叩いた結果）に基づき、
// 「トイレ」「充電」など実際に一致するFAQを殺さない最小値として0.3へ引き上げた
// （0.2のままだと助詞だけの一致でも通ってしまうケースが残っていた）。
const FAQ_MATCH_THRESHOLD = 0.3;

export function searchFaqs(query: string, faqs: AiFaq[], limit = 5): AiRelatedFaq[] {
  if (!query.trim()) return [];
  return faqs
    .map((faq) => {
      const keywordHit = Math.max(keywordScore(query, faq.question), keywordScore(query, faq.answer));
      const score = keywordHit > 0 ? Math.max(combinedSimilarity(query, faq.question), combinedSimilarity(query, faq.answer) * 0.9) : 0;
      return { ...faq, score };
    })
    .filter((faq) => faq.score >= FAQ_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((faq) => ({ ...faq, score: Math.round(faq.score * 1000) / 1000 }));
}

export function containsPii(value: string): boolean {
  return PII_CATEGORIES.some(({ source }) => new RegExp(source, 'i').test(value));
}

/** 検出した個人情報の種別コードだけを返す（値そのものは含まない）。 */
export function detectPiiTypes(value: string): string[] {
  return PII_CATEGORIES.filter(({ source }) => new RegExp(source, 'i').test(value)).map(({ type }) => type);
}

/**
 * 個人情報らしき箇所を種別ラベル付きの伏字（例:「[伏字:電話番号]」）へ
 * 置き換える。原文は書き換えず、常に呼び出し側が別テキストとして扱う。
 */
export function maskPii(value: string): string {
  return PII_CATEGORIES.reduce((text, { source, label }) => text.replace(new RegExp(source, 'gi'), `[伏字:${label}]`), value);
}

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
