import { getAdminUser } from '../../../admin-auth';
import { getShelterDashboardStats, listQuestionsForAdministratorPage } from '../../../../db/repository';

export const runtime = 'edge';

export async function GET(request: Request): Promise<Response> {
  if (!await getAdminUser()) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
  const result = await listQuestionsForAdministratorPage(null, Number.isFinite(page) ? page : 1);
  return Response.json({ ...result, stats: await getShelterDashboardStats(), page: Math.max(1, Math.trunc(page) || 1) }, { headers: { 'Cache-Control': 'no-store' } });
}
