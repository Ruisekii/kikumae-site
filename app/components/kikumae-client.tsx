'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { Faq } from '../../db/repository';

type Props = { faqs: Faq[] };

const normalize = (value: string) => value.toLocaleLowerCase('ja-JP').replace(/\s/g, '');

export function KikumaeClient({ faqs }: Props) {
  const [query, setQuery] = useState('');
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);

  const matches = useMemo(() => {
    const term = normalize(query);
    if (!term) return faqs;
    return faqs.filter((faq) => normalize(`${faq.question}${faq.answer}${faq.category}`).includes(term));
  }, [faqs, query]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setStatus('');
    try {
      const response = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: question }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        setStatus(payload.message ?? '送信できませんでした。');
        return;
      }
      setQuestion('');
      setStatus('質問を受け付けました。14日後に自動で削除されます。');
    } catch {
      setStatus('通信に失敗しました。時間をおいてもう一度お試しください。');
    } finally {
      setSending(false);
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="きくまえ トップへ">🐣 きくまえ</a>
        <nav aria-label="主要メニュー"><a href="#faq">FAQを探す</a><a href="#ask">質問する</a><a href="/staff">回答者用</a></nav>
      </header>
      <section className="hero" id="top">
        <p className="eyebrow">聞きにくいを、聞きやすく。</p>
        <h1>まずは、FAQを探してみよう。</h1>
        <p>「人に聞くほどでもない」気持ちを受け止める、小さな質問窓口です。回答は必ず人が確認します。</p>
        <div className="hero-actions"><a className="button primary" href="#faq">FAQを探す</a><a className="button accent" href="#ask">匿名で質問する</a></div>
      </section>
      <section className="section" id="faq" aria-labelledby="faq-title">
        <div className="section-heading"><div><p className="eyebrow">よくある質問</p><h2 id="faq-title">言葉のままで探せます</h2></div><label className="search-label"><span className="sr-only">FAQを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：急に見学に行っても大丈夫？" maxLength={100} type="search" /></label></div>
        <div className="faq-grid" aria-live="polite">
          {matches.map((faq) => <article className="faq-card" key={faq.id}><span className="tag">{faq.category}</span><h3><span aria-hidden="true">Q.</span> {faq.question}</h3><p><span aria-hidden="true">A.</span> {faq.answer}</p></article>)}
          {!matches.length && <p className="empty">近いFAQは見つかりませんでした。下の窓口から質問できます。</p>}
        </div>
      </section>
      <section className="ask-section" id="ask" aria-labelledby="ask-title">
        <div><p className="eyebrow">匿名の質問窓口</p><h2 id="ask-title">文章は、かしこまらなくて大丈夫。</h2><p>メールアドレス・氏名・住所・学籍番号などの個人情報は書かないでください。外部AIには送信せず、質問は14日後に自動削除されます。</p><ul><li>ChatGPTへのログイン後に送信できます</li><li>返信先の登録・メール収集はしません</li><li>AIが自動で回答・公開することはありません</li></ul></div>
        <form className="ask-form" onSubmit={submit}><label htmlFor="question">質問</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例：途中からでも参加できますか？" maxLength={500} required /><p className="input-hint">500文字まで。個人情報やURLを含む内容は送信できません。</p><button className="button accent" disabled={sending} type="submit">{sending ? '送信中…' : 'この内容で質問する'}</button>{status && <p className="form-status" role="status">{status}</p>}</form>
      </section>
      <footer>きくまえ — AIは使わず、質問の保存期間を限定したプライバシー重視の窓口です。</footer>
    </main>
  );
}
