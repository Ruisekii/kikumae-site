import { getAdminUser } from '../../../admin-auth';
import { getModelRuntimeStatus, probeModelGateway } from '../../../lib/model-gateway';

export const runtime = 'edge';

export async function GET(request: Request): Promise<Response> {
  if (!await getAdminUser(request)) return Response.json({ message: '管理者用パスワードでログインしてください。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const runtimeStatus = getModelRuntimeStatus();
  const health = await probeModelGateway();
  return Response.json({
    runtime: runtimeStatus,
    health,
    safetyGuard: { enabled: true, lane: 'independent-rules', note: 'LLM出力より先に入力文を判定' },
    fallback: runtimeStatus.mode === 'auto' && health.state !== 'connected',
    checkedAt: Date.now(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
