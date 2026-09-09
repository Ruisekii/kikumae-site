import { allowBurstShared, readRequestText } from '../../../../db/request-guard';
import { incidentStateJsonSchema, normalizeIncidentCandidate, type CanonicalIncidentState } from '../../../lib/incident-schema';
import { allowsEvaluationOverrides, getModelRuntimeStatus, requestModelJsonDetailed, withExtractionConcurrency } from '../../../lib/model-gateway';
import { detectSafetyFlags } from '../../../lib/safety-guard';
import { conversationLanguageInstruction, localizedEmergencyReply, localizedReadyReply, localizedSafetyFallback, normalizeConversationLanguage } from '../../../lib/conversation-language';
import { shouldRequestExtraction } from '../../../lib/voice-conversation';
import type { ShelterIntake } from '../../../../db/local-ai';
import { organizeStaffIncident } from '../../../lib/staff-organization';
import { getAdminUser } from '../../../admin-auth';

export const runtime = 'edge';

const MAX_REQUEST_BYTES = 16000;
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
  const source = record(value);
  // The raw transcript is app-owned state, not model output. Preserve it
  // explicitly before normalizing the untrusted structured fields; otherwise
  // every API turn silently starts with an empty transcript and later turns
  // can erase facts from earlier voice utterances.
  const originalText = Array.isArray(source?.originalText)
    ? source.originalText.filter((item): item is string => typeof item === 'string' && item.trim()).map((item) => item.trim().slice(0, 500)).slice(-12)
    : [];
  return normalizeIncidentCandidate(value, { ...base, originalText });
}

function guardConversationReply(value: string, language: ReturnType<typeof normalizeConversationLanguage>): string {
  const forbidden = language === 'en'
    ? ['calm down', 'take a deep breath', "don't worry", 'you will be fine', "you're fine"]
    : language === 'zh' ? ['冷静下来', '深呼吸', '别担心', '没事']
      : language === 'ko' ? ['진정하세요', '심호흡', '걱정하지 마세요', '괜찮습니다']
        : ['落ち着いてください', '深呼吸してください', '冷静になってください', '大丈夫です', '安心してください'];
  return forbidden.some((phrase) => value.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())) ? localizedSafetyFallback(language) : value;
}

