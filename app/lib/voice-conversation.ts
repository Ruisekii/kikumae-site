import {
  generateShelterAnalysis,
  shelterFollowUp,
  type ShelterAnalysis,
  type ShelterCategory,
  type ShelterIntake,
} from '../../db/local-ai';
import { normalizeIncidentCandidate, type CanonicalIncidentState, type FourBStatus, type IncidentFieldProvenance, type IncidentProvenance, type IncidentSource } from './incident-schema';
import { safetyGuard, type SafetyResult } from './safety-guard';
import { requestVoiceModel } from './model-client';
import { extractMultilingualIncidentHints } from './multilingual-incident';
import {
  localizedEmergencyReply,
  localizedFieldQuestion,
  localizedReadyReply,
  localizedSafetyFallback,
  normalizeConversationLanguage,
  speechLanguageTag,
  type ConversationLanguage,
} from './conversation-language';

export type TurnState = 'IDLE' | 'LISTENING' | 'USER_SPEAKING' | 'PROCESSING' | 'AI_SPEAKING' | 'INTERRUPTED' | 'ERROR';

export type IncidentUrgency = 'unknown' | 'normal' | 'medium' | 'high' | 'critical';

export type IncidentField = '場所' | '人数' | '残量' | '最後に受け取った時刻' | '追加確認';

export interface IncidentState {
  language: string;
  location?: string;
  target?: { type?: string; count?: number; ageGroup?: string };
  facts: string[];
  request?: string;
  urgency: IncidentUrgency;
  safetyFlags: string[];
  missingFields: string[];
  askedFields: string[];
  originalText: string[];
  confidence?: number;
  category?: ShelterCategory;
  analysis?: ShelterAnalysis;
  provenance?: IncidentProvenance;
  structuredComplete?: boolean;
  fourBRequested?: boolean;
  fourBStatus?: FourBStatus;
}

export type ConversationTurn = {
  state: IncidentState;
  reply: string;
  nextField: IncidentField | null;
  safety: SafetyResult;
  requiresConfirmation: boolean;
};

export interface ConversationProvider {
  respond(text: string, state: IncidentState, intake?: ShelterIntake): Promise<ConversationTurn>;
}

export interface VADProvider {
  prepare(): Promise<boolean>;
  start(callbacks: { onSpeechStart: () => void; onSpeechEnd: () => void }): void;
  stop(): void;
  release(): void;
}

export interface ASRProvider {
  readonly supported: boolean;
  start(callbacks: { onInterim: (text: string) => void; onFinal: (text: string) => void; onError: (reason?: string) => void; onEnd: () => void }): void;
  stop(): void;
  abort(): void;
}

export interface TTSProvider {
  readonly supported: boolean;
  speak(text: string, callbacks: { onStart: () => void; onEnd: () => void; onError: () => void }, language?: ConversationLanguage): void;
  stop(): void;
}

