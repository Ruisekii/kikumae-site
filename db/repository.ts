import { env } from 'cloudflare:workers';
import {
  categorizeQuestion,
  containsPii,
  generateFaqCandidate,
  generateLocalSummary,
  generateLocalDraft,
  generateAlternativeDrafts,
  searchFaqs,
} from './local-ai';

export type Faq = {
  id: number;
  question: string;
  answer: string;
  category: string;
  status: string;
  createdAt: number;
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
  answerDraft: string;
  answerAlternatives: string[];
  answerUsedAi: boolean;
  answerGrounds: string[];
  answeredAt: number | null;
  portalId: number | null;
  candidate: FaqCandidate | null;
  checkToken?: string;
};

export type AuditLog = { action: string; actorUserId: string | null; createdAt: number };


const SEED_FAQS: Omit<Faq, 'id' | 'status' | 'createdAt' | 'updatedAt'>[] = [
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
  } catch (error) {
    // Existing deployments may already have the column/index. Do not hide
    // unrelated permission, corruption, or availability failures.
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('duplicate column') || message.includes('already exists') || message.includes('no such table')) return;
    throw error;
  }
}

async function ensureAdminState(db: D1Database): Promise<void> {
  await db.prepare('CREATE TABLE IF NOT EXISTS admin_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), user_id TEXT NOT NULL, created_at INTEGER NOT NULL)').run();
}

async function initialise(): Promise<D1Database> {
  const db = database();
  const now = Date.now();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS faqs (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL UNIQUE, answer TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL)"),
    db.prepare('CREATE TABLE IF NOT EXISTS admin_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), user_id TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    db.prepare("CREATE TABLE IF NOT EXISTS faq_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, q_text TEXT NOT NULL, a_text TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id TEXT, action TEXT NOT NULL, question_id INTEGER, portal_id INTEGER, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare('CREATE INDEX IF NOT EXISTS questions_created_at_idx ON questions (created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS faq_candidates_status_idx ON faq_candidates (status, created_at DESC)'),
  ]);

  // Additive migration for the first anonymous-question schema.
  for (const migration of [
    "ALTER TABLE faqs ADD COLUMN status TEXT NOT NULL DEFAULT 'published'",
    'ALTER TABLE faqs ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE questions ADD COLUMN body_original TEXT',
    "ALTER TABLE questions ADD COLUMN ai_summary TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE questions ADD COLUMN summary_edited INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE questions ADD COLUMN contact_type TEXT NOT NULL DEFAULT 'anonymous'",
    'ALTER TABLE questions ADD COLUMN answer_body TEXT',
    "ALTER TABLE questions ADD COLUMN answer_draft TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE questions ADD COLUMN answer_alternatives TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE questions ADD COLUMN answer_used_ai INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE questions ADD COLUMN answer_grounds TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE questions ADD COLUMN answered_at INTEGER',
    'ALTER TABLE questions ADD COLUMN check_token_hash TEXT',
    'ALTER TABLE questions ADD COLUMN check_token_expires_at INTEGER',
    'ALTER TABLE questions ADD COLUMN submission_key_hash TEXT',
    'ALTER TABLE faqs ADD COLUMN portal_id INTEGER',
    'ALTER TABLE questions ADD COLUMN portal_id INTEGER',
    'ALTER TABLE faq_candidates ADD COLUMN portal_id INTEGER',
  ]) await safeRun(db, migration);
  await safeRun(db, 'ALTER TABLE audit_logs ADD COLUMN portal_id INTEGER');
  await safeRun(db, 'CREATE INDEX IF NOT EXISTS audit_logs_portal_created_idx ON audit_logs (portal_id, created_at DESC)');
  await ensureFaqIsolationSchema(db);
  await safeRun(db, 'UPDATE faqs SET created_at = updated_at WHERE created_at = 0');
  await safeRun(db, 'UPDATE questions SET body_original = body WHERE body_original IS NULL');
  await db.batch(SEED_FAQS.map((faq) => db.prepare("INSERT OR IGNORE INTO faqs (question, answer, category, status, created_at, updated_at) VALUES (?, ?, ?, 'published', ?, ?)").bind(faq.question, faq.answer, faq.category, now, now)));
  await safeRun(db, 'CREATE UNIQUE INDEX IF NOT EXISTS questions_submission_key_unique ON questions (submission_key_hash) WHERE submission_key_hash IS NOT NULL');
  return db;
}

