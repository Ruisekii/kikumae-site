import { getAdminUser } from '../../../../admin-auth';
import { deleteQuestions } from '../../../../../db/repository';
import { readRequestText } from '../../../../../db/request-guard';

export const runtime = 'edge';

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getAdminUser();
  if (!user) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  try {
    const raw = await readRequestText(request, 16 * 1024);
    const body = JSON.parse(raw) as { ids?: unknown };
    if (!Array.isArray(body.ids)) return Response.json({ message: '削除する相談を選択してください。' }, { status: 400 });
    const ids = body.ids.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0).slice(0, 100);
    if (!ids.length) return Response.json({ message: '削除する相談を選択してください。' }, { status: 400 });
    const deleted = await deleteQuestions(ids, null, user.userId);
    return Response.json({ ok: true, deleted }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE' ? '選択件数が多すぎます。' : '相談を削除できませんでした。';
    return Response.json({ message }, { status: 400 });
  }
}