function containsScriptedFollowUp(value: string, language: ReturnType<typeof normalizeConversationLanguage>): boolean {
  const patterns = language === 'en'
    ? [/\bwhere\b/i, /\bhow many\b/i, /\bhow much\b/i, /\bwhen did\b/i, /\btell us where\b/i]
    : language === 'zh'
      ? [/在哪里/u, /几个人/u, /还剩多少/u, /什么时候/u, /请告诉我们.*位置/u]
      : language === 'ko'
        ? [/어디/u, /몇 명/u, /얼마나 남/u, /언제/u, /위치를 알려/u]
        : [/どこ/u, /何人/u, /どのくらい/u, /いつ/u, /場所を教えて/u];
  return patterns.some((pattern) => pattern.test(value));
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

function explicitLocation(text: string): string | null {
  const toilet = text.match(/([^\s。]{1,30}トイレ)(?:が|は|へ|を|に)/);
  if (toilet?.[1]) return toilet[1];
  const named = text.match(/(西側の通路|北側の水場|体育館(?:東側|西側|北側|南側)?|(?:北|南|東|西)側|受付横|入口付近|救護スペース|調理室|A区画|B区画)/);
  if (named?.[1]) return named[1];
  const incidentPlace = text.match(/([^。]{1,30}?)(?:から|で)(?:煙|火|出火)/);
  return incidentPlace?.[1]?.trim() || null;
}

function explicitFacts(text: string): string[] {
  const facts: string[] = [];
  const add = (value: string) => { if (!facts.includes(value)) facts.push(value); };
  const directTerms = ['水', '給水', '水道', '配布', 'トイレ', '汚れ', '詰ま', '流れない', '使えない', '車いす', '混ん', 'おむつ', 'ミルク', '毛布', '生理用品', '食事', '備蓄品', 'インスリン', '打てていない', '転ん', '歩けない', '高齢', '胸が痛い', 'けが', '血が止まらない', '包丁', '殺す', '閉じ込め', '返事がない', '壁', '崩れ', '危険', '怖い', '大声', '眠れない', '充電', '携帯電話', 'つながらない', '寒い', '犬', 'ペット', '受付時間', '場所が分からない', 'なくなりそう', '切れ'];
  directTerms.filter((term) => text.includes(term)).forEach(add);
  if (/水|飲料水|給水|水道/.test(text)) add('飲料水・給水の不足または案内');
  if (/水道/.test(text)) add('水道が出ない');
  if (/配布/.test(text)) add('配布に関する確認');
  if (/食料|食事|ごはん|食べ物/.test(text)) add('食事・食料に関する相談');
  if (/トイレ/.test(text)) add('トイレに関する相談');
  if (/おむつ|ミルク|乳児|赤ちゃん/.test(text)) add('育児用品が不足');
  if (/赤ちゃん|乳児/.test(text)) add('赤ちゃんがいる');
  if (/子ども|こども|子供/.test(text)) add('子どもがいる');
  if (/家族/.test(text)) add('家族が避難している');
  if (/薬|インスリン|持病/.test(text)) add('薬・持病に関する相談');
  if (/体調|具合|気分が悪|しんど|つらい/.test(text)) add('体調不良の訴え');
  if (/煙|けむり|火災|火事|燃え/.test(text)) add('煙または火');
  if (/殴|暴力|刃物|武器|物を投げ/.test(text)) add('安全上の危険');
  const fever = text.match(/(\d{2})\s*(?:度|℃)/);
  if (fever?.[1]) add(`${fever[1]}度の発熱`);
  if (/ぐったり/.test(text)) add('ぐったりしている');
  if (/意識|反応が弱|起きない|起きん/.test(text)) add('意識・反応の異常');
  if (/息|呼吸|会話が続か|しゃべれん/.test(text)) add('呼吸・会話の異常');
  if (/血が止ま|出血/.test(text)) add('出血がある');
  const time = text.match(/昨日|一昨日|今朝|今晩|昨夜|さっき|先ほど|数時間前|朝から|昼から|夜から|\d+時間|\d+分/);
  if (time?.[0]) add(time[0]);
  if (/使えません|使用できません|使えない/.test(text)) facts.push('使用できない');
  if (/会話が続きません|会話が続かない/.test(text)) facts.push('会話が続かない');
  return Array.from(new Set(facts)).slice(0, 20);
}

function explicitTarget(text: string): CanonicalIncidentState['target'] | null {
  const countOf = (pattern: RegExp, fallback = 1) => {
    const match = text.match(pattern);
    return match?.[1] ? Number(match[1]) : fallback;
  };
  if (/乳児|赤ちゃん/.test(text)) {
    const accompanied = /(?:乳児|赤ちゃん)\s*と\s*\d{1,3}\s*(?:人|名)/.test(text);
    return { type: 'infant', count: accompanied ? 1 : countOf(/(?:乳児|赤ちゃん)(?:が|を)?\s*(\d{1,3})\s*(?:人|名)/, 1), ageGroup: null };
  }
  if (/子ども|こども|子供/.test(text)) return { type: 'child', count: countOf(/(?:子ども|こども|子供)\s*(\d{1,3})\s*(?:人|名)/, 1), ageGroup: null };
  if (/ペット|犬|猫/.test(text)) return { type: 'pet', count: countOf(/(?:犬|猫|ペット)\s*(\d{1,3})\s*(?:匹|頭)?/, 1), ageGroup: null };
  if (/高齢|お年寄り|母|父|お母|お父/.test(text)) return { type: 'adult', count: 1, ageGroup: 'adult' };
  const count = explicitCount(text);
  return count === null ? null : { type: null, count, ageGroup: null };
}

function requestFromText(text: string, safety: ReturnType<typeof detectSafetyFlags>): string | null {
  if (safety.flags.includes('火災・煙') || /煙|けむり|火災|火事|燃え/.test(text)) return 'fire_response';
  if (safety.flags.includes('暴力・武器') || /暴力|殴|刃物|武器|振り回|物を投げ/.test(text)) return 'safety_assistance';
  if (safety.flags.some((flag) => /意識|呼吸|体調|出血|胸痛/.test(flag)) || /薬|インスリン|体調|具合|気分が悪|しんど|つらい|高熱|発熱|ぐったり|息|胸|けが|怪我|救護/.test(text)) return 'medical_assistance';
  if (/トイレ/.test(text)) return 'toilet_assistance';
  if (/おむつ|ミルク|乳児|赤ちゃん/.test(text)) return 'infant_supplies';
  if (/水|飲料水|給水|水道/.test(text)) return 'water_supply';
  if (/食料|食事|ごはん|食べ物|毛布|生理用品|備蓄品/.test(text)) return 'food_supply';
  return null;
}

function supportedFact(fact: string, text: string): boolean {
  const normalizedFact = fact.replace(/[\s、。・!！?？「」『』()（）\[\]【】,.:;〜~ー\-]/g, '');
  const normalizedText = text.replace(/[\s、。・!！?？「」『』()（）\[\]【】,.:;〜~ー\-]/g, '');
  if (normalizedFact.length < 2) return false;
  if (normalizedText.includes(normalizedFact)) return true;
  const chunks = normalizedFact.match(/[一-龥ぁ-んァ-ン]{2,}|\d{2,}/g) ?? [];
  if (chunks.some((chunk) => normalizedText.includes(chunk))) return true;
  const aliases = [['水', '飲料水', '給水'], ['煙', 'けむり'], ['おむつ', '紙おむつ'], ['食事', 'ごはん'], ['使えない', '使用できない'], ['会話', 'しゃべれない'], ['ぐったり', '発熱', '度'], ['意識', '反応'], ['血', '出血']];
  return aliases.some((group) => group.some((item) => normalizedFact.includes(item)) && group.some((item) => normalizedText.includes(item)));
}

function refineIncident(incident: CanonicalIncidentState, text: string, safety: ReturnType<typeof detectSafetyFlags>, providedIntake: ShelterIntake): CanonicalIncidentState {
  const request = requestFromText(text, safety) ?? incident.request ?? (safety.flags.includes('火災・煙') ? 'fire_response' : safety.flags.includes('暴力・武器') ? 'safety_assistance' : null);
  const knownLocation = incident.location || explicitLocation(text) || providedIntake.issueLocation || providedIntake.location || null;
  const explicit = explicitTarget(text);
  const intakeCount = Number(String(providedIntake.peopleCount ?? '').match(/\d{1,3}/)?.[0] ?? NaN);
  const explicitNumericCount = /(\d{1,3})\s*(?:人|名)/.test(text);
  const count = explicitNumericCount ? (explicit?.count ?? explicitCount(text)) : (incident.target?.count ?? explicit?.count ?? (Number.isFinite(intakeCount) ? intakeCount : null));
  const targetCue = /(子供|こども|子ども|乳児|赤ちゃん|高齢|母|父|お母|お父|大人|成人|家族|\d{1,3}\s*(?:人|名))/.test(text);
  const target = explicit ? { ...explicit, count } : (!targetCue && incident.target?.type === 'adult' && count === 1
    ? null
    : count === null && !incident.target ? null : {
    type: incident.target?.type ?? null,
    count,
    ageGroup: incident.target?.ageGroup ?? null,
  });
  const evidence = incident.originalText.join('\n') || text;
  const facts = Array.from(new Set([...incident.facts.filter((fact) => supportedFact(fact, evidence)), ...explicitFacts(text)])).slice(0, 20);
  const urgency = incident.urgency !== 'unknown'
    ? request === 'toilet_assistance' && /詰まって|使えない|使用できない|壊れ/.test(text) && incident.urgency === 'low' ? 'medium' as const : incident.urgency
    : safety.immediate
      ? 'high' as const
      : ['water_supply', 'food_supply', 'infant_supplies', 'toilet_assistance'].includes(request ?? '')
        ? 'medium' as const
        : incident.urgency;
  const fields = new Set<string>();
  if (!knownLocation) fields.add('場所');
  if (count === null && ['water_supply', 'food_supply', 'infant_supplies'].includes(request ?? '')) fields.add('人数');
  if (safety.immediate || ['medical_assistance', 'fire_response', 'safety_assistance', 'toilet_assistance'].includes(request ?? '')) {
    return { ...incident, location: knownLocation, target, facts, request, urgency: urgency === 'unknown' ? 'high' : urgency, missingFields: knownLocation ? [] : ['場所'] };
  }
  if (request === 'infant_supplies') return { ...incident, location: knownLocation, target, facts, request, urgency, missingFields: knownLocation ? [] : ['場所'] };
  if (request === 'general_assistance' || !request) return { ...incident, location: knownLocation, target, facts, request: request ?? 'general_assistance', missingFields: knownLocation ? ['追加確認'] : ['場所', '追加確認'] };
  return { ...incident, location: knownLocation, target, facts, request, urgency, missingFields: Array.from(fields).slice(0, 12) };
}

const conversationSystem = [
  'あなたは避難所の相談受付を補助する低遅延の会話AIです。',
  '利用者の怒りや不安を否定せず、短く受け止めます。必要な追加確認は一度に1項目だけにします。',
  '生命危険・火災・暴力などの緊急判定はSafety Guardが別に行うため、あなたが安全性を確定してはいけません。',
  '「落ち着いて」「大丈夫」「安心して」などの表現、説教、推測、職員の判断の代行は禁止です。',
  '必ず次のJSONだけを返してください。',
  '{"reply":"利用者へ返す短い文","nextField":"場所|人数|残量|最後に受け取った時刻|追加確認|null","requiresConfirmation":true}',
  '原則としてnextFieldはnullにします。利用者の発話だけで職員へ届けられる場合は質問せず、requiresConfirmation=trueにします。nextFieldを選べるのは、その情報がないと今すぐ対応へ渡せない場合だけです。missingFieldsを機械的に埋める目的で質問してはいけません。緊急・医療・火災・暴力で場所が分からず、速報後に場所だけ必要な場合に限り、場所を1つだけ確認します。',
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

const extractionSystemCompact = [
  '避難所相談の原文から、職員が対応するための事実だけをIncident JSONに抽出する。',
  '原文にない事実を推測しない。不明値はnull、不足はmissingFields。原文はoriginalTextにそのまま保持する。',
  'requestはmedical_assistance / water_supply / food_supply / toilet_assistance / infant_supplies / fire_response / safety_assistance / general_assistanceのいずれか。',
  '高熱・ぐったり・意識/呼吸異常・火災・暴力はurgency=high候補。safetyFlagsはpossible_medical_emergency / possible_fire / possible_violence / possible_self_harmのみ。',
  'targetは文中に明記された対象だけ。単数の子ども=child/1、乳児=infant/1、高齢者や父母=adult/1。本人の年齢不明なら推測しない。',
  'missingFields/askedFieldsは場所・人数・残量・最後に受け取った時刻・追加確認だけ。職員が今すぐ必要なものに限定する。',
  `JSON Schema: ${JSON.stringify(incidentStateJsonSchema)}`,
  'JSONだけを返す。',
].join('\n');

function telemetryBase(started: number, safetyStarted: number, safetyFinished: number, mode: string, model: string | null, promptVariant: string): Record<string, unknown> {
  return {
    stage: mode,
    model,
    promptVariant,
    safetyGuardMs: Math.round(safetyFinished - safetyStarted),
    preprocessingMs: Math.round(safetyStarted - started),
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ message: 'この送信元は許可されていません。' }, 403);
  const evaluationSuite = allowsEvaluationOverrides() && ['phase2e', 'phase2g', 'phase3b'].includes(request.headers.get('x-kikumae-eval-suite') ?? '');
  if (evaluationSuite && !await getAdminUser(request)) return json({ message: '評価用エンドポイントではありません。' }, 404);
  if (!evaluationSuite && !await allowBurstShared(request, 'ai-voice-gateway', 30, 10 * 60 * 1000)) return json({ message: '音声相談の処理が多すぎます。少し時間をおいてください。' }, 429);
  try {
    const payload = record(JSON.parse(await readRequestText(request, MAX_REQUEST_BYTES)));
    const mode = payload.mode === 'conversation' || payload.mode === 'extract' || payload.mode === 'triage' || payload.mode === 'organize' ? payload.mode : null;
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 1000) : '';
    if (!mode || !text) return json({ message: '音声相談の入力形式が正しくありません。' }, 400);
    const started = performance.now();
    const safetyStarted = performance.now();
    const safety = detectSafetyFlags(text);
    const safetyFinished = performance.now();
    const status = getModelRuntimeStatus();
    const baseTelemetry = telemetryBase(started, safetyStarted, safetyFinished, mode, null, status.extractionPromptVariant);
    const parsedState = canonicalState(payload.state);
    const selectedLanguage = normalizeConversationLanguage(payload.selectedLanguage ?? parsedState.language);
    const languageState = { ...parsedState, language: selectedLanguage };
    const state = languageState.originalText.at(-1) === text ? languageState : { ...languageState, originalText: [...languageState.originalText, text].slice(-12) };
    const providedIntake = intake(payload.intake);
    // When the model lane is unavailable, retain a deterministic incident context
    // for extraction callers. This is intentionally derived from the original text
    // and Safety Guard; it is not an AI decision or a replacement for staff review.
    const fallbackIncident = mode === 'extract'
      ? { ...refineIncident(state, text, safety, providedIntake), safetyFlags: Array.from(new Set([...state.safetyFlags, ...safety.flags])) }
      : null;
    const fallbackContext = { originalText: state.originalText, ...(fallbackIncident ? { incident: fallbackIncident } : {}) };
    if (mode === 'triage') {
      const incident = { ...refineIncident(state, text, safety, providedIntake), safetyFlags: Array.from(new Set([...state.safetyFlags, ...safety.flags])) };
      const decision = shouldRequestExtraction(text, {
        language: incident.language,
        location: incident.location ?? undefined,
        target: incident.target ? { type: incident.target.type ?? undefined, count: incident.target.count ?? undefined, ageGroup: incident.target.ageGroup ?? undefined } : undefined,
        facts: incident.facts,
        request: incident.request ?? undefined,
        urgency: incident.urgency,
        safetyFlags: incident.safetyFlags,
        missingFields: incident.missingFields,
        askedFields: incident.askedFields,
        originalText: incident.originalText,
      });
      const triagedIncident = { ...incident, structuredComplete: decision.structuredComplete, fourBRequested: decision.useExtraction, fourBStatus: decision.useExtraction ? 'pending' as const : 'not_needed' as const };
      return json({ ok: true, aiMode: 'deterministic-triage', runtimeMode: status.mode, selectedLanguage, incident: triagedIncident, safety, extraction: decision, telemetry: { ...baseTelemetry, totalMs: Math.round(performance.now() - started), fallback: false } });
    }
    if (mode === 'organize') {
      const structuredIncident = {
        language: selectedLanguage, location: state.location, target: state.target, facts: state.facts,
        request: state.request, urgency: state.urgency, safetyFlags: state.safetyFlags, missingFields: state.missingFields,
        category: state.category, provenance: state.provenance,
      };
      const fault = allowsEvaluationOverrides() && request.headers.get('x-kikumae-eval-fault') === 'organization-down';
      const organization = organizeStaffIncident({ body: text, originalLanguage: selectedLanguage, messageId: 'eval:organization', intake: providedIntake, structuredIncident, safety, mode: fault ? 'fallback' : 'evidence-bound' });
      return json({ ok: true, aiMode: fault ? 'organization-fallback' : 'evidence-bound-organizer', runtimeMode: status.mode, selectedLanguage, organization, safety, telemetry: { ...baseTelemetry, totalMs: Math.round(performance.now() - started), fallback: fault } });
    }
    if (allowsEvaluationOverrides() && request.headers.get('x-kikumae-safety-only') === '1') return json({ ok: true, aiMode: 'safety-guard', runtimeMode: status.mode, safety, telemetry: { ...baseTelemetry, totalMs: Math.round(performance.now() - started), fallback: false } });
    const injectedFault = allowsEvaluationOverrides() ? request.headers.get('x-kikumae-eval-fault') : null;
    if (injectedFault && ['ollama-down', 'conversation-down', 'extraction-down', 'timeout', 'invalid-json', 'network-disconnect'].includes(injectedFault)) {
      return json({ ok: false, aiMode: 'local-rules', runtimeMode: status.mode, safety, ...fallbackContext, telemetry: { ...baseTelemetry, totalMs: Math.round(performance.now() - started), fallback: true, fault: injectedFault }, reason: `EVAL_FAULT_${injectedFault}` });
    }
    if (status.mode === 'local-rules') return json({ ok: false, aiMode: 'local-rules', runtimeMode: status.mode, safety, ...fallbackContext, telemetry: { ...baseTelemetry, totalMs: Math.round(performance.now() - started), fallback: true }, reason: 'LOCAL_RULES_MODE' }, 200);
    const roleConfigured = mode === 'conversation' ? status.conversationConfigured : status.extractionConfigured;
    if (!roleConfigured) return json({ ok: false, aiMode: 'local-rules', runtimeMode: status.mode, safety, ...fallbackContext, telemetry: { ...baseTelemetry, totalMs: Math.round(performance.now() - started), fallback: true }, reason: 'MODEL_GATEWAY_NOT_CONFIGURED' }, 200);
    const context = JSON.stringify({ text, selectedLanguage, state, intake: providedIntake, safety }, null, 2);
    const requestedModel = request.headers.get('x-kikumae-eval-model')?.trim() ?? '';
    const modelOverride = allowsEvaluationOverrides() && /^[a-zA-Z0-9._:-]{1,100}$/.test(requestedModel) ? requestedModel : null;
    const requestedPromptVariant = request.headers.get('x-kikumae-eval-prompt')?.trim();
    const promptOverride = allowsEvaluationOverrides() && (requestedPromptVariant === 'full' || requestedPromptVariant === 'compact') ? requestedPromptVariant : null;
    const model = modelOverride ?? (mode === 'conversation' ? status.conversationModel : status.extractionModel);
    const extractionPromptVariant = promptOverride ?? status.extractionPromptVariant;
    if (!model) return json({ ok: false, aiMode: 'local-rules', runtimeMode: status.mode, safety, ...fallbackContext, telemetry: { ...baseTelemetry, totalMs: Math.round(performance.now() - started), fallback: true }, reason: 'MODEL_NOT_CONFIGURED' }, 503);
    const modelCall = () => requestModelJsonDetailed(
      model,
      mode === 'conversation' ? `${conversationSystem}\n${conversationLanguageInstruction(selectedLanguage)}` : extractionPromptVariant === 'compact' ? extractionSystemCompact : extractionSystem,
      context,
      mode === 'conversation' ? conversationJsonSchema : { type: 'json_schema', json_schema: { name: 'incident_state', strict: true, schema: incidentStateJsonSchema } },
      { maxTokens: mode === 'conversation' ? 120 : 260, role: mode === 'conversation' ? 'conversation' : 'extraction' },
    );
    let queued: { value: Awaited<ReturnType<typeof requestModelJsonDetailed>>; queueMs: number };
    try {
      queued = mode === 'extract' ? await withExtractionConcurrency(modelCall) : { value: await modelCall(), queueMs: 0 };
    } catch (error) {
      return json({ ok: false, aiMode: 'local-rules', runtimeMode: status.mode, safety, ...fallbackContext, telemetry: { ...baseTelemetry, model, totalMs: Math.round(performance.now() - started), fallback: true, queueMs: mode === 'extract' ? null : 0 }, reason: error instanceof Error ? error.message : 'MODEL_GATEWAY_FAILED' }, 200);
    }
    const modelResult = queued.value;
    const result = modelResult.result;
    const candidate = record(result);
    if (mode === 'conversation') {
      const reply = typeof candidate.reply === 'string' ? candidate.reply.trim().slice(0, 500) : '';
      const askedFields = new Set(state.askedFields);
      const safeEmergencyField = safety.immediate && !state.location && !askedFields.has('場所') ? '場所' : null;
      // The resident-facing voice lane is intentionally not a form-filling
      // interview. Normal turns go straight to review; only the independent
      // Safety Lane may require the location immediately after an alert.
      const nextField = safeEmergencyField;
      if (!reply) return json({ ok: false, aiMode: 'local-rules', safety, telemetry: { ...baseTelemetry, model, modelTimings: modelResult.timings, totalMs: Math.round(performance.now() - started), fallback: true }, reason: 'MODEL_OUTPUT_INVALID' }, 502);
      const guardedReply = safety.immediate
        ? localizedEmergencyReply(selectedLanguage, nextField === '場所')
        : containsScriptedFollowUp(reply, selectedLanguage) ? localizedReadyReply(selectedLanguage) : guardConversationReply(reply, selectedLanguage);
      return json({ ok: true, aiMode: 'model-gateway', runtimeMode: status.mode, provider: status.provider, selectedLanguage, reply: guardedReply, nextField, requiresConfirmation: safety.immediate ? false : candidate.requiresConfirmation === true, safety, telemetry: { ...baseTelemetry, model, modelTimings: modelResult.timings, totalMs: Math.round(performance.now() - started), fallback: false } });
    }
    const normalizationStarted = performance.now();
    const normalized = normalizeIncidentCandidate({ ...candidate, safetyFlags: [...(Array.isArray(candidate.safetyFlags) ? candidate.safetyFlags : []), ...safety.flags] }, state);
    const incident = refineIncident(normalized, text, safety, providedIntake);
    const normalizationMs = Math.round(performance.now() - normalizationStarted);
    return json({ ok: true, aiMode: 'model-gateway', runtimeMode: status.mode, provider: status.provider, incident, safety, telemetry: { ...baseTelemetry, model, promptVariant: extractionPromptVariant, modelTimings: { ...modelResult.timings, queueMs: queued.queueMs }, normalizationMs, totalMs: Math.round(performance.now() - started), fallback: false } });
  } catch (error) {
    console.error('KIKUMAE_VOICE_MODEL_FAILED', error instanceof Error ? error.message : String(error));
    return json({ ok: false, aiMode: 'local-rules', reason: 'MODEL_GATEWAY_FAILED' }, 502);
  }
}
