import { requirePortalSession, sameOrigin } from '../../../../../../../db/portal-auth';
import { deleteFaq, updateFaq } from '../../../../../../../db/repository';
import { readRequestText } from '../../../../../../../db/request-guard';

export const runtime = 'edge';
const MAX_BYTES = 12_000;

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const { slug, id: rawId } = await params;
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: 'FAQ IDが正しくありません。' }, { status: 400 });
  try {
    const data = JSON.parse(await readRequestText(request, MAX_BYTES)) as Record<string, unknown>;
    const faq = await updateFaq(id, typeof data.question === 'string' ? data.question : '', typeof data.answer === 'string' ? data.answer : '', typeof data.category === 'string' ? data.category : '', portal.id, `portal:${portal.id}`);
    return Response.json({ faq }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: 'FAQの入力が長すぎます。' }, { status: 413 });
    if (error instanceof Error && error.message === 'FAQ_NOT_FOUND') return Response.json({ message: 'FAQが見つかりません。' }, { status: 404 });
    if (error instanceof Error && error.message === 'FAQ_DUPLICATE') return Response.json({ message: '同じ質問のFAQがすでにあります。' }, { status: 409 });
    if (error instanceof Error && error.message === 'FAQ_PII') return Response.json({ message: 'FAQに個人情報やURLは含められません。' }, { status: 400 });
    return Response.json({ message: 'FAQを更新できませんでした。' }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const { slug, id: rawId } = await params;
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ message: 'FAQ IDが正しくありません。' }, { status: 400 });
  try {
    await deleteFaq(id, portal.id, `portal:${portal.id}`);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'FAQ_NOT_FOUND') return Response.json({ message: 'FAQが見つかりません。' }, { status: 404 });
    return Response.json({ message: 'FAQを削除できませんでした。' }, { status: 400 });
  }
}
