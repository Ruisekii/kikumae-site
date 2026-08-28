import { getPortal } from '../../../../../db/portals';
import { listPublishedFaqs } from '../../../../../db/repository';

export const runtime = 'edge';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const portal = await getPortal(slug);
  if (!portal) return Response.json({ message: '窓口が見つかりません。' }, { status: 404 });
  return Response.json({ faqs: await listPublishedFaqs(portal.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
