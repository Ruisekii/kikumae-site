import { getPortal } from '../../../../../../db/portals';
import { listRelatedFaqs } from '../../../../../../db/repository';
import { categorizeQuestion, containsPii, generateLocalSummary } from '../../../../../../db/local-ai';
import { allowBurst, readRequestText } from '../../../../../../db/request-guard';

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
  if (!allowBurst(request, `question-preview:${slug}`, 60, 10 * 60 * 1000)) return Response.json({ message: 'プレビュー操作が多すぎます。少し時間をおいて再度お試しください。' }, { status: 429, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } });
  const portal = await getPortal(slug);
  if (!portal) return Response.json({ message: '窓口が見つかりません。' }, { status: 404 });
  try {
    const raw = await readRequestText(request, MAX_BYTES);
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!body || body.length > MAX_CHARS) return Response.json({ message: '質問は1〜500文字で入力してください。' }, { status: 400 });
    if (containsPii(body)) return Response.json({ message: '個人情報やURLは入力できません。該当箇所を削除してください。' }, { status: 400 });
    return Response.json({ body, summary: generateLocalSummary(body), category: categorizeQuestion(body), related: await listRelatedFaqs(body, 3, portal.id), aiMode: 'local-rules' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: '質問は500文字以内で入力してください。' }, { status: 413 });
    return Response.json({ message: '入力形式が正しくありません。' }, { status: 400 });
  }
}
