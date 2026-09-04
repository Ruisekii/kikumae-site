import { env } from 'cloudflare:workers';
import {
  categorizeQuestion,
  containsPii,
  detectPiiTypes,
  maskPii,
  generateFaqCandidate,
  generateLocalSummary,
  generateLocalDraft,
  generateAlternativeDrafts,
  generateShelterReplyDraft,
  generateShelterAlternativeDrafts,
  searchFaqs,
  combinedSimilarity,
  generateShelterAnalysis,
  SHELTER_CATEGORIES,
  isShelterQuestion,
  type ShelterIntake,
  type ShelterCategory,
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

export type CaseUpdate = {
  id: number;
  status: string;
  message: string;
  isPublic: boolean;
  createdAt: number;
};

export type SimilarQuestion = {
  id: number;
  title: string;
  category: string;
  location: string;
  workflowStatus: string;
  createdAt: number;
};

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
  bodyMasked: string;
  piiDetected: boolean;
  piiTypes: string[];
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
  workflowStatus: string;
  title: string;
  location: string;
  peopleCount: string;
  resourceRemaining: string;
  lastReceivedAt: string;
  factSummary: string[];
  emotionSummary: string;
  missingInformation: string[];
  urgencyCandidate: string;
  urgencyConfirmed: string | null;
  urgentReview: boolean;
  faqResolved: boolean | null;
  similarGroupId: number | null;
  similarGroupTitle: string;
  similarCount: number;
  assigneeName: string;
  internalNote: string;
  firstConfirmedAt: number | null;
  resolvedAt: number | null;
  updates: CaseUpdate[];
  similarQuestions: SimilarQuestion[];
  candidate: FaqCandidate | null;
  checkToken?: string;
};

export type ShelterDashboardStats = {
  counts: Record<string, number>;
  categoryCounts: { category: string; count: number }[];
  urgent: SubmittedQuestion[];
  surge: { category: string; count: number } | null;
};

export type AuditLog = { action: string; actorUserId: string | null; createdAt: number };


