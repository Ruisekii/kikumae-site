import { getChatGPTUser } from '../../../chatgpt-auth';
import { isOperator, listPortals } from '../../../../db/portals';

export const runtime = 'edge';

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getChatGPTUser();
  if (!user) return Response.json({ message: 'ChatGPTへのログインが必要です。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  if (!isOperator(user.userId)) return Response.json({ message: '運営者権限がありません。' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  const search = new URL(request.url).searchParams.get('q') ?? '';
  return Response.json({ portals: await listPortals(search) }, { headers: { 'Cache-Control': 'no-store' } });
}