export interface IncidentExtractor {
  extract(text: string, state: IncidentState, intake?: ShelterIntake): Promise<IncidentState>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

const FORBIDDEN_PHRASES = ['落ち着いてください', '深呼吸してください', '冷静になってください', 'お気持ちは完全に理解できます', '大丈夫です', '安心してください'];

export { detectSafetyFlags, safetyGuard } from './safety-guard';
export type { SafetyGuard, SafetyResult } from './safety-guard';

function countFromText(value: string): number | undefined {
  const match = value.match(/(\d{1,3})\s*(?:人|名)/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function targetFromAnalysis(analysis: ShelterAnalysis): IncidentState['target'] {
  const ageGroup = analysis.vulnerablePeople.find((item) => item !== '不明');
  const count = countFromText(analysis.peopleCount);
  return ageGroup || count ? { ageGroup, count } : undefined;
}

function urgencyFromAnalysis(analysis: ShelterAnalysis, safety: SafetyResult): IncidentUrgency {
  if (safety.immediate || analysis.urgentReview) return 'critical';
  if (analysis.urgencyCandidate === '高') return 'high';
  if (analysis.urgencyCandidate === '中') return 'medium';
  return 'normal';
}

function mergeUnique(values: string[], limit = 20): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, limit);
}

function provenance(value: unknown, source: IncidentSource, confirmed: boolean, evidence: string | null = null, messageId: string | null = null): IncidentFieldProvenance {
  return { value, source, confirmed, messageId, evidence };
}

function structuredComplete(state: IncidentState): boolean {
  if (!state.request || state.request === 'general_assistance' || !state.location) return false;
  if (['water_supply', 'food_supply', 'infant_supplies'].includes(state.request) && !state.target?.count) return false;
  if (state.request === 'medical_assistance' && !state.facts.length && !state.safetyFlags.length) return false;
  return true;
}

/**
 * 4B is an escalation lane, not the source of truth. Simple, structured
 * incidents can be shown to staff immediately from deterministic fields.
 */
export function shouldRequestExtraction(text: string, state: IncidentState): { useExtraction: boolean; structuredComplete: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const body = text.trim();
  const complete = structuredComplete(state);
  if (!complete) reasons.push('structured_incomplete');
  if (body.length > 120) reasons.push('long_free_text');
  if (/(かもしれ|たぶん|おそらく|でも|ただ|一方|maybe|perhaps|not sure|可能|也许|可能性|아마|모르)/i.test(body)) reasons.push('uncertainty_or_contradiction');
  const domainHits = [/(水|飲料|給水|water)/i, /(食料|毛布|おむつ|ミルク|food|blanket)/i, /(トイレ|toilet)/i, /(薬|発熱|呼吸|medical|medicine|fever|breath)/i, /(火|煙|fire)/i, /(暴力|violence)/i].filter((pattern) => pattern.test(body)).length;
  if (domainHits >= 2 || (domainHits > 0 && /(また|さらに|同時|それから|and|also|그리고|以及)/i.test(body))) reasons.push('mixed_request');
  if (/(ではない|ではありません|not\s+(?:a\s+)?fire|but\s+there)/i.test(body)) reasons.push('contradiction');
  if (state.safetyFlags.length && body.length > 80) reasons.push('important_hidden_facts_possible');
  return { useExtraction: reasons.length > 0, structuredComplete: complete, reasons };
}

function withTextProvenance(state: IncidentState, text: string, next: IncidentState): IncidentState {
  const current = state.provenance ?? {};
  const nextFacts = next.facts.filter((fact) => !state.facts.includes(fact)).map((fact) => provenance(fact, 'user_text', false, text));
  return {
    ...next,
    provenance: {
      ...current,
      ...(next.location && next.location !== state.location ? { location: provenance(next.location, 'user_text', false, text) } : {}),
      ...(next.target && JSON.stringify(next.target) !== JSON.stringify(state.target) ? { target: provenance(next.target, 'user_text', false, text) } : {}),
      ...(next.request && next.request !== state.request ? { request: provenance(next.request, 'user_text', false, text) } : {}),
      ...(nextFacts.length ? { facts: [...(current.facts ?? []), ...nextFacts].slice(-20) } : {}),
      ...(next.urgency !== 'unknown' && next.urgency !== state.urgency ? { urgency: provenance(next.urgency, next.safetyFlags.length ? 'safety_rule' : 'user_text', false, text) } : {}),
      ...(next.safetyFlags.length ? { safetyFlags: provenance(next.safetyFlags, 'safety_rule', false, text) } : {}),
    },
    structuredComplete: structuredComplete(next),
  };
}

export function createInitialIncident(intake: ShelterIntake = {}, language: ConversationLanguage = 'ja'): IncidentState {
  const count = countFromText(intake.peopleCount ?? '');
  const initialProvenance: IncidentProvenance = {};
  if (intake.location) initialProvenance.location = provenance(intake.location, 'user_selection', true, null, 'intake:location');
  if (count) initialProvenance.target = provenance({ count }, 'user_selection', true, null, 'intake:peopleCount');
  return {
    language: normalizeConversationLanguage(language),
    location: intake.location || undefined,
    target: count ? { count } : undefined,
    facts: [],
    urgency: 'unknown',
    safetyFlags: [],
    missingFields: [],
    askedFields: [],
    originalText: [],
    provenance: initialProvenance,
    structuredComplete: false,
    fourBRequested: false,
    fourBStatus: 'not_needed',
  };
}

export function intakeFromIncident(state: IncidentState): ShelterIntake {
  const count = state.target?.count ? `${state.target.count}人` : '';
  const fact = (label: string) => state.facts.find((item) => item.startsWith(`${label}：`))?.replace(`${label}：`, '') ?? '';
  return {
    location: state.location ?? '',
    issueLocation: state.location ?? '',
    peopleCount: count || fact('人数'),
    resourceRemaining: fact('残量・不足状況'),
    lastReceivedAt: fact('最後に受け取った時刻'),
    additionalDetails: fact('追加確認'),
  };
}

export function extractIncident(text: string, state: IncidentState, intake: ShelterIntake = {}): IncidentState {
  const body = [...state.originalText, text.trim()].filter(Boolean).join('\n').slice(0, 500);
  // A newly selected answer must win over the values inferred from the previous
  // turn. Otherwise a resident's correction (for example, changing the location)
  // is immediately overwritten by the older IncidentState.
  const analysis = generateShelterAnalysis(body, { ...intakeFromIncident(state), ...intake });
  const safety = safetyGuard.inspect(body);
  const hints = extractMultilingualIncidentHints(text);
  const category = hints.category ?? analysis.category;
  const request = hints.request ?? analysis.request;
  const location = analysis.location || state.location || hints.location;
  const target = hints.target ?? targetFromAnalysis(analysis) ?? state.target;
  const missing = new Set(analysis.missingInformation);
  if (!location) missing.add('場所');
  if (!target?.count && ['water_supply', 'food_supply', 'infant_supplies'].includes(request ?? '')) missing.add('人数');
  const next = {
    ...state,
    location,
    target,
    facts: mergeUnique([...analysis.facts, ...hints.facts]),
    request,
    urgency: hints.urgent ? 'critical' : urgencyFromAnalysis(analysis, safety),
    safetyFlags: mergeUnique([...state.safetyFlags, ...safety.flags], 10),
    missingFields: mergeUnique(Array.from(missing), 10),
    originalText: [...state.originalText, text.trim()].filter(Boolean).join('\n').slice(0, 500).split('\n'),
    confidence: analysis.urgencyConfidence,
    category,
    analysis,
  };
  return withTextProvenance(state, text, next);
}

export function applyIncidentAnswer(state: IncidentState, field: IncidentField, answer: string): IncidentState {
  const value = answer.trim().slice(0, 120);
  const intake = intakeFromIncident(state);
  if (field === '場所') { intake.location = value; intake.issueLocation = value; }
  if (field === '人数') intake.peopleCount = value;
  if (field === '残量') intake.resourceRemaining = value;
  if (field === '最後に受け取った時刻') intake.lastReceivedAt = value;
  if (field === '追加確認') intake.additionalDetails = value;
  const next = extractIncident(value, { ...state, askedFields: mergeUnique([...state.askedFields, field]) }, intake);
  const fieldId = `choice:${field}:${Date.now()}`;
  const provenanceByField: IncidentProvenance = { ...(next.provenance ?? {}) };
  if (field === '場所') provenanceByField.location = provenance(value, 'user_selection', true, null, fieldId);
  if (field === '人数') {
    const count = Number(value.match(/\d+/)?.[0] ?? NaN);
    provenanceByField.target = provenance({ ...(next.target ?? {}), ...(Number.isFinite(count) ? { count } : {}) }, 'user_selection', true, null, fieldId);
    provenanceByField.affectedCount = provenance(value, 'user_selection', true, null, fieldId);
  }
  if (field === '残量') provenanceByField.quantity = provenance(value, 'user_selection', true, null, fieldId);
  if (field === '最後に受け取った時刻') provenanceByField.time = provenance(value, 'user_selection', true, null, fieldId);
  if (field === '追加確認') provenanceByField.facts = [...(next.provenance?.facts ?? []), provenance(value, 'user_selection', true, null, fieldId)].slice(-20);
  return { ...next, askedFields: mergeUnique([...next.askedFields, field], 10), provenance: provenanceByField, structuredComplete: structuredComplete(next) };
}

export function fieldQuestion(field: IncidentField, category: ShelterCategory = 'その他', language: ConversationLanguage = 'ja'): string {
  if (field === '追加確認' && category !== 'トイレ・衛生') return localizedFieldQuestion(field, category, language);
  if (field === '追加確認') return localizedFieldQuestion(field, category, language);
  if (field === '残量' && category === '水・飲料') return localizedFieldQuestion(field, category, language);
  if (language !== 'ja') return localizedFieldQuestion(field, category, language);
  return shelterFollowUp(field, category).question;
}

export function fieldOptions(field: IncidentField, category: ShelterCategory = 'その他'): string[] {
  if (field === '追加確認') return category === 'トイレ・衛生' ? ['使える', '使えない', 'わからない'] : ['意識はある', '呼吸が苦しい', '痛みがある', '薬が必要', 'わからない'];
  return shelterFollowUp(field, category).options;
}

export function buildIncidentCard(state: IncidentState): string {
  const analysis = state.analysis;
  const facts = state.facts.filter((item) => !item.startsWith('相談分類：')).slice(0, 6);
  return [
    `場所：${state.location || '未確認'}`,
    `対象：${state.target?.ageGroup ? `${state.target.ageGroup} ` : ''}${state.target?.count ? `${state.target.count}人` : '未確認'}`,
    `事実：${facts.length ? facts.join('／') : analysis?.title || '確認中'}`,
    `要望：${state.request || '職員による確認'}`,
    `緊急性：${state.urgency === 'critical' ? '至急確認' : state.urgency === 'high' ? '高' : state.urgency === 'medium' ? '中' : '確認中'}`,
  ].join('\n');
}

function safeReply(text: string, language: ConversationLanguage = 'ja'): string {
  const forbidden = language === 'en'
    ? ['calm down', 'take a deep breath', "don't worry", 'you will be fine', "you're fine"]
    : language === 'zh' ? ['冷静下来', '深呼吸', '别担心', '没事']
      : language === 'ko' ? ['진정하세요', '심호흡', '걱정하지 마세요', '괜찮습니다']
        : FORBIDDEN_PHRASES;
  if (!forbidden.some((phrase) => text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()))) return text;
  return localizedSafetyFallback(language);
}

