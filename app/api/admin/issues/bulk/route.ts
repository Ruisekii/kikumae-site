import { getAdminUser } from '../../../../admin-auth';
import { deleteIssues } from '../../../../../db/repository';
import { readRequestText } from '../../../../../db/request-guard';

export const runtime = 'edge';
function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getAdminUser(request); if (!user) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  try {
    const data = JSON.parse(await readRequestText(request, 16_000)) as { ids?: unknown };
    if (!Array.isArray(data.ids)) return Response.json({ message: '削除する課題を選択してください。' }, { status: 400 });
    const ids = data.ids.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0).slice(0, 100);
    const deleted = await deleteIssues(ids, user.userId);
    return Response.json({ ok: true, deleted }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ message: '課題を削除できませんでした。' }, { status: 400 }); }
}
