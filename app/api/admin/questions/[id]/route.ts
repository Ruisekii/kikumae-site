import { getAdminUser } from '../../../../admin-auth';
import { deleteQuestion } from '../../../../../db/repository';

export const runtime = 'edge';

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getAdminUser();
  if (!user) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '質問IDが正しくありません。' }, { status: 400 });
  await deleteQuestion(id, null, user.userId);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
