import { getQuestionByCheckToken } from '../../../../../db/repository';

export const runtime = 'edge';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const question = await getQuestionByCheckToken(token);
  if (!question) return Response.json({ message: '確認用URLが正しくありません。' }, { status: 404 });
  return Response.json({ id: question.id, title: question.title, status: question.status, workflowStatus: question.workflowStatus, answer: question.answerBody, answeredAt: question.answeredAt, updatedAt: question.updates.at(-1)?.createdAt ?? question.createdAt }, { headers: { 'Cache-Control': 'no-store' } });
}
