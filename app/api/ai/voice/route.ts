import { allowBurstShared, readRequestText } from '../../../../db/request-guard';
import { incidentStateJsonSchema, normalizeIncidentCandidate, type CanonicalIncidentState } from '../../../lib/incident-schema';
import { getModelRuntimeStatus, requestModelJson } from '../../../lib/model-gateway';
import { detectSafetyFlags } from '../../../lib/safety-guard';
import type { ShelterIntake } from '../../../../db/local-ai';

export const runtime = 'edge';

const MAX_REQUEST_BYTES = 16000;
const VALID_FIELDS = new Set(['場所', '人数', '残量', '最後に受け取った時刻', '追加確認']);
const conversationJsonSchema = {
  type: 'json_schema',
  json_schema: {
    name: 'conversation_reply',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reply', 'nextField', 'requiresConfirmation'],
      properties: {
        reply: { type: 'string' },
        nextField: { type: ['string', 'null'], enum: ['場所', '人数', '残量', '最後に受け取った時刻', '追加確認', null] },
        requiresConfirmation: { type: 'boolean' },
      },
    },
  },
};

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

function explicitCount(text: string): number | null {
  const match = text.match(/(\d{1,3})\s*(?:人|名)/);
  return match?.[1] ? Number(match[1]) : null;
}

function refineIncident(incident: CanonicalIncidentState, text: string, safety: ReturnType<typeof detectSafetyFlags>, providedIntake: ShelterIntake): CanonicalIncidentState {
  const request = incident.request ?? (safety.flags.includes('火災・煙') ? 'fire_response' : safety.flags.includes('暴力・武器') ? 'safety_assistance' : null);
  const knownLocation = incident.location || providedIntake.issueLocation || providedIntake.location || null;
  const count = incident.target?.count ?? explicitCount(text);
  const targetCue = /(子供|こども|子ども|乳児|赤ちゃん|高齢|母|父|お母|お父|大人|成人|家族|\d{1,3}\s*(?:人|名))/.test(text);
  const target = !targetCue && incident.target?.type === 'adult' && count === 1
    ? null
    : count === null && !incident.target ? null : {
    type: incident.target?.type ?? null,
    count,
    ageGroup: incident.target?.ageGroup ?? null,
  };
  const urgency = incident.urgency !== 'unknown'
    ? incident.urgency
    : safety.immediate
      ? 'high' as const
      : ['water_supply', 'food_supply', 'infant_supplies', 'toilet_assistance'].includes(request ?? '')
        ? 'medium' as const
        : incident.urgency;
  const fields = new Set(incident.missingFields);
  if (knownLocation) fields.delete('場所'); else fields.add('場所');
  if (count !== null) fields.delete('人数');
  if (/(昨日|今日|今朝|昨夜|さっき|先ほど|\d+時間|\d+分|ずっと|以前から)/.test(text)) fields.delete('最後に受け取った時刻');
  if (!['water_supply', 'food_supply'].includes(request ?? '')) fields.delete('残量');
  if (!['water_supply', 'food_supply'].includes(request ?? '')) fields.delete('最後に受け取った時刻');
  if (safety.immediate || ['medical_assistance', 'fire_response', 'safety_assistance', 'toilet_assistance'].includes(request ?? '')) {
    return { ...incident, location: knownLocation, target, request, urgency: urgency === 'unknown' ? 'high' : urgency, missingFields: knownLocation ? [] : ['場所'] };
  }
  if (request === 'infant_supplies') return { ...incident, location: knownLocation, target, request, urgency, missingFields: knownLocation ? [] : ['場所'] };
  if (request === 'general_assistance' || !request) return { ...incident, location: knownLocation, target, request: request ?? 'general_assistance', missingFields: knownLocation ? ['追加確認'] : ['場所', '追加確認'] };
  return { ...incident, location: knownLocation, target, request, urgency, missingFields: Array.from(fields).slice(0, 12) };
}

const conversationSystem = [
  'あなたは避難所の相談受付を補助する低遅延の会話AIです。',
  '利用者の怒りや不安を否定せず、短く受け止めます。必要な追加確認は一度に1項目だけにします。',
  '生命危険・火災・暴力などの緊急判定はSafety Guardが別に行うため、あなたが安全性を確定してはいけません。',
  '「落ち着いて」「大丈夫」「安心して」などの表現、説教、推測、職員の判断の代行は禁止です。',
  '必ず次のJSONだけを返してください。',
  '{"reply":"利用者へ返す短い文","nextField":"場所|人数|残量|最後に受け取った時刻|追加確認|null","requiresConfirmation":true}',
  'nextFieldは、提示されたIncident StateのmissingFieldsから未確認の項目を最大1つだけ選びます。missingFieldsがまだ空の初回でも、文章から必要と判断できる項目を1つだけ選んでください。緊急・医療・火災・暴力は場所、それ以外の物資不足も原則として場所を最初に確認します。',
].join('\n');

