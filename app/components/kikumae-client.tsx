'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Faq, RelatedFaq } from '../../db/repository';

type Intake = { location: string; peopleCount: string; resourceRemaining: string; lastReceivedAt: string };
type Analysis = { title: string; overview: string; facts: string[]; emotion: string; missingInformation: string[]; urgencyCandidate: string; urgentReview: boolean; category: string };
type FollowUp = { question: string; options: string[] } | null;
type Preview = { body: string; summary: string; category: string; related: RelatedFaq[]; analysis: Analysis; followUp: FollowUp; submissionKey: string };
type ChatMessage = { from: 'ai' | 'person'; text: string };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
type SavedDraft = { savedAt?: number; input?: string; originalBody?: string; contextBody?: string; intake?: Intake; chatOpen?: boolean; messages?: ChatMessage[]; activeKey?: string; preview?: Preview | null; faqDecision?: boolean; readyToSubmit?: boolean };

type Props = { faqs: Faq[] };
const emptyIntake: Intake = { location: '', peopleCount: '', resourceRemaining: '', lastReceivedAt: '' };
const LOCATION_OPTIONS = ['体育館', '体育館北側', '体育館南側', '北トイレ', '南トイレ', '受付', '救護スペース', '駐車場', '屋外'];
const normalize = (value: string) => value.toLocaleLowerCase('ja-JP').replace(/\s/g, '');
const isUrgentAnalysis = (analysis: Analysis) => analysis.urgentReview || analysis.urgencyCandidate === '高';

