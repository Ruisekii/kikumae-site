import { env } from 'cloudflare:workers';

export type Portal = { id: number; name: string; slug: string; description: string; passwordHash: string; createdAt: number };
export type PortalSummary = { id: number; name: string; slug: string; createdAt: number };

function db(): D1Database { if (!env.DB) throw new Error('D1 database binding is unavailable.'); return env.DB; }

async function ensureTable(): Promise<void> {
  await db().prepare("CREATE TABLE IF NOT EXISTS portals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
  await db().prepare("CREATE TABLE IF NOT EXISTS portal_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, portal_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)").run();
}

async function ensureDeleteSchema(): Promise<void> {
  // Portal deletion can be the first administrative operation on a freshly
  // created portal, so do not assume the repository initializer has already
  // created every related table.
  const database = db();
  await database.batch([
    database.prepare("CREATE TABLE IF NOT EXISTS faqs (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', updated_at INTEGER NOT NULL, portal_id INTEGER)"),
    database.prepare("CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, portal_id INTEGER)"),
    database.prepare("CREATE TABLE IF NOT EXISTS faq_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, q_text TEXT NOT NULL, a_text TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, portal_id INTEGER)"),
    database.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id TEXT, action TEXT NOT NULL, question_id INTEGER, portal_id INTEGER, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
    // case_updates と question_events は portal_id 列を持たず question_id 経由でしか
    // 窓口と紐付かない。deletePortal はリポジトリ初期化前に呼ばれ得るため、他の
    // テーブルと同様にここでも存在を保証してから削除対象に含める。
    database.prepare("CREATE TABLE IF NOT EXISTS case_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', is_public INTEGER NOT NULL DEFAULT 1, actor_user_id TEXT, created_at INTEGER NOT NULL)"),
    database.prepare("CREATE TABLE IF NOT EXISTS question_events (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER, event_type TEXT NOT NULL, actor_user_id TEXT, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
  ]);
  for (const statement of [
    'ALTER TABLE faqs ADD COLUMN portal_id INTEGER',
    'ALTER TABLE questions ADD COLUMN portal_id INTEGER',
    'ALTER TABLE faq_candidates ADD COLUMN portal_id INTEGER',
    'ALTER TABLE audit_logs ADD COLUMN portal_id INTEGER',
  ]) {
    try { await database.prepare(statement).run(); } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (!message.includes('duplicate column') && !message.includes('already exists') && !message.includes('no such table')) throw error;
    }
  }
}

function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }

// Prefer the standards-based PBKDF2 password KDF exposed by Web Crypto. Keep
// the existing HMAC format as a compatibility fallback for older Workers
// runtimes; the iteration count is always encoded in the stored value.
const PBKDF2_ITERATIONS = 210_000;
const PORTAL_PASSWORD_ITERATIONS = 20_000;
let pbkdf2Supported: boolean | null = null;

// 窓口が存在しない場合でも、実在する場合と同じ処理コスト（PBKDF2の反復回数）で
// パスワード照合を行うためのダミーハッシュ。値そのものに意味はなく、
// verifyPortalPassword が本物のハッシュと同じ形式・同じ反復回数で処理することだけが目的。
// 反復回数は PBKDF2_ITERATIONS を直接参照するため、定数を変えても自動的に追従する。
export const DUMMY_PASSWORD_HASH = `pbkdf2sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$${'0'.repeat(64)}`;

