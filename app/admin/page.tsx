import { StaffDashboard } from '../components/staff-dashboard';
import { AdminLogin } from '../components/admin-login';
import { createAdminApiToken, getAdminSession } from '../admin-auth';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) return <AdminLogin />;
  return <StaffDashboard displayName={session.displayName} authorized adminApiToken={await createAdminApiToken()} signOutHref="/admin/logout" />;
}