const SEED_FAQS: Omit<Faq, 'id' | 'status' | 'createdAt' | 'updatedAt'>[] = [
  { question: '飲料水はどこで受け取れますか？', answer: '避難所の受付または物資配布場所で案内しています。配布場所や時間が分からない場合は、近くのスタッフへ声をかけてください。', category: '水・飲料' },
  { question: '食料や物資の配布はいつですか？', answer: '配布の時間と場所は、避難所内の掲示とスタッフから案内します。数が足りない場合は、世帯の人数をスタッフへ伝えてください。', category: '食料・物資' },
  { question: '薬が必要なときはどうすればいいですか？', answer: '受付または近くのスタッフへ、必要な薬と体調を伝えてください。緊急の場合は、すぐにスタッフへ知らせてください。', category: '医療・薬' },
  { question: 'トイレや手洗いの場所を教えてください', answer: '避難所内の案内表示を確認してください。見つからない場合は、受付で場所を案内します。', category: 'トイレ・衛生' },
  { question: 'スマートフォンを充電できる場所はありますか？', answer: '充電場所の有無と利用方法は、受付または掲示で案内しています。順番や時間のルールがある場合は、現地の案内に従ってください。', category: '設備・充電' },
  { question: 'ペットと一緒に避難できますか？', answer: 'ペットの受け入れ場所やルールは避難所ごとに異なります。受付で確認し、案内された場所で過ごしてください。', category: 'ペット' },
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
    db.prepare("CREATE TABLE IF NOT EXISTS case_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', is_public INTEGER NOT NULL DEFAULT 1, actor_user_id TEXT, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS similar_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS question_events (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER, event_type TEXT NOT NULL, actor_user_id TEXT, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare('CREATE INDEX IF NOT EXISTS questions_created_at_idx ON questions (created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS faq_candidates_status_idx ON faq_candidates (status, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS case_updates_question_created_idx ON case_updates (question_id, created_at ASC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS question_events_type_created_idx ON question_events (event_type, created_at DESC)'),
  ]);

  // Additive migrations are guarded by a marker so every public request does
  // not repeatedly attempt dozens of ALTER TABLE statements against D1.
  const migrationMarker = await db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_v2' LIMIT 1").first<{ value: string }>();
  if (migrationMarker?.value !== 'ready') {
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
      "ALTER TABLE questions ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'received'",
      "ALTER TABLE questions ADD COLUMN title TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN location TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN people_count TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN resource_remaining TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN last_received_at TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN fact_summary TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE questions ADD COLUMN emotion_summary TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN missing_information TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE questions ADD COLUMN urgency_candidate TEXT NOT NULL DEFAULT '低'",
      "ALTER TABLE questions ADD COLUMN urgency_confirmed TEXT",
      "ALTER TABLE questions ADD COLUMN urgent_review INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE questions ADD COLUMN faq_resolved INTEGER",
      "ALTER TABLE questions ADD COLUMN faq_id INTEGER",
      "ALTER TABLE questions ADD COLUMN similar_group_id INTEGER",
      "ALTER TABLE questions ADD COLUMN assignee_name TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN internal_note TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN first_confirmed_at INTEGER",
      "ALTER TABLE questions ADD COLUMN resolved_at INTEGER",
    ]) await safeRun(db, migration);
    await safeRun(db, 'ALTER TABLE audit_logs ADD COLUMN portal_id INTEGER');
    await safeRun(db, 'CREATE INDEX IF NOT EXISTS audit_logs_portal_created_idx ON audit_logs (portal_id, created_at DESC)');
    await safeRun(db, 'CREATE INDEX IF NOT EXISTS questions_workflow_status_idx ON questions (workflow_status, created_at DESC)');
    await safeRun(db, 'UPDATE faqs SET created_at = updated_at WHERE created_at = 0');
    await safeRun(db, 'UPDATE questions SET body_original = body WHERE body_original IS NULL');
    await db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_v2', 'ready')").run();
  }

  // 個人情報の伏字化用カラムは schema_v2 とは別マーカーで加算する。schema_v2
  // が既に 'ready' の既存デプロイでも、このブロックは独立して一度だけ実行される。
  const piiMigrationMarker = await db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_pii_mask_v1' LIMIT 1").first<{ value: string }>();
  if (piiMigrationMarker?.value !== 'ready') {
    for (const migration of [
      'ALTER TABLE questions ADD COLUMN body_masked TEXT',
      'ALTER TABLE questions ADD COLUMN pii_detected INTEGER NOT NULL DEFAULT 0',
      "ALTER TABLE questions ADD COLUMN pii_types TEXT NOT NULL DEFAULT '[]'",
    ]) await safeRun(db, migration);
    // 既存行は「個人情報を検出したら受付自体を拒否する」旧仕様で保存された
    // ものなので、本文に個人情報は含まれていない。原文をそのままマスク済み
    // 欄へコピーしてよい（新規に伏字化し直す必要はない）。
    await safeRun(db, 'UPDATE questions SET body_masked = body_original WHERE body_masked IS NULL');
    await db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_pii_mask_v1', 'ready')").run();
  }
  await ensureFaqIsolationSchema(db);
  const seedMarker = await db.prepare("SELECT value FROM schema_meta WHERE key = 'shelter_faq_seed_v1' LIMIT 1").first<{ value: string }>();
  if (seedMarker?.value !== 'ready') {
    await db.batch([
      ...SEED_FAQS.map((faq) => db.prepare("INSERT OR IGNORE INTO faqs (question, answer, category, status, created_at, updated_at) VALUES (?, ?, ?, 'published', ?, ?)").bind(faq.question, faq.answer, faq.category, now, now)),
      db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('shelter_faq_seed_v1', 'ready')"),
    ]);
  }
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

function parseStringList(value: string | null): string[] {
  if (!value) return [];
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 12) : []; } catch { return []; }
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
    ? await db.prepare(`SELECT id, question, answer, category, status, created_at, updated_at FROM faqs WHERE status = 'published' AND portal_id IS NULL AND category IN (${SHELTER_CATEGORIES.map(() => '?').join(',')}) ORDER BY updated_at DESC`).bind(...SHELTER_CATEGORIES).all<Record<string, unknown>>()
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

