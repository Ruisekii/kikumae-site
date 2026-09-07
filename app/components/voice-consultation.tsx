'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ShelterIntake } from '../../db/local-ai';
import {
  applyIncidentAnswer,
  BrowserASRProvider,
  BrowserTTSProvider,
  BrowserVADProvider,
  buildIncidentCard,
  canonicalFromIncident,
  createInitialIncident,
  extractIncident,
  fieldOptions,
  fieldQuestion,
  intakeFromIncident,
  ApiConversationProvider,
  ApiIncidentExtractor,
  nextMissingField,
  safetyGuard,
  type IncidentField,
  type IncidentState,
  type TurnState,
} from '../lib/voice-conversation';
import { useUserI18n } from '../user-i18n';

type VoiceMessage = { role: 'ai' | 'person'; text: string };
type Submission = { id: number; checkUrl: string };

type Props = {
  initialIntake: ShelterIntake;
  onClose: () => void;
  onUseText: () => void;
  onDirectStaff: () => void;
};

const stateLabels: Record<TurnState, string> = {
  IDLE: 'voice.stateReady', LISTENING: 'voice.stateListening', USER_SPEAKING: 'voice.stateRecognizing', PROCESSING: 'voice.stateThinking', AI_SPEAKING: 'voice.stateSpeaking', INTERRUPTED: 'voice.stateInterrupted', ERROR: 'voice.stateError',
};

function tokenFromCheckUrl(checkUrl: string): string {
  try { return new URL(checkUrl, window.location.origin).pathname.split('/').filter(Boolean).at(-1) ?? ''; } catch { return ''; }
}

