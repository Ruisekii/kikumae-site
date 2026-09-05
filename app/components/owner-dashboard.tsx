'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

type PortalSummary = { id: number; name: string; slug: string; createdAt: number };

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function OwnerDashboard({ signOutHref }: { signOutHref?: string }) {
  const [portals, setPortals] = useState<PortalSummary[]>([]);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PortalSummary | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [message, setMessage] = useState('避難所一覧を読み込んでいます…');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestSerial = useRef(0);

  const loadPortals = useCallback(async (search: string, page = 1) => {
    const serial = ++requestSerial.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set('q', search);
      const response = await fetch(`/api/owner/portals?${params.toString()}`, { cache: 'no-store' });
      const body = await response.json() as { portals?: PortalSummary[]; hasMore?: boolean; page?: number; message?: string };
      // A fast search can finish before the initial load.  Do not let the
      // older response overwrite the user's latest result.
      if (serial !== requestSerial.current) return;
      if (!response.ok) { setMessage(body.message ?? '避難所一覧を読み込めませんでした。'); return; }
      setPortals(body.portals ?? []);
      setMessage('');
      setLoaded(true);
    } catch {
      if (serial !== requestSerial.current) return;
      setMessage('避難所一覧の取得に失敗しました。');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    async function loadInitial() { await loadPortals(''); }
    void loadInitial();
  }, [loadPortals]);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim().slice(0, 80);
    setActiveQuery(next);
    await loadPortals(next, 1);
  }

  function openDelete(target: PortalSummary) {
    setDeleteTarget(target);
    setConfirmName('');
    setMessage('');
  }

  function closeDelete() {
    if (busy) return;
    setDeleteTarget(null);
    setConfirmName('');
  }

  async function deleteSelected() {
    if (!deleteTarget || confirmName !== deleteTarget.name) return;
    setBusy(true);
    setMessage('避難所と関連データを削除しています…');
    try {
      const response = await fetch(`/api/owner/portals/${encodeURIComponent(deleteTarget.slug)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName }),
      });
      const body = await response.json() as { message?: string };
      if (!response.ok) { setMessage(body.message ?? '避難所を削除できませんでした。'); return; }
      setPortals((current) => current.filter((portal) => portal.id !== deleteTarget.id));
      setDeleteTarget(null);
      setConfirmName('');
      setMessage('避難所を削除しました。関連データも削除済みです。');
    } catch {
      setMessage('避難所の削除に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  const resultLabel = useMemo(() => activeQuery ? `「${activeQuery}」の検索結果` : '新しい順', [activeQuery]);

  return <main className="owner-page"><header className="site-header"><Link className="brand" href="/">◌ 避難所の相談窓口</Link><div className="header-actions"><Link href="/">公開ページへ</Link><Link href="/admin">管理画面</Link>{signOutHref && <Link href={signOutHref}>ログアウト</Link>}</div></header><section className="owner-content"><p className="eyebrow">運営管理</p><h1>登録済みの避難所</h1><p className="owner-note">運営者だけが確認できる一覧です。一般利用者や各避難所の管理者には公開されません。</p><form className="owner-toolbar" onSubmit={submitSearch}><label htmlFor="owner-search">避難所名を検索</label><div className="owner-search-row"><input id="owner-search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} placeholder="避難所名" /><button className="button secondary" type="submit" disabled={busy}>検索</button>{activeQuery && <button className="text-button" type="button" onClick={() => { setQuery(''); setActiveQuery(''); void loadPortals(''); }} disabled={busy}>すべて表示</button>}</div></form><div className="owner-summary"><strong>表示中の避難所 {portals.length}件</strong><span>{resultLabel}</span></div>{message && <p className="form-status" role="status">{message}</p>}{loaded && <div className="owner-list">{portals.map((portal) => <article className="owner-row" key={portal.id}><div><h2>{portal.name}</h2><p className="owner-created">作成：{dateFormatter.format(new Date(portal.createdAt))}</p><code>/{portal.slug}</code></div><div className="owner-actions"><Link className="button secondary" href={`/${portal.slug}`} target="_blank" rel="noreferrer">公開ページを見る</Link><button className="button danger" type="button" onClick={() => openDelete(portal)}>削除</button></div></article>)}{!portals.length && <p className="owner-empty">該当する避難所はありません。</p>}</div>}{deleteTarget && <div className="delete-confirm owner-delete-confirm" role="dialog" aria-modal="true" aria-labelledby="owner-delete-title"><h2 id="owner-delete-title">「{deleteTarget.name}」を削除しますか？</h2><p>この操作は取り消せません。公開FAQ・相談・回答・FAQ候補・確認用データなど、この避難所に紐づくデータも削除されます。</p><label htmlFor="owner-confirm-name">確認のため避難所名を入力してください<input id="owner-confirm-name" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoComplete="off" placeholder={deleteTarget.name} /></label><div className="form-actions"><button className="button danger" type="button" disabled={busy || confirmName !== deleteTarget.name} onClick={() => void deleteSelected()}>完全に削除する</button><button className="button secondary" type="button" disabled={busy} onClick={closeDelete}>キャンセル</button></div></div>}</section></main>;
}
