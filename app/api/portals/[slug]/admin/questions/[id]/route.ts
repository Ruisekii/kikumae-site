import { requirePortalSession, sameOrigin } from '../../../../../../../db/portal-auth';
import { deleteQuestion } from '../../../../../../../db/repository';

export const runtime = 'edge';

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const { slug, id: rawId } = await params;
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '質問IDが正しくありません。' }, { status: 400 });
  try {
    await deleteQuestion(id, portal.id, `portal:${portal.id}`);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ message: '質問を削除できませんでした。' }, { status: 400 });
  }
}
