/** Best-effort per-isolate abuse guard for public mutation endpoints.
 *
 * Durable authorization and data ownership remain in D1.  This small guard
 * only limits burst traffic before expensive parsing/AI work; entries are
 * pruned so a long-lived Worker isolate cannot grow without bound.
 */
type Counter = { startedAt: number; count: number };

const counters = new Map<string, Counter>();
const MAX_COUNTERS = 5_000;

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
