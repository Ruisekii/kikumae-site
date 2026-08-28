import { createPortalSession, getPortal, verifyPortalPassword } from '../../../../../db/portals';

export const runtime = 'edge';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const origin = request.headers.get('origin'); if (origin && origin !== new URL(request.url).origin) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const { slug } = await params;
  const portal = await getPortal(slug); if (!portal) return Response.json({ message: '窓口が見つかりません。' }, { status: 404 });
  let body: { password?: string };
  try { body = await request.json() as { password?: string }; } catch { return Response.json({ message: '入力形式が正しくありません。' }, { status: 400 }); }
  if (!await verifyPortalPassword(String(body.password ?? ''), portal.passwordHash)) return Response.json({ message: 'パスワードが違います。' }, { status: 401 });
  try {
    const token = await createPortalSession(portal);
    // API routes live under /api, so the session must be sent there as well.
    // Every protected handler re-checks the session against the requested slug.
    return new Response(JSON.stringify({ ok: true, portal: { name: portal.name, slug: portal.slug } }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `kikumae_portal_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200` } });
  } catch {
    return Response.json({ message: 'セッションを作成できませんでした。時間をおいて再度お試しください。' }, { status: 503 });
  }
}
