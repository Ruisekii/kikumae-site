import { requirePortalSession, sameOrigin } from '../../../../../../db/portal-auth';
import { listQuestionsForAdministrator } from '../../../../../../db/repository';

export const runtime = 'edge';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  const portal = await requirePortalSession(request, slug);
  if (!portal) return Response.json({ message: '管理者パスワードでログインしてください。' }, { status: 401 });
  return Response.json({ questions: await listQuestionsForAdministrator(portal.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
