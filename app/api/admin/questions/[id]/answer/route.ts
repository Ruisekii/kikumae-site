import { getChatGPTUser } from '../../../../../chatgpt-auth';
import { approveAnswer, isAdministrator } from '../../../../../../db/repository';

export const runtime = 'edge';
const MAX_BYTES = 12_000;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getChatGPTUser();
  if (!user) return Response.json({ message: '管理画面はChatGPTアカウントで認証してください。' }, { status: 401 });
  if (!(await isAdministrator(user.userId))) return Response.json({ message: 'このアカウントには管理権限がありません。' }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '質問IDが正しくありません。' }, { status: 400 });
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength > MAX_BYTES) return Response.json({ message: '回答が長すぎます。' }, { status: 413 });
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return Response.json({ message: '回答が長すぎます。' }, { status: 413 });
    const data = JSON.parse(raw) as Record<string, unknown>;
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    const usedAi = data.usedAi === true;
    const grounds = Array.isArray(data.grounds) ? data.grounds.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
    if (!body) return Response.json({ message: '回答本文を入力してください。' }, { status: 400 });
    const candidate = await approveAnswer(id, body, usedAi, grounds, null);
    return Response.json({ ok: true, candidate }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : '回答を保存できませんでした。' }, { status: 400 });
  }
}
