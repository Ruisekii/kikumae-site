import { createQuestion } from '../../../db/repository';
import type { ShelterIntake } from '../../../db/local-ai';
import { allowBurstShared, readRequestText } from '../../../db/request-guard';

export const runtime = 'edge';

const MAX_REQUEST_BYTES = 4096;
const MAX_QUESTION_CHARS = 500;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function json(message: string, status: number): Response {
  return Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json('この送信元は許可されていません。', 403);
  if (!await allowBurstShared(request, 'question-create:root', 30, 10 * 60 * 1000)) return Response.json({ message: '送信が多すぎます。少し時間をおいて再度お試しください。' }, { status: 429, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } });
  let payload: unknown;
  try {
    payload = JSON.parse(await readRequestText(request, MAX_REQUEST_BYTES));
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return json('質問は500文字以内で入力してください。', 413);
    return json('入力形式が正しくありません。', 400);
  }

  const data = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
  const category = typeof data.category === 'string' ? data.category.trim() : '';
  const submissionKey = typeof data.submissionKey === 'string' ? data.submissionKey.trim().slice(0, 128) : '';
  const rawIntake = (data.intake && typeof data.intake === 'object') ? data.intake as Record<string, unknown> : {};
  const intake: ShelterIntake = {
    location: typeof rawIntake.location === 'string' ? rawIntake.location : '',
    peopleCount: typeof rawIntake.peopleCount === 'string' ? rawIntake.peopleCount : '',
    resourceRemaining: typeof rawIntake.resourceRemaining === 'string' ? rawIntake.resourceRemaining : '',
    lastReceivedAt: typeof rawIntake.lastReceivedAt === 'string' ? rawIntake.lastReceivedAt : '',
  };
  if (!body || body.length > MAX_QUESTION_CHARS) return json('質問は1〜500文字で入力してください。', 400);
  if (summary.length > 300) return json('要約は300文字以内で入力してください。', 400);
  // 個人情報やURLを含んでいても受付は拒否しない。原文はそのまま保存し、
  // 職員向けの要約・分析などの表示は createQuestion 内で伏字化される。
  // どの種別を検出したかは応答の piiDetected / piiTypes で伝える。

  try {
    const question = await createQuestion(body, summary, category, null, submissionKey, intake);
    return Response.json({
      id: question.id,
      checkUrl: `${new URL(request.url).origin}/questions/${question.checkToken}`,
      message: question.piiDetected
        ? '質問を受け付けました。個人情報を含む可能性がある内容が見つかったため、職員の画面では該当箇所を伏字にして表示します。'
        : '質問を受け付けました。管理者が確認します。',
      piiDetected: question.piiDetected,
      piiTypes: question.piiTypes,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'QUESTION_DUPLICATE') return json('この質問はすでに受け付けています。回答の確認URLをご確認ください。', 409);
    return json('質問を保存できませんでした。', 400);
  }
}