export class LocalRulesConversationProvider implements ConversationProvider {
  async respond(text: string, state: IncidentState, intake: ShelterIntake = {}): Promise<ConversationTurn> {
    const nextState = extractIncident(text, state, intake);
    const safety = safetyGuard.inspect(nextState.originalText.join('\n'));
    // The fallback must preserve the resident's free-form voice instead of
    // turning every consultation into a scripted intake interview. Only an
    // urgent case without a location gets an immediate follow-up prompt.
    const nextField = safety.immediate && !nextState.location && !nextState.askedFields.includes('場所') ? '場所' : null;
    const language = normalizeConversationLanguage(nextState.language);
    const reply = safety.immediate
      ? localizedEmergencyReply(language, Boolean(nextField))
      : localizedReadyReply(language);
    return { state: nextState, reply: safeReply(reply, language), nextField, safety, requiresConfirmation: !safety.immediate && !nextField };
  }
}

/** Backward-compatible name for the Phase 1 fallback. */
export { LocalRulesConversationProvider as LocalConversationProvider };

export function canonicalFromIncident(state: IncidentState): CanonicalIncidentState {
  return {
    language: state.language,
    location: state.location ?? null,
    target: state.target ? {
      type: state.target.type ?? null,
      count: state.target.count ?? null,
      ageGroup: state.target.ageGroup ?? null,
    } : null,
    facts: state.facts,
    request: state.request ?? null,
    urgency: state.urgency,
    safetyFlags: state.safetyFlags,
    missingFields: state.missingFields,
    askedFields: state.askedFields,
    originalText: state.originalText,
    confidence: state.confidence ?? null,
    category: state.category ?? null,
    provenance: state.provenance,
    structuredComplete: state.structuredComplete,
    fourBRequested: state.fourBRequested,
    fourBStatus: state.fourBStatus,
  };
}

