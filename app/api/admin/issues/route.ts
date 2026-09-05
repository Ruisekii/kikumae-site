import { getAdminUser } from '../../../admin-auth';
import { getShelterDashboardStats, listIssuesForAdministratorPage } from '../../../../db/repository';

export const runtime = 'edge';

export async function GET(request: Request): Promise<Response> {
  if (!await getAdminUser(request)) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const params = new URL(request.url).searchParams;
  const page = Number(params.get('page') ?? '1');
  const search = params.get('search') ?? '';
  const result = await listIssuesForAdministratorPage(null, Number.isFinite(page) ? page : 1, 100, search);
  return Response.json({ ...result, stats: await getShelterDashboardStats(), page: Math.max(1, Math.trunc(page) || 1) }, { headers: { 'Cache-Control': 'no-store' } });
}
