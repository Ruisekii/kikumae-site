'use client';

import Link from 'next/link';
import { FormEvent, use, useState } from 'react';

export default function PortalAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [password, setPassword] = useState(''); const [message, setMessage] = useState(''); const [loggedIn, setLoggedIn] = useState(false); const [name, setName] = useState('この窓口');
  async function login(event: FormEvent) { event.preventDefault(); setMessage(''); const response = await fetch(`/api/portals/${slug}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); const body = await response.json() as { message?: string; portal?: { name: string } }; if (!response.ok) { setMessage(body.message ?? 'ログインできませんでした。'); return; } setName(body.portal?.name ?? 'この窓口'); setLoggedIn(true); }
  return <main className="staff-page"><header className="site-header"><Link className="brand" href="/">🐣 きくまえ</Link><Link href={`/${slug}`}>公開ページへ</Link></header><section className="portal-admin-login"><p className="eyebrow">回答者・管理者用</p><h1>{name}<br />管理画面</h1>{!loggedIn ? <form onSubmit={login}><label>管理者パスワード<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required autoComplete="current-password" /></label><button className="button accent" type="submit">管理画面に入る</button>{message && <p className="form-status" role="status">{message}</p>}</form> : <div className="portal-admin-home"><p>ログインしました。ここから窓口を整えていけます。</p><div className="staff-stats"><span>未回答 <b>0</b></span><span>FAQ候補 <b>0</b></span><span>公開FAQ <b>0</b></span></div><nav className="admin-menu"><Link className="button primary" href="/staff">質問への対応</Link><button className="button secondary" type="button" disabled>FAQ管理（次の更新）</button><button className="button secondary" type="button" disabled>窓口設定（次の更新）</button></nav></div>}</section></main>;
}
