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

const PUNCTUATION = /[\s、。・!！?？「」『』()（）\[\]【】,.:;〜~ー\-]/g;
const KEYWORD_RE = /[一-龥]{2,}|[ァ-ヴー]{2,}|[a-zA-Z]{3,}/g;
const PERSONAL_DATA_PATTERN = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|www\.|(?:0\d{1,4}[-ー－ ]?\d{1,4}[-ー－ ]?\d{3,4})|〒\s?\d{3}[-ー－]?\d{4}|(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県).{0,24}(?:市|区|町|村|丁目|番地|号)|(?:学籍|生徒|社員)番号)/i;
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '見学・参加方法': ['見学', '参加', '入部', '入り', '体験', '予約', '訪問', '一人で'],
  '初心者向け': ['初心者', '未経験', '初めて', 'はじめて', 'できない', '不安', 'ついていける'],
  '活動内容': ['活動日', '活動', 'いつ', '曜日', '時間', '内容', '大会'],
  '部費・持ち物': ['部費', 'お金', '費用', '持ち物', '道具', '必要なもの', 'かかる'],
};
const SYNONYM_GROUPS = [
  ['見学', '体験', '訪問'], ['予約', '急に', 'アポ', 'いきなり'],
  ['初心者', '未経験', '初めて', 'はじめて'], ['部費', '費用', 'お金', '料金'],
  ['活動日', '曜日', '日時', '時間', 'いつ'], ['持ち物', '道具', '必要'],
  ['入部', '参加', '入り'], ['一人', '1人', 'ひとり'],
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
  ['いつ', '急に', '一人', '1人', 'ひとり', 'はじめて', '初めて', 'お金'].forEach((hint) => { if (text.includes(hint)) found.add(hint); });
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

function combinedSimilarity(query: string, target: string): number {
  return Math.max(cosineSimilarity(query, target), keywordScore(query, target) * 0.8);
}

export function searchFaqs(query: string, faqs: AiFaq[], limit = 5): AiRelatedFaq[] {
  if (!query.trim()) return [];
  return faqs
    .map((faq) => ({ ...faq, score: Math.max(combinedSimilarity(query, faq.question), combinedSimilarity(query, faq.answer) * 0.9) }))
    .filter((faq) => faq.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((faq) => ({ ...faq, score: Math.round(faq.score * 1000) / 1000 }));
}

export function containsPii(value: string): boolean { return PERSONAL_DATA_PATTERN.test(value); }

export function categorizeQuestion(value: string, requested = ''): string {
  if (Object.prototype.hasOwnProperty.call(CATEGORY_KEYWORDS, requested)) return requested;
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
  if (!related.length) return 'この質問に対応する承認済みFAQが見つかりませんでした。\nAIは推測せず、担当者による確認が必要です。';
  const answers = Array.from(new Set(related.map((faq) => faq.answer.trim()))).join('\n');
  return `${answers}\n\n（質問の要約: ${summary || generateLocalSummary(original)}）`;
}

export function generateAlternativeDrafts(summary: string, original: string, related: AiRelatedFaq[]): string[] {
  const topic = summary || generateLocalSummary(original);
  const basis = related.length ? related[0].answer.trim() : '';
  return [
    basis ? `${basis}\n\n（質問の要約: ${topic}）` : `ご質問ありがとうございます。${topic}について確認して回答します。`,
    `ご質問の「${original.trim().slice(0, 80)}」について、担当者が確認してご案内します。\n\n（回答案のため、内容を確認・修正してください）`,
    `お問い合わせの件は、現在の状況を確認のうえご案内します。\n必要に応じて担当者から補足します。\n\n（質問の要約: ${topic}）`,
  ];
}

export function generateFaqCandidate(question: string, answer: string, category: string): { q: string; a: string; category: string } {
  const base = generateLocalSummary(question).replace(/知りたい。$/, '').replace(/^「|」$/g, '').slice(0, 50);
  const q = /[か?？]$/.test(base) ? `${base}${base.endsWith('か') ? '？' : ''}` : `${base}について教えてください。`;
  return { q, a: answer.trim().slice(0, 1000), category: categorizeQuestion(question, category) };
}
