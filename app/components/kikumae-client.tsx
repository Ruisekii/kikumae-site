'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Faq, RelatedFaq } from '../../db/repository';

type Intake = { location: string; peopleCount: string; resourceRemaining: string; lastReceivedAt: string; additionalDetails: string };
type Analysis = { title: string; overview: string; facts: string[]; emotion: string; missingInformation: string[]; urgencyCandidate: string; urgentReview: boolean; category: string; location: string; peopleCount: string; resourceRemaining: string; lastReceivedAt: string };
type Preview = { body: string; summary: string; category: string; related: RelatedFaq[]; analysis: Analysis; followUp: { question: string; options: string[] } | null; submissionKey: string };
type ChatMessage = { from: 'ai' | 'person'; text: string };
type SupplementKey = 'location' | 'peopleCount' | 'resourceRemaining' | 'lastReceivedAt' | 'additionalDetails';
type SupplementField = { key: SupplementKey; label: string; kind: 'choice' | 'select' | 'stepper'; options?: string[]; help?: string };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
type SavedDraft = { savedAt?: number; input?: string; originalBody?: string; contextBody?: string; intake?: Intake; chatOpen?: boolean; messages?: ChatMessage[]; preview?: Preview | null; faqDecision?: boolean; readyToSubmit?: boolean; showSupplementSheet?: boolean };
type Props = { faqs: Faq[] };

const emptyIntake: Intake = { location: '', peopleCount: '', resourceRemaining: '', lastReceivedAt: '', additionalDetails: '' };
const LOCATION_OPTIONS = ['体育館', '体育館北側', '体育館南側', '北トイレ', '南トイレ', '受付', '救護スペース', '駐車場', '屋外'];
const normalize = (value: string) => value.toLocaleLowerCase('ja-JP').replace(/\s/g, '');
const isUrgentAnalysis = (analysis: Analysis) => analysis.urgentReview || analysis.urgencyCandidate === '高';

function supplementFields(analysis: Analysis, body: string, intake: Intake): SupplementField[] {
  const missing = new Set(analysis.missingInformation);
  const fields: SupplementField[] = [];
  if (missing.has('場所') && !intake.location) fields.push({ key: 'location', label: '今いる場所', kind: 'select', options: [...LOCATION_OPTIONS, 'わからない'], help: '場所が分かると、近くの職員が対応しやすくなります。' });
  if (missing.has('人数') && !intake.peopleCount) fields.push({ key: 'peopleCount', label: '対象になる人数', kind: 'choice', options: ['1人', '2〜5人', '6〜10人', '11人以上', 'わからない'] });
  if (missing.has('残量') && !intake.resourceRemaining) {
    const isBlanket = /毛布|枚/.test(body);
    fields.push(isBlanket ? { key: 'resourceRemaining', label: '必要な毛布の枚数', kind: 'stepper', help: 'おおよその枚数で大丈夫です。' } : { key: 'resourceRemaining', label: '残り・不足の状況', kind: 'choice', options: ['ほとんどない', '少しある', 'まだある', 'わからない'] });
  }
  if (missing.has('最後に受け取った時刻') && !intake.lastReceivedAt) fields.push({ key: 'lastReceivedAt', label: 'いつから／いつ必要ですか', kind: 'choice', options: ['今すぐ', '数時間以内', '今日中', '急がない', 'わからない'] });
  if (analysis.category === 'トイレ・衛生' && /トイレ|便所/.test(body) && !intake.additionalDetails) fields.push({ key: 'additionalDetails', label: 'そのトイレは今使えますか', kind: 'choice', options: ['使える', '使えない', 'わからない'] });
  if (analysis.category === '医療・薬' && /熱|薬|痛|体調|具合/.test(body) && !intake.additionalDetails) fields.push({ key: 'additionalDetails', label: 'いちばん近い状況を教えてください', kind: 'choice', options: ['意識はある', '呼吸が苦しい', '痛みがある', '薬が必要', 'わからない'] });
  return fields;
}