function stateFromCanonical(fallback: IncidentState, candidate: CanonicalIncidentState): IncidentState {
  const safety = safetyGuard.inspect(fallback.originalText.join('\n'));
  const candidateProvenance: IncidentProvenance = { ...(fallback.provenance ?? {}) };
  if (candidate.location && candidate.location !== fallback.location) candidateProvenance.location = provenance(candidate.location, 'llm_extraction', false, fallback.originalText.join('\n'));
  if (candidate.target && JSON.stringify(candidate.target) !== JSON.stringify(fallback.target)) candidateProvenance.target = provenance(candidate.target, 'llm_extraction', false, fallback.originalText.join('\n'));
  if (candidate.request && candidate.request !== fallback.request) candidateProvenance.request = provenance(candidate.request, 'llm_extraction', false, fallback.originalText.join('\n'));
  if (candidate.facts.length) candidateProvenance.facts = candidate.facts.map((fact) => fallback.facts.includes(fact) ? (fallback.provenance?.facts?.find((item) => item.value === fact) ?? provenance(fact, 'user_text', false, null)) : provenance(fact, 'llm_extraction', false, fallback.originalText.join('\n'))).slice(-20);
  return {
    ...fallback,
    location: candidate.location ?? undefined,
    target: candidate.target ? {
      type: candidate.target.type ?? undefined,
      count: candidate.target.count ?? undefined,
      ageGroup: candidate.target.ageGroup ?? undefined,
    } : undefined,
    facts: mergeUnique(candidate.facts),
    request: candidate.request ?? undefined,
    urgency: candidate.urgency,
    safetyFlags: mergeUnique([...fallback.safetyFlags, ...candidate.safetyFlags, ...safety.flags], 10),
    missingFields: mergeUnique(candidate.missingFields, 10),
    askedFields: mergeUnique(fallback.askedFields, 10),
    originalText: fallback.originalText,
    confidence: candidate.confidence ?? fallback.confidence,
    category: candidate.category ?? fallback.category,
    provenance: candidateProvenance,
    structuredComplete: structuredComplete({ ...fallback, location: candidate.location ?? undefined, request: candidate.request ?? undefined, target: candidate.target ? { count: candidate.target.count ?? undefined, type: candidate.target.type ?? undefined, ageGroup: candidate.target.ageGroup ?? undefined } : undefined, facts: candidate.facts }),
    fourBRequested: true,
    fourBStatus: 'completed',
  };
}

