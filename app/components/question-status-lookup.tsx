'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { clearConsultHistory, loadConsultHistory, type ConsultHistoryEntry } from './kikumae-client';

export function QuestionStatusLookup() {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<ConsultHistoryEntry[]>([]);
  const historyLoadAttemptedRef = useRef(false);

  // localStorageはサーバー側では読めないため、マウント後にこの端末の受付履歴を読み込む
  useEffect(() => {
    if (historyLoadAttemptedRef.current) return;
    historyLoadAttemptedRef.current = true;
    setHistory(loadConsultHistory());
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = value.trim();
    const match = input.match(/\/questions\/([0-9a-f-]{32,80})/i) ?? input.match(/^([0-9a-f-]{32,80})$/i);
    if (!match) { setMessage('受付完了時に表示された確認URLまたは確認用コードを入力してください。'); return; }
    window.location.assign(`/questions/${match[1]}`);
  }

  function handleClearHistory() {
    clearConsultHistory();
    setHistory([]);
  }

  return <main className="public-page status-lookup-page evac-theme"><header className="site-header"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">相</span>相談窓口</Link><Link href="/">ホームへ戻る</Link></header><section className="status-lookup-card"><p className="eyebrow">相談状況を見る</p><h1>自分の相談が、いまどうなっているか確認できます。</h1><p>受付完了時に保存した確認URLを貼り付けてください。ログインは必要ありません。</p><form onSubmit={submit}><label htmlFor="status-token">確認URLまたは確認用コード<input id="status-token" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://…/questions/確認用コード" autoComplete="off" required /></label><button className="button accent" type="submit">相談状況を見る</button>{message && <p className="form-status" role="alert">{message}</p>}</form>{history.length > 0 && <div className="device-history"><h2>この端末から送った相談</h2><p className="device-history-note">確認URLの控えを忘れても、この端末なら7日間はここから開けます（相談内容は保存していません）。共用の端末を使っている場合は、見終わったら下のボタンでこの履歴を消してください。</p><ul className="device-history-list">{history.map((entry) => <li key={`${entry.id}-${entry.savedAt}`}><Link href={entry.checkUrl}>#{String(entry.id).padStart(4, '0')} {entry.title}</Link><span className="device-history-date">{new Date(entry.savedAt).toLocaleString('ja-JP')}</span></li>)}</ul><button className="text-button" type="button" onClick={handleClearHistory}>この端末の相談履歴を消す</button></div>}</section></main>;
}
