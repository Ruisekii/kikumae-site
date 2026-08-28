import { createQuestion } from '../../../db/repository';
import { containsPii } from '../../../db/local-ai';

export const runtime = 'edge';

const MAX_REQUEST_BYTES = 4096;
const MAX_QUESTION_CHARS = 500;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function json(message: string, status: number): Response {
  return Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json('この送信元は許可されていません。', 403);
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BYTES) return json('質問は500文字以内で入力してください。', 413);

  let payload: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return json('質問は500文字以内で入力してください。', 413);
    payload = JSON.parse(raw);
  } catch {
    return json('入力形式が正しくありません。', 400);
  }

  const data = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
  const category = typeof data.category === 'string' ? data.category.trim() : '';
  if (!body || body.length > MAX_QUESTION_CHARS) return json('質問は1〜500文字で入力してください。', 400);
  if (containsPii(body)) return json('個人情報やURLは保存できません。内容を取り除いてから送信してください。', 400);
  if (summary.length > 300) return json('要約は300文字以内で入力してください。', 400);
  if (summary && containsPii(summary)) return json('要約にも個人情報やURLは含められません。', 400);

  const question = await createQuestion(body, summary, category);
  return Response.json({ id: question.id, checkUrl: `${new URL(request.url).origin}/questions/${question.checkToken}`, message: '質問を受け付けました。回答者が確認します。' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
