import { getAdminUser } from '../../../admin-auth';

export const runtime = 'edge';

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  if (!await getAdminUser()) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
