'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { clearConsultHistory, loadConsultHistory, type ConsultHistoryEntry } from './kikumae-client';

export function QuestionStatusLookup() {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<ConsultHistoryEntry[]>([]);

  useEffect(() => { const timer = window.setTimeout(() => setHistory(loadConsultHistory()), 0); return () => window.clearTimeout(timer); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = value.trim();
    const match = input.match(/\/questions\/([0-9a-f-]{32,80})/i) ?? input.match(/^([0-9a-f-]{32,80})$/i);
    if (!match) { setMessage('受付完了時に表示された確認URLまたは確認用コードを入力してください。'); return; }
    window.location.assign(`/questions/${match[1]}`);
  }

  return <main className="evac-theme public-page status-lookup-page"><header className="site-header"><Link className="brand" href="/">🐣 相談窓口</Link><Link href="/">ホームへ戻る</Link></header><section className="status-lookup-card"><p className="eyebrow">相談状況を見る</p><h1>自分の相談が、いまどうなっているか確認できます。</h1><p>受付完了時に保存した確認URLを貼り付けてください。ログインは必要ありません。</p><form onSubmit={submit}><label htmlFor="status-token">確認URLまたは確認用コード<input id="status-token" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://…/questions/確認用コード" autoComplete="off" required /></label><button className="button accent" type="submit">相談状況を見る</button>{message && <p className="form-status" role="alert">{message}</p>}</form>{history.length > 0 && <div className="device-history"><h2>この端末から送った相談</h2><p className="device-history-note">相談本文は保存していません。7日間だけ、状況確認へのリンクを表示します。</p><ul className="device-history-list">{history.map((entry) => <li key={`${entry.id}-${entry.savedAt}`}><a href={entry.checkUrl}>#{String(entry.id).padStart(4, '0')} {entry.title}</a><time className="device-history-date" dateTime={new Date(entry.savedAt).toISOString()}>{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(new Date(entry.savedAt))}</time></li>)}</ul><button className="text-button" type="button" onClick={() => { clearConsultHistory(); setHistory([]); }}>この端末の履歴を消す</button></div>}</section></main>;
}
