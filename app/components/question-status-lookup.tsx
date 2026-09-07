'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { clearConsultHistory, loadConsultHistory, type ConsultHistoryEntry } from './consult-history';
import { translateUserIssueTitle, UserHeader, useUserI18n } from '../user-i18n';

type StatusRecord = { id: number; title: string; workflowStatus: string; updatedAt: number };
type HistoryCard = ConsultHistoryEntry & { status?: StatusRecord; loading: boolean; unavailable: boolean };

const stages = [
  ['received', 'status.received'],
  ['reviewing', 'status.reviewing'],
  ['field_checking', 'status.fieldChecking'],
  ['in_progress', 'status.inProgress'],
  ['resolved', 'status.resolved'],
] as const;

function statusIndex(status: string) {
  if (status === 'resolved' || status === 'cannot_resolve') return 4;
  if (status === 'in_progress' || status === 'awaiting_info') return 3;
  if (status === 'field_checking') return 2;
  if (status === 'reviewing' || status === 'assigned' || status === 'waiting') return 1;
  return 0;
}

function statusLabel(status: string, t: (key: string, options?: Record<string, unknown>) => string) {
  if (status === 'waiting') return t('statusLookup.waiting');
  if (status === 'cannot_resolve') return t('statusLookup.cannotResolve');
  return t(stages[statusIndex(status)]?.[1] ?? 'status.received');
}

function formatStatusTime(value: Date, language: 'ja' | 'en' | 'zh' | 'ko', options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Tokyo', ...options }).format(value);
}

async function fetchStatus(entry: ConsultHistoryEntry): Promise<{ status?: StatusRecord; unavailable: boolean }> {
  try {
    const token = entry.checkUrl.match(/\/questions\/([0-9a-f-]{32,80})/i)?.[1];
    if (!token) return { unavailable: true };
    const response = await fetch(`/api/questions/status/${token}`, { cache: 'no-store' });
    if (!response.ok) return { unavailable: true };
    const payload = await response.json() as Partial<StatusRecord>;
    if (typeof payload.workflowStatus !== 'string') return { unavailable: true };
    return { status: { id: typeof payload.id === 'number' ? payload.id : entry.id, title: payload.title || entry.title, workflowStatus: payload.workflowStatus, updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : entry.savedAt }, unavailable: false };
  } catch { return { unavailable: true }; }
}

export function QuestionStatusLookup() {
  const { t, language } = useUserI18n();
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<HistoryCard[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function refreshHistory() {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      const entries = loadConsultHistory();
      if (!entries.length) {
        if (active) { setHistory([]); setLastCheckedAt(new Date()); }
        inFlight = false;
        return;
      }
      setHistory((current) => entries.map((entry) => {
        const previous = current.find((item) => item.id === entry.id && item.savedAt === entry.savedAt);
        return { ...entry, status: previous?.status, loading: true, unavailable: false };
      }));
      try {
        const results = await Promise.all(entries.map(async (entry) => ({ entry, result: await fetchStatus(entry) })));
        if (active) {
          setHistory(results.map(({ entry, result }) => ({ ...entry, status: result.status, loading: false, unavailable: result.unavailable })));
          setLastCheckedAt(new Date());
        }
      } finally {
        inFlight = false;
      }
    }
    void refreshHistory();
    const timer = window.setInterval(() => { void refreshHistory(); }, 10_000);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshHistory(); };
    const refreshWhenOnline = () => { void refreshHistory(); };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('online', refreshWhenOnline);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshWhenVisible); window.removeEventListener('online', refreshWhenOnline); };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = value.trim();
    const match = input.match(/\/questions\/([0-9a-f-]{32,80})/i) ?? input.match(/^([0-9a-f-]{32,80})$/i);
    if (!match) { setMessage(t('statusLookup.invalidToken')); return; }
    window.location.assign(`/questions/${match[1]}`);
  }

  return <main className="evac-theme public-page status-lookup-page">
    <UserHeader brand="◌ イセキ避難所" brandHref="/" faqHref="/#reception-faq" statusHref="/questions" />
    <section className="status-lookup-card">
      <p className="eyebrow">{t('statusLookup.eyebrow')}</p>
      <h1>{t('statusLookup.title')}</h1>
      <p>{t('statusLookup.lead')}</p>
      {lastCheckedAt && <p className="status-live-note" role="status">{t('statusLookup.live', { time: formatStatusTime(lastCheckedAt, language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}</p>}
      {history.length > 0 ? <div className="device-history">
        <div className="device-history-heading"><h2>{t('statusLookup.current')}</h2><span>{t('statusLookup.days')}</span></div>
        <ul className="device-history-cards">{history.map((entry) => {
          const index = statusIndex(entry.status?.workflowStatus ?? 'received');
          const title = translateUserIssueTitle(entry.status?.title || entry.title, language);
          return <li className="device-history-card" key={`${entry.id}-${entry.savedAt}`}>
            <div className="device-history-card-top"><span className="device-history-category">{title}</span><strong>{entry.loading ? t('statusLookup.loading') : entry.unavailable ? t('statusLookup.unavailable') : statusLabel(entry.status?.workflowStatus ?? 'received', t)}</strong></div>
            <div className="mini-status-track" aria-label={t('statusLookup.trackAria', { title })}>{stages.map(([key, label], stage) => <span className={stage <= index ? 'done' : ''} key={key}><i aria-hidden="true">{stage <= index ? '●' : '○'}</i>{t(label)}</span>)}</div>
            <div className="device-history-card-bottom"><time dateTime={new Date(entry.status?.updatedAt ?? entry.savedAt).toISOString()}>{entry.unavailable ? t('statusLookup.savedPage') : t('statusLookup.lastUpdated', { time: formatStatusTime(new Date(entry.status?.updatedAt ?? entry.savedAt), language, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })}</time><a className="button secondary" href={entry.checkUrl}>{t('statusLookup.details')}</a></div>
          </li>;
        })}</ul>
        <button className="text-button" type="button" onClick={() => { clearConsultHistory(); setHistory([]); }}>{t('statusLookup.clear')}</button>
      </div> : <div className="device-history-empty"><strong>{t('statusLookup.emptyTitle')}</strong><p>{t('statusLookup.emptyLead')}</p><Link className="button accent" href="/">{t('statusLookup.chooseIssue')}</Link></div>}
      <details className="status-advanced-lookup">
        <summary>{t('statusLookup.advanced')}</summary>
        <p>{t('statusLookup.advancedLead')}</p>
        <form onSubmit={submit}><label htmlFor="status-token">{t('statusLookup.tokenLabel')}<input id="status-token" value={value} onChange={(event) => setValue(event.target.value)} placeholder={t('statusLookup.tokenPlaceholder')} autoComplete="off" required /></label><button className="button secondary" type="submit">{t('statusLookup.open')}</button>{message && <p className="form-status" role="alert">{message}</p>}</form>
      </details>
    </section>
  </main>;
}
