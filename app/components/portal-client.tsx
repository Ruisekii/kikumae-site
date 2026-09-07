'use client';

import { FormEvent, useMemo, useState } from 'react';
import { SHELTER_CATEGORIES } from '../../db/local-ai';
import type { Faq, RelatedFaq } from '../../db/repository';
import { translateUserFaq, UserHeader, useUserI18n } from '../user-i18n';

type Preview = { body: string; summary: string; category: string; related: RelatedFaq[]; submissionKey: string };
type Props = { slug: string; name: string; description: string; faqs: Faq[] };
const normalize = (value: string) => value.toLocaleLowerCase('ja-JP').replace(/\s/g, '');
const PORTAL_CATEGORY_KEYS: Record<string, string> = { '水・飲料': 'portal.category.water', '食料・物資': 'portal.category.food', '医療・薬': 'portal.category.medical', 'トイレ・衛生': 'portal.category.toilet', '設備・充電': 'portal.category.facility', 'ペット': 'portal.category.pets', '安全・その他': 'portal.category.safety', 'その他': 'portal.category.other' };

export function PortalClient({ slug, name, description, faqs }: Props) {
  const { t, language } = useUserI18n();
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
  const closest = matches[0] ? translateUserFaq(matches[0], language) : null;

  async function previewQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setStatus('');
    try {
      const response = await fetch(`/api/portals/${slug}/questions/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: question }) });
      const payload = await response.json() as Preview;
      if (!response.ok) { setStatus(t('portal.errors.checked')); return; }
      setPreview({ ...payload, submissionKey: crypto.randomUUID() }); setQuestion(payload.body);
    } catch { setStatus(t('portal.errors.connection')); }
    finally { setBusy(false); }
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!preview) return; setBusy(true); setStatus('');
    try {
      const response = await fetch(`/api/portals/${slug}/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: preview.body, summary: preview.summary, category: preview.category, submissionKey: preview.submissionKey }) });
      const payload = await response.json() as { checkUrl?: string; id?: number };
      if (!response.ok) { setStatus(t('portal.errors.sent')); return; }
      const id = typeof payload.id === 'number' ? payload.id : null;
      setQuestion(''); setPreview(null); setCheckUrl(payload.checkUrl ?? ''); setQuestionId(id); setStatus(t('portal.saveScreen'));
    } catch { setStatus(t('portal.errors.connection')); }
    finally { setBusy(false); }
  }

  async function copyCheckUrl() {
    const field = document.getElementById('portal-check-url') as HTMLInputElement | null;
    field?.select();
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(checkUrl); setStatus(t('portal.errors.copied')); return; } } catch { /* 手動コピーへ */ }
    setStatus(t('portal.errors.copyManual'));
  }

  return <main className="evac-theme">
    <UserHeader brand={t('portal.headerBrand')} brandHref={`/${slug}`} faqHref="#faq" adminHref={`/${slug}/admin`} />
    <p className="portal-origin-notice" role="note">{t('portal.notice', { name })}</p>
    <section className="portal-hero"><p className="eyebrow">{t('portal.eyebrow')}</p><h1>{t('portal.title', { name })}</h1><p>{description || t('portal.defaultDescription')}</p><div className="hero-actions"><a className="button primary" href="#faq">{t('portal.searchFaq')}</a><a className="button accent" href="#ask">{t('portal.consult')}</a></div></section>
    <section className="section" id="faq"><div className="section-heading"><div><p className="eyebrow">{t('portal.faqEyebrow')}</p><h2>{t('portal.faqTitle')}</h2></div><label className="search-label"><span className="sr-only">{t('portal.searchAria')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('portal.searchPlaceholder')} maxLength={100} type="search" aria-label={t('portal.searchAria')} /></label></div>
      {closest ? <article className="faq-card faq-card-featured"><span className="tag">{closest.category}</span><h3>Q. {closest.question}</h3><p>A. {closest.answer}</p>{matches.length > 1 && <details><summary>{t('portal.faqOther', { count: matches.length - 1 })}</summary><div className="faq-grid faq-grid-inner">{matches.slice(1).map((faq) => { const translatedFaq = translateUserFaq(faq, language); return <article className="faq-card" key={faq.id}><span className="tag">{translatedFaq.category}</span><h3>Q. {translatedFaq.question}</h3><p>A. {translatedFaq.answer}</p></article>; })}</div></details>}<div className="form-actions"><a className="button primary" href="#ask">{t('portal.faqSolved')}</a><a className="button secondary" href="#ask">{t('portal.faqStill')}</a></div></article> : <p className="empty">{t('portal.faqEmpty')}</p>}
    </section>
    <section className="ask-section" id="ask"><div><p className="eyebrow">{t('portal.askEyebrow')}</p><h2>{t('portal.askTitle')}</h2><p>{t('portal.askLead')}</p><ul><li>{t('portal.policyNoPii')}</li><li>{t('portal.policyOriginal')}</li><li>{t('portal.policyAi')}</li><li>{t('portal.policyFaq')}</li></ul></div>{checkUrl ? <div className="ask-form consult-receipt"><span className="tag">{t('portal.received')}</span><h3>{t('portal.receivedTitle')}</h3>{questionId != null && <p className="consult-id">{t('portal.consultId')} <b>#{String(questionId).padStart(4, '0')}</b></p>}<p>{status}</p><div className="check-url-box"><label className="sr-only" htmlFor="portal-check-url">{t('portal.statusUrl')}</label><input id="portal-check-url" className="check-url-input" readOnly value={checkUrl} onFocus={(event) => event.currentTarget.select()} aria-label={t('portal.statusUrl')} /><button className="button secondary" type="button" onClick={() => void copyCheckUrl()}>{t('portal.copyUrl')}</button></div><p className="save-hint">{t('portal.saveScreen')}</p><div className="form-actions"><a className="button accent" href={checkUrl}>{t('portal.openStatus')}</a><button className="button secondary" type="button" onClick={() => { setCheckUrl(''); setQuestionId(null); setStatus(''); }}>{t('portal.newConsult')}</button></div></div> : !preview ? <form className="ask-form" onSubmit={previewQuestion}><label htmlFor="portal-question">{t('portal.formLabel')}</label><textarea id="portal-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t('portal.formPlaceholder')} maxLength={500} required aria-describedby="portal-question-hint" /><p className="input-hint" id="portal-question-hint">{t('portal.inputHint')}</p><button className="button accent" disabled={busy} type="submit">{busy ? t('portal.checking') : t('portal.findFaqAndCheck')}</button>{status && <p className="form-status" role="status">{status}</p>}</form> : <form className="ask-form" onSubmit={submitQuestion}><div className="step-card"><span className="tag">{t('portal.organized')}</span><h3>{t('portal.summaryTitle')}</h3><textarea value={preview.summary} onChange={(event) => setPreview({ ...preview, summary: event.target.value })} maxLength={300} aria-label={t('portal.summaryTitle')} /><p className="input-hint">{t('portal.summaryHint')}</p></div><div className="original-card"><h3>{t('portal.originalTitle')}</h3><p>{preview.body}</p></div><label htmlFor="portal-category">{t('portal.category')}</label><select id="portal-category" value={preview.category} onChange={(event) => setPreview({ ...preview, category: event.target.value })}>{SHELTER_CATEGORIES.map((category) => <option key={category} value={category}>{PORTAL_CATEGORY_KEYS[category] ? t(PORTAL_CATEGORY_KEYS[category]) : category}</option>)}</select>{preview.related.length > 0 && <div className="related-card"><h3>{t('portal.related')}</h3>{preview.related.slice(0, 1).map((faq) => { const translatedFaq = translateUserFaq(faq, language); return <div className="related-item" key={faq.id}><b>Q. {translatedFaq.question}</b><p>A. {translatedFaq.answer}</p></div>; })}{preview.related.length > 1 && <details><summary>{t('portal.moreCandidates')}</summary>{preview.related.slice(1).map((faq) => { const translatedFaq = translateUserFaq(faq, language); return <div className="related-item" key={faq.id}><b>Q. {translatedFaq.question}</b><p>A. {translatedFaq.answer}</p></div>; })}</details>}<p className="input-hint">{t('portal.canSend')}</p></div>}<div className="form-actions"><button className="button accent" disabled={busy} type="submit">{busy ? t('portal.sending') : t('portal.send')}</button><button className="button secondary" type="button" onClick={() => { setPreview(null); setStatus(''); }}>{t('portal.rewrite')}</button></div>{status && <p className="form-status" role="status">{status}</p>}</form>}</section>
    <footer>{t('portal.footer')}</footer>
  </main>;
}
