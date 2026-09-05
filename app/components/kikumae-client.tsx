'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Faq, RelatedFaq } from '../../db/repository';

type Intake = { location: string; peopleCount: string; resourceRemaining: string; lastReceivedAt: string };
type Analysis = { title: string; overview: string; facts: string[]; emotion: string; missingInformation: string[]; urgencyCandidate: string; urgentReview: boolean; category: string };
type FollowUp = { question: string; options: string[] } | null;
type Preview = { body: string; summary: string; category: string; related: RelatedFaq[]; analysis: Analysis; followUp: FollowUp; submissionKey: string };
type ChatMessage = { from: 'ai' | 'person'; text: string };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

type Props = { faqs: Faq[] };
const emptyIntake: Intake = { location: '', peopleCount: '', resourceRemaining: '', lastReceivedAt: '' };
const normalize = (value: string) => value.toLocaleLowerCase('ja-JP').replace(/\s/g, '');
// 緊急度が高い相談では、追加質問で足止めせず即送信を促す（urgentReviewまたは緊急度候補「高」）
const isUrgentAnalysis = (analysis: Analysis) => analysis.urgentReview || analysis.urgencyCandidate === '高';

// 下書きの自動保存（相談内容には要配慮個人情報が含まれるため、保存期間に上限を設ける）
type Draft = { chatOpen: boolean; messages: ChatMessage[]; input: string; originalBody: string; contextBody: string; intake: Intake; activeKey: string; preview: Preview | null; faqDecision: boolean; readyToSubmit: boolean };
const DRAFT_STORAGE_KEY = 'kikumae-chat-draft';
const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6時間で失効させ、共用端末での閲覧事故を防ぐ

function loadDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { savedAt?: number; draft?: Draft };
    if (!saved.savedAt || !saved.draft || Date.now() - saved.savedAt > DRAFT_MAX_AGE_MS) { window.localStorage.removeItem(DRAFT_STORAGE_KEY); return null; }
    if (!Array.isArray(saved.draft.messages)) return null;
    return saved.draft;
  } catch { return null; }
}

function saveDraft(draft: Draft) {
  try { window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), draft })); } catch { /* プライベートモード等でlocalStorageが使えない場合は何もしない */ }
}

function clearDraft() {
  try { window.localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* 何もしない */ }
}

// 受付済み相談の端末内保存（確認URLを控え忘れても同じ端末なら辿れるようにする）。
// 相談本文は保存せず、ID・確認URL・保存日時のみを保存する。
// titleフィールドには「場所を含む分析タイトル」ではなく相談分類（例：水・飲料）だけを入れる。
// question-status-lookup.tsx側の型・表示（#ID タイトル 日時）を壊さないよう、
// ConsultHistoryEntry の形は変えず、titleの中身だけを場所を含まない安全な値に差し替えている
// （第2ラウンドで対応。以前はanalysis.titleを入れており、「1階の受付近くの飲料水不足」のように
// 避難者の居場所が共用端末に7日間残ってしまっていた）。
// 共用端末での閲覧事故を防ぐため7日で失効させる。
export type ConsultHistoryEntry = { id: number; checkUrl: string; title: string; savedAt: number };
const HISTORY_STORAGE_KEY = 'kikumae-consult-history';
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadConsultHistory(): ConsultHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const fresh = (parsed as ConsultHistoryEntry[]).filter((entry) => entry && typeof entry.id === 'number' && typeof entry.checkUrl === 'string' && typeof entry.savedAt === 'number' && now - entry.savedAt <= HISTORY_MAX_AGE_MS);
    if (fresh.length !== parsed.length) { try { window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(fresh)); } catch { /* 何もしない */ } }
    return fresh;
  } catch { return []; }
}

export function appendConsultHistory(entry: ConsultHistoryEntry) {
  try {
    const current = loadConsultHistory();
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([entry, ...current].slice(0, 30)));
  } catch { /* プライベートモード等でlocalStorageが使えない場合は何もしない */ }
}

