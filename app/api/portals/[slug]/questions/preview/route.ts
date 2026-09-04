import { getPortal } from '../../../../../../db/portals';
import { listRelatedFaqs } from '../../../../../../db/repository';
import { categorizeQuestion, detectPiiTypes, maskPii, generateLocalSummary } from '../../../../../../db/local-ai';
import { allowBurstShared, readRequestText } from '../../../../../../db/request-guard';

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
  if (!await allowBurstShared(request, `question-preview:${slug}`, 60, 10 * 60 * 1000)) return Response.json({ message: 'プレビュー操作が多すぎます。少し時間をおいて再度お試しください。' }, { status: 429, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } });
  const portal = await getPortal(slug);
  if (!portal) return Response.json({ message: '窓口が見つかりません。' }, { status: 404 });
  try {
    const raw = await readRequestText(request, MAX_BYTES);
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!body || body.length > MAX_CHARS) return Response.json({ message: '質問は1〜500文字で入力してください。' }, { status: 400 });
    // 個人情報やURLを検出してもプレビューは拒否しない。要約・分類などの
    // 派生テキストは伏字化したテキストから生成する。
    const piiTypes = detectPiiTypes(body);
    const piiDetected = piiTypes.length > 0;
    const maskedBody = piiDetected ? maskPii(body) : body;
    return Response.json({ body, bodyMasked: maskedBody, piiDetected, piiTypes, summary: generateLocalSummary(maskedBody), category: categorizeQuestion(maskedBody), related: await listRelatedFaqs(maskedBody, 3, portal.id), aiMode: 'local-rules' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: '質問は500文字以内で入力してください。' }, { status: 413 });
    return Response.json({ message: '入力形式が正しくありません。' }, { status: 400 });
  }
}
