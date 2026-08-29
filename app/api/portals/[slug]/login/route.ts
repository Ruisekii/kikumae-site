import { createPortalSession, getPortal, shouldUpgradePortalPassword, upgradePortalPassword, verifyPortalPassword } from '../../../../../db/portals';
import { allowBurst } from '../../../../../db/request-guard';

export const runtime = 'edge';
const MAX_REQUEST_BYTES = 4_096;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const origin = request.headers.get('origin'); if (origin && origin !== new URL(request.url).origin) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const { slug } = await params;
  if (!allowBurst(request, `portal-login:${slug}`, 10, 5 * 60 * 1000)) return Response.json({ message: 'ログイン試行が多すぎます。5分ほど待ってから再度お試しください。' }, { status: 429, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' } });
  const portal = await getPortal(slug); if (!portal) return Response.json({ message: '窓口が見つかりません。' }, { status: 404 });
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BYTES) return Response.json({ message: '入力が大きすぎます。' }, { status: 413 });
  let body: { password?: string };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return Response.json({ message: '入力が大きすぎます。' }, { status: 413 });
    body = JSON.parse(raw) as { password?: string };
  } catch { return Response.json({ message: '入力形式が正しくありません。' }, { status: 400 }); }
  const password = String(body.password ?? '');
  if (password.length > 128 || !await verifyPortalPassword(password, portal.passwordHash)) return Response.json({ message: 'パスワードが違います。' }, { status: 401 });
  if (shouldUpgradePortalPassword(portal.passwordHash)) {
    // Do not fail a valid login if a best-effort hash upgrade is unavailable;
    // the rate limit still protects this endpoint and the next login retries.
    try { await upgradePortalPassword(portal.id, password); } catch { /* retry on a later login */ }
  }
  try {
    const token = await createPortalSession(portal);
    // API routes live under /api, so the session must be sent there as well.
    // Every protected handler re-checks the session against the requested slug.
    return new Response(JSON.stringify({ ok: true, portal: { name: portal.name, slug: portal.slug } }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `kikumae_portal_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200` } });
  } catch {
    return Response.json({ message: 'セッションを作成できませんでした。時間をおいて再度お試しください。' }, { status: 503 });
  }
}