export function clearConsultHistory() {
  try { window.localStorage.removeItem(HISTORY_STORAGE_KEY); } catch { /* 何もしない */ }
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
  const inputRef = useRef<HTMLInputElement>(null);
  const skipNextDraftSaveRef = useRef(true);
  const draftRestoreAttemptedRef = useRef(false);
  const restoredDraftRef = useRef<Draft | null>(null);
  const voiceCheckAttemptedRef = useRef(false);

  // マウント時に下書きがあれば復元する（ページ再読み込みや瞬断からの再開）。二重復元を避けるためrefで一度だけに制御する
  useEffect(() => {
    if (draftRestoreAttemptedRef.current) return;
    draftRestoreAttemptedRef.current = true;
    restoredDraftRef.current = loadDraft();
    const draft = restoredDraftRef.current;
    if (!draft || !draft.chatOpen) return;
    setChatOpen(draft.chatOpen); setMessages(draft.messages); setInput(draft.input); setOriginalBody(draft.originalBody); setContextBody(draft.contextBody); setIntake(draft.intake); setActiveKey(draft.activeKey); setPreview(draft.preview); setFaqDecision(draft.faqDecision); setReadyToSubmit(draft.readyToSubmit);
    setShowFaqCard(!draft.faqDecision && Boolean(draft.preview?.related.length));
  }, []);

  // 音声入力（Web Speech API）に対応しているブラウザかどうかをマウント後に判定する。
  // 対応していない場合は、押す前に分かるようボタン自体を出さない。
  useEffect(() => {
    if (voiceCheckAttemptedRef.current) return;
    voiceCheckAttemptedRef.current = true;
    const speechWindow = window as SpeechWindow;
    setVoiceSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
  }, []);

  // 相談中の状態を逐次保存する。送信が完了したら要配慮個人情報を残さないよう必ず消す
  useEffect(() => {
    if (skipNextDraftSaveRef.current) { skipNextDraftSaveRef.current = false; return; }
    if (checkUrl) { clearDraft(); return; }
    if (!chatOpen) return;
    saveDraft({ chatOpen, messages, input, originalBody, contextBody, intake, activeKey, preview, faqDecision, readyToSubmit });
  }, [chatOpen, messages, input, originalBody, contextBody, intake, activeKey, preview, faqDecision, readyToSubmit, checkUrl]);

  const matches = useMemo(() => {
    const term = normalize(query);
    if (!term) return faqs;
    return faqs.filter((faq) => normalize(`${faq.question}${faq.answer}${faq.category}`).includes(term));
  }, [faqs, query]);

  function addMessage(message: ChatMessage) { setMessages((current) => [...current, message]); }

  function beginChat(withVoice = false) {
    setChatOpen(true); setMessages([{ from: 'ai', text: '来てくださってありがとうございます。まず、いちばん困っていることを教えてください。短い言葉でも大丈夫です。' }]); setPreview(null); setFaqDecision(false); setShowFaqCard(false); setReadyToSubmit(false); setStatus('');
    window.setTimeout(() => { inputRef.current?.focus(); if (withVoice) startVoice(); }, 50);
  }

  function startVoice() {
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) { setStatus('このブラウザでは音声入力が使えないため、文字でお話しください。'); inputRef.current?.focus(); return; }
    const recognition = new SpeechRecognition(); recognition.lang = 'ja-JP'; recognition.interimResults = false; setListening(true);
    recognition.onresult = (event) => { const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(''); setInput(transcript); setListening(false); };
    recognition.onerror = () => { setListening(false); setStatus('音声を聞き取れませんでした。文字でも入力できます。'); };
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
        // FAQカードは最初の相談直後の1回だけ出す（追加質問の応答中には出さない）
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
      // 最初のinspectが成功した時点で、常に「このまま職員に届ける」を選べるようにする。
      // 追加質問は任意の上乗せであり、送信の必須条件にはしない。
      setReadyToSubmit(true);
      return true;
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? '通信が遅いようです。もう一度お試しください。' : '通信に失敗しました。時間をおいてもう一度お試しください。'); return false; }
    finally { setBusy(false); }
  }

  async function sendMessageValue(value: string) {
    const trimmed = value.trim(); if (!trimmed || busy) return; setInput(''); addMessage({ from: 'person', text: trimmed });
    if (!originalBody) {
      setOriginalBody(trimmed); setContextBody(trimmed);
      const ok = await inspect(trimmed, intake);
      if (!ok) { setOriginalBody(''); setContextBody(''); }
      return;
    }
    // activeKeyがある場合は不足情報への回答として扱い、ない場合（送信確認カード表示中に
    // 言い足された自由記述など）もそのまま追加の文脈として再分析にかける。
    const nextIntake = activeKey ? intakeForKey(trimmed, activeKey, intake) : intake;
    const nextContext = activeKey ? `${contextBody}\n${activeKey}：${trimmed}` : `${contextBody}\n${trimmed}`;
    setContextBody(nextContext);
    await inspect(nextContext, nextIntake, true);
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
    addMessage({ from: 'ai', text: 'まだ困っていることがあるのですね。同じ内容を職員へ届けます。答えられる範囲で追加の情報を確認しますが、すぐ届けたいときは「このまま届ける」を押してください。' });
    setReadyToSubmit(true);
  }

  async function submitQuestion() {
    if (!preview || busy) return; setBusy(true); setStatus('相談を届けています…');
    try {
      const response = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: originalBody, summary: preview.summary, category: preview.category, submissionKey: preview.submissionKey, intake }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; checkUrl?: string; id?: number };
      if (!response.ok) { setStatus(payload.message ?? '相談を届けられませんでした。'); return; }
      const url = payload.checkUrl ?? '';
      const id = typeof payload.id === 'number' ? payload.id : null;
      setCheckUrl(url); setQuestionId(id); setReadyToSubmit(false); setStatus('相談が届きました。この画面を写真に撮るか、確認URLを保存してください。');
      addMessage({ from: 'ai', text: `相談を受け付けました。相談ID${id != null ? ` #${String(id).padStart(4, '0')}` : ''}で対応状況を確認できます。` });
      // 控えを忘れても同じ端末なら辿れるよう、この端末に受付済み相談を保存する（相談本文は保存しない）。
      // titleには場所を含む分析タイトルではなく、相談分類（例：水・飲料）だけを入れる。
      if (id != null && url) appendConsultHistory({ id, checkUrl: url, title: preview.category, savedAt: Date.now() });
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? '通信が遅いようです。もう一度お試しください。' : '通信に失敗しました。時間をおいてもう一度お試しください。'); }
    finally { setBusy(false); }
  }

  // 確認URLをクリップボードへコピーする。使えない環境ではテキストを選択済み状態にして
  // 手動でコピーできるようにする。
  async function copyCheckUrl() {
    const field = document.getElementById('check-url-text') as HTMLInputElement | null;
    field?.select();
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(checkUrl); setStatus('確認URLをコピーしました。'); return; }
    } catch { /* フォールバックへ */ }
    setStatus('コピーできなかったため、URLを選択しました。そのままコピーして保存してください。');
  }

  function closeChat() { setChatOpen(false); setStatus(''); }

  return <main className="evac-theme">
    <header className="site-header"><a className="brand" href="#home" aria-label="ホームへ戻る"><span className="brand-mark" aria-hidden="true">相</span>相談窓口</a><nav aria-label="主要メニュー"><a href="#faq">よくある質問</a><Link href="/questions">相談状況</Link></nav></header>
    <section className="shelter-hero" id="home"><div className="shelter-hero-copy"><p className="eyebrow">避難所の相談窓口</p><h1>困っていることを、<br /><span>教えてください。</span></h1><p>言葉がまとまっていなくても大丈夫です。AIがいったん受け止め、必要なことを職員へ分かりやすく届けます。</p><div className="shelter-actions"><button className="button accent large" type="button" onClick={() => beginChat()}><span aria-hidden="true">▱</span> 文字で相談する</button><button className={`button secondary large voice-slot${voiceSupported ? ' is-voice-ready' : ''}`} type="button" onClick={() => beginChat(true)} aria-hidden={!voiceSupported} tabIndex={voiceSupported ? 0 : -1}><span aria-hidden="true">◉</span> 音声で話す</button></div><p className="shelter-reassure">相談は匿名で送れます。電話番号や住所などを書いても、そのまま受け付けます。原文は保存されますが、職員の画面では個人情報の部分を伏字にして表示します。</p></div><div className="shelter-hero-note"><span className="note-icon" aria-hidden="true">＋</span><div><strong>あなたの声を、<br />職員に届けます</strong><p>受付後は、対応状況をいつでも確認できます。</p></div></div></section>
    <section className="quick-links" aria-label="相談以外の入口"><a href="#faq"><span className="quick-icon" aria-hidden="true">?</span><span><strong>よくある質問を見る</strong><small>水・食料・トイレなど</small></span><b aria-hidden="true">›</b></a><Link href="/questions"><span className="quick-icon" aria-hidden="true">◷</span><span><strong>自分の相談状況を見る</strong><small>受付済み・確認中・対応中</small></span><b aria-hidden="true">›</b></Link></section>
    <section className="shelter-chat-section" aria-labelledby="chat-title">{!chatOpen ? <div className="chat-invite"><div><p className="eyebrow">まずはここから</p><h2 id="chat-title">うまく説明できなくても大丈夫です。</h2><p>「水が足りない」「薬がほしい」「どこに行けばいい？」など、思ったまま話してください。</p><a className="text-button chat-invite-link" href="#home">↑ 上の「文字で相談する」からはじめられます</a></div></div> : <div className="chat-panel"><div className="chat-panel-head"><div><p className="eyebrow">相談中</p><h2 id="chat-title">お話を聞いています</h2></div><button className="text-button" type="button" onClick={closeChat}>閉じる</button></div><div className="chat-messages" aria-live="polite">{messages.map((message, index) => <div className={`chat-bubble ${message.from}`} key={`${message.from}-${index}`}><span className="bubble-avatar" aria-hidden="true">{message.from === 'ai' ? '相' : 'あ'}</span><div className="bubble-body"><span className="bubble-who">{message.from === 'ai' ? '相談窓口' : 'あなた'}</span><p>{message.text}</p></div></div>)}{showFaqCard && preview && !faqDecision ? <div className="chat-faq-card"><p className="eyebrow">近い案内</p>{preview.related.slice(0, 2).map((faq) => <article key={faq.id}><strong>{faq.question}</strong><p>{faq.answer}</p></article>)}<p className="faq-question">この案内で解決しましたか？</p><div className="quick-replies"><button type="button" onClick={() => void faqResult(true)}>はい</button><button type="button" onClick={() => void faqResult(false)}>まだ相談したい</button></div></div> : null}{preview && readyToSubmit && !checkUrl && <div className="chat-confirm-card"><div className="analysis-mini"><span className={`status-badge${preview.analysis.urgentReview ? ' urgent' : ''}`}>{preview.analysis.urgentReview ? '要緊急確認' : '内容を整理しました'}</span><strong>{preview.analysis.title}</strong><p>{preview.analysis.overview}</p>{preview.analysis.facts.length > 0 && <ul>{preview.analysis.facts.slice(0, 4).map((fact) => <li key={fact}>{fact}</li>)}</ul>}</div><button className="button accent" type="button" onClick={() => void submitQuestion()} disabled={busy}>この内容を職員に届ける</button><p className="input-hint">送信後に相談IDと確認ページをお渡しします。</p></div>}{checkUrl && <div className="chat-confirm-card delivered"><span className="delivered-check" aria-hidden="true">✓</span><strong>相談が届きました</strong>{questionId != null && <p className="consult-id">相談ID <b>#{String(questionId).padStart(4, '0')}</b></p>}<p>{status}</p><div className="check-url-box"><label className="sr-only" htmlFor="check-url-text">確認URL</label><input id="check-url-text" className="check-url-input" readOnly value={checkUrl} onFocus={(event) => event.currentTarget.select()} /><button className="button secondary" type="button" onClick={() => void copyCheckUrl()}>URLをコピー</button></div><p className="save-hint">この画面を写真に撮るか、上のURLを保存してください。</p><Link className="button accent" href={checkUrl}>相談状況を見る</Link><button className="text-button" type="button" onClick={() => { setChatOpen(false); setCheckUrl(''); setQuestionId(null); setMessages([]); setOriginalBody(''); setContextBody(''); setIntake(emptyIntake); }}>新しく相談する</button></div>}</div>{!checkUrl && <form className="chat-input" onSubmit={sendMessage}><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder={activeKey ? '答えられる範囲で教えてください' : 'ここに入力してください'} maxLength={500} aria-label="相談内容" /><button className={`voice-button voice-slot${voiceSupported ? ' is-voice-ready' : ''}`} type="button" onClick={startVoice} aria-label={listening ? '音声を聞き取っています' : '音声入力を始める'} aria-pressed={listening} disabled={listening} aria-hidden={!voiceSupported} tabIndex={voiceSupported ? 0 : -1}><span aria-hidden="true">{listening ? '●' : '◉'}</span></button><button className="send-button" type="submit" disabled={busy || !input.trim()} aria-label="送信"><span aria-hidden="true">↑</span></button></form>}{preview?.followUp && activeKey && !checkUrl && !isUrgentAnalysis(preview.analysis) && <div className="quick-replies chat-quick-options">{preview.followUp.options.map((option) => <button type="button" key={option} onClick={() => void chooseQuickReply(option)}>{option}</button>)}</div>}{status && !checkUrl && <p className="form-status" role="status">{status}</p>}<p className="chat-safety">困ったときは、近くの職員にも直接声をかけてください。</p></div>}</section>
    <section className="faq-section" id="faq" aria-labelledby="faq-title"><div className="section-heading"><div><p className="eyebrow">すぐに確認できます</p><h2 id="faq-title">よくある質問</h2><p className="section-lead">避難所でよくある案内をまとめています。見つからないときは、そのまま相談してください。</p></div><label className="search-label"><span className="sr-only">よくある質問を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：充電できる場所は？" maxLength={100} type="search" /></label></div><div className="shelter-faq-grid" aria-live="polite">{matches.map((faq) => <details className="shelter-faq-card" key={faq.id}><summary><span className="faq-category">{faq.category}</span><strong>{faq.question}</strong><span className="faq-chevron" aria-hidden="true">＋</span></summary><p>{faq.answer}</p><div className="faq-card-actions"><button type="button" onClick={() => beginChat()}>解決しないときは相談する</button></div></details>)}{!matches.length && <div className="empty-state"><strong>近い案内が見つかりませんでした。</strong><p>職員へ相談すると、状況を確認してもらえます。</p><button className="button accent" type="button" onClick={() => beginChat()}>相談する</button></div>}</div></section>
    <section className="shelter-footer-note"><span aria-hidden="true">✓</span><div><strong>相談は、ちゃんと届きます。</strong><p>受付後は相談IDが発行され、職員の確認・対応・解決までの状況を確認できます。</p></div><Link href="/questions">状況を確認する <span aria-hidden="true">→</span></Link></section>
    <nav className="mobile-bottom-nav" aria-label="モバイルメニュー"><a href="#home"><span aria-hidden="true">⌂</span><span>ホーム</span></a><a href="#faq"><span aria-hidden="true">?</span><span>よくある質問</span></a><Link href="/questions"><span aria-hidden="true">◷</span><span>相談状況</span></Link></nav>
    <footer className="evac-footer"><Link href="/admin">職員の方はこちら</Link></footer>
  </main>;
}
