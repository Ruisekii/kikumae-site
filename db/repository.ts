import { env } from 'cloudflare:workers';
import {
  categorizeQuestion,
  containsPii,
  generateFaqCandidate,
  generateLocalSummary,
  generateLocalDraft,
  searchFaqs,
} from './local-ai';

export type Faq = {
  id: number;
  question: string;
  answer: string;
  category: string;
  status: string;
  updatedAt: number;
};

export type RelatedFaq = Faq & { score: number };

export type FaqCandidate = {
  id: number;
  questionId: number;
  qText: string;
  aText: string;
  category: string;
  status: string;
  createdAt: number;
};

export type SubmittedQuestion = {
  id: number;
  body: string;
  bodyOriginal: string;
  aiSummary: string;
  summaryEdited: boolean;
  category: string;
  status: string;
  createdAt: number;
  answerBody: string | null;
  answerUsedAi: boolean;
  answerGrounds: string[];
  answeredAt: number | null;
  candidate: FaqCandidate | null;
};

const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const SEED_FAQS: Omit<Faq, 'id' | 'status' | 'updatedAt'>[] = [
  { question: '見学は予約なしでも可能ですか？', answer: '予約なしでも見学できます。事前に連絡していただけると、案内がよりスムーズです。', category: '見学・参加方法' },
  { question: '初心者でも参加できますか？', answer: 'はい。初心者・未経験者も歓迎です。最初は無理のない作業から始められます。', category: '初心者向け' },
  { question: '活動日はいつですか？', answer: '通常活動は火曜日と木曜日の放課後です。大会前は活動日が増える場合があります。', category: '活動内容' },
  { question: '部費はいくらですか？', answer: '部費は月額500円です。大会遠征時には別途交通費がかかる場合があります。', category: '部費・持ち物' },
  { question: '一人で見学に行っても大丈夫ですか？', answer: 'もちろん大丈夫です。一人で来る方も多いので、気軽にお越しください。', category: '見学・参加方法' },
];

function database(): D1Database {
  if (!env.DB) throw new Error('D1 database binding is unavailable.');
  return env.DB;
}

function configuredOwnerUserId(): string | null {
  const value = env.KIKUMAE_OWNER_USER_ID?.trim();
  return value || null;
}

async function safeRun(db: D1Database, sql: string): Promise<void> {
  try {
    await db.prepare(sql).run();
  } catch {
    // Existing deployments may already have the column. Migration is idempotent.
  }
}

async function initialise(): Promise<D1Database> {
  const db = database();
  const now = Date.now();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS faqs (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL UNIQUE, answer TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL)"),
    db.prepare('CREATE TABLE IF NOT EXISTS admin_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), user_id TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    db.prepare("CREATE TABLE IF NOT EXISTS faq_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, q_text TEXT NOT NULL, a_text TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id TEXT, action TEXT NOT NULL, question_id INTEGER, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
    db.prepare('CREATE INDEX IF NOT EXISTS questions_created_at_idx ON questions (created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS faq_candidates_status_idx ON faq_candidates (status, created_at DESC)'),
  ]);

  // Additive migration for the first anonymous-question schema.
  for (const migration of [
    "ALTER TABLE faqs ADD COLUMN status TEXT NOT NULL DEFAULT 'published'",
    'ALTER TABLE questions ADD COLUMN body_original TEXT',
    "ALTER TABLE questions ADD COLUMN ai_summary TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE questions ADD COLUMN summary_edited INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE questions ADD COLUMN contact_type TEXT NOT NULL DEFAULT 'anonymous'",
    'ALTER TABLE questions ADD COLUMN answer_body TEXT',
    'ALTER TABLE questions ADD COLUMN answer_used_ai INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE questions ADD COLUMN answer_grounds TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE questions ADD COLUMN answered_at INTEGER',
  ]) await safeRun(db, migration);
  await safeRun(db, 'UPDATE questions SET body_original = body WHERE body_original IS NULL');
  await db.batch(SEED_FAQS.map((faq) => db.prepare("INSERT OR IGNORE INTO faqs (question, answer, category, status, updated_at) VALUES (?, ?, ?, 'published', ?)").bind(faq.question, faq.answer, faq.category, now)));
  return db;
}

async function purgeExpiredQuestions(db: D1Database): Promise<void> {
  const cutoff = Date.now() - RETENTION_MS;
  await db.prepare('DELETE FROM faq_candidates WHERE question_id IN (SELECT id FROM questions WHERE created_at < ?)').bind(cutoff).run();
  await db.prepare('DELETE FROM questions WHERE created_at < ?').bind(cutoff).run();
}

function parseGrounds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

function mapFaq(row: Record<string, unknown>): Faq {
  return {
    id: Number(row.id),
    question: String(row.question ?? ''),
    answer: String(row.answer ?? ''),
    category: String(row.category ?? 'その他'),
    status: String(row.status ?? 'published'),
    updatedAt: Number(row.updated_at ?? row.updatedAt ?? 0),
  };
}