export function VoiceConsultation({ initialIntake, onClose, onUseText, onDirectStaff }: Props) {
  const { t } = useUserI18n();
  const initialIncident = createInitialIncident(initialIntake);
  const providerRef = useRef(new ApiConversationProvider());
  const extractorRef = useRef(new ApiIncidentExtractor());
  const asrRef = useRef(new BrowserASRProvider());
  const ttsRef = useRef(new BrowserTTSProvider());
  const vadRef = useRef(new BrowserVADProvider());
  const incidentRef = useRef<IncidentState>(initialIncident);
  const [incident, setIncident] = useState<IncidentState>(initialIncident);
  const [turn, setTurn] = useState<TurnState>('IDLE');
  const [messages, setMessages] = useState<VoiceMessage[]>([{ role: 'ai', text: t('voice.welcome') }]);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [nextField, setNextField] = useState<IncidentField | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pttMode, setPttMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [asrSupported, setAsrSupported] = useState(false);
  const mountedRef = useRef(true);
  const listeningRef = useRef(false);

  useEffect(() => {
    incidentRef.current = incident;
  }, [incident]);

  useEffect(() => { setAsrSupported(asrRef.current.supported); }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    listeningRef.current = false;
    asrRef.current.abort();
    ttsRef.current.stop();
    vadRef.current.release();
  }, []);

  function updateIncident(next: IncidentState) {
    incidentRef.current = next;
    setIncident(next);
  }

  function addMessage(message: VoiceMessage) {
    setMessages((current) => [...current, message].slice(-12));
  }

  function interruptSpeech() {
    if (turn === 'AI_SPEAKING') {
      ttsRef.current.stop();
      setTurn('INTERRUPTED');
    }
  }

  function speakReply(text: string) {
    if (!ttsRef.current.supported) { setTurn('IDLE'); return; }
    setTurn('AI_SPEAKING');
    ttsRef.current.speak(text, {
      onStart: () => mountedRef.current && setTurn('AI_SPEAKING'),
      onEnd: () => mountedRef.current && setTurn('IDLE'),
      onError: () => mountedRef.current && setTurn('IDLE'),
    });
  }

  function setReply(text: string, field: IncidentField | null, confirm: boolean) {
    if (!mountedRef.current) return;
    addMessage({ role: 'ai', text });
    setNextField(field);
    setConfirmOpen(confirm);
    speakReply(text);
  }

  async function submitIncident(next: IncidentState, immediate: boolean): Promise<Submission | null> {
    if (busy || submission) return submission;
    const body = next.originalText.join('\n').trim().slice(0, 500);
    if (!body) return null;
    setBusy(true);
    setStatus(immediate ? t('voice.sendingUrgent') : t('voice.sending'));
    try {
      const response = await fetch('/api/questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, summary: buildIncidentCard(next), category: next.analysis?.category ?? 'その他', submissionKey: crypto.randomUUID(), intake: intakeFromIncident(next), incident: canonicalFromIncident(next) }),
      });
      const payload = await response.json() as { id?: number; checkUrl?: string; message?: string };
      if (!response.ok || typeof payload.id !== 'number' || !payload.checkUrl) { setStatus(payload.message ?? t('voice.sendError')); return null; }
      const saved = { id: payload.id, checkUrl: payload.checkUrl };
      setSubmission(saved); setConfirmOpen(false); setStatus(immediate ? t('voice.urgentSent') : t('voice.sent'));
      addMessage({ role: 'ai', text: immediate ? t('voice.urgentSentMessage') : t('voice.sentMessage') });
      return saved;
    } catch { setStatus(t('voice.connectionError')); return null; }
    finally { if (mountedRef.current) setBusy(false); }
  }

  async function appendPublicUpdate(next: IncidentState, saved: Submission) {
    const token = tokenFromCheckUrl(saved.checkUrl);
    if (!token) return;
    try {
      await fetch(`/api/questions/status/${token}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: next.originalText.join('\n').trim().slice(0, 500), intake: intakeFromIncident(next), incident: canonicalFromIncident(next) }),
      });
    } catch { /* 追加情報は次の再送を妨げない */ }
  }

  async function processTranscript(text: string) {
    const current = incidentRef.current;
    setTurn('PROCESSING');
    setInterimTranscript('');
    addMessage({ role: 'person', text });
    const safety = safetyGuard.inspect([...current.originalText, text].join('\n'));
    // Safety Lane is independent of model availability. The deterministic
    // state is sufficient to send the first alert before waiting for a model.
    const fallbackState = extractIncident(text, current, intakeFromIncident(current));
    const urgentState = { ...fallbackState, safetyFlags: Array.from(new Set([...fallbackState.safetyFlags, ...safety.flags])) };
    let saved = submission;
    if (safety.immediate && !saved) saved = await submitIncident(urgentState, true);
    const [conversation, extracted] = await Promise.all([
      providerRef.current.respond(text, current, intakeFromIncident(current)),
      extractorRef.current.extract(text, current, intakeFromIncident(current)),
    ]);
    updateIncident(extracted);
    const following = nextMissingField(extracted);
    if (saved) void appendPublicUpdate(extracted, saved);
    const reply = safety.immediate
      ? `緊急の可能性がある内容として、先に職員へ知らせます。${following ? ' 今いる場所を教えてください。' : ' 近くの職員にもすぐ知らせてください。'}`
      : conversation.reply;
    setReply(reply, following, !safety.immediate && !following && conversation.requiresConfirmation);
  }

  function startListening() {
    interruptSpeech();
    setConfirmOpen(false);
    listeningRef.current = true;
    setTurn('LISTENING');
    void vadRef.current.prepare().then((ready) => {
      if (!ready || !mountedRef.current || !listeningRef.current) return;
      vadRef.current.start({
        onSpeechStart: () => mountedRef.current && setTurn((current) => current === 'LISTENING' ? 'USER_SPEAKING' : current),
        onSpeechEnd: () => mountedRef.current && setTurn((current) => current === 'USER_SPEAKING' ? 'LISTENING' : current),
      });
    });
    asrRef.current.start({
      onInterim: (text) => { if (mountedRef.current) { setInterimTranscript(text); setTurn('USER_SPEAKING'); } },
      onFinal: (text) => { listeningRef.current = false; asrRef.current.stop(); vadRef.current.stop(); if (text.trim()) void processTranscript(text.trim()); },
      onError: () => { listeningRef.current = false; vadRef.current.stop(); if (mountedRef.current) { setTurn('ERROR'); setStatus(t('voice.recognitionError')); } },
      onEnd: () => { if (mountedRef.current) setTurn((current) => current === 'LISTENING' || current === 'USER_SPEAKING' ? 'IDLE' : current); },
    });
  }

  function stopListening() {
    listeningRef.current = false;
    asrRef.current.stop();
    vadRef.current.stop();
    setInterimTranscript('');
    setTurn((current) => current === 'LISTENING' || current === 'USER_SPEAKING' ? 'IDLE' : current);
  }

  function handleMicClick() {
    // Pointer down/up owns push-to-talk. Ignoring the synthetic click that
    // follows pointerup prevents a quick press from starting and immediately
    // stopping the same recognition session.
    if (pttMode) return;
    if (turn === 'AI_SPEAKING') { startListening(); return; }
    if (turn === 'LISTENING' || turn === 'USER_SPEAKING') stopListening();
    else startListening();
  }

  function handleMicKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!pttMode || (event.key !== ' ' && event.key !== 'Enter') || event.repeat) return;
    event.preventDefault();
    startListening();
  }

  function handleMicKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (!pttMode || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    stopListening();
  }

  async function handleFieldAnswer(field: IncidentField, value: string) {
    const localNext = applyIncidentAnswer(incidentRef.current, field, value);
    const next = await extractorRef.current.extract(value, localNext, intakeFromIncident(localNext));
    updateIncident(next);
    addMessage({ role: 'person', text: value });
    const following = nextMissingField(next);
    if (submission) void appendPublicUpdate(next, submission);
    if (following) {
      const question = fieldQuestion(following, next.category ?? 'その他');
      setReply(question, following, false);
    } else {
      const reply = '必要な情報がそろいました。職員へ伝える内容を確認してください。';
      setReply(reply, null, !submission);
    }
  }

  async function handleConfirm() {
    if (busy || submission) return;
    await submitIncident(incidentRef.current, false);
  }

  const currentOptions = nextField ? fieldOptions(nextField, incident.category ?? 'その他') : [];
  const stateText = t(stateLabels[turn]);
  const micLabel = turn === 'AI_SPEAKING' ? t('voice.interruptAndSpeak') : turn === 'LISTENING' || turn === 'USER_SPEAKING' ? t('voice.stopListening') : t('voice.startListening');

  return <section className="voice-consultation" aria-labelledby="voice-consult-title">
    <div className="voice-consult-head"><div><p className="eyebrow">{t('voice.eyebrow')}</p><h1 id="voice-consult-title">{t('voice.title')}</h1><p>{t('voice.lead')}</p></div><button className="text-button voice-close" type="button" onClick={onClose}>{t('voice.close')}</button></div>
    <div className={`voice-state voice-state-${turn.toLowerCase()}`} role="status" aria-live="polite"><span className="voice-state-dot" aria-hidden="true" />{stateText}</div>
    <div className="voice-messages" aria-live="polite">{messages.map((message, index) => <div className={`voice-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'ai' ? t('voice.aiLabel') : t('voice.youLabel')}</span><p>{message.text}</p></div>)}{interimTranscript && <div className="voice-caption"><span>{t('voice.liveCaption')}</span><p>{interimTranscript}</p></div>}</div>
    {incident.safetyFlags.length > 0 && <div className="voice-safety-alert" role="alert"><strong>{t('voice.safetyTitle')}</strong><p>{t('voice.safetyLead')}</p><small>{incident.safetyFlags.join('／')}</small></div>}
    {nextField && !submission && <div className="voice-quick-card"><p className="eyebrow">{t('voice.onlyOneQuestion')}</p><h2>{fieldQuestion(nextField, incident.category ?? 'その他')}</h2><div className="voice-quick-options">{currentOptions.map((option) => <button key={option} type="button" onClick={() => handleFieldAnswer(nextField, option)}>{option}</button>)}</div><p>{t('voice.quickHint')}</p></div>}
    {confirmOpen && !submission && <div className="voice-confirm-card"><p className="eyebrow">{t('voice.confirmEyebrow')}</p><h2>{t('voice.confirmTitle')}</h2><pre>{buildIncidentCard(incident)}</pre><div className="voice-confirm-actions"><button className="button secondary" type="button" onClick={onUseText}>{t('voice.editInText')}</button><button className="button accent" type="button" disabled={busy} onClick={() => { void handleConfirm(); }}>{busy ? t('voice.sending') : t('voice.confirmSend')}</button></div></div>}
    {submission && <div className="voice-sent-card"><span className="voice-sent-check" aria-hidden="true">✓</span><h2>{t('voice.sentTitle')}</h2><p>{t('voice.sentLead')}</p><p className="voice-receipt">{t('voice.receipt')} <strong>#{String(submission.id).padStart(4, '0')}</strong></p><a className="button accent" href={submission.checkUrl}>{t('voice.statusLink')}</a></div>}
    <div className="voice-controls"><button className={`voice-mic-button ${turn === 'LISTENING' || turn === 'USER_SPEAKING' ? 'is-listening' : ''}`} type="button" onClick={handleMicClick} onKeyDown={handleMicKeyDown} onKeyUp={handleMicKeyUp} onPointerDown={pttMode ? startListening : undefined} onPointerUp={pttMode ? stopListening : undefined} onPointerCancel={pttMode ? stopListening : undefined} aria-label={micLabel} disabled={busy && !submission}><span aria-hidden="true">{turn === 'AI_SPEAKING' ? '↗' : '🎙'}</span><strong>{micLabel}</strong></button><p>{asrSupported ? t('voice.micHint') : t('voice.unsupported')}</p></div>
    <div className="voice-secondary-actions"><button type="button" onClick={() => setPttMode((current) => !current)} aria-pressed={pttMode}>{pttMode ? t('voice.pttOn') : t('voice.pttOff')}</button><button type="button" onClick={onUseText}>{t('voice.useText')}</button><button type="button" onClick={onDirectStaff}>{t('voice.directStaff')}</button></div>
    {status && <p className="voice-status" role="status">{status}</p>}
  </section>;
}
