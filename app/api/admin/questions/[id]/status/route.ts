import { getChatGPTUser } from '../../../../../chatgpt-auth';
import { isAdministrator, updateQuestionWorkflow } from '../../../../../../db/repository';
import { readRequestText } from '../../../../../../db/request-guard';

export const runtime = 'edge';
const MAX_BYTES = 8_000;

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
    const data = JSON.parse(await readRequestText(request, MAX_BYTES)) as Record<string, unknown>;
    const status = typeof data.status === 'string' ? data.status : '';
    const message = typeof data.message === 'string' ? data.message : '';
    const assigneeName = typeof data.assigneeName === 'string' ? data.assigneeName : '';
    const urgencyConfirmed = typeof data.urgencyConfirmed === 'string' ? data.urgencyConfirmed : '';
    const internalNote = typeof data.internalNote === 'string' ? data.internalNote : '';
    const isPublic = data.isPublic === true;
    const question = await updateQuestionWorkflow(id, status, message, isPublic, assigneeName, urgencyConfirmed, internalNote, user.userId);
    return Response.json({ question }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error && error.message === 'STATUS_INVALID' ? '状態の指定が正しくありません。' : '相談の状態を更新できませんでした。';
    return Response.json({ message }, { status: 400 });
  }
}
