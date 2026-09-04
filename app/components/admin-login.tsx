'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

export function AdminLogin() {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await response.json() as { message?: string };
      if (!response.ok) { setMessage(body.message ?? 'パスワードを確認してください。'); return; }
      window.location.assign('/admin');
    } catch {
      setMessage('通信に失敗しました。もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  return <main className="admin-login-page"><section className="admin-login-card" aria-labelledby="admin-login-title"><div className="admin-login-mark">◌</div><p className="eyebrow">職員用</p><h1 id="admin-login-title">管理画面に入る</h1><p className="admin-login-lead">管理者用パスワードを入力してください。避難者向けの相談画面とは別に、職員だけが相談状況を確認できます。</p><form onSubmit={submit}><label htmlFor="admin-password">管理者用パスワード<input id="admin-password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required maxLength={128} /></label><button className="button accent" type="submit" disabled={busy}>{busy ? '確認しています…' : '管理画面に入る'}</button>{message && <p className="form-status" role="alert">{message}</p>}</form><Link className="admin-login-back" href="/">避難者向け画面へ戻る</Link></section></main>;
}
