import { getAdminUser } from '../../../../admin-auth';
import { deleteIssues } from '../../../../../db/repository';

export const runtime = 'edge';

function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getAdminUser(request); if (!user) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '課題IDが正しくありません。' }, { status: 400 });
  const deleted = await deleteIssues([id], user.userId);
  return deleted ? Response.json({ ok: true, deleted }, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ message: '課題が見つかりません。' }, { status: 404 });
}
