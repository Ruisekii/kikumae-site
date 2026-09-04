import { getChatGPTUser } from '../../../chatgpt-auth';
import { getShelterDashboardStats, isAdministrator, listQuestionsForAdministratorPage } from '../../../../db/repository';

export const runtime = 'edge';

export async function GET(request: Request): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ message: '管理画面はChatGPTアカウントで認証してください。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  if (!(await isAdministrator(user.userId))) return Response.json({ message: 'このアカウントには管理権限がありません。' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
  const result = await listQuestionsForAdministratorPage(null, Number.isFinite(page) ? page : 1);
  return Response.json({ ...result, stats: await getShelterDashboardStats(), page: Math.max(1, Math.trunc(page) || 1) }, { headers: { 'Cache-Control': 'no-store' } });
}
