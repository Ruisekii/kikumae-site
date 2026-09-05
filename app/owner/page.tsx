import Link from 'next/link';
import { chatGPTSignOutPath, requireChatGPTUser } from '../chatgpt-auth';
import { OwnerDashboard } from '../components/owner-dashboard';
import { isOperator } from '../../db/portals';

export const dynamic = 'force-dynamic';

export default async function OwnerPage() {
  const user = await requireChatGPTUser('/owner');
  if (!isOperator(user.userId)) {
    return <main className="owner-page"><header className="site-header"><Link className="brand" href="/">◌ 避難所の相談窓口</Link><Link href="/">公開ページへ</Link></header><section className="owner-card owner-denied"><p className="eyebrow">運営管理</p><h1>運営者専用ページ</h1><p>このアカウントには運営者権限がありません。</p><Link className="button secondary" href="/">公開ページへ戻る</Link></section></main>;
  }
  return <OwnerDashboard signOutHref={chatGPTSignOutPath('/')} />;
}
