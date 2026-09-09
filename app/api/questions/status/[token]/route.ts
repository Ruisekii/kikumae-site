import { getQuestionByCheckToken, updateQuestionFromPublicToken, type ConversationMessageInput } from '../../../../../db/repository';
import type { ShelterIntake } from '../../../../../db/local-ai';
import { allowBurstShared, readRequestText } from '../../../../../db/request-guard';

export const runtime = 'edge';

const MAX_REQUEST_BYTES = 16000;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function conversationMessages(value: unknown): ConversationMessageInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-24).flatMap((item): ConversationMessageInput[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    if ((source.role !== 'user' && source.role !== 'assistant') || typeof source.originalText !== 'string') return [];
    const originalText = source.originalText.trim().slice(0, 500);
    return originalText ? [{ role: source.role, originalText, originalLanguage: typeof source.originalLanguage === 'string' ? source.originalLanguage.slice(0, 12) : undefined, messageId: typeof source.messageId === 'string' ? source.messageId.slice(0, 120) : undefined, createdAt: typeof source.createdAt === 'number' ? source.createdAt : undefined }] : [];
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const question = await getQuestionByCheckToken(token);
  if (!question) return Response.json({ message: '確認用URLが正しくありません。' }, { status: 404 });
  return Response.json({
    id: question.id,
    title: question.title,
    status: question.status,
    workflowStatus: question.workflowStatus,
    answer: question.answerBody,
    answeredAt: question.answeredAt,
    updatedAt: question.updates.at(-1)?.createdAt ?? question.createdAt,
    assigneeName: question.assigneeName,
    firstConfirmedAt: question.firstConfirmedAt,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  if (!sameOrigin(request)) return Response.json({ message: 'この送信元は許可されていません。' }, { status: 403 });
  if (!await allowBurstShared(request, `question-intake-update:${token.slice(0, 12)}`, 20, 10 * 60 * 1000)) return Response.json({ message: '追加情報の送信が多すぎます。少し時間をおいてください。' }, { status: 429 });
  try {
    const payload = JSON.parse(await readRequestText(request, MAX_REQUEST_BYTES)) as Record<string, unknown>;
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    const rawIntake = payload.intake && typeof payload.intake === 'object' ? payload.intake as Record<string, unknown> : {};
    const transcript = conversationMessages(payload.conversation);
    const selectedLanguage = typeof payload.selectedLanguage === 'string' ? payload.selectedLanguage.trim().slice(0, 12) : '';
    const intake: ShelterIntake = {
      location: typeof rawIntake.location === 'string' ? rawIntake.location : '',
      issueLocation: typeof rawIntake.issueLocation === 'string' ? rawIntake.issueLocation : '',
      peopleCount: typeof rawIntake.peopleCount === 'string' ? rawIntake.peopleCount : '',
      resourceRemaining: typeof rawIntake.resourceRemaining === 'string' ? rawIntake.resourceRemaining : '',
      lastReceivedAt: typeof rawIntake.lastReceivedAt === 'string' ? rawIntake.lastReceivedAt : '',
      additionalDetails: typeof rawIntake.additionalDetails === 'string' ? rawIntake.additionalDetails : '',
    };
    if (!body || body.length > 500) return Response.json({ message: '追加情報を確認できませんでした。' }, { status: 400 });
    const updated = await updateQuestionFromPublicToken(token, body, intake, undefined, transcript, selectedLanguage);
    if (!updated) return Response.json({ message: '確認用URLが正しくありません。' }, { status: 404 });
    return Response.json({
      id: updated.id,
      title: updated.title,
      workflowStatus: updated.workflowStatus,
      updatedAt: updated.updates.at(-1)?.createdAt ?? updated.createdAt,
      assigneeName: updated.assigneeName,
      firstConfirmedAt: updated.firstConfirmedAt,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return Response.json({ message: '追加情報が長すぎます。' }, { status: 413 });
    console.error('KIKUMAE_PUBLIC_INTAKE_UPDATE_FAILED', error instanceof Error ? error.message : String(error));
    return Response.json({ message: '追加情報を保存できませんでした。' }, { status: 400 });
  }
}
