/** Best-effort per-isolate abuse guard for public mutation endpoints.
 *
 * Durable authorization and data ownership remain in D1.  This small guard
 * only limits burst traffic before expensive parsing/AI work; entries are
 * pruned so a long-lived Worker isolate cannot grow without bound.
 */
type Counter = { startedAt: number; count: number };

const counters = new Map<string, Counter>();
const MAX_COUNTERS = 5_000;

function clientHint(request: Request): string {
  const value = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
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

