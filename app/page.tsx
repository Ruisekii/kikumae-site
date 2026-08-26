import { KikumaeClient } from './components/kikumae-client';
import { listPublishedFaqs } from '../db/repository';

export const dynamic = 'force-dynamic';

export default async function Home() {
  return <KikumaeClient faqs={await listPublishedFaqs()} />;
}
