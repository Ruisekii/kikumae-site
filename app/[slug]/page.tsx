import Link from 'next/link';
import { getPortal } from '../../db/portals';
import { listPublishedFaqs } from '../../db/repository';
import { PortalClient } from '../components/portal-client';

export const dynamic = 'force-dynamic';

export default async function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const portal = await getPortal(slug);
  if (!portal) return <main className="public-page"><h1>窓口が見つかりません</h1><Link href="/">トップへ戻る</Link></main>;
  return <PortalClient slug={portal.slug} name={portal.name} description={portal.description} faqs={await listPublishedFaqs(portal.id)} />;
}