/**
 * The original MVP made FAQ questions globally unique. That allowed a portal
 * to accidentally update the root FAQ (and prevented two portals from using
 * the same wording). Rebuild the table once with scope-aware unique indexes.
 */
async function ensureFaqIsolationSchema(db: D1Database): Promise<void> {
  const marker = await db.prepare("SELECT value FROM schema_meta WHERE key = 'faqs_scope_v1' LIMIT 1").first<{ value: string }>();
  if (marker?.value === 'ready') return;
  try {
    await db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS faqs_scope_rebuild (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'published\', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, portal_id INTEGER)'),
      db.prepare('INSERT OR IGNORE INTO faqs_scope_rebuild (id, question, answer, category, status, created_at, updated_at, portal_id) SELECT id, question, answer, category, status, COALESCE(created_at, updated_at), updated_at, portal_id FROM faqs'),
      db.prepare('DROP TABLE faqs'),
      db.prepare('ALTER TABLE faqs_scope_rebuild RENAME TO faqs'),
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS faqs_question_root_unique ON faqs (question) WHERE portal_id IS NULL'),
      db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS faqs_question_portal_unique ON faqs (question, portal_id) WHERE portal_id IS NOT NULL'),
      db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('faqs_scope_v1', 'ready')"),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    // A concurrent legacy migration can race on the temporary table. Retry on
    // the next request, but surface unrelated DB failures to the caller.
    if (!(message.includes('already exists') || message.includes('no such table') || message.includes('database is locked'))) throw error;
  }
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

function parseAlternatives(value: string | null): string[] {
  if (!value) return [];
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 3) : []; } catch { return []; }
}

async function hashCheckToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function mapFaq(row: Record<string, unknown>): Faq {
  return {
    id: Number(row.id),
    question: String(row.question ?? ''),
    answer: String(row.answer ?? ''),
    category: String(row.category ?? 'その他'),
    status: String(row.status ?? 'published'),
    createdAt: Number(row.created_at ?? row.createdAt ?? row.updated_at ?? 0),
    updatedAt: Number(row.updated_at ?? row.updatedAt ?? 0),
  };
}

export async function listPublishedFaqs(portalId: number | null = null): Promise<Faq[]> {
  const db = await initialise();
  const result = portalId == null
    ? await db.prepare("SELECT id, question, answer, category, status, created_at, updated_at FROM faqs WHERE status = 'published' AND portal_id IS NULL ORDER BY updated_at DESC").all<Record<string, unknown>>()
    : await db.prepare("SELECT id, question, answer, category, status, created_at, updated_at FROM faqs WHERE status = 'published' AND portal_id = ? ORDER BY updated_at DESC").bind(portalId).all<Record<string, unknown>>();
  return (result.results ?? []).map(mapFaq);
}

function faqScope(portalId: number | null): { clause: string; values: number[] } {
  return portalId == null ? { clause: 'portal_id IS NULL', values: [] } : { clause: 'portal_id = ?', values: [portalId] };
}

function validateFaqInput(question: string, answer: string, category: string): { question: string; answer: string; category: string } {
  const safeQuestion = question.trim().slice(0, 300);
  const safeAnswer = answer.trim().slice(0, 2000);
  const safeCategory = category.trim().slice(0, 64) || 'その他';
  if (safeQuestion.length < 2 || safeAnswer.length < 1) throw new Error('FAQ_INVALID');
  if (containsPii(safeQuestion) || containsPii(safeAnswer)) throw new Error('FAQ_PII');
  return { question: safeQuestion, answer: safeAnswer, category: safeCategory };
}

