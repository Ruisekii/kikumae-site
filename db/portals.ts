import { env } from 'cloudflare:workers';

export type Portal = { id: number; name: string; slug: string; description: string; passwordHash: string; createdAt: number };

function db(): D1Database { if (!env.DB) throw new Error('D1 database binding is unavailable.'); return env.DB; }

async function ensureTable(): Promise<void> {
  await db().prepare("CREATE TABLE IF NOT EXISTS portals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
}

function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }

export async function hashPortalPassword(password: string, salt = crypto.randomUUID()): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`));
  return `${salt}.${bytesToHex(new Uint8Array(digest))}`;
}

export async function verifyPortalPassword(password: string, encoded: string): Promise<boolean> {
  const [salt] = encoded.split('.', 1);
  if (!salt) return false;
  return (await hashPortalPassword(password, salt)).split('.')[1] === encoded.split('.')[1];
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
