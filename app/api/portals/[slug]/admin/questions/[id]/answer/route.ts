import { requirePortalSession } from '../../../../../../../../db/portal-auth';
import { approveAnswer } from '../../../../../../../../db/repository';

export const runtime = 'edge';
const MAX_BYTES = 12000;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const { slug, id: rawId } = await params;
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '質問IDが正しくありません。' }, { status: 400 });
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return Response.json({ message: '回答が長すぎます。' }, { status: 413 });
    const data = JSON.parse(raw) as Record<string, unknown>;
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    const usedAi = data.usedAi === true;
    const grounds = Array.isArray(data.grounds) ? data.grounds.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
    if (!body) return Response.json({ message: '回答本文を入力してください。' }, { status: 400 });
    const question = await (await import('../../../../../../../../db/repository')).getQuestionForAdministrator(id);
    if (!question || question.portalId !== portal.id) return Response.json({ message: 'この窓口の質問ではありません。' }, { status: 404 });
    return Response.json({ ok: true, candidate: await approveAnswer(id, body, usedAi, grounds) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ message: error instanceof Error ? error.message : '回答を保存できませんでした。' }, { status: 400 }); }
}
