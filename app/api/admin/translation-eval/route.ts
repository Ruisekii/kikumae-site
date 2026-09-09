import { allowBurstShared, readRequestText } from '../../../../db/request-guard';
import { translateForStaff } from '../../../../db/translation';
import { allowsEvaluationOverrides } from '../../../lib/model-gateway';
import { getAdminUser } from '../../../admin-auth';

export const runtime = 'edge';

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request) || !allowsEvaluationOverrides() || request.headers.get('x-kikumae-eval-translation') !== '1') return Response.json({ message: '評価用エンドポイントではありません。' }, { status: 404 });
  if (!await getAdminUser(request)) return Response.json({ message: '評価用エンドポイントではありません。' }, { status: 404 });
  if (!await allowBurstShared(request, 'translation-eval', 60, 10 * 60 * 1000)) return Response.json({ message: '評価リクエストが多すぎます。' }, { status: 429 });
  try {
    const payload = JSON.parse(await readRequestText(request, 4000)) as Record<string, unknown>;
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 500) : '';
    const language = typeof payload.language === 'string' ? payload.language.trim().slice(0, 12) : undefined;
    if (!text) return Response.json({ message: '翻訳対象がありません。' }, { status: 400 });
    if (request.headers.get('x-kikumae-eval-fault') === 'translation-failure') return Response.json({ originalText: text, originalLanguage: language ?? 'unknown', translatedTextJa: '', translationStatus: 'failed' }, { headers: { 'Cache-Control': 'no-store' } });
    return Response.json(await translateForStaff(text, language), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ message: '翻訳評価に失敗しました。' }, { status: 400 });
  }
}