const extractionSystem = [
  'あなたは避難所相談のIncident Extraction専用モデルです。',
  '会話の自然文を、原文を消さずに業務上の事実へ変換します。書かれていないことを推測せず、不明はnullまたはmissingFieldsにします。',
  '緊急度を生命判断として確定せず、可能性はsafetyFlagsへ記録します。文章要約ではなく、必ずJSON Schemaに従うJSONだけを返してください。',
  'Schema: ' + JSON.stringify(incidentStateJsonSchema),
  '値のルール：targetは対象を表すオブジェクトです。文中に「子供が1人」とあれば type=child, count=1、生後何か月の赤ちゃんなら type=infant, count=1、単数の大人なら type=adult, count=1にします。本人の年齢が書かれていない「息が苦しい」だけではtargetを推測しません。requestはmedical_assistance / water_supply / food_supply / toilet_assistance / infant_supplies / fire_response / safety_assistance / general_assistance のいずれかを必ず使います。煙・火・出火はfire_response、怒鳴る・椅子を振り回すなどの危険行為はsafety_assistance、内容が不明な「困っています」はgeneral_assistanceです。safetyFlagsはpossible_medical_emergency / possible_fire / possible_violence / possible_self_harmだけを使います。missingFieldsとaskedFieldsは場所・人数・残量・最後に受け取った時刻・追加確認だけを使います。高熱でぐったり、意識・呼吸の異常、火災、暴力はurgency=highとし、最終判断ではなく候補として出します。飲料水・食料・おむつ等が不足し残量がほぼない、または長時間待っている場合はurgency=mediumです。',
  'missingFieldsは「職員がこの案件を動かすために今すぐ必要な項目」だけです。医療の詳細な問診項目や任意情報を追加しないでください。入力が「子供が39度あってぐったりしている」の場合、targetはchild/count=1、requestはmedical_assistance、urgencyはhigh、safetyFlagsはpossible_medical_emergency、missingFieldsは場所だけです。入力が「調理室から煙が出て火が見える」の場合、locationは調理室、requestはfire_response、urgencyはhigh、safetyFlagsはpossible_fireです。',
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
    if (status.mode === 'local-rules') return json({ ok: false, aiMode: 'local-rules', runtimeMode: status.mode, safety, reason: 'LOCAL_RULES_MODE' }, 200);
    if (!status.configured) return json({ ok: false, aiMode: 'local-rules', runtimeMode: status.mode, safety, reason: 'MODEL_GATEWAY_NOT_CONFIGURED' }, 503);
    const parsedState = canonicalState(payload.state);
    const state = parsedState.originalText.at(-1) === text ? parsedState : { ...parsedState, originalText: [...parsedState.originalText, text].slice(-12) };
    const providedIntake = intake(payload.intake);
    const context = JSON.stringify({ text, state, intake: providedIntake, safety }, null, 2);
    const model = mode === 'conversation' ? status.conversationModel : status.extractionModel;
    if (!model) return json({ ok: false, aiMode: 'local-rules', runtimeMode: status.mode, safety, reason: 'MODEL_NOT_CONFIGURED' }, 503);
    const result = await requestModelJson(
      model,
      mode === 'conversation' ? conversationSystem : extractionSystem,
      context,
      mode === 'conversation' ? conversationJsonSchema : { type: 'json_schema', json_schema: { name: 'incident_state', strict: true, schema: incidentStateJsonSchema } },
    );
    const candidate = record(result);
    if (mode === 'conversation') {
      const reply = typeof candidate.reply === 'string' ? candidate.reply.trim().slice(0, 500) : '';
      const requestedField = candidate.nextField === null || candidate.nextField === undefined ? null : String(candidate.nextField);
      const missingFields = new Set(state.missingFields);
      const askedFields = new Set(state.askedFields);
      const safeEmergencyField = safety.immediate && !state.location && !askedFields.has('場所') ? '場所' : null;
      const nextField = requestedField && VALID_FIELDS.has(requestedField) && !askedFields.has(requestedField) && (missingFields.has(requestedField) || (missingFields.size === 0 && requestedField === '場所'))
        ? requestedField
        : safeEmergencyField;
      if (!reply || (requestedField !== null && !VALID_FIELDS.has(requestedField))) return json({ ok: false, aiMode: 'local-rules', safety, reason: 'MODEL_OUTPUT_INVALID' }, 502);
      const guardedReply = safety.immediate
        ? `緊急の可能性がある内容として、先に職員へ知らせます。${nextField === '場所' ? '今いる場所を教えてください。' : '近くの職員にもすぐ知らせてください。'}`
        : reply;
      return json({ ok: true, aiMode: 'model-gateway', runtimeMode: status.mode, provider: status.provider, reply: guardedReply, nextField, requiresConfirmation: safety.immediate ? false : candidate.requiresConfirmation === true, safety });
    }
    const normalized = normalizeIncidentCandidate({ ...candidate, safetyFlags: [...(Array.isArray(candidate.safetyFlags) ? candidate.safetyFlags : []), ...safety.flags] }, state);
    const incident = refineIncident(normalized, text, safety, providedIntake);
    return json({ ok: true, aiMode: 'model-gateway', runtimeMode: status.mode, provider: status.provider, incident, safety });
  } catch (error) {
    console.error('KIKUMAE_VOICE_MODEL_FAILED', error instanceof Error ? error.message : String(error));
    return json({ ok: false, aiMode: 'local-rules', reason: 'MODEL_GATEWAY_FAILED' }, 502);
  }
}
