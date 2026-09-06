import { env } from 'cloudflare:workers';
import {
  categorizeQuestion,
  containsPii,
  generateFaqCandidate,
  generateLocalSummary,
  generateLocalDraft,
  generateAlternativeDrafts,
  generateShelterReplyDraft,
  generateShelterAlternativeDrafts,
  searchFaqs,
  combinedSimilarity,
  generateShelterAnalysis,
  redactSensitiveInformation,
  SHELTER_CATEGORIES,
  isShelterQuestion,
  type ShelterIntake,
  type ShelterCategory,
  type IssueCategory,
  type UrgencyLevel,
} from './local-ai';
import { resolveShelterZoneId } from '../lib/shelter-map-data';

export type Faq = {
  id: number;
  question: string;
  answer: string;
  category: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  source?: string;
  expiresAt?: number | null;
  verified?: boolean;
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
  issueLocation: string;
  reporterLocation: string;
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
  request?: string;
  affectedPeople?: string;
  vulnerablePeople?: string[];
  emotionalIntensity?: 'low' | 'medium' | 'high';
  containsAbusiveLanguage?: boolean;
  aiConfidence?: { urgency: number; grouping: number; vulnerablePeople: number };
  displayBody?: string;
  issueId?: number | null;
};

export type IssueReport = {
  id: number;
  title: string;
  createdAt: number;
  workflowStatus: string;
  location: string;
  issueLocation: string;
  reporterLocation: string;
  urgency: UrgencyLevel;
  displayBody: string;
  originalBody?: string;
};

export type Issue = {
  id: number;
  title: string;
  summary: string;
  request: string;
  category: IssueCategory | string;
  location: string;
  issueLocation: string;
  reporterLocation: string;
  urgency: UrgencyLevel;
  urgencyConfidence: number;
  urgencyConfirmed: UrgencyLevel | null;
  status: 'new' | 'reviewing' | 'assigned' | 'field_checking' | 'in_progress' | 'waiting' | 'resolved' | 'cannot_resolve' | string;
  reportCount: number;
  affectedPeople: string;
  vulnerablePeople: string[];
  firstReportedAt: number;
  lastReportedAt: number;
  assignedTeam: string;
  assignedUser: string;
  responseMessage: string;
  internalNote: string;
  estimatedResolutionTime: string;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
  version: number;
  groupingConfidence: number;
  groupingMode: 'auto' | 'suggested' | 'single' | string;
  facts: string[];
  emotions: string[];
  missingInformation: string[];
  reports: IssueReport[];
  representativeReportId: number | null;
  candidateId: number | null;
  candidateIssueId: number | null;
  candidateConfidence: number | null;
  candidateIssueTitle: string;
  candidateReason: string;
  updates: CaseUpdate[];
};

