import { requirePortalSession, sameOrigin } from '../../../../../db/portal-auth';
import { deletePortal } from '../../../../../db/portals';

export const runtime = 'edge';
const MAX_BYTES = 4096;

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) return Response.json({ message: '入力が長すぎます。' }, { status: 413 });
  let body: { confirmName?: unknown };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return Response.json({ message: '入力が長すぎます。' }, { status: 413 });
    body = JSON.parse(raw) as { confirmName?: unknown };
  } catch {
    return Response.json({ message: '入力形式が正しくありません。' }, { status: 400 });
  }
  if (typeof body.confirmName !== 'string' || body.confirmName !== portal.name) return Response.json({ message: '窓口名が一致しません。削除を中止しました。' }, { status: 400 });
  try {
    await deletePortal(portal.id);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ message: '窓口を削除できませんでした。時間をおいて再度お試しください。' }, { status: 500 });
  }
}
