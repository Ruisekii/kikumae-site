import Link from 'next/link';
import { getAdminSession } from '../admin-auth';
import { OpenPortalForm } from './open-portal-form';

export const dynamic = 'force-dynamic';

export default async function OpenPortalPage() {
  const session = await getAdminSession();
  if (!session) {
    return <main className="evac-theme portal-create-page">
      <header className="site-header"><Link className="brand" href="/" aria-label="トップへ戻る"><span className="brand-mark" aria-hidden="true">相</span>相談窓口</Link><Link href="/">相談ページへ戻る</Link></header>
      <section className="portal-create-card">
        <p className="eyebrow">避難所の登録</p>
        <h1>先に管理者としてログインしてください</h1>
        <p>避難所の登録は、なりすましを防ぐため管理者用パスワードでログインした職員だけが行えます。</p>
        <div className="form-actions"><Link className="button accent" href="/admin">管理者ページでログインする</Link></div>
        <p className="input-hint">ログインすると、このページに避難所の登録フォームが表示されます。</p>
      </section>
    </main>;
  }
  return <OpenPortalForm />;
}
