import {
  generateShelterAnalysis,
  shelterFollowUp,
  type ShelterAnalysis,
  type ShelterCategory,
  type ShelterIntake,
} from '../../db/local-ai';

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
}

export type SafetyResult = {
  flags: string[];
  immediate: boolean;
};

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
  release(): void;
}

export interface ASRProvider {
  readonly supported: boolean;
  start(callbacks: { onInterim: (text: string) => void; onFinal: (text: string) => void; onError: () => void; onEnd: () => void }): void;
  stop(): void;
  abort(): void;
}

export interface TTSProvider {
  readonly supported: boolean;
  speak(text: string, callbacks: { onStart: () => void; onEnd: () => void; onError: () => void }): void;
  stop(): void;
}

export interface IncidentExtractor {
  extract(text: string, state: IncidentState, intake?: ShelterIntake): IncidentState;
}

export interface SafetyGuard {
  inspect(text: string): SafetyResult;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

const SAFETY_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '意識・呼吸の異常', pattern: /(意識(?:が|は)?(?:ない|ありません|おかしい)|呼吸(?:が|は)?(?:苦しい|できない|おかしい|止ま)|息(?:が|を)(?:できない|苦しい))/i },
  { label: '大量出血', pattern: /(大量出血|血が止まら|出血が(?:ひど|多))/i },
  { label: '強い胸痛', pattern: /(強い胸痛|胸(?:が|の)(?:強く)?痛|胸を締め付け)/i },
  { label: '火災・煙', pattern: /(火災|火事|煙が|燃えて|焦げ臭)/i },
  { label: '暴力・武器', pattern: /(暴力|殴ら|殴って|襲われ|武器|刃物|ナイフ)/i },
  { label: '自傷・他害', pattern: /(自傷|自殺|死にたい|消えたい|殺す|他害|自分を傷つけ)/i },
  { label: '重大な体調変化', pattern: /(ぐったり|倒れ|けいれん|痙攣|39度|40度|高熱|救急|命に関わ|生命の危険)/i },
];

const FIELD_ORDER: IncidentField[] = ['場所', '人数', '残量', '最後に受け取った時刻', '追加確認'];
const FORBIDDEN_PHRASES = ['落ち着いてください', '深呼吸してください', '冷静になってください', 'お気持ちは完全に理解できます', '大丈夫です', '安心してください'];

export function detectSafetyFlags(text: string): SafetyResult {
  const flags = SAFETY_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
  return { flags: Array.from(new Set(flags)), immediate: flags.length > 0 };
}

export const safetyGuard: SafetyGuard = { inspect: detectSafetyFlags };

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