export type ShelterDashboardStats = {
  counts: Record<string, number>;
  categoryCounts: { category: string; count: number }[];
  urgent: Issue[];
  surge: { category: string; count: number } | null;
  metrics?: {
    reports: number;
    issues: number;
    autoGrouped: number;
    originalOpened: number;
    issueResponses: number;
    faqResolved: number;
    staffHandled: number;
    originalNotOpened: number;
    averageFirstConfirmationSeconds: number | null;
    averageResolutionSeconds: number | null;
    resolvedToday: number;
  };
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

let initialisationPromise: Promise<D1Database> | null = null;

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
  if (!initialisationPromise) {
    const db = database();
    initialisationPromise = initialiseDatabase(db).then(() => db).catch((error) => {
      initialisationPromise = null;
      throw error;
    });
  }
  try { return await initialisationPromise; } catch (error) {
    console.error('KIKUMAE_INITIALISE_FAILED', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function initialiseDatabase(db: D1Database): Promise<D1Database> {
  const now = Date.now();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS faqs (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL UNIQUE, answer TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT '避難所スタッフ', expires_at INTEGER, verified INTEGER NOT NULL DEFAULT 1)"),
    db.prepare("CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL)"),
    db.prepare('CREATE TABLE IF NOT EXISTS admin_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), user_id TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    db.prepare("CREATE TABLE IF NOT EXISTS faq_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, q_text TEXT NOT NULL, a_text TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id TEXT, action TEXT NOT NULL, question_id INTEGER, portal_id INTEGER, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS case_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', is_public INTEGER NOT NULL DEFAULT 1, actor_user_id TEXT, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS similar_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS question_events (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER, event_type TEXT NOT NULL, actor_user_id TEXT, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS issues (id INTEGER PRIMARY KEY AUTOINCREMENT, portal_id INTEGER, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', request TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'その他', location TEXT NOT NULL DEFAULT '', urgency_candidate TEXT NOT NULL DEFAULT 'normal', urgency_confirmed TEXT, status TEXT NOT NULL DEFAULT 'new', report_count INTEGER NOT NULL DEFAULT 0, affected_people TEXT NOT NULL DEFAULT '', vulnerable_people TEXT NOT NULL DEFAULT '[]', first_reported_at INTEGER NOT NULL, last_reported_at INTEGER NOT NULL, assigned_team TEXT NOT NULL DEFAULT '', assigned_user TEXT NOT NULL DEFAULT '', response_message TEXT NOT NULL DEFAULT '', estimated_resolution_time TEXT NOT NULL DEFAULT '', internal_note TEXT NOT NULL DEFAULT '', resolved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, grouping_confidence REAL NOT NULL DEFAULT 1, grouping_mode TEXT NOT NULL DEFAULT 'single')"),
    db.prepare("CREATE TABLE IF NOT EXISTS issue_reports (issue_id INTEGER NOT NULL, question_id INTEGER NOT NULL UNIQUE, confidence REAL NOT NULL DEFAULT 1, link_type TEXT NOT NULL DEFAULT 'single', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (issue_id, question_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS issue_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, message TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 1, actor_user_id TEXT, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS staff_users (id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', active INTEGER NOT NULL DEFAULT 1, last_seen_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS issue_operation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, report_id INTEGER, operation TEXT NOT NULL, actor_user_id TEXT, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS issue_merge_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, candidate_issue_id INTEGER NOT NULL, confidence REAL NOT NULL, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS shelter_locations (id INTEGER PRIMARY KEY AUTOINCREMENT, portal_id INTEGER, label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)"),
    db.prepare("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare('CREATE INDEX IF NOT EXISTS questions_created_at_idx ON questions (created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS faq_candidates_status_idx ON faq_candidates (status, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS case_updates_question_created_idx ON case_updates (question_id, created_at ASC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS question_events_type_created_idx ON question_events (event_type, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS issues_status_updated_idx ON issues (status, updated_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS issues_priority_idx ON issues (urgency_candidate, report_count DESC, last_reported_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS issue_reports_issue_idx ON issue_reports (issue_id, created_at ASC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS issue_history_issue_idx ON issue_operation_history (issue_id, created_at DESC)'),
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
      "ALTER TABLE questions ADD COLUMN request_text TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN affected_people TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN vulnerable_people TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE questions ADD COLUMN emotional_intensity TEXT NOT NULL DEFAULT 'low'",
      "ALTER TABLE questions ADD COLUMN contains_abusive_language INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE questions ADD COLUMN urgency_confidence REAL NOT NULL DEFAULT 0.5",
      "ALTER TABLE questions ADD COLUMN grouping_confidence REAL NOT NULL DEFAULT 1",
      "ALTER TABLE questions ADD COLUMN display_body TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN issue_id INTEGER",
      "ALTER TABLE questions ADD COLUMN issue_link_confidence REAL NOT NULL DEFAULT 1",
      "ALTER TABLE issues ADD COLUMN internal_note TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE faqs ADD COLUMN source TEXT NOT NULL DEFAULT '避難所スタッフ'",
      "ALTER TABLE faqs ADD COLUMN expires_at INTEGER",
      "ALTER TABLE faqs ADD COLUMN verified INTEGER NOT NULL DEFAULT 1",
    ]) await safeRun(db, migration);
    await safeRun(db, 'ALTER TABLE audit_logs ADD COLUMN portal_id INTEGER');
    await safeRun(db, 'CREATE INDEX IF NOT EXISTS audit_logs_portal_created_idx ON audit_logs (portal_id, created_at DESC)');
    await safeRun(db, 'CREATE INDEX IF NOT EXISTS questions_workflow_status_idx ON questions (workflow_status, created_at DESC)');
    await safeRun(db, 'UPDATE faqs SET created_at = updated_at WHERE created_at = 0');
    await safeRun(db, 'UPDATE questions SET body_original = body WHERE body_original IS NULL');
    await db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_v2', 'ready')").run();
  }
  // schema_v2 was already marked complete on existing deployments before the
  // Report -> Issue fields were introduced. Keep those databases additive and
  // migrate the new columns once without rewriting the legacy rows.
  const issueSchemaMarker = await db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_v3' LIMIT 1").first<{ value: string }>();
  if (issueSchemaMarker?.value !== 'ready') {
    for (const migration of [
      "ALTER TABLE questions ADD COLUMN request_text TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN affected_people TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN vulnerable_people TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE questions ADD COLUMN emotional_intensity TEXT NOT NULL DEFAULT 'low'",
      "ALTER TABLE questions ADD COLUMN contains_abusive_language INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE questions ADD COLUMN urgency_confidence REAL NOT NULL DEFAULT 0.5",
      "ALTER TABLE questions ADD COLUMN grouping_confidence REAL NOT NULL DEFAULT 1",
      "ALTER TABLE questions ADD COLUMN display_body TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE questions ADD COLUMN issue_id INTEGER',
      "ALTER TABLE questions ADD COLUMN issue_link_confidence REAL NOT NULL DEFAULT 1",
      "ALTER TABLE issues ADD COLUMN internal_note TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE faqs ADD COLUMN source TEXT NOT NULL DEFAULT '避難所スタッフ'",
      'ALTER TABLE faqs ADD COLUMN expires_at INTEGER',
      'ALTER TABLE faqs ADD COLUMN verified INTEGER NOT NULL DEFAULT 1',
    ]) await safeRun(db, migration);
    await safeRun(db, 'CREATE INDEX IF NOT EXISTS questions_issue_idx ON questions (issue_id, created_at DESC)');
    await db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_v3', 'ready')").run();
  }
  const mapSchemaMarker = await db.prepare("SELECT value FROM schema_meta WHERE key = 'shelter_map_location_v1' LIMIT 1").first<{ value: string }>();
  if (mapSchemaMarker?.value !== 'ready') {
    for (const migration of [
      "ALTER TABLE questions ADD COLUMN issue_location TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE questions ADD COLUMN reporter_location TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE issues ADD COLUMN issue_location TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE issues ADD COLUMN reporter_location TEXT NOT NULL DEFAULT ''",
    ]) await safeRun(db, migration);
    await safeRun(db, "UPDATE questions SET issue_location = location WHERE issue_location = '' AND location <> ''");
    await safeRun(db, "UPDATE issues SET issue_location = location WHERE issue_location = '' AND location <> ''");
    await db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('shelter_map_location_v1', 'ready')").run();
  }
  await ensureFaqIsolationSchema(db);
  await ensureIssueMigration(db);
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
      db.prepare('CREATE TABLE IF NOT EXISTS faqs_scope_rebuild (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'published\', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, portal_id INTEGER, source TEXT NOT NULL DEFAULT \'避難所スタッフ\', expires_at INTEGER, verified INTEGER NOT NULL DEFAULT 1)'),
      db.prepare('INSERT OR IGNORE INTO faqs_scope_rebuild (id, question, answer, category, status, created_at, updated_at, portal_id, source, expires_at, verified) SELECT id, question, answer, category, status, COALESCE(created_at, updated_at), updated_at, portal_id, COALESCE(source, \'避難所スタッフ\'), expires_at, COALESCE(verified, 1) FROM faqs'),
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

/**
 * Introduce the Report -> Issue layer without deleting the legacy questions.
 * Existing similar_groups become the first Issue groups; ungrouped reports
 * receive a one-report Issue so old data remains visible immediately.
 */
async function ensureIssueMigration(db: D1Database): Promise<void> {
  const marker = await db.prepare("SELECT value FROM schema_meta WHERE key = 'issue_v1' LIMIT 1").first<{ value: string }>();
  if (marker?.value === 'ready') return;
  const rows = await db.prepare(`SELECT id, portal_id, similar_group_id, body_original, ai_summary, request_text, category, location, issue_location, reporter_location,
    urgency_candidate, urgent_review, urgency_confidence, affected_people, vulnerable_people, created_at,
    title, fact_summary, emotion_summary, grouping_confidence, issue_id
    FROM questions WHERE issue_id IS NULL ORDER BY created_at ASC LIMIT 1000`).all<Record<string, unknown>>();
  const buckets = new Map<string, Record<string, unknown>[]>();
  for (const row of rows.results ?? []) {
    const portal = row.portal_id == null ? 'root' : String(row.portal_id);
    const group = row.similar_group_id == null ? `report:${row.id}` : `group:${row.similar_group_id}`;
    const key = `${portal}:${group}`;
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  for (const bucket of buckets.values()) {
    const first = bucket[0];
    const now = Date.now();
    const vulnerable = parseStringList(first.vulnerable_people == null ? null : String(first.vulnerable_people));
    const firstReported = Math.min(...bucket.map((row) => Number(row.created_at ?? now)));
    const lastReported = Math.max(...bucket.map((row) => Number(row.created_at ?? now)));
    const legacyUrgency = String(first.urgency_candidate ?? 'normal');
    const urgency = Number(first.urgent_review ?? 0) === 1 || legacyUrgency === 'critical' ? 'critical' : legacyUrgency === '高' || legacyUrgency === 'high' ? 'high' : legacyUrgency === '中' || legacyUrgency === 'normal' ? 'normal' : 'low';
    const issue = await db.prepare(`INSERT INTO issues (portal_id, title, summary, request, category, location, issue_location, reporter_location, urgency_candidate, status,
      report_count, affected_people, vulnerable_people, first_reported_at, last_reported_at, created_at, updated_at, grouping_confidence, grouping_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(first.portal_id == null ? null : Number(first.portal_id), String(first.title ?? first.ai_summary ?? '相談'), String(first.ai_summary ?? ''), String(first.request_text ?? ''), String(first.category ?? 'その他'), String(first.location ?? ''), String(first.issue_location ?? first.location ?? ''), String(first.reporter_location ?? ''), urgency, bucket.length, String(first.affected_people ?? ''), JSON.stringify(vulnerable.length ? vulnerable : ['不明']), firstReported, lastReported, firstReported, now, bucket.length > 1 ? Number(first.grouping_confidence ?? 0.7) : 1, bucket.length > 1 ? 'auto' : 'single').run();
    const issueId = Number(issue.meta.last_row_id);
    await db.batch(bucket.flatMap((row) => [
      db.prepare('INSERT OR IGNORE INTO issue_reports (issue_id, question_id, confidence, link_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(issueId, Number(row.id), Number(row.grouping_confidence ?? 1), bucket.length > 1 ? 'legacy-group' : 'single', Number(row.created_at ?? now), now),
      db.prepare('UPDATE questions SET issue_id = ?, issue_link_confidence = ? WHERE id = ? AND issue_id IS NULL').bind(issueId, Number(row.grouping_confidence ?? 1), Number(row.id)),
    ]));
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS questions_issue_idx ON questions (issue_id, created_at DESC)').run();
  await db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('issue_v1', 'ready')").run();
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
    source: String(row.source ?? '避難所スタッフ'),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    verified: Boolean(Number(row.verified ?? 1)),
  };
}

async function readPublishedFaqs(db: D1Database, portalId: number | null): Promise<Faq[]> {
  const result = portalId == null
    ? await db.prepare(`SELECT id, question, answer, category, status, created_at, updated_at, source, expires_at, verified FROM faqs WHERE status = 'published' AND portal_id IS NULL AND (expires_at IS NULL OR expires_at > ?) AND category IN (${SHELTER_CATEGORIES.map(() => '?').join(',')}) ORDER BY updated_at DESC`).bind(Date.now(), ...SHELTER_CATEGORIES).all<Record<string, unknown>>()
    : await db.prepare("SELECT id, question, answer, category, status, created_at, updated_at, source, expires_at, verified FROM faqs WHERE status = 'published' AND portal_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY updated_at DESC").bind(portalId, Date.now()).all<Record<string, unknown>>();
  return (result.results ?? []).map(mapFaq);
}

export async function listPublishedFaqs(portalId: number | null = null): Promise<Faq[]> {
  // The public home page only needs published FAQ rows. Read that small,
  // stable surface first so a cold Worker does not block the first screen on
  // the administrator schema migration. New or legacy databases still fall
  // back to the full additive initialisation when the FAQ schema is missing.
  const db = database();
  try {
    return await readPublishedFaqs(db, portalId);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes('no such table') && !message.includes('no such column')) throw error;
    return readPublishedFaqs(await initialise(), portalId);
  }
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
  const statement = db.prepare(`SELECT id, question, answer, category, status, created_at, updated_at, source, expires_at, verified FROM faqs WHERE ${scope.clause} ORDER BY updated_at DESC LIMIT 500`);
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
  const statement = db.prepare(`SELECT id, question, answer, category, status, created_at, updated_at, source, expires_at, verified FROM faqs WHERE id = ? AND ${scope.clause} LIMIT 1`);
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

export async function listRelatedFaqs(query: string, limit = 3, portalId: number | null = null, shelterCategory = ''): Promise<RelatedFaq[]> {
  const faqs = await listPublishedFaqs(portalId);
  const ranked = searchFaqs(query, faqs, Math.max(limit, 6));
  if (!shelterCategory || shelterCategory === 'その他') return ranked.slice(0, limit);
  const categoryFaqs = faqs.filter((faq) => faq.category === shelterCategory).map((faq) => {
    const existing = ranked.find((item) => item.id === faq.id);
    return existing ?? { ...faq, score: 0.65 };
  });
  return [...categoryFaqs, ...ranked.filter((faq) => faq.category !== shelterCategory)].slice(0, limit);
}

export async function createQuestion(body: string, requestedSummary = '', requestedCategory = '', portalId: number | null = null, submissionKey = '', intake: ShelterIntake = {}): Promise<SubmittedQuestion> {
  const db = await initialise();
  const createdAt = Date.now();
  const submissionKeyHash = submissionKey ? await hashCheckToken(submissionKey) : null;
  if (submissionKeyHash) {
    const duplicate = await db.prepare('SELECT id FROM questions WHERE submission_key_hash = ? LIMIT 1').bind(submissionKeyHash).first<{ id: number }>();
    if (duplicate) throw new Error('QUESTION_DUPLICATE');
  }
  const shelterAnalysis = portalId === null ? generateShelterAnalysis(body, intake) : null;
  const canonicalSummary = shelterAnalysis?.overview ?? generateLocalSummary(body);
  const aiSummary = requestedSummary.trim().slice(0, 300) || canonicalSummary;
  const category = categorizeQuestion(body, requestedCategory);
  const analysis = shelterAnalysis ?? generateShelterAnalysis(body, intake);
  const issueLocation = analysis.issueLocation || resolveShelterZoneId(analysis.location) || analysis.location;
  const reporterLocation = intake.reporterLocation?.trim().slice(0, 120) ?? '';
  const related = await listRelatedFaqs(aiSummary || body, 3, portalId, analysis.category);
  const draft = generateLocalDraft(aiSummary, body, related);
  const alternatives = generateAlternativeDrafts(aiSummary, body, related);
  const checkToken = crypto.randomUUID() + crypto.randomUUID();
  // Keep the question/FAQ data indefinitely, but limit the bearer URL used to
  // check a private question to 30 days.  Legacy rows without an expiry remain
  // readable so existing users are not broken during migration.
  const checkTokenExpiresAt = createdAt + 30 * 24 * 60 * 60 * 1000;
  const displayBody = redactSensitiveInformation(body);
  const result = await db.prepare("INSERT INTO questions (body, body_original, ai_summary, summary_edited, category, status, workflow_status, title, location, people_count, resource_remaining, last_received_at, fact_summary, emotion_summary, missing_information, urgency_candidate, urgent_review, request_text, affected_people, vulnerable_people, emotional_intensity, contains_abusive_language, urgency_confidence, grouping_confidence, display_body, contact_type, answer_draft, answer_alternatives, answer_grounds, portal_id, check_token_hash, check_token_expires_at, submission_key_hash, created_at) VALUES (?, ?, ?, ?, ?, 'open', 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'anonymous', ?, ?, ?, ?, ?, ?, ?, ?)").bind(body, body, aiSummary, aiSummary !== canonicalSummary ? 1 : 0, category, analysis.title, analysis.location, analysis.peopleCount, analysis.resourceRemaining, analysis.lastReceivedAt, JSON.stringify(analysis.facts), analysis.emotion, JSON.stringify(analysis.missingInformation), analysis.urgencyCandidate, analysis.urgentReview ? 1 : 0, analysis.request, analysis.affectedPeople, JSON.stringify(analysis.vulnerablePeople), analysis.emotionalIntensity, analysis.containsAbusiveLanguage ? 1 : 0, analysis.urgencyConfidence, 1, displayBody, draft, JSON.stringify(alternatives), JSON.stringify(related.map((faq) => faq.question)), portalId, await hashCheckToken(checkToken), checkTokenExpiresAt, submissionKeyHash, createdAt).run();
  const id = Number(result.meta.last_row_id);
  await db.prepare('UPDATE questions SET issue_location = ?, reporter_location = ? WHERE id = ?').bind(issueLocation, reporterLocation, id).run();
  await db.prepare("INSERT INTO case_updates (question_id, status, message, is_public, actor_user_id, created_at) VALUES (?, 'received', ?, 1, NULL, ?)").bind(id, '相談を受け付けました。避難所スタッフが内容を確認します。', createdAt).run();
  await recordQuestionEvent(id, 'question_received', null, '相談受付');
  await attachQuestionToIssue(db, id, portalId, analysis, createdAt, reporterLocation);
  if (portalId === null) await assignSimilarGroup(db, id, analysis, createdAt);
  return {
    id, body, bodyOriginal: body, aiSummary, summaryEdited: aiSummary !== canonicalSummary,
    category, status: 'open', createdAt, answerBody: null, answerDraft: draft, answerAlternatives: alternatives, answerUsedAi: false,
    answerGrounds: related.map((faq) => faq.question), answeredAt: null, portalId, workflowStatus: 'received', title: analysis.title,
    location: analysis.location, issueLocation, reporterLocation, peopleCount: analysis.peopleCount, resourceRemaining: analysis.resourceRemaining, lastReceivedAt: analysis.lastReceivedAt,
    factSummary: analysis.facts, emotionSummary: analysis.emotion, missingInformation: analysis.missingInformation, urgencyCandidate: analysis.urgencyCandidate,
    urgencyConfirmed: null, urgentReview: analysis.urgentReview, faqResolved: null, similarGroupId: null, similarGroupTitle: '', similarCount: 0,
    assigneeName: '', internalNote: '', firstConfirmedAt: null, resolvedAt: null, updates: [{ id: 0, status: 'received', message: '相談を受け付けました。避難所スタッフが内容を確認します。', isPublic: true, createdAt }], similarQuestions: [], candidate: null, checkToken,
    request: analysis.request, affectedPeople: analysis.affectedPeople, vulnerablePeople: analysis.vulnerablePeople, emotionalIntensity: analysis.emotionalIntensity,
    containsAbusiveLanguage: analysis.containsAbusiveLanguage, aiConfidence: { urgency: analysis.urgencyConfidence, grouping: 1, vulnerablePeople: analysis.vulnerablePeople[0] === '不明' ? 0.42 : 0.76 }, displayBody,
  };
}

function urgencyRank(value: string): number {
  return value === 'critical' ? 4 : value === 'high' ? 3 : value === 'normal' ? 2 : 1;
}

function mergeList(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].filter(Boolean))).slice(0, 12);
}

async function attachQuestionToIssue(db: D1Database, questionId: number, portalId: number | null, analysis: ReturnType<typeof generateShelterAnalysis>, now: number, reporterLocation = ''): Promise<number> {
  const portalClause = portalId === null ? 'portal_id IS NULL' : 'portal_id = ?';
  const portalValues = portalId === null ? [] : [portalId];
  const candidates = await db.prepare(`SELECT id, title, summary, request, category, location, urgency_candidate, report_count, affected_people, vulnerable_people, grouping_mode
    FROM issues WHERE ${portalClause} AND status NOT IN ('resolved', 'cannot_resolve') AND last_reported_at > ? ORDER BY last_reported_at DESC LIMIT 120`)
    .bind(...portalValues, now - 7 * 24 * 60 * 60 * 1000).all<Record<string, unknown>>();
  const query = [analysis.request, analysis.title, analysis.facts.join(' '), analysis.location].filter(Boolean).join(' ');
  let best: { row: Record<string, unknown>; score: number } | null = null;
  for (const row of candidates.results ?? []) {
    const categoryMatch = String(row.category ?? '') === analysis.issueCategory;
    const existingLocation = String(row.location ?? '').trim();
    const locationMatch = Boolean(analysis.location && existingLocation && analysis.location === existingLocation);
    const differentKnownLocation = Boolean(analysis.location && existingLocation && analysis.location !== existingLocation);
    let score = combinedSimilarity(query, [row.title, row.summary, row.request, row.location].filter(Boolean).join(' '));
    if (categoryMatch) score += 0.1;
    if (locationMatch) score += 0.2;
    if (differentKnownLocation) score -= 0.22;
    if (!best || score > best.score) best = { row, score };
  }
  const bestScore = best?.score ?? 0;
  const autoGroup = Boolean(best && ((bestScore >= 0.62) || (bestScore >= 0.42 && String(best.row.category ?? '') === analysis.issueCategory && (!analysis.location || !String(best.row.location ?? '') || analysis.location === String(best.row.location ?? '')))));
  const suggested = Boolean(best && !autoGroup && bestScore >= 0.36);
  const issueId = autoGroup ? Number(best!.row.id) : Number((await db.prepare(`INSERT INTO issues (portal_id, title, summary, request, category, location, urgency_candidate, status, report_count, affected_people, vulnerable_people, first_reported_at, last_reported_at, created_at, updated_at, grouping_confidence, grouping_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 1, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(portalId, analysis.title, analysis.overview, analysis.request, analysis.issueCategory, analysis.location, analysis.urgencyLevel, analysis.affectedPeople, JSON.stringify(analysis.vulnerablePeople), now, now, now, now, suggested ? bestScore : 1, suggested ? 'suggested' : 'single').run()).meta.last_row_id);

  await db.prepare("UPDATE issues SET issue_location = CASE WHEN issue_location = '' THEN ? ELSE issue_location END, reporter_location = CASE WHEN reporter_location = '' THEN ? ELSE reporter_location END WHERE id = ?")
    .bind(analysis.issueLocation || resolveShelterZoneId(analysis.location) || analysis.location, reporterLocation, issueId).run();

  if (autoGroup) {
    const existingVulnerable = parseStringList(best!.row.vulnerable_people == null ? null : String(best!.row.vulnerable_people));
    const combinedVulnerable = mergeList(existingVulnerable, analysis.vulnerablePeople);
    const currentUrgency = String(best!.row.urgency_candidate ?? 'normal');
    const urgency = urgencyRank(analysis.urgencyLevel) > urgencyRank(currentUrgency) ? analysis.urgencyLevel : currentUrgency;
    const location = String(best!.row.location ?? '') || analysis.location;
    const title = String(best!.row.title ?? '') || analysis.title;
    await db.prepare(`UPDATE issues SET title = ?, summary = ?, request = ?, category = ?, location = ?, urgency_candidate = ?, report_count = report_count + 1,
      affected_people = CASE WHEN affected_people = '' THEN ? ELSE affected_people END, vulnerable_people = ?, last_reported_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
      .bind(title, analysis.overview, analysis.request, analysis.issueCategory, location, urgency, analysis.affectedPeople, JSON.stringify(combinedVulnerable.length ? combinedVulnerable : ['不明']), now, now, issueId).run();
  }
  await db.prepare('INSERT OR IGNORE INTO issue_reports (issue_id, question_id, confidence, link_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(issueId, questionId, autoGroup ? Math.min(0.99, Math.max(0.5, bestScore)) : suggested ? bestScore : 1, autoGroup ? 'auto' : suggested ? 'suggested' : 'single', now, now).run();
  await db.prepare('UPDATE questions SET issue_id = ?, issue_link_confidence = ? WHERE id = ?').bind(issueId, autoGroup ? Math.min(0.99, Math.max(0.5, bestScore)) : suggested ? bestScore : 1, questionId).run();
  if (suggested && best) {
    await db.prepare('INSERT INTO issue_merge_candidates (issue_id, candidate_issue_id, confidence, reason, status, created_at) VALUES (?, ?, ?, ?, \'pending\', ?)')
      .bind(issueId, Number(best.row.id), bestScore, 'カテゴリ・場所・要望が近い統合候補', now).run();
  }
  await db.prepare('INSERT INTO issue_operation_history (issue_id, report_id, operation, actor_user_id, detail, created_at) VALUES (?, ?, ?, NULL, ?, ?)')
    .bind(issueId, questionId, autoGroup ? 'report_auto_grouped' : suggested ? 'report_group_candidate' : 'issue_created', autoGroup ? `score:${bestScore.toFixed(3)}` : '新しい課題として受付', now).run();
  return issueId;
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
  const japanNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const startOfJapanDay = Date.UTC(japanNow.getUTCFullYear(), japanNow.getUTCMonth(), japanNow.getUTCDate()) - 9 * 60 * 60 * 1000;
  const [countsResult, categoryResult, urgentResult, surgeResult, reportMetric, issueMetric, groupedMetric, originalQuestionMetric, originalIssueMetric, responseMetric, faqResolvedMetric, staffHandledMetric, originalNotOpenedMetric, timingMetric, resolvedTodayMetric] = await Promise.all([
    db.prepare("SELECT status, COUNT(*) AS count FROM issues WHERE portal_id IS NULL GROUP BY status").all<Record<string, unknown>>(),
    db.prepare("SELECT category, SUM(report_count) AS count FROM issues WHERE portal_id IS NULL GROUP BY category ORDER BY count DESC").all<Record<string, unknown>>(),
    db.prepare(`${ISSUE_SELECT} WHERE portal_id IS NULL AND urgency_candidate IN ('critical','high') AND status NOT IN ('resolved','cannot_resolve') ORDER BY CASE urgency_candidate WHEN 'critical' THEN 2 ELSE 1 END DESC, report_count DESC, last_reported_at ASC LIMIT 8`).all<Record<string, unknown>>(),
    db.prepare("SELECT category, SUM(report_count) AS count FROM issues WHERE portal_id IS NULL AND last_reported_at > ? GROUP BY category ORDER BY count DESC LIMIT 1").bind(Date.now() - 30 * 60 * 1000).first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM questions WHERE portal_id IS NULL").first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM issues WHERE portal_id IS NULL").first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM issue_reports ir JOIN issues i ON i.id = ir.issue_id WHERE i.portal_id IS NULL AND ir.link_type = 'auto'").first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM question_events qe JOIN questions q ON q.id = qe.question_id WHERE q.portal_id IS NULL AND qe.event_type = 'original_opened'").first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(DISTINCT h.issue_id) AS count FROM issue_operation_history h JOIN issues i ON i.id = h.issue_id WHERE i.portal_id IS NULL AND h.operation = 'original_opened'").first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM issue_responses ir JOIN issues i ON i.id = ir.issue_id WHERE i.portal_id IS NULL").first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM questions WHERE portal_id IS NULL AND faq_resolved = 1").first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM issues WHERE portal_id IS NULL AND status != 'new'").first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM issues i WHERE i.portal_id IS NULL AND i.status != 'new' AND NOT EXISTS (SELECT 1 FROM issue_operation_history h WHERE h.issue_id = i.id AND h.operation = 'original_opened')").first<Record<string, unknown>>(),
    db.prepare("SELECT AVG(first_confirmed_at - created_at) AS first_confirmation_ms, AVG(resolved_at - created_at) AS resolution_ms FROM questions WHERE portal_id IS NULL AND (first_confirmed_at IS NOT NULL OR resolved_at IS NOT NULL)").first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS count FROM issues WHERE portal_id IS NULL AND resolved_at >= ?").bind(startOfJapanDay).first<Record<string, unknown>>(),
  ]);
  const urgent = await Promise.all((urgentResult.results ?? []).map((row) => hydrateIssue(db, mapIssue(row), false)));
  const counts: Record<string, number> = { new: 0, reviewing: 0, assigned: 0, field_checking: 0, in_progress: 0, waiting: 0, resolved: 0, cannot_resolve: 0 };
  (countsResult.results ?? []).forEach((row) => { counts[String(row.status ?? 'new')] = Number(row.count ?? 0); });
  const averageSeconds = (value: unknown): number | null => value == null ? null : Math.max(0, Math.round(Number(value) / 1000));
  return {
    counts, categoryCounts: (categoryResult.results ?? []).map((row) => ({ category: String(row.category ?? 'その他'), count: Number(row.count ?? 0) })),
    urgent, surge: surgeResult ? { category: String(surgeResult.category ?? 'その他'), count: Number(surgeResult.count ?? 0) } : null,
    metrics: {
      reports: Number(reportMetric?.count ?? 0), issues: Number(issueMetric?.count ?? 0),
      autoGrouped: Number(groupedMetric?.count ?? 0),
      originalOpened: Number(originalQuestionMetric?.count ?? 0) + Number(originalIssueMetric?.count ?? 0),
      issueResponses: Number(responseMetric?.count ?? 0), faqResolved: Number(faqResolvedMetric?.count ?? 0),
      staffHandled: Number(staffHandledMetric?.count ?? 0), originalNotOpened: Number(originalNotOpenedMetric?.count ?? 0),
      averageFirstConfirmationSeconds: averageSeconds(timingMetric?.first_confirmation_ms), averageResolutionSeconds: averageSeconds(timingMetric?.resolution_ms),
      resolvedToday: Number(resolvedTodayMetric?.count ?? 0),
    },
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
    answeredAt: row.answered_at == null ? null : Number(row.answered_at), portalId: row.portal_id == null ? null : Number(row.portal_id),
    workflowStatus: String(row.workflow_status ?? (row.status === 'answered' ? 'resolved' : 'received')),
    title: String(row.title ?? row.ai_summary ?? ''), location: String(row.location ?? ''), issueLocation: String(row.issue_location ?? (resolveShelterZoneId(String(row.location ?? '')) || row.location || '')), reporterLocation: String(row.reporter_location ?? ''), peopleCount: String(row.people_count ?? ''),
    resourceRemaining: String(row.resource_remaining ?? ''), lastReceivedAt: String(row.last_received_at ?? ''),
    factSummary: parseStringList(row.fact_summary == null ? null : String(row.fact_summary)), emotionSummary: String(row.emotion_summary ?? ''),
    missingInformation: parseStringList(row.missing_information == null ? null : String(row.missing_information)),
    urgencyCandidate: String(row.urgency_candidate ?? '低'), urgencyConfirmed: row.urgency_confirmed == null ? null : String(row.urgency_confirmed),
    urgentReview: Boolean(Number(row.urgent_review ?? 0)), faqResolved: row.faq_resolved == null ? null : Boolean(Number(row.faq_resolved)),
    similarGroupId: row.similar_group_id == null ? null : Number(row.similar_group_id), similarGroupTitle: String(row.similar_group_title ?? ''),
    similarCount: Number(row.similar_count ?? 0), assigneeName: String(row.assignee_name ?? ''), internalNote: String(row.internal_note ?? ''),
    firstConfirmedAt: row.first_confirmed_at == null ? null : Number(row.first_confirmed_at), resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at),
    updates: [], similarQuestions: [], candidate: mapCandidate(row),
    request: String(row.request_text ?? ''), affectedPeople: String(row.affected_people ?? row.people_count ?? ''),
    vulnerablePeople: parseStringList(row.vulnerable_people == null ? null : String(row.vulnerable_people)).length ? parseStringList(row.vulnerable_people == null ? null : String(row.vulnerable_people)) : ['不明'],
    emotionalIntensity: String(row.emotional_intensity ?? 'low') as 'low' | 'medium' | 'high', containsAbusiveLanguage: Boolean(Number(row.contains_abusive_language ?? 0)),
    aiConfidence: { urgency: Number(row.urgency_confidence ?? 0.5), grouping: Number(row.grouping_confidence ?? 1), vulnerablePeople: parseStringList(row.vulnerable_people == null ? null : String(row.vulnerable_people)).includes('不明') ? 0.42 : 0.76 },
    displayBody: String(row.display_body ?? row.body_original ?? row.body ?? ''),
    issueId: row.issue_id == null ? null : Number(row.issue_id),
  };
}

const QUESTION_SELECT = `SELECT q.id, q.body, q.body_original, q.ai_summary, q.summary_edited, q.category, q.status, q.created_at, q.answer_body, q.answer_draft, q.answer_alternatives, q.answer_used_ai, q.answer_grounds, q.answered_at, q.portal_id,
  q.workflow_status, q.title, q.location, q.issue_location, q.reporter_location, q.people_count, q.resource_remaining, q.last_received_at, q.fact_summary, q.emotion_summary, q.missing_information, q.urgency_candidate, q.urgency_confirmed, q.urgent_review, q.faq_resolved, q.faq_id, q.similar_group_id, q.assignee_name, q.internal_note, q.first_confirmed_at, q.resolved_at,
  q.request_text, q.affected_people, q.vulnerable_people, q.emotional_intensity, q.contains_abusive_language, q.urgency_confidence, q.grouping_confidence, q.display_body, q.issue_id,
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
  if (question.issueId) {
    const issue = await db.prepare('SELECT title, report_count FROM issues WHERE id = ? LIMIT 1').bind(question.issueId).first<Record<string, unknown>>();
    return { ...question, updates, similarGroupTitle: String(issue?.title ?? question.similarGroupTitle), similarCount: Math.max(Number(issue?.report_count ?? 1) - 1, 0), similarQuestions };
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
    : { ...question, answerAlternatives: generateAlternativeDrafts(question.aiSummary, question.bodyOriginal, []) });
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

const ISSUE_SELECT = `SELECT id, portal_id, title, summary, request, category, location, issue_location, reporter_location, urgency_candidate, urgency_confirmed, status,
  report_count, affected_people, vulnerable_people, first_reported_at, last_reported_at, assigned_team, assigned_user,
  response_message, estimated_resolution_time, internal_note, resolved_at, created_at, updated_at, version, grouping_confidence, grouping_mode
  FROM issues`;

function mapIssue(row: Record<string, unknown>): Issue {
  const urgency = String(row.urgency_candidate ?? 'normal');
  const confirmed = row.urgency_confirmed == null ? null : String(row.urgency_confirmed) as UrgencyLevel;
  const vulnerable = parseStringList(row.vulnerable_people == null ? null : String(row.vulnerable_people));
  const issueLocation = String(row.issue_location ?? (resolveShelterZoneId(String(row.location ?? '')) || row.location || ''));
  return {
    id: Number(row.id), title: String(row.title ?? '課題'), summary: String(row.summary ?? ''), request: String(row.request ?? ''),
    category: String(row.category ?? 'その他'), location: String(row.location ?? ''), issueLocation, reporterLocation: String(row.reporter_location ?? ''), urgency: urgency as UrgencyLevel, urgencyConfidence: Number(row.urgency_confidence ?? 0), urgencyConfirmed: confirmed,
    status: String(row.status ?? 'new') as Issue['status'], reportCount: Number(row.report_count ?? 0), affectedPeople: String(row.affected_people ?? ''),
    vulnerablePeople: vulnerable.length ? vulnerable : ['不明'], firstReportedAt: Number(row.first_reported_at ?? row.created_at ?? 0),
    lastReportedAt: Number(row.last_reported_at ?? row.updated_at ?? 0), assignedTeam: String(row.assigned_team ?? ''), assignedUser: String(row.assigned_user ?? ''),
    responseMessage: String(row.response_message ?? ''), internalNote: String(row.internal_note ?? ''), estimatedResolutionTime: String(row.estimated_resolution_time ?? ''),
    resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at), createdAt: Number(row.created_at ?? 0), updatedAt: Number(row.updated_at ?? 0),
    version: Number(row.version ?? 1), groupingConfidence: Number(row.grouping_confidence ?? 1), groupingMode: String(row.grouping_mode ?? 'single'),
    facts: [], emotions: [], missingInformation: [], reports: [], representativeReportId: null, candidateId: null, candidateIssueId: null, candidateConfidence: null, candidateIssueTitle: '', candidateReason: '', updates: [],
  };
}

async function hydrateIssue(db: D1Database, issue: Issue, includeReports = true): Promise<Issue> {
  const reportRows = includeReports ? await db.prepare(`SELECT q.id, q.title, q.created_at, q.workflow_status, q.location, q.issue_location, q.reporter_location, q.urgency_candidate, q.urgency_confidence, q.display_body, q.body_original,
      q.fact_summary, q.emotion_summary, q.missing_information FROM issue_reports ir JOIN questions q ON q.id = ir.question_id
      WHERE ir.issue_id = ? ORDER BY q.created_at ASC, q.id ASC LIMIT 200`).bind(issue.id).all<Record<string, unknown>>() : { results: [] };
  const reports = (reportRows.results ?? []).map((row) => ({
    id: Number(row.id), title: String(row.title ?? '相談'), createdAt: Number(row.created_at ?? 0), workflowStatus: String(row.workflow_status ?? 'received'),
    location: String(row.location ?? ''), issueLocation: String(row.issue_location ?? (resolveShelterZoneId(String(row.location ?? '')) || row.location || '')), reporterLocation: String(row.reporter_location ?? ''), urgency: String(row.urgency_candidate ?? 'normal') as UrgencyLevel, displayBody: String(row.display_body ?? ''), originalBody: String(row.body_original ?? row.display_body ?? ''),
  }));
  const facts: string[] = []; const emotions: string[] = []; const missing: string[] = [];
  const urgencyConfidence = Math.max(issue.urgencyConfidence, ...(reportRows.results ?? []).map((row) => Number(row.urgency_confidence ?? 0)));
  for (const row of reportRows.results ?? []) {
    facts.push(...parseStringList(row.fact_summary == null ? null : String(row.fact_summary)));
    if (row.emotion_summary) emotions.push(String(row.emotion_summary));
    missing.push(...parseStringList(row.missing_information == null ? null : String(row.missing_information)));
  }
  const updates = await db.prepare('SELECT id, message, is_public, created_at, \'issue\' AS status FROM issue_responses WHERE issue_id = ? ORDER BY created_at ASC, id ASC LIMIT 100').bind(issue.id).all<Record<string, unknown>>();
  const candidate = await db.prepare(`SELECT c.id, c.candidate_issue_id, c.confidence, c.reason, target.title AS candidate_issue_title
    FROM issue_merge_candidates c JOIN issues target ON target.id = c.candidate_issue_id
    WHERE c.issue_id = ? AND c.status = 'pending' ORDER BY c.confidence DESC LIMIT 1`).bind(issue.id).first<Record<string, unknown>>();
  return {
    ...issue, urgencyConfidence, reports, reportCount: Math.max(issue.reportCount, reports.length), facts: Array.from(new Set(facts)).slice(0, 16),
    emotions: Array.from(new Set(emotions)).slice(0, 8), missingInformation: Array.from(new Set(missing)).slice(0, 12),
    representativeReportId: reports[0]?.id ?? null,
    candidateId: candidate?.id == null ? null : Number(candidate.id),
    candidateIssueId: candidate?.candidate_issue_id == null ? null : Number(candidate.candidate_issue_id),
    candidateConfidence: candidate?.confidence == null ? null : Number(candidate.confidence),
    candidateIssueTitle: String(candidate?.candidate_issue_title ?? ''),
    candidateReason: String(candidate?.reason ?? ''),
    updates: (updates.results ?? []).map((row) => ({ id: Number(row.id), status: String(row.status ?? 'issue'), message: String(row.message ?? ''), isPublic: Boolean(Number(row.is_public ?? 0)), createdAt: Number(row.created_at ?? 0) })),
  };
}

export async function listIssuesForAdministratorPage(portalId: number | null = null, page = 1, pageSize = 100, search = ''): Promise<{ issues: Issue[]; hasMore: boolean }> {
  const db = await initialise();
  const safePage = Math.max(1, Math.trunc(page) || 1); const safePageSize = Math.min(Math.max(Math.trunc(pageSize) || 100, 1), 100); const offset = (safePage - 1) * safePageSize;
  const scope = portalId === null ? 'portal_id IS NULL' : 'portal_id = ?';
  const priority = "CASE urgency_candidate WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END";
  const term = search.trim().slice(0, 80);
  const searchClause = term ? " AND (title LIKE ? OR summary LIKE ? OR request LIKE ? OR location LIKE ? OR category LIKE ? OR assigned_team LIKE ? OR assigned_user LIKE ?)" : '';
  const searchValues = term ? Array.from({ length: 7 }, () => `%${term}%`) : [];
  const statement = db.prepare(`${ISSUE_SELECT} WHERE ${scope}${searchClause} ORDER BY CASE WHEN status IN ('resolved','cannot_resolve') THEN 1 ELSE 0 END ASC, ${priority} DESC, report_count DESC, last_reported_at ASC LIMIT ? OFFSET ?`);
  const values = portalId === null ? [...searchValues, safePageSize + 1, offset] : [portalId, ...searchValues, safePageSize + 1, offset];
  const result = await statement.bind(...values).all<Record<string, unknown>>();
  const rows = result.results ?? []; const hasMore = rows.length > safePageSize;
  return { issues: await Promise.all(rows.slice(0, safePageSize).map((row) => hydrateIssue(db, mapIssue(row)))), hasMore };
}

export async function reviewIssueMergeCandidate(candidateId: number, action: 'accept' | 'reject', actorUserId: string, actorDisplayName = '避難所統括-田中'): Promise<{ action: 'accepted' | 'rejected'; issueId: number; targetIssueId: number | null }> {
  if (!Number.isInteger(candidateId) || candidateId <= 0) throw new Error('MERGE_CANDIDATE_INVALID');
  const db = await initialise();
  const candidate = await db.prepare(`SELECT c.id, c.issue_id, c.candidate_issue_id, source.status AS source_status, target.status AS target_status,
      source.report_count AS source_report_count, target.report_count AS target_report_count, source.last_reported_at AS source_last_reported_at,
      target.last_reported_at AS target_last_reported_at, source.urgency_candidate AS source_urgency, target.urgency_candidate AS target_urgency
    FROM issue_merge_candidates c JOIN issues source ON source.id = c.issue_id JOIN issues target ON target.id = c.candidate_issue_id
    WHERE c.id = ? AND c.status = 'pending' AND source.portal_id IS NULL AND target.portal_id IS NULL`).bind(candidateId).first<Record<string, unknown>>();
  if (!candidate) throw new Error('MERGE_CANDIDATE_NOT_FOUND');
  const issueId = Number(candidate.issue_id);
  const targetIssueId = Number(candidate.candidate_issue_id);
  await ensureStaffUser(actorUserId, actorDisplayName);
  const actor = await auditActorId(actorUserId);

  if (action === 'reject') {
    const result = await db.prepare("UPDATE issue_merge_candidates SET status = 'rejected' WHERE id = ? AND status = 'pending'").bind(candidateId).run();
    if (Number(result.meta.changes ?? 0) !== 1) throw new Error('MERGE_CONFLICT');
    await db.prepare('INSERT INTO issue_operation_history (issue_id, report_id, operation, actor_user_id, detail, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(issueId, 'merge_candidate_rejected', actor, `candidate:${targetIssueId}`, Date.now()).run();
    await writeAuditLog('issue_merge_candidate_rejected', actorUserId, null, null, `issue:${issueId} candidate:${targetIssueId}`);
    return { action: 'rejected', issueId, targetIssueId: null };
  }

  if (candidate.source_status === 'resolved' || candidate.source_status === 'cannot_resolve' || candidate.target_status === 'resolved' || candidate.target_status === 'cannot_resolve') throw new Error('MERGE_NOT_ALLOWED');
  const now = Date.now();
  const sourceLastReportedAt = Number(candidate.source_last_reported_at ?? 0);
  const targetLastReportedAt = Number(candidate.target_last_reported_at ?? 0);
  const urgency = urgencyRank(String(candidate.source_urgency ?? 'normal')) > urgencyRank(String(candidate.target_urgency ?? 'normal')) ? String(candidate.source_urgency ?? 'normal') : String(candidate.target_urgency ?? 'normal');
  await db.batch([
    db.prepare("UPDATE issue_reports SET issue_id = ?, link_type = 'manual', confidence = 1, updated_at = ? WHERE issue_id = ?").bind(targetIssueId, now, issueId),
    db.prepare('UPDATE questions SET issue_id = ?, issue_link_confidence = 1 WHERE issue_id = ?').bind(targetIssueId, issueId),
    db.prepare('UPDATE issue_responses SET issue_id = ? WHERE issue_id = ?').bind(targetIssueId, issueId),
    db.prepare('UPDATE issue_operation_history SET issue_id = ? WHERE issue_id = ?').bind(targetIssueId, issueId),
    db.prepare(`UPDATE issues SET report_count = (SELECT COUNT(*) FROM issue_reports WHERE issue_id = ?), last_reported_at = ?, urgency_candidate = ?, grouping_confidence = 1, grouping_mode = 'manual', updated_at = ?, version = version + 1 WHERE id = ? AND portal_id IS NULL`).bind(targetIssueId, Math.max(sourceLastReportedAt, targetLastReportedAt), urgency, now, targetIssueId),
    db.prepare('INSERT INTO issue_operation_history (issue_id, report_id, operation, actor_user_id, detail, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(targetIssueId, 'merge_candidate_accepted', actor, `merged_issue:${issueId}`, now),
    db.prepare('DELETE FROM issue_merge_candidates WHERE issue_id = ? OR candidate_issue_id = ?').bind(issueId, issueId),
    db.prepare('DELETE FROM issues WHERE id = ? AND portal_id IS NULL').bind(issueId),
  ]);
  await writeAuditLog('issue_merge_candidate_accepted', actorUserId, null, null, `issue:${issueId} target:${targetIssueId}`);
  return { action: 'accepted', issueId, targetIssueId };
}

export async function getIssueForAdministrator(issueId: number, portalId: number | null = null): Promise<Issue | null> {
  const db = await initialise(); const scope = portalId === null ? 'portal_id IS NULL' : 'portal_id = ?';
  const statement = db.prepare(`${ISSUE_SELECT} WHERE id = ? AND ${scope} LIMIT 1`);
  const row = portalId === null ? await statement.bind(issueId).first<Record<string, unknown>>() : await statement.bind(issueId, portalId).first<Record<string, unknown>>();
  return row ? hydrateIssue(db, mapIssue(row)) : null;
}

function questionStatusForIssue(status: string): string {
  return status === 'resolved' || status === 'cannot_resolve' ? 'resolved' : status === 'in_progress' ? 'in_progress' : status === 'field_checking' ? 'field_checking' : status === 'waiting' ? 'awaiting_info' : status === 'new' ? 'received' : 'reviewing';
}

function issueStatusPublicMessage(status: string): string {
  const messages: Record<string, string> = {
    new: '相談を受け付けました。避難所スタッフが内容を確認します。',
    reviewing: '避難所スタッフが状況を確認しています。',
    assigned: '担当スタッフを決めて、対応を進めます。',
    field_checking: '避難所スタッフが現場の状況を確認しています。',
    in_progress: '避難所スタッフが対応を進めています。',
    waiting: '対応に必要な情報を確認しています。',
    resolved: '対応が完了しました。',
    cannot_resolve: '現在の対応状況を記録しました。近くのスタッフにもご相談ください。',
  };
  return messages[status] ?? '相談の対応状況が更新されました。';
}

export async function ensureStaffUser(externalId: string, displayName: string, role = 'staff'): Promise<void> {
  const db = await initialise(); const id = externalId.trim().slice(0, 120) || 'admin-password'; const name = displayName.trim().slice(0, 120) || '避難所統括-田中';
  await db.prepare(`INSERT INTO staff_users (external_id, display_name, role, active, last_seen_at) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(external_id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, active = 1, last_seen_at = excluded.last_seen_at`).bind(id, name, role, Date.now()).run();
}

export async function updateIssueWorkflow(issueId: number, status: string, message: string, isPublic: boolean, assignedTeam: string, assignedUser: string, urgencyConfirmed: string, internalNote: string, expectedVersion: number | null, actorUserId: string, actorDisplayName = '避難所統括-田中'): Promise<Issue> {
  const allowed = new Set(['new', 'reviewing', 'assigned', 'field_checking', 'in_progress', 'waiting', 'resolved', 'cannot_resolve']);
  if (!allowed.has(status)) throw new Error('ISSUE_STATUS_INVALID');
  const db = await initialise(); const issue = await getIssueForAdministrator(issueId, null); if (!issue) throw new Error('ISSUE_NOT_FOUND');
  if (expectedVersion != null && issue.version !== expectedVersion) throw new Error('ISSUE_CONFLICT');
  await ensureStaffUser(actorUserId, actorDisplayName);
  const now = Date.now(); const resolvedAt = status === 'resolved' || status === 'cannot_resolve' ? (issue.resolvedAt ?? now) : null;
  const binds = [status, assignedTeam.trim().slice(0, 120), assignedUser.trim().slice(0, 120), urgencyConfirmed.trim().slice(0, 16) || null, internalNote.trim().slice(0, 2000), resolvedAt, now, issueId];
  const result = expectedVersion == null
    ? await db.prepare(`UPDATE issues SET status = ?, assigned_team = ?, assigned_user = ?, urgency_confirmed = ?, internal_note = ?, resolved_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND portal_id IS NULL`).bind(...binds).run()
    : await db.prepare(`UPDATE issues SET status = ?, assigned_team = ?, assigned_user = ?, urgency_confirmed = ?, internal_note = ?, resolved_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND portal_id IS NULL AND version = ?`).bind(...binds, expectedVersion).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error(expectedVersion == null ? 'ISSUE_UPDATE_FAILED' : 'ISSUE_CONFLICT');
  const mappedStatus = questionStatusForIssue(status);
  const publicMessage = message.trim().slice(0, 1000);
  const publicFlag = isPublic ? 1 : 0;
  const statusChanged = issue.status !== status;
  if (publicMessage || statusChanged) {
    const actor = await auditActorId(actorUserId);
    const residentMessage = publicMessage || issueStatusPublicMessage(status);
    if (publicMessage) await db.prepare('INSERT INTO issue_responses (issue_id, message, is_public, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(issueId, publicMessage, publicFlag, actor, now).run();
    const reportIds = await db.prepare('SELECT question_id FROM issue_reports WHERE issue_id = ?').bind(issueId).all<{ question_id: number }>();
    await db.batch((reportIds.results ?? []).map((row) => db.prepare('INSERT INTO case_updates (question_id, status, message, is_public, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(Number(row.question_id), mappedStatus, residentMessage, publicMessage ? publicFlag : 1, actor, now)));
  }
  await db.prepare('UPDATE questions SET workflow_status = ?, assignee_name = ?, urgency_confirmed = ?, internal_note = ?, first_confirmed_at = COALESCE(first_confirmed_at, ?) WHERE issue_id = ?').bind(mappedStatus, assignedUser.trim().slice(0, 120), urgencyConfirmed.trim().slice(0, 8) || null, internalNote.trim().slice(0, 2000), status === 'new' ? null : now, issueId).run();
  if (status === 'resolved' || status === 'cannot_resolve') await db.prepare('UPDATE questions SET resolved_at = COALESCE(resolved_at, ?) WHERE issue_id = ?').bind(now, issueId).run();
  await db.prepare('INSERT INTO issue_operation_history (issue_id, report_id, operation, actor_user_id, detail, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(issueId, `issue_${status}`, await auditActorId(actorUserId), publicMessage ? `public:${publicFlag}` : 'status only', now).run();
  await writeAuditLog('issue_workflow_updated', actorUserId, null, null, `issue:${issueId} status:${status}`);
  return (await getIssueForAdministrator(issueId, null))!;
}

export async function generateIssueDraft(issueId: number, portalId: number | null = null): Promise<{ draft: string; alternatives: string[]; grounds: string[]; mode: 'local-rules' }> {
  const issue = await getIssueForAdministrator(issueId, portalId); if (!issue) throw new Error('ISSUE_NOT_FOUND');
  const related = await listRelatedFaqs([issue.title, issue.summary, issue.request, issue.category].join(' '), 5, portalId);
  const categoryMap: Record<string, ShelterCategory> = { 水: '水・飲料', 食料: '食料・物資', 医療: '医療・薬', 衛生: 'トイレ・衛生', トイレ: 'トイレ・衛生', ペット: 'ペット', 安全: '安全・その他', '充電・通信': '設備・充電' };
  const category = categoryMap[issue.category] ?? (SHELTER_CATEGORIES.includes(issue.category as ShelterCategory) ? issue.category as ShelterCategory : 'その他');
  const context = { category, location: issue.location, peopleCount: issue.affectedPeople, emotion: issue.emotions[0], missingInformation: issue.missingInformation, urgentReview: issue.urgency === 'critical' };
  const representative = issue.reports[0]?.displayBody || issue.summary;
  const shelterRelated = related.filter((faq) => faq.category === category);
  return { draft: generateShelterReplyDraft(context, representative, shelterRelated), alternatives: generateShelterAlternativeDrafts(context, representative, shelterRelated), grounds: shelterRelated.map((faq) => faq.question), mode: 'local-rules' };
}

export async function approveIssueResponse(issueId: number, body: string, usedAi: boolean, grounds: string[], actorUserId: string, actorDisplayName = '避難所統括-田中'): Promise<FaqCandidate | null> {
  const issue = await getIssueForAdministrator(issueId, null); if (!issue) throw new Error('ISSUE_NOT_FOUND');
  if (issue.status === 'resolved' || issue.status === 'cannot_resolve') throw new Error('ISSUE_ALREADY_RESOLVED');
  const answer = body.trim().slice(0, 4000); if (!answer) throw new Error('ANSWER_REQUIRED');
  await ensureStaffUser(actorUserId, actorDisplayName); const db = await initialise(); const now = Date.now(); const actor = await auditActorId(actorUserId);
  const updated = await db.prepare("UPDATE issues SET response_message = ?, status = 'resolved', resolved_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status NOT IN ('resolved', 'cannot_resolve')").bind(answer, now, now, issueId).run();
  if (Number(updated.meta.changes ?? 0) !== 1) throw new Error('ISSUE_CONFLICT');
  await db.prepare('INSERT INTO issue_responses (issue_id, message, is_public, actor_user_id, created_at) VALUES (?, ?, 1, ?, ?)').bind(issueId, answer, actor, now).run();
  const reportRows = await db.prepare('SELECT question_id FROM issue_reports WHERE issue_id = ?').bind(issueId).all<{ question_id: number }>();
  const reportIds = (reportRows.results ?? []).map((row) => Number(row.question_id));
  const updateStatements = reportIds.flatMap((reportId) => [
    db.prepare("UPDATE questions SET answer_body = ?, answer_used_ai = ?, answer_grounds = ?, status = 'answered', workflow_status = 'resolved', answered_at = ?, resolved_at = COALESCE(resolved_at, ?) WHERE id = ?").bind(answer, usedAi ? 1 : 0, JSON.stringify(grounds.slice(0, 10)), now, now, reportId),
    db.prepare("INSERT INTO case_updates (question_id, status, message, is_public, actor_user_id, created_at) VALUES (?, 'resolved', ?, 1, ?, ?)").bind(reportId, answer, actor, now),
  ]);
  if (updateStatements.length) await db.batch(updateStatements);
  await db.prepare('INSERT INTO issue_operation_history (issue_id, report_id, operation, actor_user_id, detail, created_at) VALUES (?, NULL, \'issue_bulk_response\', ?, ?, ?)').bind(issueId, actor, `reports:${reportIds.length} ai:${usedAi ? 1 : 0}`, now).run();
  await writeAuditLog('issue_bulk_response', actorUserId, null, null, `issue:${issueId} reports:${reportIds.length}`);
  const reportId = issue.representativeReportId;
  if (reportId == null) return null;
  const candidate = generateFaqCandidate(issue.title, answer, issue.category);
  if (!candidate) return null;
  const existing = await db.prepare("SELECT id FROM faq_candidates WHERE question_id = ? AND status = 'pending' LIMIT 1").bind(reportId).first<{ id: number }>();
  if (existing) {
    const row = await db.prepare('SELECT id, question_id, q_text, a_text, category, status, created_at FROM faq_candidates WHERE id = ?').bind(existing.id).first<Record<string, unknown>>();
    if (row) return { id: Number(row.id), questionId: Number(row.question_id), qText: String(row.q_text ?? ''), aText: String(row.a_text ?? ''), category: String(row.category ?? 'その他'), status: String(row.status ?? 'pending'), createdAt: Number(row.created_at ?? now) };
  }
  const inserted = await db.prepare("INSERT INTO faq_candidates (question_id, q_text, a_text, category, portal_id, status, created_at) VALUES (?, ?, ?, ?, NULL, 'pending', ?)").bind(reportId, candidate.q, candidate.a, candidate.category, now).run();
  return { id: Number(inserted.meta.last_row_id), questionId: reportId, qText: candidate.q, aText: candidate.a, category: candidate.category, status: 'pending', createdAt: now };
}

export async function deleteIssues(issueIds: number[], actorUserId: string | null = null): Promise<number> {
  const ids = [...new Set(issueIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100); if (!ids.length) return 0;
  const db = await initialise(); const placeholders = ids.map(() => '?').join(', ');
  const issues = await db.prepare(`SELECT id FROM issues WHERE id IN (${placeholders}) AND portal_id IS NULL`).bind(...ids).all<{ id: number }>();
  const foundIds = (issues.results ?? []).map((row) => Number(row.id)); if (!foundIds.length) return 0;
  const issuePlaceholders = foundIds.map(() => '?').join(', '); const reports = await db.prepare(`SELECT question_id FROM issue_reports WHERE issue_id IN (${issuePlaceholders})`).bind(...foundIds).all<{ question_id: number }>();
  const reportIds = (reports.results ?? []).map((row) => Number(row.question_id));
  const statements = [
    db.prepare(`DELETE FROM issue_merge_candidates WHERE issue_id IN (${issuePlaceholders}) OR candidate_issue_id IN (${issuePlaceholders})`).bind(...foundIds, ...foundIds),
    db.prepare(`DELETE FROM issue_operation_history WHERE issue_id IN (${issuePlaceholders})`).bind(...foundIds),
    db.prepare(`DELETE FROM issue_responses WHERE issue_id IN (${issuePlaceholders})`).bind(...foundIds),
    db.prepare(`DELETE FROM issue_reports WHERE issue_id IN (${issuePlaceholders})`).bind(...foundIds),
  ];
  if (reportIds.length) {
    const reportPlaceholders = reportIds.map(() => '?').join(', ');
    statements.push(db.prepare(`DELETE FROM faq_candidates WHERE question_id IN (${reportPlaceholders})`).bind(...reportIds), db.prepare(`DELETE FROM case_updates WHERE question_id IN (${reportPlaceholders})`).bind(...reportIds), db.prepare(`DELETE FROM question_events WHERE question_id IN (${reportPlaceholders})`).bind(...reportIds), db.prepare(`DELETE FROM questions WHERE id IN (${reportPlaceholders})`).bind(...reportIds));
  }
  statements.push(db.prepare(`DELETE FROM issues WHERE id IN (${issuePlaceholders}) AND portal_id IS NULL`).bind(...foundIds)); await db.batch(statements);
  try { await writeAuditLog('issues_deleted', actorUserId, null, null, `count:${foundIds.length}`); } catch { /* best effort */ }
  return foundIds.length;
}

export async function recordIssueOriginalViewed(issueId: number, actorUserId: string): Promise<void> {
  const db = await initialise(); const issue = await getIssueForAdministrator(issueId, null); if (!issue) throw new Error('ISSUE_NOT_FOUND');
  const actor = await auditActorId(actorUserId); const now = Date.now();
  await db.prepare('INSERT INTO issue_operation_history (issue_id, report_id, operation, actor_user_id, detail, created_at) VALUES (?, NULL, \'original_opened\', ?, ?, ?)').bind(issueId, actor, `reports:${issue.reportCount}`, now).run();
  await db.batch(issue.reports.map((report) => db.prepare('INSERT INTO question_events (question_id, event_type, actor_user_id, detail, created_at) VALUES (?, \'original_opened\', ?, ?, ?)').bind(report.id, actor, `issue:${issueId}`, now)));
}

export async function generateAnswerDraft(questionId: number, portalId?: number | null): Promise<{ draft: string; alternatives: string[]; grounds: string[]; mode: 'local-rules' }> {
  const question = await getQuestionForAdministrator(questionId, portalId);
  if (!question) throw new Error('質問が見つかりません。');
  if (portalId !== undefined && question.portalId !== portalId) throw new Error('この窓口の質問ではありません。');
  const query = [question.title, question.aiSummary, question.bodyOriginal, question.category].filter(Boolean).join(' ');
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
      draft: generateShelterReplyDraft(context, question.bodyOriginal, shelterRelated),
      alternatives: generateShelterAlternativeDrafts(context, question.bodyOriginal, shelterRelated),
      grounds: shelterRelated.map((faq) => faq.question),
      mode: 'local-rules',
    };
  }
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
  const update = db.prepare(`UPDATE questions SET answer_body = ?, answer_used_ai = ?, answer_grounds = ?, status = 'answered', workflow_status = 'resolved', answered_at = ?, resolved_at = COALESCE(resolved_at, ?) WHERE id = ? AND status = 'open'${scope}`);
  const updateResult = portalId === undefined || portalId === null
    ? await update.bind(answer, usedAi ? 1 : 0, JSON.stringify(verifiedGrounds.slice(0, 10)), answeredAt, answeredAt, questionId).run()
    : await update.bind(answer, usedAi ? 1 : 0, JSON.stringify(verifiedGrounds.slice(0, 10)), answeredAt, answeredAt, questionId, portalId).run();
  if (Number(updateResult.meta.changes ?? 0) !== 1) throw new Error('この質問はすでに回答済みです。');
  await db.prepare("INSERT INTO case_updates (question_id, status, message, is_public, actor_user_id, created_at) VALUES (?, 'resolved', ?, 1, ?, ?)").bind(questionId, '確認済みの回答をお届けしました。', await auditActorId(actorUserId), answeredAt).run();
  await recordQuestionEvent(questionId, 'answer_approved', actorUserId, usedAi ? 'ai_draft_reviewed' : 'human_written');
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
  const scope = portalId === null ? ' AND portal_id IS NULL' : portalId === undefined ? '' : ' AND portal_id = ?';
  const statement = db.prepare(`DELETE FROM questions WHERE id = ?${scope}`);
  await db.batch([
    db.prepare('DELETE FROM faq_candidates WHERE question_id = ?').bind(questionId),
    db.prepare('DELETE FROM case_updates WHERE question_id = ?').bind(questionId),
    db.prepare('DELETE FROM question_events WHERE question_id = ?').bind(questionId),
    portalId === undefined || portalId === null ? statement.bind(questionId) : statement.bind(questionId, portalId),
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
