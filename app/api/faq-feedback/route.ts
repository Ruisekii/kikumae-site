import { recordFaqSelfResolved } from '../../../db/repository';
import { allowBurstShared, readRequestText } from '../../../db/request-guard';

export const runtime = 'edge';
const MAX_BYTES = 2_048;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  if (!await allowBurstShared(request, 'faq-feedback', 30, 10 * 60 * 1000)) return Response.json({ message: '操作が多すぎます。少し時間をおいてください。' }, { status: 429 });
  try {
    const data = JSON.parse(await readRequestText(request, MAX_BYTES)) as Record<string, unknown>;
    const faqId = typeof data.faqId === 'number' && Number.isInteger(data.faqId) ? data.faqId : null;
    const query = typeof data.query === 'string' ? data.query : '';
    await recordFaqSelfResolved(faqId, query);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ message: '記録できませんでした。' }, { status: 400 });
  }
}
