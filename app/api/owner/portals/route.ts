import { getChatGPTUser } from '../../../chatgpt-auth';
import { isOperator, listPortalsPage } from '../../../../db/portals';

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
  const params = new URL(request.url).searchParams;
  const search = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1');
  const result = await listPortalsPage(search, Number.isFinite(page) ? page : 1);
  return Response.json({ ...result, page: Math.max(1, Math.trunc(page) || 1) }, { headers: { 'Cache-Control': 'no-store' } });
}
