import { getAdminUser } from '../../../../admin-auth';
import { actOnCandidate } from '../../../../../db/repository';
import { readRequestText } from '../../../../../db/request-guard';

export const runtime = 'edge';
const MAX_BYTES = 8_000;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getAdminUser();
  if (!user) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  const id = Number((await params).id);
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '候補IDが正しくありません。' }, { status: 400 });
  if (!Number.isFinite(contentLength) || contentLength > MAX_BYTES) return Response.json({ message: '入力が長すぎます。' }, { status: 413 });
  try {
    const raw = await readRequestText(request, MAX_BYTES);
    const data = JSON.parse(raw) as Record<string, unknown>;
    const action = typeof data.action === 'string' ? data.action : '';
    const qText = typeof data.qText === 'string' ? data.qText : '';
    const aText = typeof data.aText === 'string' ? data.aText : '';
    const category = typeof data.category === 'string' ? data.category : '';
    await actOnCandidate(id, action, qText, aText, category, null, user.userId);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: '入力が長すぎます。' }, { status: 413 });
    return Response.json({ message: 'FAQ候補を更新できませんでした。' }, { status: 400 });
  }
}