export function createInitialIncident(intake: ShelterIntake = {}): IncidentState {
  const count = countFromText(intake.peopleCount ?? '');
  return {
    language: 'ja',
    location: intake.location || undefined,
    target: count ? { count } : undefined,
    facts: [],
    urgency: 'unknown',
    safetyFlags: [],
    missingFields: [],
    askedFields: [],
    originalText: [],
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
  return {
    ...state,
    location: analysis.location || state.location,
    target: targetFromAnalysis(analysis) ?? state.target,
    facts: mergeUnique(analysis.facts),
    request: analysis.request,
    urgency: urgencyFromAnalysis(analysis, safety),
    safetyFlags: mergeUnique([...state.safetyFlags, ...safety.flags], 10),
    missingFields: mergeUnique(analysis.missingInformation, 10),
    originalText: [...state.originalText, text.trim()].filter(Boolean).join('\n').slice(0, 500).split('\n'),
    confidence: analysis.urgencyConfidence,
    category: analysis.category,
    analysis,
  };
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
  return { ...next, askedFields: mergeUnique([...next.askedFields, field], 10) };
}

export function nextMissingField(state: IncidentState): IncidentField | null {
  return FIELD_ORDER.find((field) => state.missingFields.includes(field) && !state.askedFields.includes(field)) ?? null;
}

export function fieldQuestion(field: IncidentField, category: ShelterCategory = 'その他'): string {
  if (field === '追加確認') return category === 'トイレ・衛生' ? 'そのトイレは今、使えますか？' : 'いちばん気になる状況を教えてください。';
  return shelterFollowUp(field, category).question;
}

export function fieldOptions(field: IncidentField, category: ShelterCategory = 'その他'): string[] {
  if (field === '追加確認') return category === 'トイレ・衛生' ? ['使える', '使えない', 'わからない'] : ['意識はある', '呼吸が苦しい', '痛みがある', '薬が必要', 'わからない'];
  return shelterFollowUp(field, category).options;
}

function shortAcknowledgement(state: IncidentState): string {
  if (state.safetyFlags.length) return '緊急の可能性がある内容として、先に職員へ知らせます。';
  if (state.urgency === 'high' || state.urgency === 'medium') return '状況を確認します。';
  return '必要な情報だけ確認します。';
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

function safeReply(text: string): string {
  if (!FORBIDDEN_PHRASES.some((phrase) => text.includes(phrase))) return text;
  return '状況を確認します。必要な情報を一つだけ教えてください。';
}

export class LocalConversationProvider implements ConversationProvider {
  async respond(text: string, state: IncidentState, intake: ShelterIntake = {}): Promise<ConversationTurn> {
    const nextState = extractIncident(text, state, intake);
    const safety = safetyGuard.inspect(nextState.originalText.join('\n'));
    const nextField = nextMissingField(nextState);
    const question = nextField ? fieldQuestion(nextField, nextState.category ?? 'その他') : '';
    const reply = safety.immediate
      ? `${shortAcknowledgement(nextState)}${nextField ? ` 今いる場所を教えてください。` : ' 近くの職員にもすぐ知らせてください。'}`
      : nextField
        ? `${shortAcknowledgement(nextState)} ${question}`
        : '内容を整理しました。職員へ伝える内容を確認してください。';
    return { state: nextState, reply: safeReply(reply), nextField, safety, requiresConfirmation: !safety.immediate && !nextField };
  }
}

type SpeechRecognitionResultLike = { isFinal: boolean; 0?: { transcript?: string } };
type SpeechRecognitionEventLike = { resultIndex?: number; results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

export class BrowserASRProvider implements ASRProvider {
  private recognition: SpeechRecognitionLike | null = null;
  readonly supported: boolean;

  constructor(private readonly language = 'ja-JP') {
    const speechWindow = typeof window === 'undefined' ? null : window as SpeechWindow;
    this.supported = Boolean(speechWindow?.SpeechRecognition ?? speechWindow?.webkitSpeechRecognition);
  }

  start(callbacks: { onInterim: (text: string) => void; onFinal: (text: string) => void; onError: () => void; onEnd: () => void }): void {
    if (!this.supported || typeof window === 'undefined') { callbacks.onError(); return; }
    const speechWindow = window as SpeechWindow;
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) { callbacks.onError(); return; }
    this.abort();
    const recognition = new Constructor();
    recognition.lang = this.language;
    recognition.continuous = false;
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
      if (interim) callbacks.onInterim(interim);
      if (finalText) callbacks.onFinal(finalText);
    };
    recognition.onerror = callbacks.onError;
    recognition.onend = callbacks.onEnd;
    this.recognition = recognition;
    try { recognition.start(); } catch { callbacks.onError(); }
  }

  stop(): void { try { this.recognition?.stop(); } catch { /* already stopped */ } }
  abort(): void { try { this.recognition?.abort(); } catch { /* already stopped */ } this.recognition = null; }
}

export class BrowserTTSProvider implements TTSProvider {
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  speak(text: string, callbacks: { onStart: () => void; onEnd: () => void; onError: () => void }): void {
    if (!this.supported || typeof window === 'undefined') { callbacks.onError(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP'; utterance.rate = 0.96; utterance.pitch = 1; utterance.volume = 1;
    utterance.onstart = callbacks.onStart;
    utterance.onend = callbacks.onEnd;
    utterance.onerror = callbacks.onError;
    window.speechSynthesis.speak(utterance);
  }

  stop(): void { if (this.supported && typeof window !== 'undefined') window.speechSynthesis.cancel(); }
}

export class BrowserVADProvider implements VADProvider {
  private stream: MediaStream | null = null;

  async prepare(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      return true;
    } catch { return false; }
  }

  release(): void { this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null; }
}

export class LocalIncidentExtractor implements IncidentExtractor {
  extract(text: string, state: IncidentState, intake: ShelterIntake = {}): IncidentState { return extractIncident(text, state, intake); }
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    // MVP placeholder: the provider boundary is ready for Qwen3-Embedding or another local model.
    return Array.from(text.slice(0, 64), (character) => character.codePointAt(0) ?? 0).map((value) => value / 0x10ffff);
  }
}
