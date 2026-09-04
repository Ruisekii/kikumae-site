import { getAdminUser } from '../../../../admin-auth';
import { readRequestText } from '../../../../../db/request-guard';
import { reviewIssueMergeCandidate } from '../../../../../db/repository';

export const runtime = 'edge';
const MAX_BYTES = 4_000;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const user = await getAdminUser(request);
  if (!user) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401 });
  try {
    const data = JSON.parse(await readRequestText(request, MAX_BYTES)) as Record<string, unknown>;
    const candidateId = typeof data.candidateId === 'number' ? data.candidateId : Number(data.candidateId);
    const action = data.action === 'accept' || data.action === 'reject' ? data.action : '';
    if (!Number.isInteger(candidateId) || candidateId <= 0 || !action) return Response.json({ message: '統合候補の指定が正しくありません。' }, { status: 400 });
    const result = await reviewIssueMergeCandidate(candidateId, action, user.userId, user.displayName);
    return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const message = code === 'MERGE_CANDIDATE_NOT_FOUND' ? 'この統合候補はすでに処理されています。' : code === 'MERGE_NOT_ALLOWED' ? '解決済みの課題は統合できません。' : '統合候補を処理できませんでした。';
    return Response.json({ message }, { status: code === 'MERGE_CANDIDATE_NOT_FOUND' ? 409 : 400 });
  }
}
