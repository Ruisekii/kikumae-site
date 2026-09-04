import { getPortal } from '../../../../../db/portals';
import { createQuestion } from '../../../../../db/repository';
import { allowBurstShared, readRequestText } from '../../../../../db/request-guard';

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
  if (!await allowBurstShared(request, `question-create:${slug}`, 30, 10 * 60 * 1000)) return Response.json({ message: '送信が多すぎます。少し時間をおいて再度お試しください。' }, { status: 429, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } });
  const portal = await getPortal(slug);
  if (!portal) return Response.json({ message: '窓口が見つかりません。' }, { status: 404 });
  try {
    const raw = await readRequestText(request, MAX_BYTES);
    const data = JSON.parse(raw) as Record<string, unknown>;
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    const category = typeof data.category === 'string' ? data.category.trim() : '';
    const submissionKey = typeof data.submissionKey === 'string' ? data.submissionKey.trim().slice(0, 128) : '';
    if (!body || body.length > MAX_CHARS) return Response.json({ message: '質問は1〜500文字で入力してください。' }, { status: 400 });
    if (summary.length > 300) return Response.json({ message: '要約は300文字以内で入力してください。' }, { status: 400 });
    // 個人情報やURLを含んでいても受付は拒否しない。原文はそのまま保存し、
    // 職員向けの表示は createQuestion 内で伏字化される。
    try {
      const question = await createQuestion(body, summary, category, portal.id, submissionKey);
      return Response.json({
        id: question.id,
        checkUrl: `${new URL(request.url).origin}/questions/${question.checkToken}`,
        message: question.piiDetected
          ? '質問を受け付けました。個人情報を含む可能性がある内容が見つかったため、職員の画面では該当箇所を伏字にして表示します。'
          : '質問を受け付けました。管理者が確認します。',
        piiDetected: question.piiDetected,
        piiTypes: question.piiTypes,
      }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof Error && error.message === 'QUESTION_DUPLICATE') return Response.json({ message: 'この質問はすでに受け付けています。回答の確認URLをご確認ください。' }, { status: 409 });
      return Response.json({ message: '質問を保存できませんでした。' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: '質問は500文字以内で入力してください。' }, { status: 413 });
    return Response.json({ message: '質問を保存できませんでした。' }, { status: 400 });
  }
}
