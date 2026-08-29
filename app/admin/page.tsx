import { StaffDashboard } from '../components/staff-dashboard';
import { requireChatGPTUser } from '../chatgpt-auth';
import { claimAdministrator } from '../../db/repository';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await requireChatGPTUser('/admin');
  const allowed = await claimAdministrator(user.userId);
  if (!allowed) return <main className="staff-page"><header className="site-header"><a className="brand" href="/">🐣 きくまえ</a><a href="/">公開ページへ</a></header><section className="owner-card owner-denied"><p className="eyebrow">管理者用</p><h1>管理権限がありません</h1><p>このアカウントでは管理画面を利用できません。</p><a className="button secondary" href="/">公開ページへ戻る</a></section></main>;
  return <StaffDashboard displayName={user.fullName ?? 'サイトオーナー'} authorized />;
}
