import { sameOrigin } from '../../../../../db/portal-auth';

export const runtime = 'edge';

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': 'kikumae_portal_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
}
