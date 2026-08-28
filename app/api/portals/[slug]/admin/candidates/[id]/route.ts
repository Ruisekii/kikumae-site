import { requirePortalSession } from '../../../../../../../db/portal-auth';
import { actOnCandidate } from '../../../../../../../db/repository';

export const runtime = 'edge';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const { slug, id: rawId } = await params;
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '候補IDが正しくありません。' }, { status: 400 });
  try {
    const data = await request.json() as Record<string, unknown>;
    await actOnCandidate(id, typeof data.action === 'string' ? data.action : '', typeof data.qText === 'string' ? data.qText : '', typeof data.aText === 'string' ? data.aText : '', typeof data.category === 'string' ? data.category : '', portal.id);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ message: error instanceof Error ? error.message : 'FAQ候補を更新できませんでした。' }, { status: 400 }); }
}