export async function createQuestion(body: string, requestedSummary = '', requestedCategory = '', portalId: number | null = null, submissionKey = '', intake: ShelterIntake = {}): Promise<SubmittedQuestion> {
  const db = await initialise();
  const createdAt = Date.now();
  const submissionKeyHash = submissionKey ? await hashCheckToken(submissionKey) : null;
  if (submissionKeyHash) {
    const duplicate = await db.prepare('SELECT id FROM questions WHERE submission_key_hash = ? LIMIT 1').bind(submissionKeyHash).first<{ id: number }>();
    if (duplicate) throw new Error('QUESTION_DUPLICATE');
  }
  // 原文（body/body_original）は必ずそのまま保存する。個人情報を検出した
  // 場合でも受付自体は拒否せず、要約・分析・回答案・FAQ候補など原文以外の
  // 派生テキストの生成には伏字化した maskedBody を使う。原文は職員が
  // 「原文を開く」操作をしたときだけ参照する（recordOriginalViewed）。
  const piiTypes = detectPiiTypes(body);
  const piiDetected = piiTypes.length > 0;
  const maskedBody = piiDetected ? maskPii(body) : body;
  const shelterAnalysis = portalId === null ? generateShelterAnalysis(maskedBody, intake) : null;
  const canonicalSummary = shelterAnalysis?.overview ?? generateLocalSummary(maskedBody);
  const requestedSummaryTrimmed = requestedSummary.trim().slice(0, 300);
  const maskedRequestedSummary = requestedSummaryTrimmed && containsPii(requestedSummaryTrimmed) ? maskPii(requestedSummaryTrimmed) : requestedSummaryTrimmed;
  const aiSummary = maskedRequestedSummary || canonicalSummary;
  const category = categorizeQuestion(maskedBody, requestedCategory);
  const related = await listRelatedFaqs(aiSummary || maskedBody, 3, portalId);
  const draft = generateLocalDraft(aiSummary, maskedBody, related);
  const alternatives = generateAlternativeDrafts(aiSummary, maskedBody, related);
  const checkToken = crypto.randomUUID() + crypto.randomUUID();
  // Keep the question/FAQ data indefinitely, but limit the bearer URL used to
  // check a private question to 30 days.  Legacy rows without an expiry remain
  // readable so existing users are not broken during migration.
  const checkTokenExpiresAt = createdAt + 30 * 24 * 60 * 60 * 1000;
  const analysis = shelterAnalysis ?? generateShelterAnalysis(maskedBody, intake);
  const result = await db.prepare("INSERT INTO questions (body, body_original, body_masked, pii_detected, pii_types, ai_summary, summary_edited, category, status, workflow_status, title, location, people_count, resource_remaining, last_received_at, fact_summary, emotion_summary, missing_information, urgency_candidate, urgent_review, contact_type, answer_draft, answer_alternatives, answer_grounds, portal_id, check_token_hash, check_token_expires_at, submission_key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'anonymous', ?, ?, ?, ?, ?, ?, ?, ?)").bind(
    body, body, maskedBody, piiDetected ? 1 : 0, JSON.stringify(piiTypes),
    aiSummary, aiSummary !== canonicalSummary ? 1 : 0, category,
    analysis.title, analysis.location, analysis.peopleCount, analysis.resourceRemaining, analysis.lastReceivedAt,
    JSON.stringify(analysis.facts), analysis.emotion, JSON.stringify(analysis.missingInformation), analysis.urgencyCandidate, analysis.urgentReview ? 1 : 0,
    draft, JSON.stringify(alternatives), JSON.stringify(related.map((faq) => faq.question)),
    portalId, await hashCheckToken(checkToken), checkTokenExpiresAt, submissionKeyHash, createdAt,
  ).run();
  const id = Number(result.meta.last_row_id);
  await db.prepare("INSERT INTO case_updates (question_id, status, message, is_public, actor_user_id, created_at) VALUES (?, 'received', ?, 1, NULL, ?)").bind(id, '相談を受け付けました。避難所スタッフが内容を確認します。', createdAt).run();
  await recordQuestionEvent(id, 'question_received', null, '相談受付');
  if (portalId === null) await assignSimilarGroup(db, id, analysis, createdAt);
  return {
    id, body: maskedBody, bodyOriginal: body, bodyMasked: maskedBody, piiDetected, piiTypes, aiSummary, summaryEdited: aiSummary !== canonicalSummary,
    category, status: 'open', createdAt, answerBody: null, answerDraft: draft, answerAlternatives: alternatives, answerUsedAi: false,
    answerGrounds: related.map((faq) => faq.question), answeredAt: null, portalId, workflowStatus: 'received', title: analysis.title,
    location: analysis.location, peopleCount: analysis.peopleCount, resourceRemaining: analysis.resourceRemaining, lastReceivedAt: analysis.lastReceivedAt,
    factSummary: analysis.facts, emotionSummary: analysis.emotion, missingInformation: analysis.missingInformation, urgencyCandidate: analysis.urgencyCandidate,
    urgencyConfirmed: null, urgentReview: analysis.urgentReview, faqResolved: null, similarGroupId: null, similarGroupTitle: '', similarCount: 0,
    assigneeName: '', internalNote: '', firstConfirmedAt: null, resolvedAt: null, updates: [{ id: 0, status: 'received', message: '相談を受け付けました。避難所スタッフが内容を確認します。', isPublic: true, createdAt }], similarQuestions: [], candidate: null, checkToken,
  };
}