export async function listPublishedFaqs(): Promise<Faq[]> {
  const db = await initialise();
  const result = await db.prepare("SELECT id, question, answer, category, status, updated_at FROM faqs WHERE status = 'published' ORDER BY updated_at DESC").all<Record<string, unknown>>();
  return (result.results ?? []).map(mapFaq);
}

export async function listRelatedFaqs(query: string, limit = 3): Promise<RelatedFaq[]> {
  return searchFaqs(query, await listPublishedFaqs(), limit);
}

export async function createQuestion(body: string, requestedSummary = '', requestedCategory = ''): Promise<SubmittedQuestion> {
  const db = await initialise();
  await purgeExpiredQuestions(db);
  const createdAt = Date.now();
  const canonicalSummary = generateLocalSummary(body);
  const aiSummary = requestedSummary.trim().slice(0, 300) || canonicalSummary;
  const category = categorizeQuestion(body, requestedCategory);
  const result = await db.prepare("INSERT INTO questions (body, body_original, ai_summary, summary_edited, category, status, contact_type, created_at) VALUES (?, ?, ?, ?, ?, 'open', 'anonymous', ?)").bind(body, body, aiSummary, aiSummary !== canonicalSummary ? 1 : 0, category, createdAt).run();
  const id = Number(result.meta.last_row_id);
  return {
    id, body, bodyOriginal: body, aiSummary, summaryEdited: aiSummary !== canonicalSummary,
    category, status: 'open', createdAt, answerBody: null, answerUsedAi: false,
    answerGrounds: [], answeredAt: null, candidate: null,
  };
}

export async function claimAdministrator(userId: string): Promise<boolean> {
  const db = await initialise();
  const ownerUserId = configuredOwnerUserId();
  if (!ownerUserId) return false;
  if (ownerUserId && ownerUserId !== userId) return false;
  const current = await db.prepare('SELECT user_id FROM admin_state WHERE singleton = 1').first<{ user_id: string }>();
  if (!current) await db.prepare('INSERT INTO admin_state (singleton, user_id, created_at) VALUES (1, ?, ?)').bind(userId, Date.now()).run();
  else if (ownerUserId && current.user_id !== userId) await db.prepare('UPDATE admin_state SET user_id = ? WHERE singleton = 1').bind(userId).run();
  const state = await db.prepare('SELECT user_id FROM admin_state WHERE singleton = 1').first<{ user_id: string }>();
  return state?.user_id === userId;
}

export async function isAdministrator(userId: string): Promise<boolean> {
  const db = await initialise();
  const ownerUserId = configuredOwnerUserId();
  if (!ownerUserId) return false;
  if (ownerUserId && ownerUserId !== userId) return false;
  const state = await db.prepare('SELECT user_id FROM admin_state WHERE singleton = 1').first<{ user_id: string }>();
  return state?.user_id === userId;
}

function mapCandidate(row: Record<string, unknown> | null): FaqCandidate | null {
  if (!row || row.candidate_id == null) return null;
  return {
    id: Number(row.candidate_id), questionId: Number(row.question_id),
    qText: String(row.q_text ?? ''), aText: String(row.a_text ?? ''),
    category: String(row.candidate_category ?? 'その他'),
    status: String(row.candidate_status ?? 'pending'), createdAt: Number(row.candidate_created_at ?? 0),
  };
}

function mapQuestion(row: Record<string, unknown>): SubmittedQuestion {
  return {
    id: Number(row.id), body: String(row.body_original ?? row.body ?? ''),
    bodyOriginal: String(row.body_original ?? row.body ?? ''), aiSummary: String(row.ai_summary ?? ''),
    summaryEdited: Boolean(Number(row.summary_edited ?? 0)), category: String(row.category ?? 'その他'),
    status: String(row.status ?? 'open'), createdAt: Number(row.created_at ?? 0),
    answerBody: row.answer_body == null ? null : String(row.answer_body),
    answerUsedAi: Boolean(Number(row.answer_used_ai ?? 0)),
    answerGrounds: parseGrounds(row.answer_grounds == null ? null : String(row.answer_grounds)),
    answeredAt: row.answered_at == null ? null : Number(row.answered_at), candidate: mapCandidate(row),
  };
}

const QUESTION_SELECT = `SELECT q.id, q.body, q.body_original, q.ai_summary, q.summary_edited, q.category, q.status, q.created_at, q.answer_body, q.answer_used_ai, q.answer_grounds, q.answered_at,
  c.id AS candidate_id, c.question_id, c.q_text, c.a_text, c.category AS candidate_category, c.status AS candidate_status, c.created_at AS candidate_created_at
  FROM questions q LEFT JOIN faq_candidates c ON c.question_id = q.id AND c.status = 'pending'`;

