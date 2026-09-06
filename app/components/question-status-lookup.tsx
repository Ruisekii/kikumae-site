'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { clearConsultHistory, loadConsultHistory, type ConsultHistoryEntry } from './consult-history';

type StatusRecord = { id: number; title: string; workflowStatus: string; updatedAt: number };
type HistoryCard = ConsultHistoryEntry & { status?: StatusRecord; loading: boolean };

const stages = [
  ['received', '受付済み'],
  ['reviewing', '確認中'],
  ['field_checking', '現場確認中'],
  ['in_progress', '対応中'],
  ['resolved', '解決済み'],
] as const;

function statusIndex(status: string) {
  if (status === 'resolved' || status === 'cannot_resolve') return 4;
  if (status === 'in_progress' || status === 'awaiting_info') return 3;
  if (status === 'field_checking') return 2;
  if (status === 'reviewing' || status === 'assigned' || status === 'waiting') return 1;
  return 0;
}

function statusLabel(status: string) { return stages[statusIndex(status)]?.[1] ?? '受付済み'; }

async function fetchStatus(entry: ConsultHistoryEntry): Promise<StatusRecord | undefined> {
  try {
    const token = entry.checkUrl.match(/\/questions\/([0-9a-f-]{32,80})/i)?.[1];
    if (!token) return undefined;
    const response = await fetch(`/api/questions/status/${token}`, { cache: 'no-store' });
    if (!response.ok) return undefined;
    const payload = await response.json() as Partial<StatusRecord>;
    if (typeof payload.workflowStatus !== 'string') return undefined;
    return { id: typeof payload.id === 'number' ? payload.id : entry.id, title: payload.title || entry.title, workflowStatus: payload.workflowStatus, updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : entry.savedAt };
  } catch { return undefined; }
}

export function QuestionStatusLookup() {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<HistoryCard[]>([]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const entries = loadConsultHistory();
      setHistory(entries.map((entry) => ({ ...entry, loading: true })));
      void Promise.all(entries.map(async (entry) => ({ entry, status: await fetchStatus(entry) }))).then((results) => {
        if (active) setHistory(results.map(({ entry, status }) => ({ ...entry, status, loading: false })));
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = value.trim();
    const match = input.match(/\/questions\/([0-9a-f-]{32,80})/i) ?? input.match(/^([0-9a-f-]{32,80})$/i);
    if (!match) { setMessage('確認URLまたは確認用コードの形式を確認してください。'); return; }
    window.location.assign(`/questions/${match[1]}`);
  }

  return <main className="evac-theme public-page status-lookup-page">
    <header className="site-header status-site-header">
      <Link className="brand" href="/">◌ 避難所の受付</Link>
      <nav aria-label="利用者メニュー"><Link href="/">困りごと</Link><Link href="/#reception-faq">よくある質問</Link><Link href="/questions" aria-current="page">相談状況</Link></nav>
    </header>
    <section className="status-lookup-card">
      <p className="eyebrow">相談状況</p>
      <h1>あなたの相談</h1>
      <p>この端末から送った相談は、自動でここに表示されます。ログインは必要ありません。</p>
      {history.length > 0 ? <div className="device-history">
        <div className="device-history-heading"><h2>いまの対応状況</h2><span>7日間表示</span></div>
        <ul className="device-history-cards">{history.map((entry) => {
          const index = statusIndex(entry.status?.workflowStatus ?? 'received');
          return <li className="device-history-card" key={`${entry.id}-${entry.savedAt}`}>
            <div className="device-history-card-top"><span className="device-history-category">{entry.status?.title || entry.title}</span><strong>{entry.loading ? '確認中…' : statusLabel(entry.status?.workflowStatus ?? 'received')}</strong></div>
            <div className="mini-status-track" aria-label={`${entry.status?.title || entry.title}の進み具合`}>{stages.map(([key, label], stage) => <span className={stage <= index ? 'done' : ''} key={key}><i aria-hidden="true">{stage <= index ? '●' : '○'}</i>{label}</span>)}</div>
            <div className="device-history-card-bottom"><time dateTime={new Date(entry.status?.updatedAt ?? entry.savedAt).toISOString()}>最終更新 {new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(entry.status?.updatedAt ?? entry.savedAt))}</time><a className="button secondary" href={entry.checkUrl}>詳しく見る</a></div>
          </li>;
        })}</ul>
        <button className="text-button" type="button" onClick={() => { clearConsultHistory(); setHistory([]); }}>この端末の履歴を消す</button>
      </div> : <div className="device-history-empty"><strong>この端末に保存された相談はありません。</strong><p>相談を送信すると、ここからいつでも状況を確認できます。</p><Link className="button accent" href="/">困りごとを選ぶ</Link></div>}
      <details className="status-advanced-lookup">
        <summary>別の端末・保存したURLから確認する</summary>
        <p>受付完了時の確認URLまたは確認用コードを入力してください。</p>
        <form onSubmit={submit}><label htmlFor="status-token">確認URLまたは確認用コード<input id="status-token" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://…/questions/確認用コード" autoComplete="off" required /></label><button className="button secondary" type="submit">相談状況を開く</button>{message && <p className="form-status" role="alert">{message}</p>}</form>
      </details>
    </section>
  </main>;
}
