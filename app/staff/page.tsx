import { StaffDashboard } from '../components/staff-dashboard';
import { requireChatGPTUser } from '../chatgpt-auth';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const user = await requireChatGPTUser('/staff');
  return <StaffDashboard displayName={user.displayName} />;
}
