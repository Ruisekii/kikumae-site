import { StaffDashboard } from '../components/staff-dashboard';
import { requireChatGPTUser } from '../chatgpt-auth';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await requireChatGPTUser('/admin');
  return <StaffDashboard displayName={user.fullName ?? 'サイトオーナー'} />;
}
