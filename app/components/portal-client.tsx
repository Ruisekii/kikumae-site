'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Faq, RelatedFaq } from '../../db/repository';

type Preview = { body: string; summary: string; category: string; related: RelatedFaq[]; submissionKey: string };
type Props = { slug: string; name: string; description: string; faqs: Faq[] };
const normalize = (value: string) => value.toLocaleLowerCase('ja-JP').replace(/\s/g, '');
const categories = ['利用方法', '申請・手続き', '日程・場所', '料金・費用', 'ルール・制度', '困りごと・トラブル', 'その他'];

export function PortalClient({ slug, name, description, faqs }: Props) {
  const [query, setQuery] = useState('');
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState('');
  const [checkUrl, setCheckUrl] = useState('');
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
      const payload = await response.json() as { message?: string; checkUrl?: string };
      if (!response.ok) { setStatus(payload.message ?? '送信できませんでした。'); return; }
      setQuestion(''); setPreview(null); setCheckUrl(payload.checkUrl ?? ''); setStatus('質問を受け付けました。管理者が確認し、FAQ改善のため継続保存されます。');
    } catch { setStatus('通信に失敗しました。時間をおいて再度お試しください。'); }
    finally { setBusy(false); }
  }
  return <main>
    <header className="site-header"><Link className="brand" href="/">🐣 きくまえ</Link><nav><a href="#faq">FAQを探す</a><a href="#ask">質問する</a><Link href={`/${slug}/admin`}>管理画面</Link></nav></header>
    {/* なりすまし対策: この窓口が避難所の公式窓口ではなく、誰かが自分で開設したものであることを
        常時・目立つ形で明示する。折りたたみにせず、質問フォームより前に必ず目に入る位置に置く。 */}
    <p className="portal-origin-notice" role="note" style={{ maxWidth: 1120, margin: '20px auto 0', padding: '14px 20px', border: '2px solid var(--ink)', borderRadius: 14, background: 'var(--blue)', boxShadow: '4px 4px 0 var(--ink)', fontWeight: 800, fontSize: '.92rem', lineHeight: 1.6 }}>
      この窓口は「{name}」の利用者が自分で開設したものです。避難所の公式な相談窓口ではありません。避難所に関するご相談は<Link href="/" style={{ textDecoration: 'underline' }}>公式窓口（トップページ）</Link>をご利用ください。
    </p>
    <section className="portal-hero"><p className="eyebrow">匿名の質問窓口</p><h1>🐣 {name}のきくまえ</h1><p>{description || '気になることは、思ったままの言葉で聞けます。'}</p><div className="hero-actions"><a className="button primary" href="#faq">FAQを探す</a><a className="button accent" href="#ask">質問する</a></div></section>
    <section className="section" id="faq"><div className="section-heading"><div><p className="eyebrow">公開FAQ</p><h2>まず、聞く前に探せます</h2></div><label className="search-label"><span className="sr-only">FAQを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：どこから申し込めばいい？" maxLength={100} type="search" /></label></div>
      {closest ? <article className="faq-card faq-card-featured"><span className="tag">{closest.category}</span><h3>Q. {closest.question}</h3><p>A. {closest.answer}</p>{matches.length > 1 && <details><summary>ほかのFAQ {matches.length - 1}件</summary><div className="faq-grid faq-grid-inner">{matches.slice(1).map((faq) => <article className="faq-card" key={faq.id}><span className="tag">{faq.category}</span><h3>Q. {faq.question}</h3><p>A. {faq.answer}</p></article>)}</div></details>}<div className="form-actions"><a className="button primary" href="#ask">これで解決した</a><a className="button secondary" href="#ask">それでも質問する</a></div></article> : <p className="empty">近いFAQは見つかりませんでした。下の窓口から気軽に質問できます。</p>}
    </section>
    <section className="ask-section" id="ask"><div><p className="eyebrow">匿名で質問</p><h2>文章は、かしこまらなくて大丈夫。</h2><p>「どこから申請すればいい？」のような自然な文章で送れます。ログインは不要です。</p><ul><li>原文はそのまま保存し、管理者に表示します</li><li>AIは質問の整理と回答案の下書きだけを支援します</li><li>人が確認した回答だけがFAQとして育ちます</li></ul></div>{!preview ? <form className="ask-form" onSubmit={previewQuestion}><label htmlFor="portal-question">質問</label><textarea id="portal-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例：どこから申し込めばいい？" maxLength={500} required /><p className="input-hint">500文字まで。氏名・連絡先・住所・URLなどの個人情報は書かないでください。</p><button className="button accent" disabled={busy} type="submit">{busy ? '確認中…' : 'FAQを探して内容を確認'}</button>{status && <p className="form-status" role="status">{status}</p>}{checkUrl && <p className="check-link"><a href={checkUrl}>回答の確認ページを保存する</a></p>}</form> : <form className="ask-form" onSubmit={submitQuestion}><div className="step-card"><span className="tag">AIが質問を整理</span><h3>管理者向けの要約</h3><textarea value={preview.summary} onChange={(event) => setPreview({ ...preview, summary: event.target.value })} maxLength={300} /><p className="input-hint">参考情報です。自由に直せます。原文は変わりません。</p></div><div className="original-card"><h3>質問の原文</h3><p>{preview.body}</p></div><label htmlFor="portal-category">カテゴリ</label><select id="portal-category" value={preview.category} onChange={(event) => setPreview({ ...preview, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select>{preview.related.length > 0 && <div className="related-card"><h3>近いFAQ</h3>{preview.related.slice(0, 1).map((faq) => <div className="related-item" key={faq.id}><b>Q. {faq.question}</b><p>A. {faq.answer}</p></div>)}{preview.related.length > 1 && <details><summary>ほかの候補を見る</summary>{preview.related.slice(1).map((faq) => <div className="related-item" key={faq.id}><b>Q. {faq.question}</b><p>A. {faq.answer}</p></div>)}</details>}<p className="input-hint">解決しなければ、そのまま質問を送れます。</p></div>}<div className="form-actions"><button className="button accent" disabled={busy} type="submit">{busy ? '送信中…' : '匿名で質問を送信'}</button><button className="button secondary" type="button" onClick={() => { setPreview(null); setStatus(''); }}>書き直す</button></div>{status && <p className="form-status" role="status">{status}</p>}</form>}</section>
    <footer>きくまえ — この窓口の回答・FAQ公開は、必ず人が確認します。確認URLは安全のため30日間有効です。</footer>
  </main>;
}