function fieldFromModel(value: unknown): IncidentField | null {
  return value === '場所' || value === '人数' || value === '残量' || value === '最後に受け取った時刻' || value === '追加確認' ? value : null;
}

/** Phase 2 client adapter. It calls the server-side model gateway and falls back safely. */
export class ApiConversationProvider implements ConversationProvider {
  constructor(private readonly fallback: ConversationProvider = new LocalRulesConversationProvider()) {}

  async respond(text: string, state: IncidentState, intake: ShelterIntake = {}): Promise<ConversationTurn> {
    const fallback = await this.fallback.respond(text, state, intake);
    try {
      const result = await requestVoiceModel({ mode: 'conversation', text, state, intake, selectedLanguage: normalizeConversationLanguage(state.language) });
      const modelField = fieldFromModel(result.nextField);
      const nextField = modelField && !state.askedFields.includes(modelField) && (state.missingFields.includes(modelField) || (modelField === '場所' && !state.location))
        ? modelField
        : fallback.nextField;
      return {
        state,
        reply: safeReply(typeof result.reply === 'string' ? result.reply.trim().slice(0, 500) : fallback.reply, normalizeConversationLanguage(state.language)),
        nextField,
        safety: fallback.safety,
        requiresConfirmation: nextField === null && result.requiresConfirmation !== false,
      };
    } catch {
      return fallback;
    }
  }
}

