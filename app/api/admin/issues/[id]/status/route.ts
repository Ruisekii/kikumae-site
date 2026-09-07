import { getAdminUser } from '../../../../../admin-auth';
import { updateIssueWorkflow } from '../../../../../../db/repository';
import { readRequestText } from '../../../../../../db/request-guard';

export const runtime = 'edge';
const MAX_BYTES = 10_000;
function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getAdminUser(request); if (!user) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return Response.json({ message: '課題IDが正しくありません。' }, { status: 400 });
  try {
    const data = JSON.parse(await readRequestText(request, MAX_BYTES)) as Record<string, unknown>;
    const issue = await updateIssueWorkflow(id, typeof data.status === 'string' ? data.status : '', typeof data.message === 'string' ? data.message : '', data.isPublic === true, typeof data.assignedTeam === 'string' ? data.assignedTeam : '', typeof data.assignedUser === 'string' ? data.assignedUser : '', typeof data.urgencyConfirmed === 'string' ? data.urgencyConfirmed : '', typeof data.internalNote === 'string' ? data.internalNote : '', typeof data.expectedVersion === 'number' ? data.expectedVersion : null, user.userId, user.displayName);
    return Response.json({ issue }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const message = code === 'ISSUE_STATUS_INVALID' ? '状態の指定が正しくありません。' : code === 'ISSUE_URGENCY_INVALID' ? '優先度の指定が正しくありません。' : code === 'ISSUE_CONFLICT' ? '別の職員が先に更新しました。最新状態を読み込みました。' : '課題の状態を更新できませんでした。';
    return Response.json({ message }, { status: code === 'ISSUE_CONFLICT' ? 409 : 400 });
  }
}