async function assignSimilarGroup(db: D1Database, questionId: number, analysis: ReturnType<typeof generateShelterAnalysis>, now: number): Promise<number | null> {
  const result = await db.prepare("SELECT id, body, ai_summary, category, location, similar_group_id FROM questions WHERE portal_id IS NULL AND id != ? AND created_at > ? ORDER BY created_at DESC LIMIT 80").bind(questionId, now - 7 * 24 * 60 * 60 * 1000).all<Record<string, unknown>>();
  const candidate = (result.results ?? []).find((row) => {
    const samePlace = analysis.location && String(row.location ?? '') && analysis.location === String(row.location ?? '');
    const sameCategory = analysis.category !== 'その他' && analysis.category === String(row.category ?? '');
    const score = combinedSimilarity(analysis.overview, String(row.ai_summary ?? row.body ?? ''));
    return Boolean((samePlace && sameCategory) || score >= 0.52 || (sameCategory && score >= 0.35));
  });
  if (!candidate) return null;
  let groupId = candidate.similar_group_id == null ? null : Number(candidate.similar_group_id);
  if (!groupId) {
    const group = await db.prepare('INSERT INTO similar_groups (title, category, location, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(analysis.title, analysis.category, analysis.location, now, now).run();
    groupId = Number(group.meta.last_row_id);
    await db.prepare('UPDATE questions SET similar_group_id = ? WHERE id = ?').bind(groupId, Number(candidate.id)).run();
  }
  await db.prepare('UPDATE questions SET similar_group_id = ? WHERE id = ?').bind(groupId, questionId).run();
  await db.prepare('UPDATE similar_groups SET updated_at = ? WHERE id = ?').bind(now, groupId).run();
  return groupId;
}

export async function recordQuestionEvent(questionId: number | null, eventType: string, actorUserId: string | null = null, detail = ''): Promise<void> {
  const db = await initialise();
  await db.prepare('INSERT INTO question_events (question_id, event_type, actor_user_id, detail, created_at) VALUES (?, ?, ?, ?, ?)').bind(questionId, eventType.slice(0, 64), await auditActorId(actorUserId), detail.slice(0, 500), Date.now()).run();
}

export async function recordFaqSelfResolved(faqId: number | null, query: string): Promise<void> {
  await writeAuditLog('faq_self_resolved', null, null, null, `faq:${faqId ?? 'none'} query:${query.trim().slice(0, 80)}`);
  await recordQuestionEvent(null, 'faq_self_resolved', null, `faq:${faqId ?? 'none'}`);
}

export async function updateQuestionWorkflow(questionId: number, workflowStatus: string, message: string, isPublic: boolean, assigneeName: string, urgencyConfirmed: string, internalNote: string, actorUserId: string): Promise<SubmittedQuestion> {
  const allowed = new Set(['received', 'reviewing', 'in_progress', 'awaiting_info', 'resolved']);
  if (!allowed.has(workflowStatus)) throw new Error('STATUS_INVALID');
  const db = await initialise();
  const question = await getQuestionForAdministrator(questionId, null);
  if (!question) throw new Error('質問が見つかりません。');
  const now = Date.now();
  const firstConfirmedAt = question.firstConfirmedAt ?? (workflowStatus !== 'received' ? now : null);
  const resolvedAt = workflowStatus === 'resolved' ? (question.resolvedAt ?? now) : null;
  const scope = ' AND portal_id IS NULL';
  const update = await db.prepare(`UPDATE questions SET workflow_status = ?, assignee_name = ?, urgency_confirmed = ?, internal_note = ?, first_confirmed_at = COALESCE(first_confirmed_at, ?), resolved_at = ? WHERE id = ?${scope}`).bind(workflowStatus, assigneeName.trim().slice(0, 120), urgencyConfirmed.trim().slice(0, 8) || null, internalNote.trim().slice(0, 2000), firstConfirmedAt, resolvedAt, questionId).run();
  if (Number(update.meta.changes ?? 0) !== 1) throw new Error('質問を更新できませんでした。');
  const publicMessage = message.trim().slice(0, 500);
  if (publicMessage || isPublic) await db.prepare('INSERT INTO case_updates (question_id, status, message, is_public, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(questionId, workflowStatus, publicMessage, isPublic ? 1 : 0, await auditActorId(actorUserId), now).run();
  await recordQuestionEvent(questionId, 'status_changed', actorUserId, `${workflowStatus}:${isPublic ? 'public' : 'internal'}`);
  await writeAuditLog('workflow_updated', actorUserId, questionId, null, workflowStatus);
  return (await getQuestionForAdministrator(questionId, null))!;
}

export async function recordOriginalViewed(questionId: number, actorUserId: string): Promise<void> {
  await recordQuestionEvent(questionId, 'original_opened', actorUserId);
  await writeAuditLog('original_opened', actorUserId, questionId, null, '原文タブを表示');
}

export async function getShelterDashboardStats(): Promise<ShelterDashboardStats> {
  const db = await initialise();
  const countsResult = await db.prepare("SELECT workflow_status, COUNT(*) AS count FROM questions WHERE portal_id IS NULL GROUP BY workflow_status").all<Record<string, unknown>>();
  const categoryResult = await db.prepare("SELECT category, COUNT(*) AS count FROM questions WHERE portal_id IS NULL GROUP BY category ORDER BY count DESC").all<Record<string, unknown>>();
  const urgentResult = await db.prepare(`${QUESTION_SELECT} WHERE q.portal_id IS NULL AND (q.urgent_review = 1 OR q.urgency_confirmed = '高') AND q.workflow_status != 'resolved' ORDER BY q.created_at DESC LIMIT 8`).all<Record<string, unknown>>();
  const surgeResult = await db.prepare("SELECT category, COUNT(*) AS count FROM questions WHERE portal_id IS NULL AND created_at > ? GROUP BY category ORDER BY count DESC LIMIT 1").bind(Date.now() - 30 * 60 * 1000).first<Record<string, unknown>>();
  const urgent = await Promise.all((urgentResult.results ?? []).map((row) => hydrateQuestion(db, mapQuestion(row))));
  const counts: Record<string, number> = { received: 0, reviewing: 0, in_progress: 0, awaiting_info: 0, resolved: 0 };
  (countsResult.results ?? []).forEach((row) => { counts[String(row.workflow_status ?? 'received')] = Number(row.count ?? 0); });
  return { counts, categoryCounts: (categoryResult.results ?? []).map((row) => ({ category: String(row.category ?? 'その他'), count: Number(row.count ?? 0) })), urgent, surge: surgeResult ? { category: String(surgeResult.category ?? 'その他'), count: Number(surgeResult.count ?? 0) } : null };
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
    // body は既定表示用（個人情報を検出していればマスク済み）。原文が
    // 必要な場合は bodyOriginal を使う（職員が「原文を開く」操作をした
    // ときだけ参照し、question_events に original_opened として記録する）。
    id: Number(row.id), body: String(row.body_masked ?? row.body_original ?? row.body ?? ''),
    bodyOriginal: String(row.body_original ?? row.body ?? ''),
    bodyMasked: String(row.body_masked ?? row.body_original ?? row.body ?? ''),
    piiDetected: Boolean(Number(row.pii_detected ?? 0)),
    piiTypes: parseStringList(row.pii_types == null ? null : String(row.pii_types)),
    aiSummary: String(row.ai_summary ?? ''),
    summaryEdited: Boolean(Number(row.summary_edited ?? 0)), category: String(row.category ?? 'その他'),
    status: String(row.status ?? 'open'), createdAt: Number(row.created_at ?? 0),
    answerBody: row.answer_body == null ? null : String(row.answer_body),
    answerDraft: String(row.answer_draft ?? ''),
    answerAlternatives: parseAlternatives(row.answer_alternatives == null ? null : String(row.answer_alternatives)),
    answerUsedAi: Boolean(Number(row.answer_used_ai ?? 0)),
    answerGrounds: parseGrounds(row.answer_grounds == null ? null : String(row.answer_grounds)),
    answeredAt: row.answered_at == null ? null : Number(row.answered_at), portalId: row.portal_id == null ? null : Number(row.portal_id),
    workflowStatus: String(row.workflow_status ?? (row.status === 'answered' ? 'resolved' : 'received')),
    title: String(row.title ?? row.ai_summary ?? ''), location: String(row.location ?? ''), peopleCount: String(row.people_count ?? ''),
    resourceRemaining: String(row.resource_remaining ?? ''), lastReceivedAt: String(row.last_received_at ?? ''),
    factSummary: parseStringList(row.fact_summary == null ? null : String(row.fact_summary)), emotionSummary: String(row.emotion_summary ?? ''),
    missingInformation: parseStringList(row.missing_information == null ? null : String(row.missing_information)),
    urgencyCandidate: String(row.urgency_candidate ?? '低'), urgencyConfirmed: row.urgency_confirmed == null ? null : String(row.urgency_confirmed),
    urgentReview: Boolean(Number(row.urgent_review ?? 0)), faqResolved: row.faq_resolved == null ? null : Boolean(Number(row.faq_resolved)),
    similarGroupId: row.similar_group_id == null ? null : Number(row.similar_group_id), similarGroupTitle: String(row.similar_group_title ?? ''),
    similarCount: Number(row.similar_count ?? 0), assigneeName: String(row.assignee_name ?? ''), internalNote: String(row.internal_note ?? ''),
    firstConfirmedAt: row.first_confirmed_at == null ? null : Number(row.first_confirmed_at), resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at),
    updates: [], similarQuestions: [], candidate: mapCandidate(row),
  };
}