export async function listQuestionsForAdministrator(): Promise<SubmittedQuestion[]> {
  const db = await initialise(); await purgeExpiredQuestions(db);
  const result = await db.prepare(`${QUESTION_SELECT} ORDER BY q.created_at DESC LIMIT 100`).all<Record<string, unknown>>();
  return (result.results ?? []).map(mapQuestion);
}

export async function getQuestionForAdministrator(questionId: number): Promise<SubmittedQuestion | null> {
  const db = await initialise();
  const result = await db.prepare(`${QUESTION_SELECT} WHERE q.id = ? LIMIT 1`).bind(questionId).first<Record<string, unknown>>();
  return result ? mapQuestion(result) : null;
}

export async function generateAnswerDraft(questionId: number): Promise<{ draft: string; grounds: string[]; mode: 'local-rules' }> {
  const question = await getQuestionForAdministrator(questionId);
  if (!question) throw new Error('質問が見つかりません。');
  const related = await listRelatedFaqs(question.aiSummary || question.bodyOriginal, 3);
  return { draft: generateLocalDraft(question.aiSummary || question.bodyOriginal, question.bodyOriginal, related), grounds: related.map((faq) => faq.question), mode: 'local-rules' };
}

export async function approveAnswer(questionId: number, body: string, usedAi: boolean, grounds: string[]): Promise<FaqCandidate | null> {
  const db = await initialise();
  const question = await getQuestionForAdministrator(questionId);
  if (!question) throw new Error('質問が見つかりません。');
  const answer = body.trim().slice(0, 4000);
  if (!answer) throw new Error('回答本文を入力してください。');
  const answeredAt = Date.now();
  await db.prepare("UPDATE questions SET answer_body = ?, answer_used_ai = ?, answer_grounds = ?, status = 'answered', answered_at = ? WHERE id = ?").bind(answer, usedAi ? 1 : 0, JSON.stringify(grounds.filter(Boolean).slice(0, 10)), answeredAt, questionId).run();
  const candidate = containsPii(question.bodyOriginal) || containsPii(answer) ? null : generateFaqCandidate(question.bodyOriginal, answer, question.category);
  if (!candidate) return null;
  const result = await db.prepare("INSERT INTO faq_candidates (question_id, q_text, a_text, category, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").bind(questionId, candidate.q, candidate.a, candidate.category, answeredAt).run();
  return { id: Number(result.meta.last_row_id), questionId, qText: candidate.q, aText: candidate.a, category: candidate.category, status: 'pending', createdAt: answeredAt };
}

export async function deleteQuestion(questionId: number): Promise<void> {
  const db = await initialise();
  await db.prepare('DELETE FROM faq_candidates WHERE question_id = ?').bind(questionId).run();
  await db.prepare('DELETE FROM questions WHERE id = ?').bind(questionId).run();
}

export async function actOnCandidate(candidateId: number, action: string, qText: string, aText: string, category: string): Promise<void> {
  const db = await initialise();
  const candidate = await db.prepare("SELECT id, q_text, a_text, category FROM faq_candidates WHERE id = ? AND status = 'pending'").bind(candidateId).first<{ id: number; q_text: string; a_text: string; category: string }>();
  if (!candidate) throw new Error('承認待ちのFAQ候補が見つかりません。');
  const safeQuestion = (qText.trim() || candidate.q_text).slice(0, 300);
  const safeAnswer = (aText.trim() || candidate.a_text).slice(0, 2000);
  const safeCategory = category.trim().slice(0, 64) || candidate.category;
  if (action === 'publish' || action === 'publish_edited') {
    if (containsPii(safeQuestion) || containsPii(safeAnswer)) throw new Error('個人情報やURLを含むFAQは公開できません。');
    const existing = await db.prepare('SELECT id FROM faqs WHERE question = ?').bind(safeQuestion).first<{ id: number }>();
    if (existing) {
      await db.prepare("UPDATE faqs SET answer = ?, category = ?, status = 'published', updated_at = ? WHERE id = ?").bind(safeAnswer, safeCategory, Date.now(), existing.id).run();
    } else {
      await db.prepare("INSERT INTO faqs (question, answer, category, status, updated_at) VALUES (?, ?, ?, 'published', ?)").bind(safeQuestion, safeAnswer, safeCategory, Date.now()).run();
    }
    await db.prepare("UPDATE faq_candidates SET status = 'published', q_text = ?, a_text = ?, category = ? WHERE id = ?").bind(safeQuestion, safeAnswer, safeCategory, candidateId).run();
  } else if (action === 'individual' || action === 'reject') {
    await db.prepare('UPDATE faq_candidates SET status = ? WHERE id = ?').bind(action, candidateId).run();
  } else {
    throw new Error('操作が正しくありません。');
  }
}