type SpeechRecognitionResultLike = { isFinal: boolean; 0?: { transcript?: string } };
type SpeechRecognitionEventLike = { resultIndex?: number; results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionErrorLike = { error?: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event?: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

export class BrowserASRProvider implements ASRProvider {
  private recognition: SpeechRecognitionLike | null = null;
  private callbacks: { onInterim: (text: string) => void; onFinal: (text: string) => void; onError: (reason?: string) => void; onEnd: () => void } | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private endNotified = false;
  private localProcessingState: 'true' | 'false' | 'unknown' = 'unknown';
  readonly supported: boolean;
  get localProcessing(): 'true' | 'false' | 'unknown' { return this.localProcessingState; }

  constructor(private readonly language = 'ja-JP') {
    const speechWindow = typeof window === 'undefined' ? null : window as SpeechWindow;
    this.supported = Boolean(speechWindow?.SpeechRecognition ?? speechWindow?.webkitSpeechRecognition);
  }

  start(callbacks: { onInterim: (text: string) => void; onFinal: (text: string) => void; onError: (reason?: string) => void; onEnd: () => void }): void {
    if (!this.supported || typeof window === 'undefined') { callbacks.onError(); return; }
    this.abort();
    this.callbacks = callbacks;
    this.active = true;
    this.endNotified = false;
    this.openRecognition();
  }

  private openRecognition(): void {
    if (!this.active || typeof window === 'undefined') return;
    const speechWindow = window as SpeechWindow;
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) { this.active = false; this.callbacks?.onError(); return; }
    const recognition = new Constructor();
    this.localProcessingState = typeof recognition.processLocally === 'boolean' ? String(recognition.processLocally) as 'true' | 'false' : 'unknown';
    recognition.lang = this.language;
    // Chrome can end a non-continuous session immediately when it sees silence.
    // Keep the user-visible session alive and restart only the browser recognizer.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => undefined;
    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      const start = event.resultIndex ?? 0;
      for (let index = start; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? '';
        if (result?.isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (interim) this.callbacks?.onInterim(interim);
      if (finalText) this.callbacks?.onFinal(finalText);
    };
    recognition.onerror = (event) => {
      // Web Speech often reports an unavailable recognition service as
      // `network`. Retrying forever leaves the resident on a microphone
      // screen with no usable path, so offer the text path instead.
      const terminal = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(event?.error ?? '');
      if (terminal) {
        this.active = false;
        this.callbacks?.onError(event?.error);
      }
      // no-speech and transient service errors are followed by onend, where the
      // recognizer is restarted without resetting the resident's session.
    };
    recognition.onend = () => {
      if (!this.active) { this.notifyEnd(); return; }
      this.restartTimer = setTimeout(() => this.openRecognition(), 120);
    };
    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      this.active = false;
      this.callbacks?.onError();
    }
  }

  private notifyEnd(): void {
    if (this.endNotified) return;
    this.endNotified = true;
    this.callbacks?.onEnd();
  }

  stop(): void {
    this.active = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const current = this.recognition;
    this.recognition = null;
    try { current?.stop(); } catch { /* already stopped */ }
    this.notifyEnd();
  }

  abort(): void {
    this.active = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    try { this.recognition?.abort(); } catch { /* already stopped */ }
    this.recognition = null;
    this.callbacks = null;
  }
}

export class BrowserTTSProvider implements TTSProvider {
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  speak(text: string, callbacks: { onStart: () => void; onEnd: () => void; onError: () => void }, language: ConversationLanguage = 'ja'): void {
    if (!this.supported || typeof window === 'undefined') { callbacks.onError(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLanguageTag(language); utterance.rate = 0.96; utterance.pitch = 1; utterance.volume = 1;
    utterance.onstart = callbacks.onStart;
    utterance.onend = callbacks.onEnd;
    utterance.onerror = callbacks.onError;
    window.speechSynthesis.speak(utterance);
  }

  stop(): void { if (this.supported && typeof window !== 'undefined') window.speechSynthesis.cancel(); }
}

export class BrowserVADProvider implements VADProvider {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private frame: number | null = null;
  private speaking = false;
  private speechSince = 0;
  private silenceSince = 0;
  readonly mode = 'browser-level-vad' as const;

  async prepare(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      return true;
    } catch { return false; }
  }

  start(callbacks: { onSpeechStart: () => void; onSpeechEnd: () => void }): void {
    if (!this.stream || typeof window === 'undefined') return;
    this.stop();
    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    this.context = new AudioContextConstructor();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    const buffer = new Uint8Array(this.analyser.fftSize);
    const sample = () => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(buffer);
      let energy = 0;
      for (const value of buffer) { const normalized = (value - 128) / 128; energy += normalized * normalized; }
      const rms = Math.sqrt(energy / buffer.length);
      const now = performance.now();
      if (rms > 0.035) {
        this.silenceSince = 0;
        if (!this.speechSince) this.speechSince = now;
        if (!this.speaking && now - this.speechSince > 100) { this.speaking = true; callbacks.onSpeechStart(); }
      } else {
        this.speechSince = 0;
        if (this.speaking) {
          if (!this.silenceSince) this.silenceSince = now;
          if (now - this.silenceSince > 650) { this.speaking = false; callbacks.onSpeechEnd(); }
        }
      }
      this.frame = requestAnimationFrame(sample);
    };
    this.frame = requestAnimationFrame(sample);
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.speaking = false;
    this.speechSince = 0;
    this.silenceSince = 0;
  }

  release(): void { this.stop(); this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null; }
}

export class LocalIncidentExtractor implements IncidentExtractor {
  async extract(text: string, state: IncidentState, intake: ShelterIntake = {}): Promise<IncidentState> { return extractIncident(text, state, intake); }
}

/** Phase 2 adapter. The raw model JSON is validated before it can affect the card. */
export class ApiIncidentExtractor implements IncidentExtractor {
  constructor(private readonly fallback: IncidentExtractor = new LocalIncidentExtractor()) {}

  async extract(text: string, state: IncidentState, intake: ShelterIntake = {}): Promise<IncidentState> {
    // Quick-choice answers are already appended by applyIncidentAnswer.
    // Do not append the same answer a second time before asking the model.
    const fallback = state.originalText.at(-1) === text ? state : await this.fallback.extract(text, state, intake);
    try {
      const result = await requestVoiceModel({ mode: 'extract', text, state: fallback, intake, selectedLanguage: normalizeConversationLanguage(fallback.language) });
      const candidate = normalizeIncidentCandidate(result.incident, canonicalFromIncident(fallback));
      return stateFromCanonical(fallback, candidate);
    } catch {
      return { ...fallback, fourBRequested: true, fourBStatus: 'failed', structuredComplete: structuredComplete(fallback) };
    }
  }
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    // MVP placeholder: the provider boundary is ready for Qwen3-Embedding or another local model.
    return Array.from(text.slice(0, 64), (character) => character.codePointAt(0) ?? 0).map((value) => value / 0x10ffff);
  }
}
