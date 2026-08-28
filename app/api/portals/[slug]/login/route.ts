import { createPortalSession, getPortal, verifyPortalPassword } from '../../../../../db/portals';

export const runtime = 'edge';

export async function POST(request: Request, { params }: { params: { slug: string } }): Promise<Response> {
  const origin = request.headers.get('origin'); if (origin && origin !== new URL(request.url).origin) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const portal = await getPortal(params.slug); if (!portal) return Response.json({ message: '窓口が見つかりません。' }, { status: 404 });
  const body = await request.json() as { password?: string };
  if (!await verifyPortalPassword(String(body.password ?? ''), portal.passwordHash)) return Response.json({ message: 'パスワードが違います。' }, { status: 401 });
  const token = await createPortalSession(portal);
  return new Response(JSON.stringify({ ok: true, portal: { name: portal.name, slug: portal.slug } }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `kikumae_portal_session=${token}; Path=/${portal.slug}; HttpOnly; Secure; SameSite=Lax; Max-Age=43200` } });
}
