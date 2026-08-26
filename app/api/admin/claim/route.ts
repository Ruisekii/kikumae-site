import { getChatGPTUser } from '../../../chatgpt-auth';
import { claimAdministrator } from '../../../../db/repository';

export const runtime = 'edge';

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getChatGPTUser();
  if (!user) return Response.json({ message: 'ChatGPTへのログインが必要です。' }, { status: 401 });

  const isAdmin = await claimAdministrator(user.userId);
  if (!isAdmin) return Response.json({ message: 'このアカウントには管理権限がありません。' }, { status: 403 });
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
