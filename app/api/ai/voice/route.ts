import { allowBurstShared, readRequestText } from '../../../../db/request-guard';
import { incidentStateJsonSchema, normalizeIncidentCandidate, type CanonicalIncidentState } from '../../../lib/incident-schema';
import { getModelRuntimeStatus, requestModelJson } from '../../../lib/model-gateway';
import { detectSafetyFlags } from '../../../lib/safety-guard';
import type { ShelterIntake } from '../../../../db/local-ai';

export const runtime = 'edge';

const MAX_REQUEST_BYTES = 16000;
const VALID_FIELDS = new Set(['場所', '人数', '残量', '最後に受け取った時刻', '追加確認']);

function json(payload: Record<string, unknown>, status = 200): Response {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function canonicalState(value: unknown): CanonicalIncidentState {
  const base: CanonicalIncidentState = {
    language: 'ja', location: null, target: null, facts: [], request: null, urgency: 'unknown',
    safetyFlags: [], missingFields: [], askedFields: [], originalText: [], confidence: null, category: null,
  };
  return normalizeIncidentCandidate(value, base);
}

function intake(value: unknown): ShelterIntake {
  const source = record(value);
  return {
    location: typeof source.location === 'string' ? source.location.slice(0, 120) : '',
    issueLocation: typeof source.issueLocation === 'string' ? source.issueLocation.slice(0, 120) : '',
    peopleCount: typeof source.peopleCount === 'string' ? source.peopleCount.slice(0, 40) : '',
    resourceRemaining: typeof source.resourceRemaining === 'string' ? source.resourceRemaining.slice(0, 80) : '',
    lastReceivedAt: typeof source.lastReceivedAt === 'string' ? source.lastReceivedAt.slice(0, 80) : '',
    additionalDetails: typeof source.additionalDetails === 'string' ? source.additionalDetails.slice(0, 120) : '',
  };
}

const conversationSystem = [
  'あなたは避難所の相談受付を補助する低遅延の会話AIです。',
  '利用者の怒りや不安を否定せず、短く受け止めます。必要な追加確認は一度に1項目だけにします。',
  '生命危険・火災・暴力などの緊急判定はSafety Guardが別に行うため、あなたが安全性を確定してはいけません。',
  '「落ち着いて」「大丈夫」「安心して」などの表現、説教、推測、職員の判断の代行は禁止です。',
  '必ず次のJSONだけを返してください。',
  '{"reply":"利用者へ返す短い文","nextField":"場所|人数|残量|最後に受け取った時刻|追加確認|null","requiresConfirmation":true}',
  'nextFieldは、提示されたIncident StateのmissingFieldsから未確認の項目を最大1つだけ選びます。',
].join('\n');

const extractionSystem = [
  'あなたは避難所相談のIncident Extraction専用モデルです。',
  '会話の自然文を、原文を消さずに業務上の事実へ変換します。書かれていないことを推測せず、不明はnullまたはmissingFieldsにします。',
  '緊急度を生命判断として確定せず、可能性はsafetyFlagsへ記録します。文章要約ではなく、必ずJSON Schemaに従うJSONだけを返してください。',
  'Schema: ' + JSON.stringify(incidentStateJsonSchema),
  '重要：originalTextは入力状態の値をそのまま保持し、モデルの言い換えで置き換えないでください。',
].join('\n');

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ message: 'この送信元は許可されていません。' }, 403);
  if (!await allowBurstShared(request, 'ai-voice-gateway', 30, 10 * 60 * 1000)) return json({ message: '音声相談の処理が多すぎます。少し時間をおいてください。' }, 429);
  try {
    const payload = record(JSON.parse(await readRequestText(request, MAX_REQUEST_BYTES)));
    const mode = payload.mode === 'conversation' || payload.mode === 'extract' ? payload.mode : null;
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 1000) : '';
    if (!mode || !text) return json({ message: '音声相談の入力形式が正しくありません。' }, 400);
    const safety = detectSafetyFlags(text);
    const status = getModelRuntimeStatus();
    if (!status.configured) return json({ ok: false, aiMode: 'local-rules', safety, reason: 'MODEL_GATEWAY_NOT_CONFIGURED' }, 503);
    const state = canonicalState(payload.state);
    const context = JSON.stringify({ text, state, intake: intake(payload.intake), safety }, null, 2);
    const model = mode === 'conversation' ? status.conversationModel : status.extractionModel;
    if (!model) return json({ ok: false, aiMode: 'local-rules', safety, reason: 'MODEL_NOT_CONFIGURED' }, 503);
    const result = await requestModelJson(model, mode === 'conversation' ? conversationSystem : extractionSystem, context);
    const candidate = record(result);
    if (mode === 'conversation') {
      const reply = typeof candidate.reply === 'string' ? candidate.reply.trim().slice(0, 500) : '';
      const requestedField = candidate.nextField === null || candidate.nextField === undefined ? null : String(candidate.nextField);
      const missingFields = new Set(state.missingFields);
      const askedFields = new Set(state.askedFields);
      const nextField = requestedField && VALID_FIELDS.has(requestedField) && missingFields.has(requestedField) && !askedFields.has(requestedField)
        ? requestedField
        : null;
      if (!reply || (requestedField !== null && !VALID_FIELDS.has(requestedField))) return json({ ok: false, aiMode: 'local-rules', safety, reason: 'MODEL_OUTPUT_INVALID' }, 502);
      return json({ ok: true, aiMode: 'model-gateway', provider: status.provider, reply, nextField, requiresConfirmation: candidate.requiresConfirmation === true, safety });
    }
    const incident = normalizeIncidentCandidate(candidate, state);
    return json({ ok: true, aiMode: 'model-gateway', provider: status.provider, incident, safety });
  } catch (error) {
    console.error('KIKUMAE_VOICE_MODEL_FAILED', error instanceof Error ? error.message : String(error));
    return json({ ok: false, aiMode: 'local-rules', reason: 'MODEL_GATEWAY_FAILED' }, 502);
  }
}
