import { getChatGPTUser } from '../../../../../chatgpt-auth';
import { generateAnswerDraft, isAdministrator } from '../../../../../../db/repository';

export const runtime = 'edge';

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
  try {
    return Response.json(await generateAnswerDraft(id, null), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : '回答案を生成できませんでした。' }, { status: 404 });
  }
}
