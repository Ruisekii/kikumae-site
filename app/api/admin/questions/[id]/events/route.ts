import { getChatGPTUser } from '../../../../../chatgpt-auth';
import { isAdministrator, recordOriginalViewed } from '../../../../../../db/repository';
import { readRequestText } from '../../../../../../db/request-guard';

export const runtime = 'edge';

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getChatGPTUser();
  if (!user) return Response.json({ message: '管理画面はChatGPTアカウントで認証してください。' }, { status: 401 });
  if (!(await isAdministrator(user.userId))) return Response.json({ message: 'このアカウントには管理権限がありません。' }, { status: 403 });
  const id = Number((await params).id);
  try {
    const data = JSON.parse(await readRequestText(request, 1_024)) as Record<string, unknown>;
    if (data.event === 'original_opened' && Number.isInteger(id) && id > 0) await recordOriginalViewed(id, user.userId);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ message: '操作を記録できませんでした。' }, { status: 400 });
  }
}
