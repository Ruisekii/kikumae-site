import { requirePortalSession, sameOrigin } from '../../../../../../db/portal-auth';
import { createFaq, listFaqsForAdministrator } from '../../../../../../db/repository';
import { readRequestText } from '../../../../../../db/request-guard';

export const runtime = 'edge';
const MAX_BYTES = 12_000;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  return Response.json({ faqs: await listFaqsForAdministrator(portal.id) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  try {
    const data = JSON.parse(await readRequestText(request, MAX_BYTES)) as Record<string, unknown>;
    const faq = await createFaq(typeof data.question === 'string' ? data.question : '', typeof data.answer === 'string' ? data.answer : '', typeof data.category === 'string' ? data.category : '', portal.id, `portal:${portal.id}`);
    return Response.json({ faq }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: 'FAQの入力が長すぎます。' }, { status: 413 });
    if (error instanceof Error && error.message === 'FAQ_DUPLICATE') return Response.json({ message: '同じ質問のFAQがすでにあります。既存FAQを編集してください。' }, { status: 409 });
    if (error instanceof Error && error.message === 'FAQ_PII') return Response.json({ message: 'FAQに個人情報やURLは含められません。' }, { status: 400 });
    return Response.json({ message: 'FAQを保存できませんでした。' }, { status: 400 });
  }
}