export type ConsultHistoryEntry = { id: number; checkUrl: string; title: string; savedAt: number };
const HISTORY_STORAGE_KEY = 'kikumae-consult-history';
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadConsultHistory(): ConsultHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const fresh = (parsed as ConsultHistoryEntry[]).filter((entry) => {
      if (!entry || typeof entry.id !== 'number' || typeof entry.checkUrl !== 'string' || typeof entry.title !== 'string' || typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > HISTORY_MAX_AGE_MS) return false;
      try { const url = new URL(entry.checkUrl, window.location.origin); return url.origin === window.location.origin && /^\/questions\/[0-9a-f-]{32,80}$/i.test(url.pathname); } catch { return false; }
    });
    if (fresh.length !== parsed.length) window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch { return []; }
}

export function appendConsultHistory(entry: ConsultHistoryEntry) {
  try { window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([entry, ...loadConsultHistory()].slice(0, 30))); } catch { /* 共用端末やプライベートモードでは保存しない */ }
}

export function clearConsultHistory() {
  try { window.localStorage.removeItem(HISTORY_STORAGE_KEY); } catch { /* 保存されていない場合は何もしない */ }
}

export function KikumaeClient({ faqs }: Props) {
  const [query, setQuery] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [originalBody, setOriginalBody] = useState('');
  const [contextBody, setContextBody] = useState('');
  const [intake, setIntake] = useState<Intake>(emptyIntake);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [faqDecision, setFaqDecision] = useState(false);
  const [showFaqCard, setShowFaqCard] = useState(false);
  const [showSupplementSheet, setShowSupplementSheet] = useState(false);
  const [supplementValues, setSupplementValues] = useState<Partial<Record<SupplementKey, string>>>({});
  const [readyToSubmit, setReadyToSubmit] = useState(false);
  const [checkUrl, setCheckUrl] = useState('');
  const [questionId, setQuestionId] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [offline, setOffline] = useState(false);
  const submitLockRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateConnection = () => setOffline(!navigator.onLine);
    updateConnection(); window.addEventListener('online', updateConnection); window.addEventListener('offline', updateConnection);
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem('kikumae-shelter-draft');
        if (!saved) return;
        const draft = JSON.parse(saved) as SavedDraft;
        if (draft.savedAt && Date.now() - draft.savedAt >= 24 * 60 * 60 * 1000) return;
        if (draft.input) setInput(draft.input); if (draft.originalBody) setOriginalBody(draft.originalBody); if (draft.contextBody) setContextBody(draft.contextBody); if (draft.intake) setIntake({ ...emptyIntake, ...draft.intake }); if (draft.chatOpen) setChatOpen(true); if (draft.messages?.length) setMessages(draft.messages); if (draft.preview) setPreview(draft.preview); if (draft.faqDecision) setFaqDecision(true); if (draft.readyToSubmit) setReadyToSubmit(true); if (draft.showSupplementSheet) setShowSupplementSheet(true);
      } catch { /* 下書きの復元は利用できる場合だけ行う */ }
    }, 0);
    return () => { window.clearTimeout(restoreTimer); window.removeEventListener('online', updateConnection); window.removeEventListener('offline', updateConnection); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const location = params.get('location')?.trim().slice(0, 120) ?? '';
      const peopleCount = params.get('people')?.trim().slice(0, 80) ?? '';
      if (location || peopleCount) setIntake((current) => ({ ...current, ...(location ? { location } : {}), ...(peopleCount ? { peopleCount } : {}) }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (checkUrl) { try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ } return; }
    if (!input && !originalBody && !messages.length) return;
    try { localStorage.setItem('kikumae-shelter-draft', JSON.stringify({ savedAt: Date.now(), input, originalBody, contextBody, intake, chatOpen, messages, preview, faqDecision, readyToSubmit, showSupplementSheet } satisfies SavedDraft)); } catch { /* 共用端末やプライベートモードでは保存しない */ }
  }, [input, originalBody, contextBody, intake, chatOpen, messages, preview, faqDecision, readyToSubmit, showSupplementSheet, checkUrl]);

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    const timer = window.setTimeout(() => setVoiceSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition)), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const matches = useMemo(() => {
    const term = normalize(query);
    if (!term) return faqs;
    return faqs.filter((faq) => normalize(`${faq.question}${faq.answer}${faq.category}`).includes(term));
  }, [faqs, query]);

  function addMessage(message: ChatMessage) { setMessages((current) => [...current, message]); }

  function beginChat(withVoice = false) {
    setChatOpen(true); setMessages([{ from: 'ai', text: '来てくださってありがとうございます。まず、いちばん困っていることを教えてください。短い言葉でも大丈夫です。' }]); setInput(''); setOriginalBody(''); setContextBody(''); setPreview(null); setFaqDecision(false); setShowFaqCard(false); setShowSupplementSheet(false); setSupplementValues({}); setReadyToSubmit(false); setQuestionId(null); setCheckUrl(''); setStatus(''); setIntake((current) => ({ location: current.location, peopleCount: current.peopleCount, resourceRemaining: '', lastReceivedAt: '', additionalDetails: '' }));
    try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ }
    window.setTimeout(() => { inputRef.current?.focus(); if (withVoice) startVoice(); }, 50);
  }

  function startVoice() {
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) { setStatus('このブラウザでは音声入力が使えないため、文字でお話しください。'); inputRef.current?.focus(); return; }
    const recognition = new SpeechRecognition(); recognition.lang = 'ja-JP'; recognition.interimResults = false; setListening(true);
    recognition.onresult = (event) => { const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(''); setInput(transcript); setListening(false); };
    recognition.onerror = () => { setListening(false); setStatus('音声を聞き取れませんでした。文字でも入力できます。'); };
    recognition.onend = () => setListening(false);
    recognition.start();
  }

  async function inspect(body: string, nextIntake: Intake) {
    setBusy(true); setStatus('内容を整理しています…');
    try {
      const response = await fetch('/api/questions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, intake: nextIntake }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; body?: string; summary?: string; category?: string; related?: RelatedFaq[]; analysis?: Analysis; followUp?: Preview['followUp'] };
      if (!response.ok || !payload.analysis) { setStatus(payload.message ?? '内容を整理できませんでした。'); return false; }
      const nextPreview: Preview = { body: payload.body ?? body, summary: payload.summary ?? '', category: payload.category ?? 'その他', related: payload.related ?? [], analysis: payload.analysis, followUp: payload.followUp ?? null, submissionKey: preview?.submissionKey ?? crypto.randomUUID() };
      setPreview(nextPreview); setIntake(nextIntake); setFaqDecision(false);
      setStatus('');
      const urgent = isUrgentAnalysis(nextPreview.analysis);
      const fields = supplementFields(nextPreview.analysis, nextPreview.body, nextIntake);
      setShowFaqCard(!urgent && nextPreview.related.length > 0);
      if (urgent) addMessage({ from: 'ai', text: '緊急の可能性がある内容として受け止めました。追加の確認を待たず、このまま職員へ届けられます。' });
      else if (nextPreview.related.length) addMessage({ from: 'ai', text: '近い案内が見つかりました。解決しなければ、整理した内容をそのまま職員へ届けられます。' });
      else addMessage({ from: 'ai', text: fields.length ? '内容を整理しました。必要な項目だけ、下からまとめて選んでください。' : '内容を整理しました。この内容を職員へ届ける前に確認できます。' });
      if (urgent || (!nextPreview.related.length && !fields.length)) setReadyToSubmit(true);
      else if (!nextPreview.related.length) { setSupplementValues({}); setShowSupplementSheet(true); setReadyToSubmit(false); }
      return true;
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? '通信が遅いようです。もう一度お試しください。' : '通信に失敗しました。もう一度お試しください。'); return false; }
    finally { setBusy(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput(''); addMessage({ from: 'person', text: trimmed });
    setOriginalBody(trimmed); setContextBody(trimmed);
    const ok = await inspect(trimmed, intake);
    if (!ok) { setOriginalBody(''); setContextBody(''); }
  }

  function setSupplementValue(key: SupplementKey, value: string) { setSupplementValues((current) => ({ ...current, [key]: value })); }

  function changeQuantity(delta: number) {
    const current = Number(supplementValues.resourceRemaining ?? '1');
    setSupplementValue('resourceRemaining', String(Math.max(1, Math.min(99, (Number.isFinite(current) ? current : 1) + delta))));
  }

  function editOriginal() {
    const original = originalBody;
    setShowSupplementSheet(false); setShowFaqCard(false); setReadyToSubmit(false); setPreview(null); setOriginalBody(''); setContextBody(''); setInput(original); setMessages([{ from: 'ai', text: '内容を直せます。変更したいところを入力して、もう一度確認してください。' }]);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  function confirmSupplements() {
    if (!preview) return;
    const values = { ...supplementValues };
    for (const field of supplementFields(preview.analysis, preview.body, intake)) if (field.kind === 'stepper' && !values[field.key]) values[field.key] = '1';
    const normalizedValues = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'string' && value.length > 0).map(([key, value]) => [key, key === 'resourceRemaining' && supplementFields(preview.analysis, preview.body, intake).some((field) => field.key === 'resourceRemaining' && field.kind === 'stepper') && /^\d+$/.test(value) ? `${value}枚` : value])); const nextIntake = { ...intake, ...normalizedValues } as Intake;
    const facts = [...preview.analysis.facts];
    const factLabels: Array<[string, SupplementKey]> = [['場所', 'location'], ['人数', 'peopleCount'], ['残量・不足状況', 'resourceRemaining'], ['最後に受け取った時刻', 'lastReceivedAt'], ['追加確認', 'additionalDetails']];
    for (const [label, key] of factLabels) { const value = nextIntake[key]; if (!value) continue; const index = facts.findIndex((fact) => fact.startsWith(`${label}：`)); if (index >= 0) facts[index] = `${label}：${value}`; else facts.push(`${label}：${value}`); }
    setIntake(nextIntake); setPreview({ ...preview, analysis: { ...preview.analysis, location: nextIntake.location, peopleCount: nextIntake.peopleCount, resourceRemaining: nextIntake.resourceRemaining, lastReceivedAt: nextIntake.lastReceivedAt, facts, missingInformation: [] } }); setShowSupplementSheet(false); setReadyToSubmit(true); setStatus('');
  }

  async function faqResult(resolved: boolean) {
    setFaqDecision(true); setShowFaqCard(false);
    if (resolved) { const faqId = preview?.related[0]?.id ?? null; void fetch('/api/faq-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faqId, query: originalBody }) }); addMessage({ from: 'ai', text: '解決につながってよかったです。必要なときは、いつでもここから相談してください。' }); setPreview(null); setOriginalBody(''); setContextBody(''); setReadyToSubmit(false); return; }
    addMessage({ from: 'ai', text: 'まだ困っていることがあるのですね。必要な項目だけ、まとめて確認します。' });
    if (preview) { const fields = supplementFields(preview.analysis, preview.body, intake); setSupplementValues({}); if (fields.length) { setShowSupplementSheet(true); setReadyToSubmit(false); } else setReadyToSubmit(true); }
  }

  async function submitQuestion() {
    if (!preview || busy || submitLockRef.current) return;
    submitLockRef.current = true; setBusy(true); setStatus('相談を届けています…');
    try {
      const response = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: originalBody, summary: preview.summary, category: preview.category, submissionKey: preview.submissionKey, intake }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; checkUrl?: string; id?: number };
      if (!response.ok) { setStatus(payload.message ?? '相談を届けられませんでした。'); return; }
      const url = payload.checkUrl ?? ''; const id = typeof payload.id === 'number' ? payload.id : null;
      setCheckUrl(url); setQuestionId(id); setReadyToSubmit(false); setStatus('相談が届きました。この画面を写真に撮るか、確認URLを保存してください。'); addMessage({ from: 'ai', text: `相談を受け付けました。相談ID${id != null ? ` #${String(id).padStart(4, '0')}` : ''}で対応状況を確認できます。` });
      if (id != null && url) { try { appendConsultHistory({ id, checkUrl: url, title: preview.category, savedAt: Date.now() }); } catch { /* 履歴保存はベストエフォート */ } }
      try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ }
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? '通信が遅いようです。もう一度お試しください。' : '通信に失敗しました。もう一度お試しください。'); }
    finally { submitLockRef.current = false; setBusy(false); }
  }

  function closeChat() { setChatOpen(false); setStatus(''); }

  async function copyCheckUrl() {
    const field = document.getElementById('check-url-text') as HTMLInputElement | null;
    field?.select();
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(new URL(checkUrl, window.location.origin).toString()); setStatus('確認ページのURLをコピーしました。'); return; } } catch { /* 手動コピーへ */ }
    setStatus('コピーできなかったため、URLを選択しました。そのまま保存してください。');
  }

  const knownContext = [intake.location && `場所：${intake.location}`, intake.peopleCount && `人数：${intake.peopleCount}`].filter(Boolean);

  return <main className="evac-theme">
    <header className="site-header shelter-header"><a className="brand" href="#home" aria-label="ホームへ戻る">◌ 相談窓口</a><nav aria-label="主要メニュー"><a href="#faq">よくある質問</a><Link href="/questions">相談状況</Link></nav></header>
    <section className="shelter-hero" id="home"><div className="shelter-hero-copy"><p className="eyebrow">避難所の相談窓口</p><h1>困っていることを、<br /><span>教えてください。</span></h1><p>言葉がまとまっていなくても大丈夫です。AIがいったん受け止め、必要なことを職員へ分かりやすく届けます。</p><div className="shelter-actions"><button className="button accent large" type="button" onClick={() => beginChat()}>▱ 文字で相談する</button><button className="button secondary large" type="button" disabled={!voiceSupported} onClick={() => beginChat(true)}>{voiceSupported ? '◉ 音声で話す' : '音声入力はこのブラウザでは使えません'}</button></div><p className="shelter-reassure">相談は匿名です。原文もそのまま保存され、職員が確認します。</p></div><div className="shelter-hero-note"><span className="note-icon">＋</span><div><strong>あなたの声を、<br />職員に届けます</strong><p>受付後は、対応状況をいつでも確認できます。</p></div></div></section>
    <section className="quick-links" aria-label="相談以外の入口"><a href="#faq"><span className="quick-icon">?</span><span><strong>よくある質問を見る</strong><small>水・食料・トイレなど</small></span><b>›</b></a><Link href="/questions"><span className="quick-icon">◷</span><span><strong>自分の相談状況を見る</strong><small>受付済み・確認中・対応中</small></span><b>›</b></Link></section>
    <section className="shelter-chat-section" aria-labelledby="chat-title">{!chatOpen ? <div className="chat-invite"><div><p className="eyebrow">まずはここから</p><h2 id="chat-title">うまく説明できなくても大丈夫です。</h2><p>「水が足りない」「薬がほしい」「どこに行けばいい？」など、思ったまま話してください。</p><p className="flow-hint">操作の目安：文章を1回入力 → 不足情報を1画面で選ぶ → 確認して送信</p></div><button className="button primary" type="button" onClick={() => beginChat()}>相談をはじめる <span>→</span></button></div> : <div className="chat-panel"><div className="chat-panel-head"><div><p className="eyebrow">相談中</p><h2 id="chat-title">お話を聞いています</h2></div><button className="text-button" type="button" onClick={closeChat}>閉じる</button></div>{knownContext.length > 0 && <div className="known-context" aria-label="自動で引き継いだ情報">自動で引き継いだ情報：{knownContext.join('　')}</div>}{offline && <div className="offline-notice" role="status">通信が不安定です。入力内容はこの端末に一時保存しています。</div>}<div className="chat-messages" aria-live="polite">{messages.map((message, index) => <div className={`chat-bubble ${message.from}`} key={`${message.from}-${index}`}><span>{message.from === 'ai' ? '相談窓口' : 'あなた'}</span><p>{message.text}</p></div>)}{showFaqCard && preview?.related.length && !faqDecision ? <div className="chat-faq-card"><p className="eyebrow">近い案内</p>{preview.related.slice(0, 2).map((faq) => <article key={faq.id}><strong>{faq.question}</strong><p>{faq.answer}</p></article>)}<p className="faq-question">この案内で解決しましたか？</p><div className="quick-replies"><button type="button" onClick={() => void faqResult(true)}>はい</button><button type="button" onClick={() => void faqResult(false)}>まだ相談したい</button></div></div> : null}{preview && readyToSubmit && !checkUrl && <div className="chat-confirm-card"><div className="analysis-mini"><span className="status-badge">{preview.analysis.urgentReview ? '要緊急確認' : '送信前の確認'}</span><strong>{preview.analysis.title}</strong><p>{preview.analysis.overview}</p><div className="submission-preview"><b>送信内容</b><ul>{preview.analysis.category && <li>困りごと：{preview.analysis.category}</li>}{preview.analysis.location && <li>場所：{preview.analysis.location}</li>}{preview.analysis.peopleCount && <li>対象：{preview.analysis.peopleCount}</li>}{preview.analysis.resourceRemaining && <li>残量・必要量：{preview.analysis.resourceRemaining}</li>}{preview.analysis.lastReceivedAt && <li>時期：{preview.analysis.lastReceivedAt}</li>}{preview.analysis.facts.filter((fact) => !fact.startsWith('場所：') && !fact.startsWith('人数：') && !fact.startsWith('残量・不足状況：') && !fact.startsWith('最後に受け取った時刻：')).slice(0, 3).map((fact) => <li key={fact}>{fact}</li>)}</ul></div></div><div className="form-actions"><button className="button secondary" type="button" onClick={editOriginal}>内容を修正する</button><button className="button accent" type="button" disabled={busy} onClick={() => void submitQuestion()}>この内容で送信</button></div><p className="input-hint">AIの整理を確認してから職員へ届けます。原文も保存されます。</p></div>}{checkUrl && <div className="chat-confirm-card delivered"><span className="delivered-check">✓</span><strong>相談が届きました</strong>{questionId != null && <p className="consult-id">相談ID <b>#{String(questionId).padStart(4, '0')}</b></p>}<p>{status}</p><div className="check-url-box"><label className="sr-only" htmlFor="check-url-text">確認URL</label><input id="check-url-text" className="check-url-input" readOnly value={checkUrl} onFocus={(event) => event.currentTarget.select()} /><button className="button secondary" type="button" onClick={() => void copyCheckUrl()}>URLをコピー</button></div><Link className="button accent" href={checkUrl}>相談状況を見る</Link><p className="save-hint">このページを写真に撮るか、確認URLを保存してください。</p><button className="text-button" type="button" onClick={() => beginChat()}>新しく相談する</button></div>}</div>{!checkUrl && !preview && <form className="chat-input" onSubmit={sendMessage}><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="ここに入力してください" maxLength={500} aria-label="相談内容" />{voiceSupported ? <span className="voice-slot is-voice-ready"><button className="voice-button" type="button" onClick={startVoice} aria-label="音声入力" disabled={listening}>{listening ? '●' : '◉'}</button></span> : <span className="voice-slot" aria-hidden="true" />}<button className="send-button" type="submit" disabled={busy || !input.trim()} aria-label="送信">↑</button></form>}{showSupplementSheet && preview && <div className="supplement-backdrop" role="presentation"><section className="supplement-sheet" role="dialog" aria-modal="true" aria-labelledby="supplement-title"><div className="supplement-grabber" aria-hidden="true" /><p className="eyebrow">あと少しだけ</p><h3 id="supplement-title">対応に必要な情報を選んでください</h3><p className="supplement-lead">分かる範囲で大丈夫です。入力済みの内容は聞き直しません。</p>{supplementFields(preview.analysis, preview.body, intake).map((field) => <div className="supplement-field" key={field.key}><label>{field.label}</label>{field.kind === 'select' && <select value={supplementValues[field.key] ?? ''} onChange={(event) => setSupplementValue(field.key, event.target.value)}><option value="">選んでください</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>}{field.kind === 'choice' && <div className="supplement-choice-grid">{field.options?.map((option) => <button className={supplementValues[field.key] === option ? 'selected' : ''} type="button" key={option} onClick={() => setSupplementValue(field.key, option)} aria-pressed={supplementValues[field.key] === option}>{option}</button>)}</div>}{field.kind === 'stepper' && <div className="quantity-stepper"><button type="button" onClick={() => changeQuantity(-1)} aria-label="枚数を減らす">−</button><strong>{supplementValues[field.key] ?? '1'}枚</strong><button type="button" onClick={() => changeQuantity(1)} aria-label="枚数を増やす">＋</button></div>}{field.help && <p>{field.help}</p>}</div>)}<div className="supplement-actions"><button className="button secondary" type="button" onClick={editOriginal}>内容を修正する</button><button className="button accent" type="button" onClick={confirmSupplements}>この内容で確認する</button></div><p className="input-hint">答えにくい項目は「わからない」を選べます。</p></section></div>}{status && !checkUrl && <p className="form-status" role="status">{status}</p>}<p className="chat-safety">困ったときは、近くの避難所職員にも直接声をかけてください。</p></div>}</section>
    <section className="faq-section" id="faq" aria-labelledby="faq-title"><div className="section-heading"><div><p className="eyebrow">すぐに確認できます</p><h2 id="faq-title">よくある質問</h2><p className="section-lead">避難所でよくある案内をまとめています。見つからないときは、そのまま相談してください。</p></div><label className="search-label"><span className="sr-only">よくある質問を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：充電できる場所は？" maxLength={100} type="search" /></label></div><div className="shelter-faq-grid" aria-live="polite">{matches.map((faq) => <details className="shelter-faq-card" key={faq.id}><summary><span className="faq-category">{faq.category}</span><strong>{faq.question}</strong><span className="faq-chevron">＋</span></summary><p>{faq.answer}</p><div className="faq-card-actions"><button type="button" onClick={() => beginChat()}>解決しないときは相談する</button></div></details>)}{!matches.length && <div className="empty-state"><strong>近い案内が見つかりませんでした。</strong><p>職員へ相談すると、状況を確認してもらえます。</p><button className="button accent" type="button" onClick={() => beginChat()}>相談する</button></div>}</div></section>
    <section className="shelter-footer-note"><span>✓</span><div><strong>相談は、ちゃんと届きます。</strong><p>受付後は相談IDが発行され、職員の確認・対応・解決までの状況を確認できます。</p></div><Link href="/questions">状況を確認する →</Link></section>
    <div className="evac-footer"><Link href="/admin">職員用ページ</Link></div>
    <nav className="mobile-bottom-nav" aria-label="モバイルメニュー"><a href="#home">⌂<span>ホーム</span></a><a href="#faq">?<span>お知らせ</span></a><Link href="/questions">◷<span>マイページ</span></Link></nav>
  </main>;
}
