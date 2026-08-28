import Link from 'next/link';
import { getPortal } from '../../../db/portals';

export const dynamic = 'force-dynamic';

export default async function PortalAdminPage({ params }: { params: { slug: string } }) {
  const portal = await getPortal(params.slug);
  if (!portal) return <main className="public-page"><h1>窓口が見つかりません</h1><Link href="/">トップへ戻る</Link></main>;
  return <main className="staff-page"><header className="site-header"><Link className="brand" href="/">🐣 きくまえ</Link><Link href={`/${portal.slug}`}>公開ページへ</Link></header><section className="portal-admin-login"><p className="eyebrow">回答者・管理者用</p><h1>{portal.name}<br />管理画面</h1><p>窓口作成時に設定した管理者パスワードでログインします。</p><form><label>管理者パスワード<input type="password" autoComplete="current-password" /></label><button className="button accent" type="button" disabled>ログイン機能を準備中</button><p className="input-hint">このMVPでは既存の回答者画面から質問対応を行えます。</p></form></section></main>;
}