async function derivePortalPassword(password: string, salt: string, iterations = PORTAL_PASSWORD_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  let value = new TextEncoder().encode(`${salt}:${password}`);
  for (let index = 0; index < iterations; index += 1) value = new Uint8Array(await crypto.subtle.sign('HMAC', key, value));
  return bytesToHex(value);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPortalPassword(password: string, salt = crypto.randomUUID()): Promise<string> {
  try {
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const encodedSalt = bytesToBase64Url(saltBytes);
    const derived = await derivePbkdf2(password, saltBytes, PBKDF2_ITERATIONS);
    pbkdf2Supported = true;
    return `pbkdf2sha256$${PBKDF2_ITERATIONS}$${encodedSalt}$${derived}`;
  } catch {
    pbkdf2Supported = false;
    return `hmac${PORTAL_PASSWORD_ITERATIONS}$${salt}$${await derivePortalPassword(password, salt)}`;
  }
}

export async function verifyPortalPassword(password: string, encoded: string): Promise<boolean> {
  const pbkdf2Match = encoded.match(/^pbkdf2sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([0-9a-f]{64})$/i);
  if (pbkdf2Match) {
    const iterations = Number(pbkdf2Match[1]);
    const salt = pbkdf2Match[2];
    const expected = pbkdf2Match[3];
    if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 500_000) return false;
    try {
      const actual = await derivePbkdf2(password, base64UrlToBytes(salt), iterations);
      pbkdf2Supported = true;
      return constantTimeEqual(actual, expected);
    } catch {
      pbkdf2Supported = false;
      return false;
    }
  }
  const hmacMatch = encoded.match(/^hmac(\d+)\$([^$]+)\$([0-9a-f]{64})$/i);
  if (hmacMatch) {
    const iterations = Number(hmacMatch[1]);
    const salt = hmacMatch[2];
    const expected = hmacMatch[3];
    if (!Number.isSafeInteger(iterations) || iterations < 1_000 || iterations > 100_000) return false;
    const actual = await derivePortalPassword(password, salt, iterations);
    return constantTimeEqual(actual, expected);
  }
  // Legacy SHA-256 hashes are accepted once so existing portals remain usable;
  // newly created portals always use the Workers-compatible HMAC scheme above.
  const [salt, expected] = encoded.split('.', 2);
  if (!salt || !expected) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`));
  return constantTimeEqual(bytesToHex(new Uint8Array(digest)), expected);
}

export function shouldUpgradePortalPassword(encoded: string): boolean {
  if (encoded.startsWith(`pbkdf2sha256$${PBKDF2_ITERATIONS}$`)) return false;
  if (pbkdf2Supported === false && encoded.startsWith(`hmac${PORTAL_PASSWORD_ITERATIONS}$`)) return false;
  return true;
}

export async function upgradePortalPassword(portalId: number, password: string): Promise<void> {
  await ensureTable();
  await db().prepare('UPDATE portals SET password_hash = ? WHERE id = ?').bind(await hashPortalPassword(password), portalId).run();
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function createPortal(name: string, slug: string, description: string, password: string): Promise<Portal> {
  await ensureTable();
  const createdAt = Date.now();
  const passwordHash = await hashPortalPassword(password);
  const result = await db().prepare('INSERT INTO portals (name, slug, description, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(name, slug, description, passwordHash, createdAt).run();
  return { id: Number(result.meta.last_row_id), name, slug, description, passwordHash, createdAt };
}

export async function getPortal(slug: string): Promise<Portal | null> {
  await ensureTable();
  const row = await db().prepare('SELECT id, name, slug, description, password_hash, created_at FROM portals WHERE slug = ? LIMIT 1').bind(slug).first<Record<string, unknown>>();
  return row ? { id: Number(row.id), name: String(row.name), slug: String(row.slug), description: String(row.description ?? ''), passwordHash: String(row.password_hash), createdAt: Number(row.created_at) } : null;
}

/** The Sites owner is the only service operator. Keep this check server-side. */
export function isOperator(userId: string): boolean {
  const configured = env.KIKUMAE_OWNER_USER_ID?.trim().toLowerCase();
  return Boolean(configured && configured === userId.trim().toLowerCase());
}

export async function listPortalsPage(search = '', page = 1, pageSize = 200): Promise<{ portals: PortalSummary[]; hasMore: boolean }> {
  await ensureTable();
  const term = search.trim().slice(0, 80);
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safePageSize = Math.min(Math.max(Math.trunc(pageSize) || 200, 1), 200);
  const offset = (safePage - 1) * safePageSize;
  const result = term
    ? await db().prepare("SELECT id, name, slug, created_at FROM portals WHERE name LIKE ? OR slug LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(`%${term}%`, `%${term}%`, safePageSize + 1, offset).all<Record<string, unknown>>()
    : await db().prepare('SELECT id, name, slug, created_at FROM portals ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(safePageSize + 1, offset).all<Record<string, unknown>>();
  const rows = result.results ?? [];
  return { portals: rows.slice(0, safePageSize).map((row) => ({ id: Number(row.id), name: String(row.name ?? ''), slug: String(row.slug ?? ''), createdAt: Number(row.created_at ?? 0) })), hasMore: rows.length > safePageSize };
}

export async function listPortals(search = ''): Promise<PortalSummary[]> {
  return (await listPortalsPage(search, 1, 200)).portals;
}

/** Delete one portal and every record that is explicitly scoped to it. */
export async function deletePortal(portalId: number): Promise<void> {
  await ensureTable();
  await ensureDeleteSchema();
  // D1 batches execute as one atomic transaction: a failed child statement
  // rolls back the entire portal deletion instead of leaving partial data.
  await db().batch([
    db().prepare('DELETE FROM faq_candidates WHERE portal_id = ? OR question_id IN (SELECT id FROM questions WHERE portal_id = ?)').bind(portalId, portalId),
    db().prepare('DELETE FROM audit_logs WHERE portal_id = ? OR question_id IN (SELECT id FROM questions WHERE portal_id = ?)').bind(portalId, portalId),
    // case_updates（対応メッセージ本文）と question_events（原文閲覧履歴）は
    // portal_id 列を持たないため、この窓口の質問IDを経由して削除する。
    db().prepare('DELETE FROM case_updates WHERE question_id IN (SELECT id FROM questions WHERE portal_id = ?)').bind(portalId),
    db().prepare('DELETE FROM question_events WHERE question_id IN (SELECT id FROM questions WHERE portal_id = ?)').bind(portalId),
    db().prepare('DELETE FROM questions WHERE portal_id = ?').bind(portalId),
    db().prepare('DELETE FROM faqs WHERE portal_id = ?').bind(portalId),
    db().prepare('DELETE FROM portal_sessions WHERE portal_id = ?').bind(portalId),
    db().prepare('DELETE FROM portals WHERE id = ?').bind(portalId),
  ]);
}

async function tokenHash(token: string): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)); return bytesToHex(new Uint8Array(digest)); }

export async function createPortalSession(portal: Portal): Promise<string> {
  await ensureTable(); const token = crypto.randomUUID() + crypto.randomUUID(); const now = Date.now();
  await db().prepare('INSERT INTO portal_sessions (portal_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(portal.id, await tokenHash(token), now + 1000 * 60 * 60 * 12, now).run();
  return token;
}

export async function getPortalBySession(token: string): Promise<Portal | null> {
  await ensureTable(); const row = await db().prepare('SELECT p.id, p.name, p.slug, p.description, p.password_hash, p.created_at FROM portal_sessions s JOIN portals p ON p.id = s.portal_id WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1').bind(await tokenHash(token), Date.now()).first<Record<string, unknown>>();
  return row ? { id: Number(row.id), name: String(row.name), slug: String(row.slug), description: String(row.description ?? ''), passwordHash: String(row.password_hash), createdAt: Number(row.created_at) } : null;
}

export async function revokePortalSession(token: string): Promise<void> {
  if (!token) return;
  await ensureTable();
  await db().prepare('DELETE FROM portal_sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
}
