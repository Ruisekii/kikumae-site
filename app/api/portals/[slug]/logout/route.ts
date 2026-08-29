import { portalSessionToken, sameOrigin } from '../../../../../db/portal-auth';
import { revokePortalSession } from '../../../../../db/portals';

export const runtime = 'edge';

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  try { await revokePortalSession(portalSessionToken(request) ?? ''); } catch { /* cookie is cleared even if the backing store is unavailable */ }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': 'kikumae_portal_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
}
