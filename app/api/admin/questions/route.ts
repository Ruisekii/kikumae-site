import { getChatGPTUser } from '../../../chatgpt-auth';
import { isAdministrator, listQuestionsForAdministrator } from '../../../../db/repository';

export const runtime = 'edge';

export async function GET(): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ message: 'ChatGPTへのログインが必要です。' }, { status: 401 });
  if (!(await isAdministrator(user.userId))) return Response.json({ message: 'このアカウントには管理権限がありません。' }, { status: 403 });
  return Response.json({ questions: await listQuestionsForAdministrator() }, { headers: { 'Cache-Control': 'no-store' } });
}
