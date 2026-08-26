import { getChatGPTUser } from '../../chatgpt-auth';
import { createQuestion } from '../../../db/repository';

export const runtime = 'edge';

const MAX_REQUEST_BYTES = 1024;
const MAX_QUESTION_CHARS = 500;
const personalDataPattern = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|www\.|(?:0\d{1,4}[-ー－ ]?\d{1,4}[-ー－ ]?\d{3,4})|〒\s?\d{3}[-ー－]?\d{4}|(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県).{0,24}(?:市|区|町|村|丁目|番地|号)|(?:学籍|生徒|社員)番号)/i;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function json(message: string, status: number): Response {
  return Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json('この送信元は許可されていません。', 403);
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BYTES) return json('質問は500文字以内で入力してください。', 413);

  const user = await getChatGPTUser();
  if (!user) return json('質問の送信にはChatGPTへのログインが必要です。', 401);

  let payload: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return json('質問は500文字以内で入力してください。', 413);
    payload = JSON.parse(raw);
  } catch {
    return json('入力形式が正しくありません。', 400);
  }

  const body = typeof (payload as { body?: unknown })?.body === 'string'
    ? (payload as { body: string }).body.trim()
    : '';
  if (!body || body.length > MAX_QUESTION_CHARS) return json('質問は1〜500文字で入力してください。', 400);
  if (personalDataPattern.test(body)) return json('個人情報やURLは保存できません。内容を取り除いてから送信してください。', 400);

  await createQuestion(body);
  return Response.json({ message: '質問を受け付けました。' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