export async function listFaqsForAdministrator(portalId: number | null = null): Promise<Faq[]> {
  const db = await initialise();
  const scope = faqScope(portalId);
  const statement = db.prepare(`SELECT id, question, answer, category, status, created_at, updated_at FROM faqs WHERE ${scope.clause} ORDER BY updated_at DESC LIMIT 500`);
  const result = scope.values.length ? await statement.bind(...scope.values).all<Record<string, unknown>>() : await statement.all<Record<string, unknown>>();
  return (result.results ?? []).map(mapFaq);
}

export async function createFaq(question: string, answer: string, category: string, portalId: number | null = null, actorUserId: string | null = null): Promise<Faq> {
  const db = await initialise();
  const input = validateFaqInput(question, answer, category);
  const createdAt = Date.now();
  try {
    const result = await db.prepare('INSERT INTO faqs (question, answer, category, portal_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, \'published\', ?, ?)').bind(input.question, input.answer, input.category, portalId, createdAt, createdAt).run();
    const faq = { id: Number(result.meta.last_row_id), ...input, status: 'published', createdAt, updatedAt: createdAt };
    try { await writeAuditLog('faq_created', actorUserId, null, portalId, `faq:${faq.id}`); } catch { /* do not fail a saved FAQ when logging is unavailable */ }
    return faq;
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) throw new Error('FAQ_DUPLICATE');
    throw error;
  }
}

async function getFaqForScope(faqId: number, portalId: number | null): Promise<Faq | null> {
  const db = await initialise();
  const scope = faqScope(portalId);
  const statement = db.prepare(`SELECT id, question, answer, category, status, created_at, updated_at FROM faqs WHERE id = ? AND ${scope.clause} LIMIT 1`);
  const row = scope.values.length ? await statement.bind(faqId, ...scope.values).first<Record<string, unknown>>() : await statement.bind(faqId).first<Record<string, unknown>>();
  return row ? mapFaq(row) : null;
}

export async function updateFaq(faqId: number, question: string, answer: string, category: string, portalId: number | null = null, actorUserId: string | null = null): Promise<Faq> {
  const db = await initialise();
  const existing = await getFaqForScope(faqId, portalId);
  if (!existing) throw new Error('FAQ_NOT_FOUND');
  const input = validateFaqInput(question, answer, category);
  const updatedAt = Date.now();
  try {
    await db.prepare(`UPDATE faqs SET question = ?, answer = ?, category = ?, status = 'published', updated_at = ? WHERE id = ?`).bind(input.question, input.answer, input.category, updatedAt, faqId).run();
    const faq = { id: faqId, ...input, status: 'published', createdAt: existing.createdAt, updatedAt };
    try { await writeAuditLog('faq_updated', actorUserId, null, portalId, `faq:${faqId}`); } catch { /* best effort */ }
    return faq;
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) throw new Error('FAQ_DUPLICATE');
    throw error;
  }
}

export async function deleteFaq(faqId: number, portalId: number | null = null, actorUserId: string | null = null): Promise<void> {
  const db = await initialise();
  const existing = await getFaqForScope(faqId, portalId);
  if (!existing) throw new Error('FAQ_NOT_FOUND');
  const scope = faqScope(portalId);
  const statement = db.prepare(`DELETE FROM faqs WHERE id = ? AND ${scope.clause}`);
  const result = scope.values.length ? await statement.bind(faqId, ...scope.values).run() : await statement.bind(faqId).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error('FAQ_NOT_FOUND');
  try { await writeAuditLog('faq_deleted', actorUserId, null, portalId, `faq:${faqId}`); } catch { /* best effort */ }
}