// 受付後の相談を同じ端末から再確認できるようにする。相談本文は保存せず、
// 相談ID・確認URL・カテゴリ・保存日時だけを短期間保持する。
export type ConsultHistoryEntry = { id: number; checkUrl: string; title: string; savedAt: number };
const HISTORY_STORAGE_KEY = 'kikumae-consult-history';
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadConsultHistory(): ConsultHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const fresh = (parsed as ConsultHistoryEntry[]).filter((entry) => entry && typeof entry.id === 'number' && typeof entry.checkUrl === 'string' && (() => { try { const url = new URL(entry.checkUrl, window.location.origin); return url.origin === window.location.origin && /^\/questions\/[0-9a-f-]{32,80}$/i.test(url.pathname); } catch { return false; } })() && typeof entry.title === 'string' && typeof entry.savedAt === 'number' && Date.now() - entry.savedAt <= HISTORY_MAX_AGE_MS);
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
  const [activeKey, setActiveKey] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [faqDecision, setFaqDecision] = useState(false);
  const [showFaqCard, setShowFaqCard] = useState(false);
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
        if (saved) { const draft = JSON.parse(saved) as SavedDraft; const fresh = !draft.savedAt || Date.now() - draft.savedAt < 24 * 60 * 60 * 1000; if (fresh) { if (draft.input) setInput(draft.input); if (draft.originalBody) setOriginalBody(draft.originalBody); if (draft.contextBody) setContextBody(draft.contextBody); if (draft.intake) setIntake({ ...emptyIntake, ...draft.intake }); if (draft.chatOpen) setChatOpen(true); if (draft.messages?.length) setMessages(draft.messages); if (draft.activeKey) setActiveKey(draft.activeKey); if (draft.preview) { setPreview(draft.preview); setShowFaqCard(!draft.faqDecision && Boolean(draft.preview.related.length)); } if (draft.faqDecision) setFaqDecision(true); if (draft.readyToSubmit) setReadyToSubmit(true); } }
      } catch { /* local draft is best effort */ }
    }, 0);
    return () => { window.clearTimeout(restoreTimer); window.removeEventListener('online', updateConnection); window.removeEventListener('offline', updateConnection); };
  }, []);

  useEffect(() => {
    if (checkUrl) { try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* local draft is best effort */ } return; }
    if (!input && !originalBody && !messages.length) return;
    try { localStorage.setItem('kikumae-shelter-draft', JSON.stringify({ savedAt: Date.now(), input, originalBody, contextBody, intake, chatOpen, messages, activeKey, preview, faqDecision, readyToSubmit } satisfies SavedDraft)); } catch { /* local draft is best effort */ }
  }, [input, originalBody, contextBody, intake, chatOpen, messages, activeKey, preview, faqDecision, readyToSubmit, checkUrl]);

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
    setChatOpen(true); setMessages([{ from: 'ai', text: '来てくださってありがとうございます。まず、いちばん困っていることを教えてください。短い言葉でも大丈夫です。' }]); setPreview(null); setFaqDecision(false); setShowFaqCard(false); setReadyToSubmit(false); setQuestionId(null); setStatus(''); setOriginalBody(''); setContextBody(''); setIntake(emptyIntake);
    try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* local draft is best effort */ }
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

  function intakeForKey(value: string, key: string, current: Intake): Intake {
    if (key === '場所') return { ...current, location: value };
    if (key === '人数') return { ...current, peopleCount: value };
    if (key === '残量') return { ...current, resourceRemaining: value };
    if (key === '最後に受け取った時刻') return { ...current, lastReceivedAt: value };
    return current;
  }

  async function inspect(body: string, nextIntake: Intake, isFollowUp = false) {
    setBusy(true); setStatus('内容を確認しています…');
    try {
      const response = await fetch('/api/questions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, intake: nextIntake }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; body?: string; summary?: string; category?: string; related?: RelatedFaq[]; analysis?: Analysis; followUp?: FollowUp };
      if (!response.ok || !payload.analysis) { setStatus(payload.message ?? '内容を確認できませんでした。'); return false; }
      setStatus('');
      const nextPreview = { body: payload.body ?? body, summary: payload.summary ?? '', category: payload.category ?? 'その他', related: payload.related ?? [], analysis: payload.analysis, followUp: payload.followUp ?? null, submissionKey: preview?.submissionKey ?? crypto.randomUUID() };
      setPreview(nextPreview); setIntake(nextIntake); setActiveKey(nextPreview.analysis.missingInformation[0] ?? '');
      const urgent = isUrgentAnalysis(nextPreview.analysis);
      const remaining = nextPreview.analysis.missingInformation.length;
      if (!isFollowUp) {
        setShowFaqCard(nextPreview.related.length > 0);
        if (nextPreview.related.length) addMessage({ from: 'ai', text: 'お話しくださってありがとうございます。近い案内が見つかりました。まずはこちらを確認してみてください。' });
        else if (urgent) addMessage({ from: 'ai', text: '緊急の可能性がある内容として受け止めました。追加の質問はせず、このまま職員へ届けることをおすすめします。' });
        else if (nextPreview.followUp) addMessage({ from: 'ai', text: `${nextPreview.analysis.emotion}状況なのですね。あと${remaining}つ、答えられる範囲で教えてください。すぐ届けたいときは「このまま届ける」を押してください。\n\n${nextPreview.followUp.question}` });
        else addMessage({ from: 'ai', text: '伝えてくださった内容を整理しました。この内容を避難所スタッフへ届けてもよいですか？' });
      } else {
        setShowFaqCard(false);
        if (!urgent && nextPreview.followUp) addMessage({ from: 'ai', text: `ありがとうございます。あと${remaining}つ、答えられる範囲で教えてください。すぐ届けたいときは「このまま届ける」を押してください。\n\n${nextPreview.followUp.question}` });
        else addMessage({ from: 'ai', text: '伝えてくださった内容を整理しました。この内容を避難所スタッフへ届けてもよいですか？' });
      }
      // 追加質問は任意。最初の整理が成功した時点で送信できるようにする。
      setReadyToSubmit(true);
      return true;
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? '通信が遅いようです。もう一度お試しください。' : '通信に失敗しました。時間をおいてもう一度お試しください。'); return false; }
    finally { setBusy(false); }
  }

  async function sendMessageValue(value: string) {
    const trimmed = value.trim(); if (!trimmed || busy) return; setInput(''); addMessage({ from: 'person', text: trimmed });
    if (!originalBody) { setOriginalBody(trimmed); setContextBody(trimmed); const ok = await inspect(trimmed, intake); if (!ok) { setOriginalBody(''); setContextBody(''); } return; }
    const nextIntake = activeKey ? intakeForKey(trimmed, activeKey, intake) : intake;
    const nextContext = activeKey ? `${contextBody}\n${activeKey}：${trimmed}` : `${contextBody}\n${trimmed}`;
    setContextBody(nextContext); await inspect(nextContext, nextIntake, true);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await sendMessageValue(input); }

  async function chooseQuickReply(value: string) {
    await sendMessageValue(value);
  }

  async function faqResult(resolved: boolean) {
    setFaqDecision(true); setShowFaqCard(false);
    if (resolved) {
      const faqId = preview?.related[0]?.id ?? null;
      void fetch('/api/faq-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faqId, query: originalBody }) });
      addMessage({ from: 'ai', text: '解決につながってよかったです。必要なときは、いつでもここから相談してください。' }); setPreview(null); setReadyToSubmit(false); return;
    }
    addMessage({ from: 'ai', text: 'まだ困っていることがあるのですね。同じ内容を職員へ届けます。対応に必要な情報を、ひとつずつ確認します。' });
    setReadyToSubmit(true);
  }

  async function submitQuestion() {
    if (!preview || busy || submitLockRef.current) return; submitLockRef.current = true; setBusy(true); setStatus('相談を届けています…');
    try {
      const response = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: originalBody, summary: preview.summary, category: preview.category, submissionKey: preview.submissionKey, intake }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; checkUrl?: string; id?: number };
      if (!response.ok) { setStatus(payload.message ?? '相談を届けられませんでした。'); return; }
      const url = payload.checkUrl ?? '';
      const id = typeof payload.id === 'number' ? payload.id : null;
      setCheckUrl(url); setQuestionId(id); setReadyToSubmit(false); setStatus('相談が届きました。この画面を写真に撮るか、確認URLを保存してください。'); addMessage({ from: 'ai', text: `相談を受け付けました。相談ID${id != null ? ` #${String(id).padStart(4, '0')}` : ''}で対応状況を確認できます。` });
      if (id != null && url) appendConsultHistory({ id, checkUrl: url, title: preview.category, savedAt: Date.now() });
      try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* local draft is best effort */ }
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? '通信が遅いようです。もう一度お試しください。' : '通信に失敗しました。時間をおいてもう一度お試しください。'); }
    finally { submitLockRef.current = false; setBusy(false); }
  }

  function closeChat() { setChatOpen(false); setStatus(''); }
  async function copyCheckUrl() {
    const field = document.getElementById('check-url-text') as HTMLInputElement | null;
    field?.select();
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(new URL(checkUrl, window.location.origin).toString()); setStatus('確認ページのURLをコピーしました。'); return; } } catch { /* 手動コピーへ */ }
    setStatus('コピーできなかったため、URLを選択しました。そのまま保存してください。');
  }

  return <main className="evac-theme">
    <header className="site-header shelter-header"><a className="brand" href="#home" aria-label="ホームへ戻る">◌ 相談窓口</a><nav aria-label="主要メニュー"><a href="#faq">よくある質問</a><Link href="/questions">相談状況</Link></nav></header>
    <section className="shelter-hero" id="home"><div className="shelter-hero-copy"><p className="eyebrow">避難所の相談窓口</p><h1>困っていることを、<br /><span>教えてください。</span></h1><p>言葉がまとまっていなくても大丈夫です。AIがいったん受け止め、必要なことを職員へ分かりやすく届けます。</p><div className="shelter-actions"><button className="button accent large" type="button" onClick={() => beginChat()}>▱ 文字で相談する</button><button className="button secondary large" type="button" disabled={!voiceSupported} onClick={() => beginChat(true)}>{voiceSupported ? '◉ 音声で話す' : '音声入力はこのブラウザでは使えません'}</button></div><p className="shelter-reassure">相談は匿名です。原文もそのまま保存され、職員が確認します。</p></div><div className="shelter-hero-note"><span className="note-icon">＋</span><div><strong>あなたの声を、<br />職員に届けます</strong><p>受付後は、対応状況をいつでも確認できます。</p></div></div></section>
    <section className="quick-links" aria-label="相談以外の入口"><a href="#faq"><span className="quick-icon">?</span><span><strong>よくある質問を見る</strong><small>水・食料・トイレなど</small></span><b>›</b></a><Link href="/questions"><span className="quick-icon">◷</span><span><strong>自分の相談状況を見る</strong><small>受付済み・確認中・対応中</small></span><b>›</b></Link></section>
    <section className="shelter-chat-section" aria-labelledby="chat-title">{!chatOpen ? <div className="chat-invite"><div><p className="eyebrow">まずはここから</p><h2 id="chat-title">うまく説明できなくても大丈夫です。</h2><p>「水が足りない」「薬がほしい」「どこに行けばいい？」など、思ったまま話してください。</p></div><button className="button primary" type="button" onClick={() => beginChat()}>相談をはじめる <span>→</span></button></div> : <div className="chat-panel"><div className="chat-panel-head"><div><p className="eyebrow">相談中</p><h2 id="chat-title">お話を聞いています</h2></div><button className="text-button" type="button" onClick={closeChat}>閉じる</button></div>{offline && <div className="offline-notice" role="status">通信が不安定です。入力内容はこの端末に一時保存しています。</div>}{!checkUrl && preview && !isUrgentAnalysis(preview.analysis) && activeKey === '場所' && <div className="location-choices" aria-label="場所を選ぶ">{LOCATION_OPTIONS.map((location) => <button type="button" key={location} onClick={() => void chooseQuickReply(location)}>{location}</button>)}</div>}<div className="chat-messages" aria-live="polite">{messages.map((message, index) => <div className={`chat-bubble ${message.from}`} key={`${message.from}-${index}`}><span>{message.from === 'ai' ? '相談窓口' : 'あなた'}</span><p>{message.text}</p></div>)}{showFaqCard && preview?.related.length && !faqDecision ? <div className="chat-faq-card"><p className="eyebrow">近い案内</p>{preview.related.slice(0, 2).map((faq) => <article key={faq.id}><strong>{faq.question}</strong><p>{faq.answer}</p></article>)}<p className="faq-question">この案内で解決しましたか？</p><div className="quick-replies"><button type="button" onClick={() => void faqResult(true)}>はい</button><button type="button" onClick={() => void faqResult(false)}>まだ相談したい</button></div></div> : null}{preview && readyToSubmit && !checkUrl && <div className="chat-confirm-card"><div className="analysis-mini"><span className="status-badge">{preview.analysis.urgentReview ? '要緊急確認' : '内容を整理しました'}</span><strong>{preview.analysis.title}</strong><p>{preview.analysis.overview}</p>{preview.analysis.facts.length > 0 && <ul>{preview.analysis.facts.slice(0, 4).map((fact) => <li key={fact}>{fact}</li>)}</ul>}</div><button className="button accent" type="button" disabled={busy} onClick={() => void submitQuestion()}>このまま届ける</button><p className="input-hint">送信後に相談IDと確認ページをお渡しします。</p></div>}{checkUrl && <div className="chat-confirm-card delivered"><span className="delivered-check">✓</span><strong>相談が届きました</strong>{questionId != null && <p className="consult-id">相談ID <b>#{String(questionId).padStart(4, '0')}</b></p>}<p>{status}</p><div className="check-url-box"><label className="sr-only" htmlFor="check-url-text">確認URL</label><input id="check-url-text" className="check-url-input" readOnly value={checkUrl} onFocus={(event) => event.currentTarget.select()} /><button className="button secondary" type="button" onClick={() => void copyCheckUrl()}>URLをコピー</button></div><Link className="button accent" href={checkUrl}>相談状況を見る</Link><p className="save-hint">このページを写真に撮るか、確認URLを保存してください。</p><button className="text-button" type="button" onClick={() => { setChatOpen(false); setCheckUrl(''); setQuestionId(null); setMessages([]); setOriginalBody(''); setContextBody(''); setIntake(emptyIntake); }}>新しく相談する</button></div>}</div>{!checkUrl && <form className="chat-input" onSubmit={sendMessage}><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder={activeKey ? '答えられる範囲で教えてください' : 'ここに入力してください'} maxLength={500} aria-label="相談内容" />{voiceSupported ? <span className="voice-slot is-voice-ready"><button className="voice-button" type="button" onClick={startVoice} aria-label="音声入力" disabled={listening}>{listening ? '●' : '◉'}</button></span> : <span className="voice-slot" aria-hidden="true" />}<button className="send-button" type="submit" disabled={busy || !input.trim()} aria-label="送信">↑</button></form>}{preview?.followUp && !isUrgentAnalysis(preview.analysis) && activeKey && !checkUrl && <div className="quick-replies chat-quick-options">{preview.followUp.options.map((option) => <button type="button" key={option} onClick={() => void chooseQuickReply(option)}>{option}</button>)}</div>}{status && !checkUrl && <p className="form-status" role="status">{status}</p>}<p className="chat-safety">困ったときは、近くの職員にも直接声をかけてください。</p></div>}</section>
    <section className="faq-section" id="faq" aria-labelledby="faq-title"><div className="section-heading"><div><p className="eyebrow">すぐに確認できます</p><h2 id="faq-title">よくある質問</h2><p className="section-lead">避難所でよくある案内をまとめています。見つからないときは、そのまま相談してください。</p></div><label className="search-label"><span className="sr-only">よくある質問を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：充電できる場所は？" maxLength={100} type="search" /></label></div><div className="shelter-faq-grid" aria-live="polite">{matches.map((faq) => <details className="shelter-faq-card" key={faq.id}><summary><span className="faq-category">{faq.category}</span><strong>{faq.question}</strong><span className="faq-chevron">＋</span></summary><p>{faq.answer}</p><div className="faq-card-actions"><button type="button" onClick={() => beginChat()}>解決しないときは相談する</button></div></details>)}{!matches.length && <div className="empty-state"><strong>近い案内が見つかりませんでした。</strong><p>職員へ相談すると、状況を確認してもらえます。</p><button className="button accent" type="button" onClick={() => beginChat()}>相談する</button></div>}</div></section>
    <section className="shelter-footer-note"><span>✓</span><div><strong>相談は、ちゃんと届きます。</strong><p>受付後は相談IDが発行され、職員の確認・対応・解決までの状況を確認できます。</p></div><Link href="/questions">状況を確認する →</Link></section>
    <div className="evac-footer"><Link href="/admin">職員用ページ</Link></div>
    <nav className="mobile-bottom-nav" aria-label="モバイルメニュー"><a href="#home">⌂<span>ホーム</span></a><a href="#faq">?<span>お知らせ</span></a><Link href="/questions">◷<span>マイページ</span></Link></nav>
  </main>;
}
