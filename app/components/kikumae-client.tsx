'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
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
const categories = ['利用方法', '申請・手続き', '日程・場所', '料金・費用', 'ルール・制度', '困りごと・トラブル', 'その他'];
const companyUseCases = [
  ['人事・総務', '有給ってどこから申請するんだっけ？', '制度や手続きの問い合わせを、次の人もFAQで確認できます。'],
  ['情報システム・社内IT', 'パスワードを忘れたらどうすればいい？', '情シスへの繰り返しの質問を減らし、解決した手順を残せます。'],
  ['新人・オンボーディング', '最初に何を設定すればいい？', '「こんなこと聞いていいのかな」を、匿名で聞きやすくします。'],
  ['採用・会社説明会', '服装はスーツですか？', '応募前の小さな疑問を、担当者に連絡する前に解決できます。'],
] as const;

export function KikumaeClient({ faqs }: Props) {
  const [query, setQuery] = useState('');
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState('');
  const [checkUrl, setCheckUrl] = useState('');
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
      const payload = await response.json() as { message?: string; checkUrl?: string };
      if (!response.ok) { setStatus(payload.message ?? '送信できませんでした。'); return; }
      setQuestion(''); setPreview(null); setCheckUrl(payload.checkUrl ?? ''); setStatus('質問を受け付けました。管理者が確認し、FAQ改善のため基本的に継続保存されます。');
    } catch { setStatus('通信に失敗しました。時間をおいてもう一度お試しください。'); }
    finally { setSending(false); }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="きくまえ トップへ">🐣 きくまえ</a>
        <nav aria-label="主要メニュー"><a href="#faq">FAQを探す</a><a href="#ask">質問する</a><Link href="/admin">管理者用</Link></nav>
      </header>
      <section className="hero" id="top">
        <p className="eyebrow">聞きにくいを、聞きやすく。</p>
        <h1><span className="hero-line">聞きにくいを、聞きやすく。</span><span className="hero-line">答える手間も、もっと軽く。</span></h1>
        <p>きくまえは、AIが似たFAQを探し、質問を分かりやすく整理し、管理者には回答案を用意するサービスです。人が確認した答えはFAQとして育ち、次の人が質問する前に解決できるようになります。</p>
        <div className="hero-actions"><a className="button primary" href="#faq">FAQを探す</a><a className="button accent" href="#ask">匿名で質問する</a></div>
      </section>
      <section className="section value-section" aria-labelledby="value-title"><p className="eyebrow">きくまえが手伝うこと</p><h2 id="value-title">聞く人も、答える人も、AIでもっと楽に。</h2><div className="feature-grid"><article className="feature-card"><span className="tag">質問者</span><h3>似たFAQを探して整理</h3><p>思ったままの文章で質問でき、AIが既存FAQや要点を整理します。</p></article><article className="feature-card"><span className="tag">管理者</span><h3>回答のたたき台を用意</h3><p>関連FAQと複数の回答案をもとに、編集して答えられます。</p></article><article className="feature-card"><span className="tag">みんな</span><h3>答えがFAQとして育つ</h3><p>人が確認した回答だけが次の「聞く前」の答えになります。</p></article></div></section>
      <section className="section cycle-section" aria-labelledby="cycle-title"><p className="eyebrow">きくまえの循環</p><h2 id="cycle-title">答えるほど、FAQが育つ。</h2><div className="cycle-list"><span>質問する</span><i>↓</i><span>AIが似たFAQを探す・質問を整理</span><i>↓</i><span>AIが回答候補を用意</span><i>↓</i><span>人が確認して回答・FAQを承認</span><i>↓</i><span>次の人はFAQで解決</span></div></section>
      <section className="section places-section" aria-labelledby="places-title"><p className="eyebrow">こんな場所で使えます</p><h2 id="places-title">あなたの場所に、聞きやすい窓口を。</h2><p className="section-lead">学校でも会社でも。「誰に聞けばいい？」を減らし、答えたことを次の人のFAQにできます。</p><div className="places-grid">{[['部活','見学・入部・活動について'],['研究室','研究内容・見学・配属前について'],['学校','新入生・保護者・案内について'],['会社','社内ルール・人事・総務・情シスについて'],['採用','応募前・説明会・選考について'],['イベント','参加方法・当日の案内について']].map(([title, text]) => <article className="place-card" key={title}><b>● {title}</b><span>{text}の質問に</span></article>)}</div></section>
      <section className="section company-section" aria-labelledby="company-title"><p className="eyebrow">会社でも、きくまえ</p><h2 id="company-title">同じ質問に、何度も答えなくていい。</h2><p className="section-lead">人事・総務・情シス・採用の「聞けば分かるけど、毎回聞くのは面倒」を、やさしい窓口にまとめます。</p><div className="company-grid">{companyUseCases.map(([title, question, value]) => <article className="company-card" key={title}><span className="tag">{title}</span><h3>「{question}」</h3><p>{value}</p></article>)}</div><div className="company-flow"><b>会社での使い方</b><p>質問 → AIが似たFAQを探す → なければ要約と3案を用意 → 人が確認して回答 → FAQ候補を承認。</p><p className="input-hint">担当者の頭の中や個別DMに残っていた答えも、人が承認すれば組織のFAQとして残ります。</p></div></section>
      <section className="section open-portal-cta" aria-labelledby="open-title"><p className="eyebrow">自分たちの窓口を開く</p><h2 id="open-title">きくまえ窓口を開きませんか？</h2><p>部活、研究室、学校、会社、採用、イベントまで。あなたの場所専用の「聞きやすい窓口」を開けます。</p><p>聞く人も、答える人も少し楽に。答えた内容は、次の「聞く前」のFAQとして育っていきます。</p><Link className="button accent" href="/open">きくまえ窓口を開く</Link></section>
      <section className="section" id="faq" aria-labelledby="faq-title">
        <div className="section-heading"><div><p className="eyebrow">よくある質問</p><h2 id="faq-title">言葉のままで探せます</h2></div><label className="search-label"><span className="sr-only">FAQを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例：急に見学に行っても大丈夫？" maxLength={100} type="search" /></label></div>
        <div className="faq-grid" aria-live="polite">
          {matches.map((faq) => <article className="faq-card" key={faq.id}><span className="tag">{faq.category}</span><h3><span aria-hidden="true">Q.</span> {faq.question}</h3><p><span aria-hidden="true">A.</span> {faq.answer}</p></article>)}
          {!matches.length && <p className="empty">近いFAQは見つかりませんでした。下の窓口から気軽に質問できます。</p>}
        </div>
      </section>
      <section className="ask-section" id="ask" aria-labelledby="ask-title">
         <div><p className="eyebrow">匿名の質問窓口</p><h2 id="ask-title">文章は、かしこまらなくて大丈夫。</h2><p>まずFAQを探し、見つからなければ思ったままの文章で質問してください。質問者はログイン不要です。</p><ul><li>外部AIへ質問内容を送信しません</li><li>原文はそのまま管理者に表示します</li><li>質問・回答・FAQ候補はFAQ改善のため基本的に継続保存します</li><li>不要になった記録は管理者が管理画面から削除できます</li></ul></div>
        {!preview ? (
          <form className="ask-form" onSubmit={previewQuestion}><label htmlFor="question">質問</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例：どこから申請すればいい？" maxLength={500} required /><p className="input-hint">500文字まで。氏名・連絡先・住所・URLなどの個人情報は書かないでください。</p><button className="button accent" disabled={sending} type="submit">{sending ? '確認中…' : 'FAQを探して内容を確認'}</button>{status && <p className="form-status" role="status">{status}</p>}{checkUrl && <p className="check-link"><a href={checkUrl}>回答の確認ページを保存する</a></p>}</form>
        ) : (
          <form className="ask-form" onSubmit={submitQuestion}>
            <div className="step-card"><span className="tag">AIが質問を整理</span><h3>管理者向けの要約</h3><textarea value={preview.summary} onChange={(event) => setPreview({ ...preview, summary: event.target.value })} maxLength={300} /><p className="input-hint">要約は参考情報です。自由に直せます。原文は変わりません。</p></div>
            <div className="original-card"><h3>質問の原文</h3><p>{preview.body}</p></div>
            <label htmlFor="category">カテゴリ（AI候補）</label><select id="category" value={preview.category} onChange={(event) => setPreview({ ...preview, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select>
            {preview.related.length > 0 && <div className="related-card"><h3>もしかして、このFAQで解決しませんか？</h3>{preview.related.map((faq) => <div className="related-item" key={faq.id}><b>Q. {faq.question}</b><p>A. {faq.answer}</p></div>)}<p className="input-hint">解決しなければ、そのまま質問を送れます。</p></div>}
            <div className="form-actions"><button className="button accent" disabled={sending} type="submit">{sending ? '送信中…' : '匿名で質問を送信'}</button><button className="button secondary" type="button" onClick={() => { setPreview(null); setStatus(''); }}>書き直す</button></div>{status && <p className="form-status" role="status">{status}</p>}
          </form>
        )}
      </section>
      <footer>きくまえ — AIがFAQ検索・質問整理・回答案作成を支援します。公式回答とFAQの公開は、必ず人が承認します。</footer>
    </main>
  );
}
