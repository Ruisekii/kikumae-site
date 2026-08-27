'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { Faq, RelatedFaq } from '../../db/repository';

type Preview = {
  body: string;
  summary: string;
  category: string;
  related: RelatedFaq[];
  aiMode: string;
};

type Props = { faqs: Faq[] };
const normalize = (value: string) => value.toLocaleLowerCase('ja-JP').replace(/\s/g, '');
const categories = ['見学・参加方法', '初心者向け', '活動内容', '部費・持ち物', 'その他'];

export function KikumaeClient({ faqs }: Props) {
  const [query, setQuery] = useState('');
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);

  const matches = useMemo(() => {
    const term = normalize(query);
    if (!term) return faqs;
    return faqs.filter((faq) => normalize(`${faq.question}${faq.answer}${faq.category}`).includes(term));
  }, [faqs, query]);

  async function previewQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true); setStatus('');
    try {
      const response = await fetch('/api/questions/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: question }),
      });
      const payload = await response.json() as Preview & { message?: string };
      if (!response.ok) { setStatus(payload.message ?? '確認できませんでした。'); return; }
      setPreview(payload); setQuestion(payload.body);
    } catch { setStatus('通信に失敗しました。時間をおいてもう一度お試しください。'); }
    finally { setSending(false); }
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    setSending(true); setStatus('');
    try {
      const response = await fetch('/api/questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: preview.body, summary: preview.summary, category: preview.category }),
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) { setStatus(payload.message ?? '送信できませんでした。'); return; }
      setQuestion(''); setPreview(null); setStatus('質問を受け付けました。回答者が確認し、14日後に自動で削除されます。');
    } catch { setStatus('通信に失敗しました。時間をおいてもう一度お試しください。'); }
    finally { setSending(false); }
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
        <p>「人に聞くほどでもない」気持ちを受け止める、小さな質問窓口です。AIは下書きを手伝い、最後は必ず人が確認します。</p>
        <div className="hero-actions"><a className="button primary" href="#faq">FAQを探す</a><a className="button accent" href="#ask">匿名で質問する</a></div>
      </section>
      <section className="section" id="faq" aria-labelledby="faq-title">
        <div className="section-heading"><div><p className="eyebrow">よくある質問</p><h2 id="faq-title">言葉のままで探せます</h2></div><label className="search-label"><span className="sr-only">FAQを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：急に見学に行っても大丈夫？" maxLength={100} type="search" /></label></div>
        <div className="faq-grid" aria-live="polite">
          {matches.map((faq) => <article className="faq-card" key={faq.id}><span className="tag">{faq.category}</span><h3><span aria-hidden="true">Q.</span> {faq.question}</h3><p><span aria-hidden="true">A.</span> {faq.answer}</p></article>)}
          {!matches.length && <p className="empty">近いFAQは見つかりませんでした。下の窓口から気軽に質問できます。</p>}
        </div>
      </section>
      <section className="ask-section" id="ask" aria-labelledby="ask-title">
        <div><p className="eyebrow">匿名の質問窓口</p><h2 id="ask-title">文章は、かしこまらなくて大丈夫。</h2><p>まずFAQを探し、見つからなければ思ったままの文章で質問してください。質問者はログイン不要です。</p><ul><li>外部AIへ質問内容を送信しません</li><li>原文はそのまま回答者に表示します</li><li>質問は14日後に自動削除します</li></ul></div>
        {!preview ? (
          <form className="ask-form" onSubmit={previewQuestion}><label htmlFor="question">質問</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例：途中からでも参加できますか？" maxLength={500} required /><p className="input-hint">500文字まで。氏名・連絡先・住所・URLなどの個人情報は書かないでください。</p><button className="button accent" disabled={sending} type="submit">{sending ? '確認中…' : 'FAQを探して内容を確認'}</button>{status && <p className="form-status" role="status">{status}</p>}</form>
        ) : (
          <form className="ask-form" onSubmit={submitQuestion}>
            <div className="step-card"><span className="tag">{preview.aiMode === 'local-rules' ? '外部送信なし・ローカル補助AI' : 'AI補助'}</span><h3>回答者向けの要約</h3><textarea value={preview.summary} onChange={(event) => setPreview({ ...preview, summary: event.target.value })} maxLength={300} /><p className="input-hint">要約は参考情報です。自由に直せます。原文は変わりません。</p></div>
            <div className="original-card"><h3>質問の原文</h3><p>{preview.body}</p></div>
            <label htmlFor="category">カテゴリ（AI候補）</label><select id="category" value={preview.category} onChange={(event) => setPreview({ ...preview, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select>
            {preview.related.length > 0 && <div className="related-card"><h3>もしかして、このFAQで解決しませんか？</h3>{preview.related.map((faq) => <div className="related-item" key={faq.id}><b>Q. {faq.question}</b><p>A. {faq.answer}</p></div>)}<p className="input-hint">解決しなければ、そのまま質問を送れます。</p></div>}
            <div className="form-actions"><button className="button accent" disabled={sending} type="submit">{sending ? '送信中…' : '匿名で質問を送信'}</button><button className="button secondary" type="button" onClick={() => { setPreview(null); setStatus(''); }}>書き直す</button></div>{status && <p className="form-status" role="status">{status}</p>}
          </form>
        )}
      </section>
      <footer>きくまえ — ローカル補助AIは下書きを手伝います。公式回答とFAQの公開は、必ず人が承認します。</footer>
    </main>
  );
}
