import { getAdminUser } from '../../../../../admin-auth';
import { approveIssueResponse } from '../../../../../../db/repository';
import { readRequestText } from '../../../../../../db/request-guard';

export const runtime = 'edge';
function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getAdminUser(request); if (!user) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '課題IDが正しくありません。' }, { status: 400 });
  try {
    const data = JSON.parse(await readRequestText(request, 14_000)) as Record<string, unknown>;
    const body = typeof data.body === 'string' ? data.body : ''; const usedAi = data.usedAi === true;
    const grounds = Array.isArray(data.grounds) ? data.grounds.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
    const candidate = await approveIssueResponse(id, body, usedAi, grounds, user.userId, user.displayName);
    return Response.json({ ok: true, candidate }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const message = code === 'ANSWER_REQUIRED' ? '返信本文を入力してください。' : code === 'ISSUE_ALREADY_RESOLVED' ? 'この課題はすでに解決済みです。' : '一括返信を保存できませんでした。';
    return Response.json({ message }, { status: 400 });
  }
}
