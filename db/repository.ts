import { env } from 'cloudflare:workers';

export type Faq = {
  id: number;
  question: string;
  answer: string;
  category: string;
};

export type SubmittedQuestion = {
  id: number;
  body: string;
  category: string;
  status: string;
  createdAt: number;
};

const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const SEED_FAQS: Omit<Faq, 'id'>[] = [
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

async function initialise(): Promise<D1Database> {
  const db = database();
  const now = Date.now();
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS faqs (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL UNIQUE, answer TEXT NOT NULL, category TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
    db.prepare("CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL)"),
    db.prepare('CREATE TABLE IF NOT EXISTS admin_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), user_id TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS questions_created_at_idx ON questions (created_at DESC)'),
  ]);
  await db.batch(SEED_FAQS.map((faq) => db.prepare('INSERT OR IGNORE INTO faqs (question, answer, category, updated_at) VALUES (?, ?, ?, ?)').bind(faq.question, faq.answer, faq.category, now)));
  return db;
}

async function purgeExpiredQuestions(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM questions WHERE created_at < ?').bind(Date.now() - RETENTION_MS).run();
}

export async function listPublishedFaqs(): Promise<Faq[]> {
  const db = await initialise();
  const result = await db.prepare('SELECT id, question, answer, category FROM faqs ORDER BY updated_at DESC').all<Faq>();
  return result.results ?? [];
}

export function categorizeQuestion(body: string): string {
  const text = body.toLowerCase();
  if (/(見学|参加|入部|体験|予約|訪問)/.test(text)) return '見学・参加方法';
  if (/(初心者|未経験|初めて|はじめて|不安)/.test(text)) return '初心者向け';
  if (/(部費|費用|お金|持ち物|道具)/.test(text)) return '部費・持ち物';
  if (/(活動日|曜日|時間|いつ|大会)/.test(text)) return '活動内容';
  return 'その他';
}

export async function createQuestion(body: string): Promise<SubmittedQuestion> {
  const db = await initialise();
  await purgeExpiredQuestions(db);
  const createdAt = Date.now();
  const category = categorizeQuestion(body);
  const result = await db.prepare("INSERT INTO questions (body, category, status, created_at) VALUES (?, ?, 'open', ?)").bind(body, category, createdAt).run();
  return { id: Number(result.meta.last_row_id), body, category, status: 'open', createdAt };
}

export async function claimAdministrator(userId: string): Promise<boolean> {
  const db = await initialise();
  await db.prepare('INSERT OR IGNORE INTO admin_state (singleton, user_id, created_at) VALUES (1, ?, ?)').bind(userId, Date.now()).run();
  const state = await db.prepare('SELECT user_id FROM admin_state WHERE singleton = 1').first<{ user_id: string }>();
  return state?.user_id === userId;
}

export async function isAdministrator(userId: string): Promise<boolean> {
  const db = await initialise();
  const state = await db.prepare('SELECT user_id FROM admin_state WHERE singleton = 1').first<{ user_id: string }>();
  return state?.user_id === userId;
}

export async function listQuestionsForAdministrator(): Promise<SubmittedQuestion[]> {
  const db = await initialise();
  await purgeExpiredQuestions(db);
  const result = await db.prepare('SELECT id, body, category, status, created_at AS createdAt FROM questions ORDER BY created_at DESC LIMIT 100').all<SubmittedQuestion>();
  return result.results ?? [];
}
