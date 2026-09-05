/* eslint-disable @next/next/no-img-element -- QR画像は公開のQR生成エンドポイントが返す画像なので next/image は使わない。 */
'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

type CreatedPortal = { name: string; slug: string; description: string };

// 避難所の登録フォーム本体。管理者ログイン済みであることは呼び出し元の
// app/open/page.tsx（サーバー側）で確認済みの前提で描画される。
export function OpenPortalForm() {
  const [message, setMessage] = useState('');
  const [created, setCreated] = useState<CreatedPortal | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState('');

  async function copyPublicUrl(url: string) {
    try {
      if (!navigator.clipboard) throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setMessage('コピーできませんでした。URLを選択してコピーしてください。');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const data = new FormData(event.currentTarget);
    const body = Object.fromEntries(data.entries());
    try {
      const response = await fetch('/api/portals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json() as { message?: string; portal?: CreatedPortal };
      if (!response.ok || !payload.portal) { setMessage(payload.message ?? '登録できませんでした。入力内容を確認してください。'); return; }
      setCreated(payload.portal);
    } catch { setMessage('通信に失敗しました。時間をおいてもう一度お試しください。'); }
    finally { setBusy(false); }
  }

  if (created) {
    const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/${created.slug}` : `/${created.slug}`;
    const adminUrl = typeof window !== 'undefined' ? `${window.location.origin}/${created.slug}/admin` : `/${created.slug}/admin`;
    return <main className="evac-theme portal-create-page"><div className="portal-complete"><p className="eyebrow">避難所の登録が完了しました！</p><h1>避難所の相談窓口ができました</h1><p>{created.name}にいる方からの相談を、この専用の窓口で受け付けられます。</p><dl><dt>公開ページ（避難者向け）</dt><dd><code>{publicUrl}</code></dd><dt>管理ページ（職員向け）</dt><dd><code>{adminUrl}</code></dd></dl><div className="portal-qr"><p><b>公開ページのQRコード</b></p><img src={`https://quickchart.io/qr?size=180&margin=1&text=${encodeURIComponent(publicUrl)}`} alt={`${created.name} 公開ページのQRコード`} width="180" height="180" loading="eager" /><p className="input-hint">QRコードには公開ページのURLだけが入ります。</p></div><div className="form-actions"><Link className="button accent" href={`/${created.slug}`}>公開ページを見る</Link><Link className="button secondary" href={`/${created.slug}/admin`}>管理画面を開く</Link><button className="button secondary" type="button" onClick={() => { void copyPublicUrl(publicUrl); }}>{copied ? 'コピーしました' : '公開URLをコピー'}</button></div><div className="next-steps"><b>次にすること</b><ol><li>公開ページと管理画面の内容を確認する</li><li>公開ページのURL・QRコードを避難所内の掲示板や受付に掲示する</li><li>届いた相談に対応し、FAQ候補を承認する</li></ol></div></div></main>;
  }

  const safeSlug = slug.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)?.[0] ?? '';
  return <main className="evac-theme portal-create-page"><header className="site-header"><Link className="brand" href="/" aria-label="トップへ戻る"><span className="brand-mark" aria-hidden="true">相</span>相談窓口</Link><Link href="/">相談ページへ戻る</Link></header><section className="portal-create-card"><p className="eyebrow">避難所の登録</p><h1>避難所を登録する</h1><p>この避難所にいる方からの相談を受け付ける、専用の相談窓口を用意します。</p><form onSubmit={submit}><label htmlFor="portal-name">避難所の名称<input id="portal-name" name="name" required maxLength={80} placeholder="例：○○小学校避難所 / ○○地区公民館" /></label><label htmlFor="portal-slug">URL用の名前<input id="portal-slug" name="slug" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={48} placeholder="例：oo-elementary-shelter" /><span className="input-hint">英小文字・数字・ハイフンで入力してください。公開URL：/{safeSlug || 'あなたのURL'}</span></label><label htmlFor="portal-description">簡単な説明<textarea id="portal-description" name="description" maxLength={300} placeholder="所在地や受け入れ状況など、避難者への案内に使いたい内容を書いてください。" /></label><label htmlFor="portal-password">管理者パスワード<input id="portal-password" name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" aria-describedby="password-hint" /></label><span id="password-hint" className="input-hint">10文字以上。作成後に表示されないため、安全な場所に保管してください。</span><label htmlFor="portal-password-confirmation">パスワード（確認）<input id="portal-password-confirmation" name="passwordConfirmation" type="password" required minLength={10} maxLength={128} autoComplete="new-password" /></label><button className="button accent" type="submit" disabled={busy}>{busy ? '避難所を登録しています…' : '避難所を登録する'}</button>{message && <p className="form-status" role="status">{message}</p>}</form></section></main>;
}
