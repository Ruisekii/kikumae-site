import { createAdminSessionCookie, verifyAdminPassword } from '../../../admin-auth';
import { allowBurstShared, readRequestText } from '../../../../db/request-guard';

export const runtime = 'edge';
const MAX_BYTES = 2_048;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  if (!await allowBurstShared(request, 'admin-login', 10, 15 * 60 * 1000)) return Response.json({ message: '試行回数が多すぎます。少し時間をおいてください。' }, { status: 429, headers: { 'Retry-After': '900' } });
  try {
    const data = JSON.parse(await readRequestText(request, MAX_BYTES)) as Record<string, unknown>;
    const password = typeof data.password === 'string' ? data.password : '';
    if (!await verifyAdminPassword(password)) return Response.json({ message: 'パスワードが違います。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': await createAdminSessionCookie(), 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: '入力が長すぎます。' }, { status: 413 });
    return Response.json({ message: '入力形式が正しくありません。' }, { status: 400 });
  }
}