const QUESTION_SELECT = `SELECT q.id, q.body, q.body_original, q.body_masked, q.pii_detected, q.pii_types, q.ai_summary, q.summary_edited, q.category, q.status, q.created_at, q.answer_body, q.answer_draft, q.answer_alternatives, q.answer_used_ai, q.answer_grounds, q.answered_at, q.portal_id,
  q.workflow_status, q.title, q.location, q.people_count, q.resource_remaining, q.last_received_at, q.fact_summary, q.emotion_summary, q.missing_information, q.urgency_candidate, q.urgency_confirmed, q.urgent_review, q.faq_resolved, q.faq_id, q.similar_group_id, q.assignee_name, q.internal_note, q.first_confirmed_at, q.resolved_at,
  sg.title AS similar_group_title, (SELECT COUNT(*) FROM questions sq WHERE sq.similar_group_id = q.similar_group_id) AS similar_count,
  c.id AS candidate_id, c.question_id, c.q_text, c.a_text, c.category AS candidate_category, c.status AS candidate_status, c.created_at AS candidate_created_at
  FROM questions q LEFT JOIN similar_groups sg ON sg.id = q.similar_group_id LEFT JOIN faq_candidates c ON c.question_id = q.id AND c.status = 'pending'`;

async function hydrateQuestion(db: D1Database, question: SubmittedQuestion): Promise<SubmittedQuestion> {
  const result = await db.prepare('SELECT id, status, message, is_public, created_at FROM case_updates WHERE question_id = ? ORDER BY created_at ASC, id ASC LIMIT 80').bind(question.id).all<Record<string, unknown>>();
  const updates = (result.results ?? []).map((row) => ({
    id: Number(row.id), status: String(row.status ?? 'received'), message: String(row.message ?? ''),
    isPublic: Boolean(Number(row.is_public ?? 0)), createdAt: Number(row.created_at ?? 0),
  }));
  let similarQuestions: SimilarQuestion[] = [];
  if (question.similarGroupId) {
    const related = await db.prepare(`${QUESTION_SELECT} WHERE q.similar_group_id = ? AND q.id != ? ORDER BY q.created_at DESC LIMIT 30`).bind(question.similarGroupId, question.id).all<Record<string, unknown>>();
    similarQuestions = (related.results ?? []).map((row) => ({
      id: Number(row.id), title: String(row.title ?? row.ai_summary ?? '相談'), category: String(row.category ?? 'その他'),
      location: String(row.location ?? ''), workflowStatus: String(row.workflow_status ?? 'received'), createdAt: Number(row.created_at ?? 0),
    }));
  }
  return { ...question, updates, similarCount: question.similarGroupId ? Math.max(question.similarCount - 1, similarQuestions.length) : 0, similarQuestions };
}

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
  const mapped = rows.slice(0, safePageSize).map(mapQuestion).map((question) => question.answerAlternatives.length || question.status !== 'open'
    ? question
    : { ...question, answerAlternatives: generateAlternativeDrafts(question.aiSummary, question.bodyMasked, []) });
  return { questions: await Promise.all(mapped.map((question) => hydrateQuestion(db, question))), hasMore };
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
  return result ? hydrateQuestion(db, mapQuestion(result)) : null;
}

