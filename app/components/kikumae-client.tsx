'use client';

import { FormEvent, useMemo, useRef, useState } from 'react';
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
  const [readyToSubmit, setReadyToSubmit] = useState(false);
  const [checkUrl, setCheckUrl] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const term = normalize(query);
    if (!term) return faqs;
    return faqs.filter((faq) => normalize(`${faq.question}${faq.answer}${faq.category}`).includes(term));
  }, [faqs, query]);

  function addMessage(message: ChatMessage) { setMessages((current) => [...current, message]); }

  function beginChat(withVoice = false) {
    setChatOpen(true); setMessages([{ from: 'ai', text: '来てくださってありがとうございます。まず、いちばん困っていることを教えてください。短い言葉でも大丈夫です。' }]); setPreview(null); setFaqDecision(false); setReadyToSubmit(false); setStatus('');
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
    setBusy(true); setStatus('');
    try {
      const response = await fetch('/api/questions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, intake: nextIntake }) });
      const payload = await response.json() as { message?: string; body?: string; summary?: string; category?: string; related?: RelatedFaq[]; analysis?: Analysis; followUp?: FollowUp };
      if (!response.ok || !payload.analysis) { setStatus(payload.message ?? '内容を確認できませんでした。'); return; }
      const nextPreview = { body: payload.body ?? body, summary: payload.summary ?? '', category: payload.category ?? 'その他', related: payload.related ?? [], analysis: payload.analysis, followUp: payload.followUp ?? null, submissionKey: preview?.submissionKey ?? crypto.randomUUID() };
      setPreview(nextPreview); setIntake(nextIntake); setActiveKey(nextPreview.analysis.missingInformation[0] ?? '');
      if (!isFollowUp && nextPreview.related.length) addMessage({ from: 'ai', text: 'お話しくださってありがとうございます。近い案内が見つかりました。まずはこちらを確認してみてください。' });
      else if (nextPreview.followUp) addMessage({ from: 'ai', text: `${nextPreview.analysis.emotion}状況なのですね。対応のために、ひとつだけ確認させてください。\n\n${nextPreview.followUp.question}` });
      else { addMessage({ from: 'ai', text: '伝えてくださった内容を整理しました。この内容を避難所スタッフへ届けてもよいですか？' }); setReadyToSubmit(true); }
    } catch { setStatus('通信に失敗しました。時間をおいてもう一度お試しください。'); }
    finally { setBusy(false); }
  }

  async function sendMessageValue(value: string) {
    const trimmed = value.trim(); if (!trimmed || busy) return; setInput(''); addMessage({ from: 'person', text: trimmed });
    if (!originalBody) { setOriginalBody(trimmed); setContextBody(trimmed); await inspect(trimmed, intake); return; }
    if (activeKey) { const nextIntake = intakeForKey(trimmed, activeKey, intake); const nextContext = `${contextBody}\n${activeKey}：${trimmed}`; setContextBody(nextContext); await inspect(nextContext, nextIntake, true); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await sendMessageValue(input); }

  async function chooseQuickReply(value: string) {
    await sendMessageValue(value);
  }

  async function faqResult(resolved: boolean) {
    setFaqDecision(true);
    if (resolved) {
      const faqId = preview?.related[0]?.id ?? null;
      void fetch('/api/faq-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faqId, query: originalBody }) });
      addMessage({ from: 'ai', text: '解決につながってよかったです。必要なときは、いつでもここから相談してください。' }); setPreview(null); setReadyToSubmit(false); return;
    }
    addMessage({ from: 'ai', text: 'まだ困っていることがあるのですね。同じ内容を職員へ届けます。対応に必要な情報を、ひとつずつ確認します。' });
    if (preview?.followUp) setReadyToSubmit(false); else setReadyToSubmit(true);
  }

  async function submitQuestion() {
    if (!preview || busy) return; setBusy(true); setStatus('相談を届けています…');
    try {
      const response = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: originalBody, summary: preview.summary, category: preview.category, submissionKey: preview.submissionKey, intake }) });
      const payload = await response.json() as { message?: string; checkUrl?: string };
      if (!response.ok) { setStatus(payload.message ?? '相談を届けられませんでした。'); return; }
      setCheckUrl(payload.checkUrl ?? ''); setReadyToSubmit(false); setStatus('相談が届きました。確認ページを保存してください。'); addMessage({ from: 'ai', text: '相談を受け付けました。相談IDと対応状況を確認できます。' });
    } catch { setStatus('通信に失敗しました。時間をおいてもう一度お試しください。'); }
    finally { setBusy(false); }
  }

  function closeChat() { setChatOpen(false); setStatus(''); }

  return <main>
    <header className="site-header shelter-header"><a className="brand" href="#home" aria-label="ホームへ戻る">◌ 相談窓口</a><nav aria-label="主要メニュー"><a href="#faq">よくある質問</a><Link href="/questions">相談状況</Link><Link href="/admin">職員用</Link></nav></header>
    <section className="shelter-hero" id="home"><div className="shelter-hero-copy"><p className="eyebrow">避難所の相談窓口</p><h1>困っていることを、<br /><span>教えてください。</span></h1><p>言葉がまとまっていなくても大丈夫です。AIがいったん受け止め、必要なことを職員へ分かりやすく届けます。</p><div className="shelter-actions"><button className="button accent large" type="button" onClick={() => beginChat()}>▱ 文字で相談する</button><button className="button secondary large" type="button" onClick={() => beginChat(true)}>◉ 音声で話す</button></div><p className="shelter-reassure">相談は匿名です。原文もそのまま保存され、職員が確認します。</p></div><div className="shelter-hero-note"><span className="note-icon">＋</span><div><strong>あなたの声を、<br />職員に届けます</strong><p>受付後は、対応状況をいつでも確認できます。</p></div></div></section>
    <section className="quick-links" aria-label="相談以外の入口"><a href="#faq"><span className="quick-icon">?</span><span><strong>よくある質問を見る</strong><small>水・食料・トイレなど</small></span><b>›</b></a><Link href="/questions"><span className="quick-icon">◷</span><span><strong>自分の相談状況を見る</strong><small>受付済み・確認中・対応中</small></span><b>›</b></Link></section>
    <section className="shelter-chat-section" aria-labelledby="chat-title">{!chatOpen ? <div className="chat-invite"><div><p className="eyebrow">まずはここから</p><h2 id="chat-title">うまく説明できなくても大丈夫です。</h2><p>「水が足りない」「薬がほしい」「どこに行けばいい？」など、思ったまま話してください。</p></div><button className="button primary" type="button" onClick={() => beginChat()}>相談をはじめる <span>→</span></button></div> : <div className="chat-panel"><div className="chat-panel-head"><div><p className="eyebrow">相談中</p><h2 id="chat-title">お話を聞いています</h2></div><button className="text-button" type="button" onClick={closeChat}>閉じる</button></div><div className="chat-messages" aria-live="polite">{messages.map((message, index) => <div className={`chat-bubble ${message.from}`} key={`${message.from}-${index}`}><span>{message.from === 'ai' ? '相談窓口' : 'あなた'}</span><p>{message.text}</p></div>)}{preview?.related.length && !faqDecision ? <div className="chat-faq-card"><p className="eyebrow">近い案内</p>{preview.related.slice(0, 2).map((faq) => <article key={faq.id}><strong>{faq.question}</strong><p>{faq.answer}</p></article>)}<p className="faq-question">この案内で解決しましたか？</p><div className="quick-replies"><button type="button" onClick={() => void faqResult(true)}>はい</button><button type="button" onClick={() => void faqResult(false)}>まだ相談したい</button></div></div> : null}{preview && readyToSubmit && !checkUrl && <div className="chat-confirm-card"><div className="analysis-mini"><span className="status-badge">{preview.analysis.urgentReview ? '要緊急確認' : '内容を整理しました'}</span><strong>{preview.analysis.title}</strong><p>{preview.analysis.overview}</p>{preview.analysis.facts.length > 0 && <ul>{preview.analysis.facts.slice(0, 4).map((fact) => <li key={fact}>{fact}</li>)}</ul>}</div><button className="button accent" type="button" onClick={() => void submitQuestion()}>この内容を職員に届ける</button><p className="input-hint">送信後に相談IDと確認ページをお渡しします。</p></div>}{checkUrl && <div className="chat-confirm-card delivered"><span className="delivered-check">✓</span><strong>相談が届きました</strong><p>{status}</p><Link className="button accent" href={checkUrl}>相談状況を見る</Link><button className="text-button" type="button" onClick={() => { setChatOpen(false); setCheckUrl(''); setMessages([]); setOriginalBody(''); setContextBody(''); setIntake(emptyIntake); }}>新しく相談する</button></div>}</div>{!checkUrl && !readyToSubmit && <form className="chat-input" onSubmit={sendMessage}><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder={activeKey ? '答えられる範囲で教えてください' : 'ここに入力してください'} maxLength={500} aria-label="相談内容" /><button className="voice-button" type="button" onClick={startVoice} aria-label="音声入力" disabled={listening}>{listening ? '●' : '◉'}</button><button className="send-button" type="submit" disabled={busy || !input.trim()} aria-label="送信">↑</button></form>}{preview?.followUp && activeKey && !readyToSubmit && !checkUrl && <div className="quick-replies chat-quick-options">{preview.followUp.options.map((option) => <button type="button" key={option} onClick={() => void chooseQuickReply(option)}>{option}</button>)}</div>}{status && !checkUrl && <p className="form-status" role="status">{status}</p>}<p className="chat-safety">困ったときは、近くの職員にも直接声をかけてください。</p></div>}</section>
    <section className="faq-section" id="faq" aria-labelledby="faq-title"><div className="section-heading"><div><p className="eyebrow">すぐに確認できます</p><h2 id="faq-title">よくある質問</h2><p className="section-lead">避難所でよくある案内をまとめています。見つからないときは、そのまま相談してください。</p></div><label className="search-label"><span className="sr-only">よくある質問を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：充電できる場所は？" maxLength={100} type="search" /></label></div><div className="shelter-faq-grid" aria-live="polite">{matches.map((faq) => <details className="shelter-faq-card" key={faq.id}><summary><span className="faq-category">{faq.category}</span><strong>{faq.question}</strong><span className="faq-chevron">＋</span></summary><p>{faq.answer}</p><div className="faq-card-actions"><button type="button" onClick={() => beginChat()}>解決しないときは相談する</button></div></details>)}{!matches.length && <div className="empty-state"><strong>近い案内が見つかりませんでした。</strong><p>職員へ相談すると、状況を確認してもらえます。</p><button className="button accent" type="button" onClick={() => beginChat()}>相談する</button></div>}</div></section>
    <section className="shelter-footer-note"><span>✓</span><div><strong>相談は、ちゃんと届きます。</strong><p>受付後は相談IDが発行され、職員の確認・対応・解決までの状況を確認できます。</p></div><Link href="/questions">状況を確認する →</Link></section>
    <nav className="mobile-bottom-nav" aria-label="モバイルメニュー"><a href="#home">⌂<span>ホーム</span></a><a href="#faq">?<span>お知らせ</span></a><Link href="/questions">◷<span>マイページ</span></Link></nav>
  </main>;
}
