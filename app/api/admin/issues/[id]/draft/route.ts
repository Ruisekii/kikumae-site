import { getAdminUser } from '../../../../../admin-auth';
import { generateIssueDraft } from '../../../../../../db/repository';

export const runtime = 'edge';
function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  if (!await getAdminUser(request)) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '課題IDが正しくありません。' }, { status: 400 });
  try { return Response.json(await generateIssueDraft(id, null), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ message: '返信案を生成できませんでした。' }, { status: 404 }); }
}
