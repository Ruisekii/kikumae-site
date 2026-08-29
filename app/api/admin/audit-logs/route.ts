import { getChatGPTUser } from '../../../chatgpt-auth';
import { isAdministrator, listAuditLogsForAdministrator } from '../../../../db/repository';

export const runtime = 'edge';

export async function GET(): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ message: '管理画面はChatGPTアカウントで認証してください。' }, { status: 401 });
  if (!(await isAdministrator(user.userId))) return Response.json({ message: 'このアカウントには管理権限がありません。' }, { status: 403 });
  return Response.json({ logs: await listAuditLogsForAdministrator(null) }, { headers: { 'Cache-Control': 'no-store' } });
}
