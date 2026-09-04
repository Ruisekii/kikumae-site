import { env } from 'cloudflare:workers';

/** Abuse guard for public mutation endpoints.
 *
 * D1 is the shared counter so a burst cannot simply move to another Worker
 * isolate. A small in-memory fallback keeps the endpoint usable during a
 * transient binding failure; it is never used for authorization.
 */
type Counter = { startedAt: number; count: number };

const counters = new Map<string, Counter>();
const MAX_COUNTERS = 5_000;
let rateTableReady: Promise<void> | null = null;

async function ensureRateTable(): Promise<void> {
  if (!env.DB) throw new Error('DB_UNAVAILABLE');
  if (!rateTableReady) {
    rateTableReady = env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      scope TEXT NOT NULL,
      client_key TEXT NOT NULL,
      window_started_at INTEGER NOT NULL,
      count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, client_key)
    )`).run().then(() => env.DB!.prepare('CREATE INDEX IF NOT EXISTS rate_limits_updated_at_idx ON rate_limits (updated_at)').run()).then(() => undefined);
  }
  try {
    await rateTableReady;
  } catch (error) {
    rateTableReady = null;
    throw error;
  }
}

/** Read a body incrementally so chunked requests cannot bypass the size cap. */
export async function readRequestText(request: Request, maxBytes: number): Promise<string> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('REQUEST_BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function clientHint(request: Request): string {
  // Only trust the address asserted by Cloudflare. Forwarded headers are
  // client-controlled on direct/local requests and would let an attacker
  // rotate the limiter key on every request.
  const value = request.headers.get('cf-connecting-ip');
  return (value || 'anonymous').slice(0, 96);
}

export function allowBurst(request: Request, scope: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const key = `${scope}:${clientHint(request)}`;
  const previous = counters.get(key);
  if (!previous || now - previous.startedAt >= windowMs) {
    counters.set(key, { startedAt: now, count: 1 });
    if (counters.size > MAX_COUNTERS) {
      for (const [entryKey, entry] of counters) if (now - entry.startedAt >= windowMs) counters.delete(entryKey);
      while (counters.size > MAX_COUNTERS) counters.delete(counters.keys().next().value as string);
    }
    return true;
  }
  if (previous.count >= limit) return false;
  previous.count += 1;
  return true;
}

/** Raw D1-backed sliding-window counter shared by the per-client and
 * scope-wide (aggregate) checks below. Returns true while `count <= limit`. */
async function incrementAndCheck(scope: string, key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
  const cutoff = now - windowMs;
  const result = await env.DB!.prepare(`
    INSERT INTO rate_limits (scope, client_key, window_started_at, count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(scope, client_key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_started_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
      window_started_at = CASE WHEN rate_limits.window_started_at <= ? THEN excluded.window_started_at ELSE rate_limits.window_started_at END,
      updated_at = excluded.updated_at
    RETURNING count
  `).bind(scope, key, now, now, cutoff, cutoff).first<{ count: number }>();
  return Number(result?.count ?? limit + 1) <= limit;
}

// ログイン系エンドポイントは呼び出し側がスコープに窓口スラッグ／管理者の
// 固定文字列を渡している（'admin-login' / 'portal-login:<slug>'）。それを
// 目印に、IP単位の制限とは別に「窓口・管理者ログイン単位」で合算する制限を
// ここだけで完結させる（ログインAPI側のファイルは変更しない）。同一窓口へ
// 複数IPから分散して試行された場合でも、各IPの枠が独立して残り続けて実質
// 無制限になる問題への対策。正規の職員が複数端末・複数拠点から同時にログイン
// する状況を締め出さないよう、閾値はIP単位より大きく緩めに設定している。
const AGGREGATE_CLIENT_KEY = '__scope_aggregate__';

function loginAggregateLimit(scope: string): { limit: number; windowMs: number } | null {
  if (scope === 'admin-login') return { limit: 30, windowMs: 15 * 60 * 1000 };
  if (scope.startsWith('portal-login:')) return { limit: 50, windowMs: 5 * 60 * 1000 };
  return null;
}

/** Shared, atomic D1-backed burst limiter. */
export async function allowBurstShared(request: Request, scope: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const key = clientHint(request);
  const safeScope = scope.slice(0, 96);
  try {
    await ensureRateTable();
    const perClientOk = await incrementAndCheck(safeScope, key, limit, windowMs, now);
    if (!perClientOk) return false;
    const aggregate = loginAggregateLimit(safeScope);
    if (aggregate) {
      const aggregateOk = await incrementAndCheck(safeScope, AGGREGATE_CLIENT_KEY, aggregate.limit, aggregate.windowMs, now);
      if (!aggregateOk) {
        // IPやパスワードなど機微な値は出さず、どの窓口/管理者ログインが
        // 分散攻撃を受けているかだけを運用側が気づけるように記録する。
        console.warn(`rate-limit: scope-wide login aggregate exceeded for scope=${safeScope}`);
        return false;
      }
    }
    if (Math.random() < 0.02) {
      await env.DB!.prepare('DELETE FROM rate_limits WHERE updated_at < ?').bind(now - 24 * 60 * 60 * 1000).run();
    }
    return true;
  } catch {
    return allowBurst(request, scope, limit, windowMs);
  }
}
