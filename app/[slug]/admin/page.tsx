import { PortalStaffDashboard } from '../../components/portal-staff-dashboard';

export const dynamic = 'force-dynamic';

export default function PortalAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  return <PortalStaffDashboard params={params} />;
}
