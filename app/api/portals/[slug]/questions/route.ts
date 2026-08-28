import { getPortal } from '../../../../../db/portals';
import { createQuestion } from '../../../../../db/repository';
import { containsPii } from '../../../../../db/local-ai';

export const runtime = 'edge';
const MAX_BYTES = 4096;
const MAX_CHARS = 500;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const { slug } = await params;
  const portal = await getPortal(slug);
  if (!portal) return Response.json({ message: '窓口が見つかりません。' }, { status: 404 });
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BYTES) return Response.json({ message: '質問は500文字以内で入力してください。' }, { status: 413 });
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return Response.json({ message: '質問は500文字以内で入力してください。' }, { status: 413 });
    const data = JSON.parse(raw) as Record<string, unknown>;
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    const category = typeof data.category === 'string' ? data.category.trim() : '';
    if (!body || body.length > MAX_CHARS) return Response.json({ message: '質問は1〜500文字で入力してください。' }, { status: 400 });
    if (containsPii(body) || (summary && containsPii(summary))) return Response.json({ message: '個人情報やURLは保存できません。内容を取り除いてから送信してください。' }, { status: 400 });
    if (summary.length > 300) return Response.json({ message: '要約は300文字以内で入力してください。' }, { status: 400 });
    const question = await createQuestion(body, summary, category, portal.id);
    return Response.json({ id: question.id, checkUrl: `${new URL(request.url).origin}/questions/${question.checkToken}`, message: '質問を受け付けました。回答者が確認します。' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ message: '質問を保存できませんでした。' }, { status: 400 });
  }
}
