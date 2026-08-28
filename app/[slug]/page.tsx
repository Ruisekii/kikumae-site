import Link from 'next/link';
import { getPortal } from '../../db/portals';

export const dynamic = 'force-dynamic';

export default async function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const portal = await getPortal(slug);
  if (!portal) return <main className="public-page"><h1>窓口が見つかりません</h1><Link href="/">トップへ戻る</Link></main>;
  return <main><header className="site-header"><Link className="brand" href="/">🐣 きくまえ</Link><Link href={`/${portal.slug}/admin`}>管理画面</Link></header><section className="portal-hero"><p className="eyebrow">匿名の質問窓口</p><h1>🐣 {portal.name}のきくまえ</h1><p>{portal.description || '気になることは、思ったままの言葉で聞けます。'}</p><div className="hero-actions"><a className="button primary" href="#faq">FAQを探す</a><a className="button accent" href="#ask">質問する</a></div></section><section className="section" id="faq"><h2>よくあるFAQ</h2><p>この窓口のFAQは、回答者が確認・承認した内容から育っていきます。</p><div className="empty">公開FAQは準備中です。気になることは匿名で質問できます。</div></section><section className="ask-section" id="ask"><h2>質問する</h2><p>「急に見学行ってもいい？」のような自然な文章で大丈夫です。</p><Link className="button accent" href={`/?portal=${portal.slug}#ask`}>匿名で質問する</Link></section></main>;
}
