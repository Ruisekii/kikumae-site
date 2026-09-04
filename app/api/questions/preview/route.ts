import { listRelatedFaqs } from '../../../../db/repository';
import { categorizeShelterQuestion, containsPii, generateShelterAnalysis, shelterFollowUp, type ShelterIntake } from '../../../../db/local-ai';
import { allowBurstShared, readRequestText } from '../../../../db/request-guard';

export const runtime = 'edge';

const MAX_REQUEST_BYTES = 4096;
const MAX_QUESTION_CHARS = 500;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ message: 'この送信元は許可されていません。' }, 403);
  if (!await allowBurstShared(request, 'question-preview:root', 60, 10 * 60 * 1000)) return json({ message: 'プレビュー操作が多すぎます。少し時間をおいて再度お試しください。' }, 429);
  try {
    const payload = JSON.parse(await readRequestText(request, MAX_REQUEST_BYTES)) as Record<string, unknown>;
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    const intake = (payload.intake && typeof payload.intake === 'object') ? payload.intake as ShelterIntake : {};
    if (!body || body.length > MAX_QUESTION_CHARS) return json({ message: '質問は1〜500文字で入力してください。' }, 400);
    if (containsPii(body)) return json({ message: '個人情報やURLは入力できません。該当箇所を削除してください。' }, 400);
    const analysis = generateShelterAnalysis(body, intake);
    const related = await listRelatedFaqs(body, 3);
    const followUpKey = analysis.missingInformation[0] ?? '';
    return json({ body, summary: analysis.overview, category: categorizeShelterQuestion(body), analysis, related, followUp: followUpKey ? shelterFollowUp(followUpKey, analysis.category) : null, aiMode: 'local-rules' });
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE') return json({ message: '質問は500文字以内で入力してください。' }, 413);
    return json({ message: '入力形式が正しくありません。' }, 400);
  }
}
