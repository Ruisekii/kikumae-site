import { requirePortalSession, sameOrigin } from '../../../../../../../db/portal-auth';
import { actOnCandidate } from '../../../../../../../db/repository';
import { readRequestText } from '../../../../../../../db/request-guard';

export const runtime = 'edge';
const MAX_BYTES = 8_000;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const { slug, id: rawId } = await params;
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '候補IDが正しくありません。' }, { status: 400 });
  try {
    const data = JSON.parse(await readRequestText(request, MAX_BYTES)) as Record<string, unknown>;
    await actOnCandidate(id, typeof data.action === 'string' ? data.action : '', typeof data.qText === 'string' ? data.qText : '', typeof data.aText === 'string' ? data.aText : '', typeof data.category === 'string' ? data.category : '', portal.id);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: '入力が長すぎます。' }, { status: 413 });
    return Response.json({ message: 'FAQ候補を更新できませんでした。' }, { status: 400 });
  }
}