export async function getQuestionByCheckToken(token: string): Promise<SubmittedQuestion | null> {
  const db = await initialise();
  if (!/^[0-9a-f-]{32,80}$/i.test(token)) return null;
  const result = await db.prepare(`${QUESTION_SELECT} WHERE q.check_token_hash = ? AND (q.check_token_expires_at IS NULL OR q.check_token_expires_at > ?) LIMIT 1`).bind(await hashCheckToken(token), Date.now()).first<Record<string, unknown>>();
  return result ? hydrateQuestion(db, mapQuestion(result)) : null;
}

export async function generateAnswerDraft(questionId: number, portalId?: number | null): Promise<{ draft: string; alternatives: string[]; grounds: string[]; mode: 'local-rules' }> {
  const question = await getQuestionForAdministrator(questionId, portalId);
  if (!question) throw new Error('質問が見つかりません。');
  if (portalId !== undefined && question.portalId !== portalId) throw new Error('この窓口の質問ではありません。');
  const query = [question.title, question.aiSummary, question.bodyMasked, question.category].filter(Boolean).join(' ');
  const related = await listRelatedFaqs(query, 5, question.portalId);
  const shelterCategory = SHELTER_CATEGORIES.includes(question.category as ShelterCategory)
    && (question.category !== 'その他' || isShelterQuestion(question.bodyOriginal))
    ? question.category as ShelterCategory
    : null;
  if (shelterCategory) {
    const shelterRelated = related.filter((faq) => faq.category === shelterCategory);
    const context = {
      category: shelterCategory,
      location: question.location,
      peopleCount: question.peopleCount,
      resourceRemaining: question.resourceRemaining,
      lastReceivedAt: question.lastReceivedAt,
      emotion: question.emotionSummary,
      missingInformation: question.missingInformation,
      urgentReview: question.urgentReview,
    };
    return {
      draft: generateShelterReplyDraft(context, question.bodyMasked, shelterRelated),
      alternatives: generateShelterAlternativeDrafts(context, question.bodyMasked, shelterRelated),
      grounds: shelterRelated.map((faq) => faq.question),
      mode: 'local-rules',
    };
  }
  return { draft: generateLocalDraft(question.aiSummary || question.bodyMasked, question.bodyMasked, related), alternatives: generateAlternativeDrafts(question.aiSummary || question.bodyMasked, question.bodyMasked, related), grounds: related.map((faq) => faq.question), mode: 'local-rules' };
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
  const related = await listRelatedFaqs(question.aiSummary || question.bodyMasked, 3, question.portalId);
  const verifiedGrounds = related.map((faq) => faq.question);
  const scope = portalId === null ? ' AND portal_id IS NULL' : portalId === undefined ? '' : ' AND portal_id = ?';
  const update = db.prepare(`UPDATE questions SET answer_body = ?, answer_used_ai = ?, answer_grounds = ?, status = 'answered', workflow_status = 'resolved', answered_at = ?, resolved_at = COALESCE(resolved_at, ?) WHERE id = ? AND status = 'open'${scope}`);
  const updateResult = portalId === undefined || portalId === null
    ? await update.bind(answer, usedAi ? 1 : 0, JSON.stringify(verifiedGrounds.slice(0, 10)), answeredAt, answeredAt, questionId).run()
    : await update.bind(answer, usedAi ? 1 : 0, JSON.stringify(verifiedGrounds.slice(0, 10)), answeredAt, answeredAt, questionId, portalId).run();
  if (Number(updateResult.meta.changes ?? 0) !== 1) throw new Error('この質問はすでに回答済みです。');
  await db.prepare("INSERT INTO case_updates (question_id, status, message, is_public, actor_user_id, created_at) VALUES (?, 'resolved', ?, 1, ?, ?)").bind(questionId, '確認済みの回答をお届けしました。', await auditActorId(actorUserId), answeredAt).run();
  await recordQuestionEvent(questionId, 'answer_approved', actorUserId, usedAi ? 'ai_draft_reviewed' : 'human_written');
  // FAQ候補は原文ではなく伏字化済みテキストから作る。相談本文に個人情報が
  // あっても、伏字化されている以上は候補生成を諦めない。回答本文（職員が
  // 書いたもの）に個人情報が残っている場合のみ候補生成を見送る。
  const candidate = containsPii(answer) ? null : generateFaqCandidate(question.bodyMasked, answer, question.category);
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
  const scope = portalId === null ? ' AND portal_id IS NULL' : portalId === undefined ? '' : ' AND portal_id = ?';
  const questionsStatement = db.prepare(`DELETE FROM questions WHERE id = ?${scope}`);
  // 対応メモ（case_updates）と原文閲覧履歴（question_events）も、複数選択削除
  // （deleteQuestions）と同じくバッチで一緒に削除する。片方だけ削除すると、
  // 「削除したはず」の相談本文や対応メモが孤立レコードとしてD1に残り続ける。
  await db.batch([
    db.prepare('DELETE FROM faq_candidates WHERE question_id = ?').bind(questionId),
    db.prepare('DELETE FROM case_updates WHERE question_id = ?').bind(questionId),
    db.prepare('DELETE FROM question_events WHERE question_id = ?').bind(questionId),
    portalId === undefined || portalId === null ? questionsStatement.bind(questionId) : questionsStatement.bind(questionId, portalId),
  ]);
  try { await writeAuditLog('question_deleted', actorUserId, questionId, question.portalId, 'question_deleted'); } catch { /* best effort */ }
}

