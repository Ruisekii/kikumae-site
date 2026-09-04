import { getAdminUser } from '../../../admin-auth';
import { listAuditLogsForAdministrator } from '../../../../db/repository';

export const runtime = 'edge';

export async function GET(): Promise<Response> {
  if (!await getAdminUser()) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  return Response.json({ logs: await listAuditLogsForAdministrator(null) }, { headers: { 'Cache-Control': 'no-store' } });
}
