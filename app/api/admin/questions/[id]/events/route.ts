import { getAdminUser } from '../../../../../admin-auth';
import { getQuestionForAdministrator, recordOriginalViewed } from '../../../../../../db/repository';
import { readRequestText } from '../../../../../../db/request-guard';

export const runtime = 'edge';

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getAdminUser();
  if (!user) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  const id = Number((await params).id);
  try {
    const data = JSON.parse(await readRequestText(request, 1_024)) as Record<string, unknown>;
    if (data.event === 'original_opened' && Number.isInteger(id) && id > 0) {
      // ルート窓口（portal_id IS NULL）の質問であることを確認してから記録する。
      // 他窓口の質問IDを指定されても監査ログを書き込めないようにするガード。
      const question = await getQuestionForAdministrator(id, null);
      if (!question) return Response.json({ message: '質問が見つかりません。' }, { status: 404 });
      await recordOriginalViewed(id, user.userId);
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ message: '操作を記録できませんでした。' }, { status: 400 });
  }
}
