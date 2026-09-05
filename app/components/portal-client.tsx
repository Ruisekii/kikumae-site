'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Faq, RelatedFaq } from '../../db/repository';
import { SHELTER_CATEGORIES } from '../../db/local-ai';

type Preview = { body: string; summary: string; category: string; related: RelatedFaq[]; submissionKey: string };
type Props = { slug: string; name: string; description: string; faqs: Faq[] };
const normalize = (value: string) => value.toLocaleLowerCase('ja-JP').replace(/\s/g, '');

export function PortalClient({ slug, name, description, faqs }: Props) {
  const [query, setQuery] = useState('');
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState('');
  const [checkUrl, setCheckUrl] = useState('');
  const [questionId, setQuestionId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = useMemo(() => {
    const term = normalize(query);
    return term ? faqs.filter((faq) => normalize(`${faq.question}${faq.answer}${faq.category}`).includes(term)) : faqs;
  }, [faqs, query]);
  const closest = matches[0];

  async function previewQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setStatus('');
    try {
      const response = await fetch(`/api/portals/${slug}/questions/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: question }) });
      const payload = await response.json() as Preview & { message?: string };
      if (!response.ok) { setStatus(payload.message ?? '確認できませんでした。'); return; }
      setPreview({ ...payload, submissionKey: crypto.randomUUID() }); setQuestion(payload.body);
    } catch { setStatus('通信に失敗しました。時間をおいて再度お試しください。'); }
    finally { setBusy(false); }
  }
  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!preview) return; setBusy(true); setStatus('');
    try {
      const response = await fetch(`/api/portals/${slug}/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: preview.body, summary: preview.summary, category: preview.category, submissionKey: preview.submissionKey }) });
      const payload = await response.json() as { message?: string; checkUrl?: string; id?: number };
      if (!response.ok) { setStatus(payload.message ?? '送信できませんでした。'); return; }
      const id = typeof payload.id === 'number' ? payload.id : null;
      setQuestion(''); setPreview(null); setCheckUrl(payload.checkUrl ?? ''); setQuestionId(id);
      setStatus('相談を受け付けました。この画面を写真に撮るか、確認URLを保存してください。');
    } catch { setStatus('通信に失敗しました。時間をおいて再度お試しください。'); }
    finally { setBusy(false); }
  }
  // 確認URLをクリップボードへコピーする。使えない環境ではテキストを選択済み状態にして
  // 手動でコピーできるようにする（コピーの成否は色ではなく文言でも伝える）。
  async function copyCheckUrl() {
    const field = document.getElementById('portal-check-url') as HTMLInputElement | null;
    field?.select();
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(checkUrl); setStatus('確認URLをコピーしました。'); return; }
    } catch { /* フォールバックへ */ }
    setStatus('コピーできなかったため、URLを選択しました。そのままコピーして保存してください。');
  }
  return <main className="evac-theme">
    <header className="site-header"><Link className="brand" href={`/${slug}`}><span className="brand-mark" aria-hidden="true">相</span>相談窓口</Link><nav><a href="#faq">よくある質問を探す</a><a href="#ask">相談する</a><Link href={`/${slug}/admin`}>管理画面</Link></nav></header>
    {/* 出自表示: 窓口の作成には管理者パスワード認証が必須になったため、
        「利用者が自分で勝手に開設した非公式な窓口」という前提はもう成り立たない。
        ただし、避難者が「今どの窓口に相談しているか」を見失わないよう、
        折りたたまず・相談フォームより前の常時見える位置に窓口名を明示する。
        実装で確認できない保証（運営主体・公的機関である 等）は書かない。 */}
    <p className="portal-origin-notice" role="note" style={{ maxWidth: 1120, margin: '20px auto 0', padding: '14px 20px', border: '2px solid var(--ink)', borderRadius: 14, background: 'var(--blue)', boxShadow: '4px 4px 0 var(--ink)', fontWeight: 800, fontSize: '.92rem', lineHeight: 1.6 }}>
      この窓口は「{name}」の相談を受け付ける窓口です。相談は匿名で送れます。対応するのは、この避難所のスタッフです。
    </p>
    <section className="portal-hero"><p className="eyebrow">避難所の相談窓口</p><h1>{name}の相談窓口</h1><p>{description || '気になることは、思ったままの言葉で聞けます。'}</p><div className="hero-actions"><a className="button primary" href="#faq">よくある質問を探す</a><a className="button accent" href="#ask">相談する</a></div></section>
    <section className="section" id="faq"><div className="section-heading"><div><p className="eyebrow">よくある質問</p><h2>まず、聞く前に探せます</h2></div><label className="search-label"><span className="sr-only">よくある質問を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：水はどこでもらえる？" maxLength={100} type="search" /></label></div>
      {closest ? <article className="faq-card faq-card-featured"><span className="tag">{closest.category}</span><h3>Q. {closest.question}</h3><p>A. {closest.answer}</p>{matches.length > 1 && <details><summary>ほかのFAQ {matches.length - 1}件</summary><div className="faq-grid faq-grid-inner">{matches.slice(1).map((faq) => <article className="faq-card" key={faq.id}><span className="tag">{faq.category}</span><h3>Q. {faq.question}</h3><p>A. {faq.answer}</p></article>)}</div></details>}<div className="form-actions"><a className="button primary" href="#ask">これで解決した</a><a className="button secondary" href="#ask">それでも相談する</a></div></article> : <p className="empty">近いFAQは見つかりませんでした。下の窓口から気軽に相談できます。</p>}
    </section>
    <section className="ask-section" id="ask"><div><p className="eyebrow">匿名で相談</p><h2>文章は、かしこまらなくて大丈夫。</h2><p>「水が足りない」「薬がほしい」「どこに行けばいい？」など、自然な文章で送れます。ログインは不要です。</p><ul><li>電話番号や住所などを書いても、そのまま受け付けます</li><li>原文は保存されますが、職員の画面では個人情報の部分は伏字にして表示します</li><li>AIは相談の整理と回答案の下書きだけを支援します</li><li>人が確認した回答だけがFAQとして育ちます</li></ul></div>{checkUrl ? <div className="ask-form consult-receipt"><span className="tag">受付完了</span><h3>相談を受け付けました</h3>{questionId != null && <p className="consult-id">相談ID <b>#{String(questionId).padStart(4, '0')}</b></p>}<p>{status}</p><div className="check-url-box"><label className="sr-only" htmlFor="portal-check-url">確認URL</label><input id="portal-check-url" className="check-url-input" readOnly value={checkUrl} onFocus={(event) => event.currentTarget.select()} /><button className="button secondary" type="button" onClick={() => void copyCheckUrl()}>URLをコピー</button></div><p className="save-hint">この画面を写真に撮るか、上のURLを保存してください。</p><div className="form-actions"><a className="button accent" href={checkUrl}>確認ページを開く</a><button className="button secondary" type="button" onClick={() => { setCheckUrl(''); setQuestionId(null); setStatus(''); }}>新しく相談する</button></div></div> : !preview ? <form className="ask-form" onSubmit={previewQuestion}><label htmlFor="portal-question">相談</label><textarea id="portal-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例：水が足りない、どこに行けばいいですか" maxLength={500} required /><p className="input-hint">500文字まで。電話番号や住所などを書いても、そのまま受け付けます。</p><button className="button accent" disabled={busy} type="submit">{busy ? '確認中…' : 'FAQを探して内容を確認'}</button>{status && <p className="form-status" role="status">{status}</p>}</form> : <form className="ask-form" onSubmit={submitQuestion}><div className="step-card"><span className="tag">AIが相談を整理</span><h3>職員向けの要約</h3><textarea value={preview.summary} onChange={(event) => setPreview({ ...preview, summary: event.target.value })} maxLength={300} /><p className="input-hint">参考情報です。自由に直せます。原文は変わりません。</p></div><div className="original-card"><h3>相談の原文</h3><p>{preview.body}</p></div><label htmlFor="portal-category">カテゴリ</label><select id="portal-category" value={preview.category} onChange={(event) => setPreview({ ...preview, category: event.target.value })}>{SHELTER_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select>{preview.related.length > 0 && <div className="related-card"><h3>近いFAQ</h3>{preview.related.slice(0, 1).map((faq) => <div className="related-item" key={faq.id}><b>Q. {faq.question}</b><p>A. {faq.answer}</p></div>)}{preview.related.length > 1 && <details><summary>ほかの候補を見る</summary>{preview.related.slice(1).map((faq) => <div className="related-item" key={faq.id}><b>Q. {faq.question}</b><p>A. {faq.answer}</p></div>)}</details>}<p className="input-hint">解決しなければ、そのまま相談を送れます。</p></div>}<div className="form-actions"><button className="button accent" disabled={busy} type="submit">{busy ? '送信中…' : '匿名で相談を送信'}</button><button className="button secondary" type="button" onClick={() => { setPreview(null); setStatus(''); }}>書き直す</button></div>{status && <p className="form-status" role="status">{status}</p>}</form>}</section>
    <footer>この窓口の回答・FAQ公開は、必ず人が確認します。確認URLは安全のため30日間有効です。</footer>
  </main>;
}
