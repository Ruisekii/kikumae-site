import { env } from 'cloudflare:workers';

export type Portal = { id: number; name: string; slug: string; description: string; passwordHash: string; createdAt: number };
export type PortalSummary = { id: number; name: string; slug: string; createdAt: number };

function db(): D1Database { if (!env.DB) throw new Error('D1 database binding is unavailable.'); return env.DB; }

async function ensureTable(): Promise<void> {
  await db().prepare("CREATE TABLE IF NOT EXISTS portals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
  await db().prepare("CREATE TABLE IF NOT EXISTS portal_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, portal_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)").run();
}

function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }

// PBKDF2 is not available in the Workers Web Crypto runtime. HMAC-SHA-256
// is supported, so use a salted, deliberately expensive derivation with a
// random salt.  The iteration count is encoded in the stored value so older
// hmac1000 hashes can be upgraded after the next successful login.
const PORTAL_PASSWORD_ITERATIONS = 20_000;

async function derivePortalPassword(password: string, salt: string, iterations = PORTAL_PASSWORD_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  let value = new TextEncoder().encode(`${salt}:${password}`);
  for (let index = 0; index < iterations; index += 1) value = new Uint8Array(await crypto.subtle.sign('HMAC', key, value));
  return bytesToHex(value);
}

export async function hashPortalPassword(password: string, salt = crypto.randomUUID()): Promise<string> {
  return `hmac${PORTAL_PASSWORD_ITERATIONS}$${salt}$${await derivePortalPassword(password, salt)}`;
}

export async function verifyPortalPassword(password: string, encoded: string): Promise<boolean> {
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
  return !encoded.startsWith(`hmac${PORTAL_PASSWORD_ITERATIONS}$`);
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

export async function listPortals(search = ''): Promise<PortalSummary[]> {
  await ensureTable();
  const term = search.trim().slice(0, 80);
  const result = term
    ? await db().prepare("SELECT id, name, slug, created_at FROM portals WHERE name LIKE ? OR slug LIKE ? ORDER BY created_at DESC LIMIT 200").bind(`%${term}%`, `%${term}%`).all<Record<string, unknown>>()
    : await db().prepare('SELECT id, name, slug, created_at FROM portals ORDER BY created_at DESC LIMIT 200').all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => ({ id: Number(row.id), name: String(row.name ?? ''), slug: String(row.slug ?? ''), createdAt: Number(row.created_at ?? 0) }));
}

/** Delete one portal and every record that is explicitly scoped to it. */
export async function deletePortal(portalId: number): Promise<void> {
  await ensureTable();
  // D1 batches execute as one atomic transaction: a failed child statement
  // rolls back the entire portal deletion instead of leaving partial data.
  await db().batch([
    db().prepare('DELETE FROM faq_candidates WHERE portal_id = ? OR question_id IN (SELECT id FROM questions WHERE portal_id = ?)').bind(portalId, portalId),
    db().prepare('DELETE FROM audit_logs WHERE question_id IN (SELECT id FROM questions WHERE portal_id = ?)').bind(portalId),
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
