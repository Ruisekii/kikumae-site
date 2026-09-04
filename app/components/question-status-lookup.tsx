'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

export function QuestionStatusLookup() {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = value.trim();
    const match = input.match(/\/questions\/([0-9a-f-]{32,80})/i) ?? input.match(/^([0-9a-f-]{32,80})$/i);
    if (!match) { setMessage('受付完了時に表示された確認URLまたは確認用コードを入力してください。'); return; }
    window.location.assign(`/questions/${match[1]}`);
  }

  return <main className="public-page status-lookup-page evac-theme"><header className="site-header"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">相</span>相談窓口</Link><Link href="/">ホームへ戻る</Link></header><section className="status-lookup-card"><p className="eyebrow">相談状況を見る</p><h1>自分の相談が、いまどうなっているか確認できます。</h1><p>受付完了時に保存した確認URLを貼り付けてください。ログインは必要ありません。</p><form onSubmit={submit}><label htmlFor="status-token">確認URLまたは確認用コード<input id="status-token" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://…/questions/確認用コード" autoComplete="off" required /></label><button className="button accent" type="submit">相談状況を見る</button>{message && <p className="form-status" role="alert">{message}</p>}</form></section></main>;
}
