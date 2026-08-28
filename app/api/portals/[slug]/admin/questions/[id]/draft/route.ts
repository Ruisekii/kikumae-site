import { requirePortalSession } from '../../../../../../../../db/portal-auth';
import { generateAnswerDraft } from '../../../../../../../../db/repository';

export const runtime = 'edge';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const { slug, id: rawId } = await params;
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '質問IDが正しくありません。' }, { status: 400 });
  try { return Response.json(await generateAnswerDraft(id, portal.id), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ message: error instanceof Error ? error.message : '回答案を生成できませんでした。' }, { status: 400 }); }
}
