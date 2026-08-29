import { createPortal } from '../../../db/portals';
import { allowBurst, readRequestText } from '../../../db/request-guard';

export const runtime = 'edge';
const RESERVED_PORTAL_SLUGS = new Set(['admin', 'api', 'callback', 'open', 'owner', 'questions', 'signin-with-chatgpt', 'signout-with-chatgpt', 'staff']);
const MAX_REQUEST_BYTES = 8_192;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  if (!allowBurst(request, 'portal-create', 10, 10 * 60 * 1000)) return Response.json({ message: '作成操作が多すぎます。少し時間をおいて再度お試しください。' }, { status: 429, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } });
  try {
    const raw = await readRequestText(request, MAX_REQUEST_BYTES);
    const body = JSON.parse(raw) as { name?: string; slug?: string; description?: string; password?: string; passwordConfirmation?: string };
    const name = String(body.name ?? '').trim(); const slug = String(body.slug ?? '').trim().toLowerCase(); const description = String(body.description ?? '').trim(); const password = String(body.password ?? '');
    if (name.length < 2 || name.length > 80) return Response.json({ message: '窓口名は2〜80文字で入力してください。' }, { status: 400 });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 48) return Response.json({ message: 'URL用の名前は英数字とハイフンで入力してください。' }, { status: 400 });
    if (RESERVED_PORTAL_SLUGS.has(slug)) return Response.json({ message: 'そのURL用の名前はシステムで予約されています。別の名前を入力してください。' }, { status: 400 });
    if (description.length > 300) return Response.json({ message: '説明は300文字以内で入力してください。' }, { status: 400 });
    if (password.length < 10 || password.length > 128) return Response.json({ message: '管理者パスワードは10文字以上で設定してください。' }, { status: 400 });
    if (password !== String(body.passwordConfirmation ?? '')) return Response.json({ message: 'パスワード確認が一致しません。' }, { status: 400 });
    const portal = await createPortal(name, slug, description, password);
    return Response.json({ portal: { name: portal.name, slug: portal.slug, description: portal.description } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: '入力が大きすぎます。' }, { status: 413 });
    console.error('portal creation failed', error instanceof Error ? error.name : 'unknown');
    const message = error instanceof Error && /unique/i.test(error.message) ? 'そのURL用の名前はすでに使われています。' : '窓口を作成できませんでした。';
    return Response.json({ message }, { status: 400 });
  }
}
