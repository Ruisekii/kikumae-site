import { getChatGPTUser } from '../../../chatgpt-auth';
import { isAdministrator, listQuestionsForAdministrator } from '../../../../db/repository';

export const runtime = 'edge';

export async function GET(): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ message: '回答者画面はChatGPTアカウントで認証してください。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  if (!(await isAdministrator(user.userId))) return Response.json({ message: 'このアカウントには回答者権限がありません。' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ questions: await listQuestionsForAdministrator() }, { headers: { 'Cache-Control': 'no-store' } });
}