async function auditActorId(actorUserId: string | null): Promise<string | null> {
  if (!actorUserId) return null;
  if (/^portal:\d+$/.test(actorUserId)) return actorUserId;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(actorUserId.trim().toLowerCase()));
  return `user:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
}

export async function writeAuditLog(action: string, actorUserId: string | null, questionId: number | null, portalId: number | null, detail = ''): Promise<void> {
  const db = await initialise();
  await db.prepare('INSERT INTO audit_logs (actor_user_id, action, question_id, portal_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(await auditActorId(actorUserId), action.slice(0, 64), questionId, portalId, detail.slice(0, 300), Date.now()).run();
}

export async function listAuditLogsForAdministrator(portalId: number | null = null, limit = 50): Promise<AuditLog[]> {
  const db = await initialise();
  const scope = faqScope(portalId);
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const statement = db.prepare(`SELECT action, actor_user_id, created_at FROM audit_logs WHERE ${scope.clause} ORDER BY created_at DESC LIMIT ?`);
  const result = scope.values.length ? await statement.bind(...scope.values, safeLimit).all<Record<string, unknown>>() : await statement.bind(safeLimit).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => ({ action: String(row.action ?? ''), actorUserId: row.actor_user_id == null ? null : String(row.actor_user_id), createdAt: Number(row.created_at ?? 0) }));
}

export async function listRelatedFaqs(query: string, limit = 3, portalId: number | null = null): Promise<RelatedFaq[]> {
  return searchFaqs(query, await listPublishedFaqs(portalId), limit);
}

export async function createQuestion(body: string, requestedSummary = '', requestedCategory = '', portalId: number | null = null, submissionKey = ''): Promise<SubmittedQuestion> {
  const db = await initialise();
  const createdAt = Date.now();
  const submissionKeyHash = submissionKey ? await hashCheckToken(submissionKey) : null;
  if (submissionKeyHash) {
    const duplicate = await db.prepare('SELECT id FROM questions WHERE submission_key_hash = ? LIMIT 1').bind(submissionKeyHash).first<{ id: number }>();
    if (duplicate) throw new Error('QUESTION_DUPLICATE');
  }
  const canonicalSummary = generateLocalSummary(body);
  const aiSummary = requestedSummary.trim().slice(0, 300) || canonicalSummary;
  const category = categorizeQuestion(body, requestedCategory);
  const related = await listRelatedFaqs(aiSummary || body, 3, portalId);
  const draft = generateLocalDraft(aiSummary, body, related);
  const alternatives = generateAlternativeDrafts(aiSummary, body, related);
  const checkToken = crypto.randomUUID() + crypto.randomUUID();
  // Keep the question/FAQ data indefinitely, but limit the bearer URL used to
  // check a private question to 30 days.  Legacy rows without an expiry remain
  // readable so existing users are not broken during migration.
  const checkTokenExpiresAt = createdAt + 30 * 24 * 60 * 60 * 1000;
  const result = await db.prepare("INSERT INTO questions (body, body_original, ai_summary, summary_edited, category, status, contact_type, answer_draft, answer_alternatives, answer_grounds, portal_id, check_token_hash, check_token_expires_at, submission_key_hash, created_at) VALUES (?, ?, ?, ?, ?, 'open', 'anonymous', ?, ?, ?, ?, ?, ?, ?, ?)").bind(body, body, aiSummary, aiSummary !== canonicalSummary ? 1 : 0, category, draft, JSON.stringify(alternatives), JSON.stringify(related.map((faq) => faq.question)), portalId, await hashCheckToken(checkToken), checkTokenExpiresAt, submissionKeyHash, createdAt).run();
  const id = Number(result.meta.last_row_id);
  return {
    id, body, bodyOriginal: body, aiSummary, summaryEdited: aiSummary !== canonicalSummary,
    category, status: 'open', createdAt, answerBody: null, answerDraft: draft, answerAlternatives: alternatives, answerUsedAi: false,
    answerGrounds: related.map((faq) => faq.question), answeredAt: null, portalId, candidate: null, checkToken,
  };
}

export async function claimAdministrator(userId: string): Promise<boolean> {
  const db = database();
  await ensureAdminState(db);
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
  const db = database();
  await ensureAdminState(db);
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
    answerDraft: String(row.answer_draft ?? ''),
    answerAlternatives: parseAlternatives(row.answer_alternatives == null ? null : String(row.answer_alternatives)),
    answerUsedAi: Boolean(Number(row.answer_used_ai ?? 0)),
    answerGrounds: parseGrounds(row.answer_grounds == null ? null : String(row.answer_grounds)),
    answeredAt: row.answered_at == null ? null : Number(row.answered_at), portalId: row.portal_id == null ? null : Number(row.portal_id), candidate: mapCandidate(row),
  };
}

const QUESTION_SELECT = `SELECT q.id, q.body, q.body_original, q.ai_summary, q.summary_edited, q.category, q.status, q.created_at, q.answer_body, q.answer_draft, q.answer_alternatives, q.answer_used_ai, q.answer_grounds, q.answered_at, q.portal_id,
  c.id AS candidate_id, c.question_id, c.q_text, c.a_text, c.category AS candidate_category, c.status AS candidate_status, c.created_at AS candidate_created_at
  FROM questions q LEFT JOIN faq_candidates c ON c.question_id = q.id AND c.status = 'pending'`;

export async function listQuestionsForAdministratorPage(portalId: number | null = null, page = 1, pageSize = 100): Promise<{ questions: SubmittedQuestion[]; hasMore: boolean }> {
  const db = await initialise();
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safePageSize = Math.min(Math.max(Math.trunc(pageSize) || 100, 1), 100);
  const offset = (safePage - 1) * safePageSize;
  const result = portalId == null
    ? await db.prepare(`${QUESTION_SELECT} WHERE q.portal_id IS NULL ORDER BY q.created_at DESC LIMIT ? OFFSET ?`).bind(safePageSize + 1, offset).all<Record<string, unknown>>()
    : await db.prepare(`${QUESTION_SELECT} WHERE q.portal_id = ? ORDER BY q.created_at DESC LIMIT ? OFFSET ?`).bind(portalId, safePageSize + 1, offset).all<Record<string, unknown>>();
  const rows = result.results ?? [];
  const hasMore = rows.length > safePageSize;
  return { questions: rows.slice(0, safePageSize).map(mapQuestion).map((question) => question.answerAlternatives.length || question.status !== 'open'
    ? question
    : { ...question, answerAlternatives: generateAlternativeDrafts(question.aiSummary, question.bodyOriginal, []) }), hasMore };
}

export async function listQuestionsForAdministrator(portalId: number | null = null): Promise<SubmittedQuestion[]> {
  return (await listQuestionsForAdministratorPage(portalId, 1, 100)).questions;
}

/**
 * Fetch a question inside an explicit portal scope.  `null` means the
 * service-wide (root) inbox; a number means that portal; `undefined` is
 * reserved for internal callers that have already performed their own check.
 */
export async function getQuestionForAdministrator(questionId: number, portalId?: number | null): Promise<SubmittedQuestion | null> {
  const db = await initialise();
  const scope = portalId === null ? ' AND q.portal_id IS NULL' : portalId === undefined ? '' : ' AND q.portal_id = ?';
  const statement = db.prepare(`${QUESTION_SELECT} WHERE q.id = ?${scope} LIMIT 1`);
  const result = portalId === undefined || portalId === null
    ? await statement.bind(questionId).first<Record<string, unknown>>()
    : await statement.bind(questionId, portalId).first<Record<string, unknown>>();
  return result ? mapQuestion(result) : null;
}

export async function getQuestionByCheckToken(token: string): Promise<SubmittedQuestion | null> {
  const db = await initialise();
  if (!/^[0-9a-f-]{32,80}$/i.test(token)) return null;
  const result = await db.prepare(`${QUESTION_SELECT} WHERE q.check_token_hash = ? AND (q.check_token_expires_at IS NULL OR q.check_token_expires_at > ?) LIMIT 1`).bind(await hashCheckToken(token), Date.now()).first<Record<string, unknown>>();
  return result ? mapQuestion(result) : null;
}

export async function generateAnswerDraft(questionId: number, portalId?: number | null): Promise<{ draft: string; alternatives: string[]; grounds: string[]; mode: 'local-rules' }> {
  const question = await getQuestionForAdministrator(questionId, portalId);
  if (!question) throw new Error('質問が見つかりません。');
  if (portalId !== undefined && question.portalId !== portalId) throw new Error('この窓口の質問ではありません。');
  const related = await listRelatedFaqs(question.aiSummary || question.bodyOriginal, 3, question.portalId);
  return { draft: generateLocalDraft(question.aiSummary || question.bodyOriginal, question.bodyOriginal, related), alternatives: generateAlternativeDrafts(question.aiSummary || question.bodyOriginal, question.bodyOriginal, related), grounds: related.map((faq) => faq.question), mode: 'local-rules' };
}

export async function approveAnswer(questionId: number, body: string, usedAi: boolean, grounds: string[], portalId?: number | null, actorUserId: string | null = null): Promise<FaqCandidate | null> {
  const db = await initialise();
  const question = await getQuestionForAdministrator(questionId, portalId);
  if (!question) throw new Error('質問が見つかりません。');
  if (question.status !== 'open') throw new Error('この質問はすでに回答済みです。');
  const answer = body.trim().slice(0, 4000);
  if (!answer) throw new Error('回答本文を入力してください。');
  const answeredAt = Date.now();
  // Recompute grounds from the server-side FAQ set. Client supplied grounds
  // are display hints only and must not become provenance records.
  const related = await listRelatedFaqs(question.aiSummary || question.bodyOriginal, 3, question.portalId);
  const verifiedGrounds = related.map((faq) => faq.question);
  const scope = portalId === null ? ' AND portal_id IS NULL' : portalId === undefined ? '' : ' AND portal_id = ?';
  const update = db.prepare(`UPDATE questions SET answer_body = ?, answer_used_ai = ?, answer_grounds = ?, status = 'answered', answered_at = ? WHERE id = ? AND status = 'open'${scope}`);
  const updateResult = portalId === undefined || portalId === null
    ? await update.bind(answer, usedAi ? 1 : 0, JSON.stringify(verifiedGrounds.slice(0, 10)), answeredAt, questionId).run()
    : await update.bind(answer, usedAi ? 1 : 0, JSON.stringify(verifiedGrounds.slice(0, 10)), answeredAt, questionId, portalId).run();
  if (Number(updateResult.meta.changes ?? 0) !== 1) throw new Error('この質問はすでに回答済みです。');
  const candidate = containsPii(question.bodyOriginal) || containsPii(answer) ? null : generateFaqCandidate(question.bodyOriginal, answer, question.category);
  if (!candidate) {
    try { await writeAuditLog('answer_saved', actorUserId, questionId, question.portalId, 'faq_candidate:none'); } catch { /* do not fail a saved answer when logging is unavailable */ }
    return null;
  }
  const pending = await db.prepare("SELECT id, question_id, q_text, a_text, category, status, created_at FROM faq_candidates WHERE question_id = ? AND status = 'pending' LIMIT 1").bind(questionId).first<Record<string, unknown>>();
  if (pending) {
    try { await writeAuditLog('answer_saved', actorUserId, questionId, question.portalId, `faq_candidate:${pending.id}`); } catch { /* best effort */ }
    return {
    id: Number(pending.id), questionId: Number(pending.question_id), qText: String(pending.q_text ?? ''),
    aText: String(pending.a_text ?? ''), category: String(pending.category ?? 'その他'),
    status: String(pending.status ?? 'pending'), createdAt: Number(pending.created_at ?? answeredAt),
    };
  }
  const result = await db.prepare("INSERT INTO faq_candidates (question_id, q_text, a_text, category, portal_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)").bind(questionId, candidate.q, candidate.a, candidate.category, question.portalId, answeredAt).run();
  try { await writeAuditLog('answer_saved', actorUserId, questionId, question.portalId, `faq_candidate:${result.meta.last_row_id}`); } catch { /* best effort */ }
  return { id: Number(result.meta.last_row_id), questionId, qText: candidate.q, aText: candidate.a, category: candidate.category, status: 'pending', createdAt: answeredAt };
}

export async function deleteQuestion(questionId: number, portalId?: number | null, actorUserId: string | null = null): Promise<void> {
  const db = await initialise();
  const question = await getQuestionForAdministrator(questionId, portalId);
  if (!question) throw new Error('質問が見つかりません。');
  await db.prepare('DELETE FROM faq_candidates WHERE question_id = ?').bind(questionId).run();
  const scope = portalId === null ? ' AND portal_id IS NULL' : portalId === undefined ? '' : ' AND portal_id = ?';
  const statement = db.prepare(`DELETE FROM questions WHERE id = ?${scope}`);
  if (portalId === undefined || portalId === null) await statement.bind(questionId).run();
  else await statement.bind(questionId, portalId).run();
  try { await writeAuditLog('question_deleted', actorUserId, questionId, question.portalId, 'question_deleted'); } catch { /* best effort */ }
}

export async function actOnCandidate(candidateId: number, action: string, qText: string, aText: string, category: string, portalId?: number | null, actorUserId: string | null = null): Promise<void> {
  const db = await initialise();
  const candidate = await db.prepare("SELECT id, question_id, q_text, a_text, category, portal_id FROM faq_candidates WHERE id = ? AND status = 'pending'").bind(candidateId).first<{ id: number; question_id: number; q_text: string; a_text: string; category: string; portal_id: number | null }>();
  if (!candidate) throw new Error('承認待ちのFAQ候補が見つかりません。');
  if (portalId !== undefined && candidate.portal_id !== portalId) throw new Error('この窓口のFAQ候補ではありません。');
  const safeQuestion = (qText.trim() || candidate.q_text).slice(0, 300);
  const safeAnswer = (aText.trim() || candidate.a_text).slice(0, 2000);
  const safeCategory = category.trim().slice(0, 64) || candidate.category;
  if (action === 'publish' || action === 'publish_edited') {
    if (containsPii(safeQuestion) || containsPii(safeAnswer)) throw new Error('個人情報やURLを含むFAQは公開できません。');
    const existing = candidate.portal_id == null
      ? await db.prepare('SELECT id FROM faqs WHERE question = ? AND portal_id IS NULL').bind(safeQuestion).first<{ id: number }>()
      : await db.prepare('SELECT id FROM faqs WHERE question = ? AND portal_id = ?').bind(safeQuestion, candidate.portal_id).first<{ id: number }>();
    if (existing) {
      await db.prepare("UPDATE faqs SET answer = ?, category = ?, status = 'published', portal_id = ?, updated_at = ? WHERE id = ?").bind(safeAnswer, safeCategory, candidate.portal_id, Date.now(), existing.id).run();
    } else {
      const publishedAt = Date.now();
      await db.prepare("INSERT INTO faqs (question, answer, category, portal_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'published', ?, ?)").bind(safeQuestion, safeAnswer, safeCategory, candidate.portal_id, publishedAt, publishedAt).run();
    }
    await db.prepare("UPDATE faq_candidates SET status = 'published', q_text = ?, a_text = ?, category = ? WHERE id = ?").bind(safeQuestion, safeAnswer, safeCategory, candidateId).run();
  } else if (action === 'individual' || action === 'reject') {
    await db.prepare('UPDATE faq_candidates SET status = ? WHERE id = ?').bind(action, candidateId).run();
  } else {
    throw new Error('操作が正しくありません。');
  }
  try { await writeAuditLog(action === 'publish' || action === 'publish_edited' ? 'faq_published' : `faq_candidate_${action}`, actorUserId, candidate.question_id, candidate.portal_id, `candidate:${candidateId}`); } catch { /* best effort */ }
}