export async function deleteQuestions(questionIds: number[], portalId: number | null = null, actorUserId: string | null = null): Promise<number> {
  const ids = [...new Set(questionIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
  if (!ids.length) return 0;
  const db = await initialise();
  const placeholders = ids.map(() => '?').join(', ');
  const scope = portalId === null ? 'portal_id IS NULL' : 'portal_id = ?';
  const scopeValues = portalId === null ? [] : [portalId];
  const found = await db.prepare(`SELECT id FROM questions WHERE id IN (${placeholders}) AND ${scope}`).bind(...ids, ...scopeValues).all<{ id: number }>();
  const foundIds = (found.results ?? []).map((row) => Number(row.id)).filter((id) => ids.includes(id));
  if (!foundIds.length) return 0;
  const foundPlaceholders = foundIds.map(() => '?').join(', ');
  await db.batch([
    db.prepare(`DELETE FROM faq_candidates WHERE question_id IN (${foundPlaceholders})`).bind(...foundIds),
    db.prepare(`DELETE FROM case_updates WHERE question_id IN (${foundPlaceholders})`).bind(...foundIds),
    db.prepare(`DELETE FROM question_events WHERE question_id IN (${foundPlaceholders})`).bind(...foundIds),
    db.prepare(`DELETE FROM questions WHERE id IN (${foundPlaceholders}) AND ${scope}`).bind(...foundIds, ...scopeValues),
    db.prepare('DELETE FROM similar_groups WHERE id NOT IN (SELECT DISTINCT similar_group_id FROM questions WHERE similar_group_id IS NOT NULL)'),
  ]);
  try { await writeAuditLog('questions_bulk_deleted', actorUserId, null, portalId, `count:${foundIds.length} ids:${foundIds.join(',')}`); } catch { /* best effort */ }
  return foundIds.length;
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
