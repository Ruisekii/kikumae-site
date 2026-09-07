import { getPortal } from '../../db/portals';
import { listPublishedFaqs } from '../../db/repository';
import { PortalClient } from '../components/portal-client';
import { UserNotFound } from '../components/user-not-found';

export const dynamic = 'force-dynamic';

export default async function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const portal = await getPortal(slug);
  if (!portal) return <UserNotFound />;
  return <PortalClient slug={portal.slug} name={portal.name} description={portal.description} faqs={await listPublishedFaqs(portal.id)} />;
}
