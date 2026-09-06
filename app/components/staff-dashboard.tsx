'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue, ShelterDashboardStats } from '../../db/repository';
import { FaqManagement } from './faq-management';
import { AuditLogList } from './audit-log-list';

type Props = { displayName: string; authorized?: boolean; adminApiToken?: string; signOutHref?: string };
type Draft = { draft: string; alternatives: string[]; grounds: string[]; mode: string };
type MergeAction = 'accept' | 'reject';
type MobilePanel = 'list' | 'summary' | 'response';

const statusLabel: Record<string, string> = { new: '未確認', reviewing: '確認中', assigned: '担当決定', field_checking: '現場確認中', in_progress: '対応中', waiting: '追加情報を確認中', resolved: '解決済み', cannot_resolve: '対応困難' };
const statusIcon: Record<string, string> = { new: '○', reviewing: '◔', assigned: '◉', field_checking: '⌖', in_progress: '▶', waiting: '…', resolved: '✓', cannot_resolve: '—' };
const urgencyLabel: Record<string, string> = { critical: '要緊急確認', high: '高', normal: '通常', low: '低' };
const urgencyRank: Record<string, number> = { critical: 4, high: 3, normal: 2, low: 1 };
const categoryIcon: Record<string, string> = { 水: '💧', '水・飲料': '💧', 食料: '🍚', '食料・物資': '🍚', 医療: '✚', '医療・薬': '✚', 衛生: '🚻', 'トイレ・衛生': '🚻', 設備: '🔧', '設備・充電': '🔌', ペット: '🐾', 寒さ: '🌡', 安全: '⚠', その他: '•' };
const dateLabel = (value: number | null) => value ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';
const clockLabel = (value: number | null) => value == null ? '—' : new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const relativeLabel = (value: number) => { const minutes = Math.max(0, Math.round((Date.now() - value) / 60000)); return minutes < 1 ? 'いま' : minutes < 60 ? `${minutes}分前` : `${Math.floor(minutes / 60)}時間前`; };
const adminHeaders = (token: string | undefined, headers: Record<string, string> = {}) => token ? { ...headers, 'x-kikumae-admin-token': token } : headers;
const publicStatusMessage = (status: string) => ({ new: '相談を受け付けました。避難所スタッフが内容を確認します。', reviewing: '避難所スタッフが状況を確認しています。', assigned: '担当スタッフを決めて、対応を進めます。', field_checking: '避難所スタッフが現場の状況を確認しています。', in_progress: '避難所スタッフが対応を進めています。', waiting: '対応に必要な情報を確認しています。', resolved: '対応が完了しました。', cannot_resolve: '現在の対応状況を記録しました。近くのスタッフにもご相談ください。' } as Record<string, string>)[status] ?? '相談の対応状況が更新されました。';

function iconForCategory(category: string): string {
  const key = Object.keys(categoryIcon).find((candidate) => category.includes(candidate));
  return key ? categoryIcon[key] : categoryIcon.その他;
}

export function StaffDashboard({ displayName, authorized = false, adminApiToken, signOutHref }: Props) {
  const [renderedAt, setRenderedAt] = useState<number | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<ShelterDashboardStats | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [answerText, setAnswerText] = useState('');
  const [answerUsesAi, setAnswerUsesAi] = useState(false);
  const [caseFilter, setCaseFilter] = useState('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [message, setMessage] = useState(authorized ? '課題を読み込んでいます…' : '管理権限を確認しています…');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('list');

  const loadIssues = useCallback(async ({ silent = false, pageNumber = page, searchTerm = search }: { silent?: boolean; pageNumber?: number; searchTerm?: string } = {}) => {
    setRefreshing(true);
    if (!silent) setMessage('相談対応画面を更新しています…');
    try {
      const query = new URLSearchParams({ page: String(Math.max(1, pageNumber)) });
      if (searchTerm.trim()) query.set('search', searchTerm.trim());
      const response = await fetch(`/api/admin/issues?${query.toString()}`, { cache: 'no-store', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { Accept: 'application/json' }) });
      const body = await response.json() as { issues?: Issue[]; stats?: ShelterDashboardStats; hasMore?: boolean; message?: string };
      if (!response.ok) {
        if (response.status === 401) { window.location.assign('/admin'); return; }
        if (!silent) setMessage(body.message ?? '相談一覧を読み込めませんでした。');
        return;
      }
      const nextIssues = body.issues ?? [];
      setIssues(nextIssues); setStats(body.stats ?? null); setHasMore(Boolean(body.hasMore));
      if (!silent) setMessage('相談対応画面を更新しました。');
      setSelectedId((current) => current && !nextIssues.some((issue) => issue.id === current) ? null : current);
    } catch { if (!silent) setMessage('相談一覧を読み込めませんでした。'); }
    finally { setRefreshing(false); }
  }, [adminApiToken, page, search]);

  useEffect(() => {
    async function load() {
      if (!authorized) {
        const claim = await fetch('/api/admin/claim', { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken) });
        if (!claim.ok) { const body = await claim.json() as { message?: string }; setMessage(body.message ?? 'このアカウントには管理権限がありません。'); return; }
      }
      await loadIssues();
    }
    void load();
  }, [authorized, loadIssues, adminApiToken]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'visible' || busy || refreshing) return; void loadIssues({ silent: true }); };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [busy, loadIssues, refreshing]);
  useEffect(() => {
    const timer = window.setTimeout(() => setRenderedAt(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!message || message.includes('権限') || message.includes('確認しています')) return;
    const timer = window.setTimeout(() => setMessage(''), 2400);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  const selected = useMemo(() => issues.find((issue) => issue.id === selectedId) ?? null, [issues, selectedId]);
  const counts = stats?.counts ?? { new: 0, reviewing: 0, assigned: 0, field_checking: 0, in_progress: 0, waiting: 0, resolved: 0, cannot_resolve: 0 };
  const visibleIssues = useMemo(() => {
    const filtered = issues.filter((issue) => caseFilter === 'critical' ? issue.urgency === 'critical' : caseFilter === 'mine' ? issue.assignedUser === displayName : caseFilter === 'all' ? true : issue.status === caseFilter);
    return [...filtered].sort((a, b) => (urgencyRank[b.urgency] ?? 0) - (urgencyRank[a.urgency] ?? 0) || b.lastReportedAt - a.lastReportedAt);
  }, [caseFilter, displayName, issues]);
  const criticalCount = issues.filter((issue) => issue.urgency === 'critical' && issue.status !== 'resolved').length;
  const openCount = issues.filter((issue) => !['resolved', 'cannot_resolve'].includes(issue.status)).length;

  async function preloadDraft(issue: Issue) {
    if (drafts[issue.id]) return;
    try {
      const response = await fetch(`/api/admin/issues/${issue.id}/draft`, { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { Accept: 'application/json' }) });
      if (!response.ok) return;
      const body = await response.json() as Draft;
      if (body.draft) setDrafts((current) => ({ ...current, [issue.id]: body }));
    } catch { /* 右パネルから再実行できます */ }
  }
  function selectIssue(issue: Issue) { setSelectedId(issue.id); setAnswerText(''); setAnswerUsesAi(false); setMessage(''); setMobilePanel('summary'); void preloadDraft(issue); }
  function toggleSelection(id: number) { setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function toggleAllVisible() { const ids = visibleIssues.map((issue) => issue.id); const all = ids.length > 0 && ids.every((id) => selectedIds.includes(id)); setSelectedIds((current) => all ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]); }
  function changePage(nextPage: number) { if (nextPage < 1 || (nextPage > page && !hasMore)) return; setPage(nextPage); setSelectedId(null); setSelectedIds([]); setMobilePanel('list'); }
  function submitSearch(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const nextSearch = searchInput.trim().slice(0, 80); if (search === nextSearch && page === 1) { void loadIssues({ pageNumber: 1, searchTerm: nextSearch }); return; } setSearch(nextSearch); setPage(1); setSelectedId(null); setSelectedIds([]); setMobilePanel('list'); }
  function clearSearch() { setSearchInput(''); setSearch(''); setPage(1); setSelectedId(null); setSelectedIds([]); setMobilePanel('list'); }

  async function deleteSelected() {
    if (!selectedIds.length || busy) return;
    if (!window.confirm(`${selectedIds.length}件の課題と関連する相談を削除します。確認ページからも見られなくなります。よろしいですか？`)) return;
    setBusy(true); setMessage(`${selectedIds.length}件の課題を削除しています…`);
    try {
      const response = await fetch('/api/admin/issues/bulk', { method: 'DELETE', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ ids: selectedIds }) });
      const body = await response.json() as { deleted?: number; message?: string };
      if (!response.ok) { setMessage(body.message ?? '課題を削除できませんでした。'); return; }
      if (selectedId && selectedIds.includes(selectedId)) { setSelectedId(null); setMobilePanel('list'); }
      setSelectedIds([]); setSelectionMode(false); await loadIssues(); setMessage(`${body.deleted ?? selectedIds.length}件の課題を削除しました。`);
    } catch { setMessage('課題の削除に失敗しました。'); }
    finally { setBusy(false); }
  }
  async function generateDraftFor(issue: Issue, silent = false) {
    if (!silent) { setBusy(true); setMessage('FAQを根拠に返信案を作っています…'); }
    try {
      const response = await fetch(`/api/admin/issues/${issue.id}/draft`, { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { Accept: 'application/json' }) });
      const body = await response.json() as Draft & { message?: string };
      if (!response.ok) { if (!silent) setMessage(body.message ?? '返信案を生成できませんでした。'); return; }
      setDrafts((current) => ({ ...current, [issue.id]: body }));
      if (!silent) setMessage('FAQを根拠に返信案を作成しました。職員が確認してから送信できます。');
    } catch { if (!silent) setMessage('返信案の生成に失敗しました。'); }
    finally { if (!silent) setBusy(false); }
  }
  async function generateDraft() { if (selected) await generateDraftFor(selected); }
  async function approveAnswer() {
    if (!selected || !answerText.trim()) return;
    setBusy(true); setMessage(`${selected.reportCount}件の相談へ返信しています…`);
    try {
      const response = await fetch(`/api/admin/issues/${selected.id}/answer`, { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ body: answerText, usedAi: answerUsesAi, grounds: drafts[selected.id]?.grounds ?? [] }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) { if (response.status === 401) { window.location.assign('/admin'); return; } setMessage(body.message ?? '返信を保存できませんでした。'); return; }
      await loadIssues(); setAnswerText(''); setMessage(`${selected.reportCount}件の相談へ返信し、解決済みにしました。`);
    } catch { setMessage('返信の保存に失敗しました。'); }
    finally { setBusy(false); }
  }
  async function updateIssue(status: string, messageText: string, isPublic: boolean, assignedTeam: string, assignedUser: string, urgencyConfirmed: string, internalNote: string): Promise<boolean> {
    if (!selected) return false;
    setBusy(true); setMessage('課題の対応状況を更新しています…');
    try {
      const response = await fetch(`/api/admin/issues/${selected.id}/status`, { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ status, message: messageText, isPublic, assignedTeam, assignedUser, urgencyConfirmed, internalNote, expectedVersion: selected.version }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) { if (response.status === 401) { window.location.assign('/admin'); return false; } setMessage(body.message ?? '課題を更新できませんでした。'); await loadIssues({ silent: true }); return false; }
      await loadIssues(); setMessage('課題の対応状況を更新しました。'); return true;
    } catch { setMessage('課題の更新に失敗しました。'); return false; }
    finally { setBusy(false); }
  }
  async function recordOriginalViewed() { if (!selected) return; void fetch(`/api/admin/issues/${selected.id}/events`, { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ event: 'original_opened' }) }); }
  async function reviewMerge(candidateId: number, action: MergeAction) {
    if (busy) return;
    setBusy(true); setMessage(action === 'accept' ? '統合候補を処理しています…' : '統合候補を却下しています…');
    try {
      const response = await fetch('/api/admin/issues/merge', { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ candidateId, action }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) { setMessage(body.message ?? '統合候補を処理できませんでした。'); return; }
      if (action === 'accept') { setSelectedId(null); setMobilePanel('list'); }
      await loadIssues(); setMessage(action === 'accept' ? '相談を同じ課題に統合しました。' : '統合候補を却下しました。');
    } catch { setMessage('統合候補の処理に失敗しました。'); }
    finally { setBusy(false); }
  }

  const filterOptions = [['all', 'すべて', issues.length], ['critical', '要緊急確認', criticalCount], ['new', '未確認', counts.new ?? 0], ['field_checking', '現場確認中', counts.field_checking ?? 0], ['in_progress', '対応中', (counts.in_progress ?? 0) + (counts.waiting ?? 0)], ['mine', '自分の担当', issues.filter((issue) => issue.assignedUser === displayName).length], ['resolved', '解決済み', counts.resolved ?? 0]] as const;

  return <main className="staff-page">
    <header className="site-header staff-topbar"><div className="staff-brand-block"><Link className="brand" href="/">◌ 避難所の相談窓口</Link><span className="staff-location-label">避難所スタッフ用</span></div><div className="header-stats" aria-label="課題件数"><span className="header-stat stat-new"><b>{counts.new ?? 0}</b><small>未確認</small></span><span className="header-stat stat-critical"><b>{criticalCount}</b><small>緊急</small></span><span className="header-stat stat-field"><b>{counts.field_checking ?? 0}</b><small>現場確認中</small></span><span className="header-stat stat-progress"><b>{(counts.in_progress ?? 0) + (counts.waiting ?? 0)}</b><small>対応中</small></span><span className="header-stat stat-resolved"><b>{stats?.metrics?.resolvedToday ?? 0}</b><small>本日解決</small></span></div><div className="header-actions"><span className="sync-label">最終同期 {clockLabel(renderedAt)}</span><span className="staff-user">{displayName || '職員'}さん</span><button className="staff-menu-toggle" type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="staff-navigation">☰ メニュー</button>{signOutHref && <Link href={signOutHref}>ログアウト</Link>}</div></header>
    <div className="staff-shell">{menuOpen && <button className="staff-menu-backdrop" type="button" onClick={() => setMenuOpen(false)} aria-label="職員メニューを閉じる" />}<aside className={`staff-sidebar ${menuOpen ? 'is-open' : ''}`} id="staff-navigation" aria-label="職員メニュー"><div className="sidebar-mobile-heading"><strong>職員メニュー</strong><button className="text-button" type="button" onClick={() => setMenuOpen(false)}>閉じる</button></div><div className="sidebar-kicker">避難所スタッフ</div><a className="sidebar-link active" href="#workspace" onClick={() => { setMenuOpen(false); setMobilePanel('list'); }}>▤ <span>相談対応</span></a><a className="sidebar-link" href="#map-panel" onClick={() => setMenuOpen(false)}>⌖ <span>マップ</span></a><a className="sidebar-link" href="#faq-management" onClick={() => setMenuOpen(false)}>▧ <span>FAQ・案内</span></a><a className="sidebar-link" href="#metrics" onClick={() => setMenuOpen(false)}>◔ <span>統計</span></a><a className="sidebar-link" href="#settings" onClick={() => setMenuOpen(false)}>⚙ <span>設定</span></a><div className="sidebar-note">AIは声を課題に整理します。重大な判断と返信は、必ず職員が確認します。</div></aside>
      <section className="staff-content shelter-staff-content" id="workspace"><div className="workspace-toolbar"><div><p className="eyebrow">相談対応</p><h1>いま対応する課題</h1><p className="staff-note">課題を見る、判断する、住民へ伝えるを一画面で。</p></div><button className="button secondary refresh-button" type="button" onClick={() => void loadIssues()} disabled={busy || refreshing}>↻ {refreshing ? '更新中…' : '更新'}</button></div>{message && <p className="form-status" role="status">{message}</p>}{criticalCount > 0 && <div className="urgent-strip"><span>⚠</span><strong>要緊急確認 {criticalCount}件</strong><small>命・安全に関わる可能性があります。AIの候補を職員が確認してください。</small></div>}
        <div className={`command-center mobile-panel-${mobilePanel}`}>
          <section className="command-pane issues-pane" aria-labelledby="issues-title"><div className="pane-heading"><div><p className="eyebrow">一覧を見る</p><h2 id="issues-title">相談・課題一覧 <small>({openCount}件)</small></h2></div><span className="pane-count">{visibleIssues.length}</span></div><form className="command-search" onSubmit={submitSearch}><label className="sr-only" htmlFor="issue-search-input">相談・課題を検索</label><input id="issue-search-input" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="⌕ 水・トイレ・場所で検索" /><button type="submit" disabled={refreshing}>検索</button>{search && <button className="clear-search" type="button" onClick={clearSearch}>解除</button>}</form><div className="command-filters" aria-label="課題を絞り込む">{filterOptions.map(([value, label, count]) => <button className={caseFilter === value ? 'selected' : ''} type="button" key={value} onClick={() => setCaseFilter(value)}>{label} <b>{count}</b></button>)}</div><div className="bulk-toolbar command-bulk"><button className="button secondary" type="button" onClick={() => setSelectionMode((current) => !current)}>{selectionMode ? '選択を終了' : '複数選択'}</button>{selectionMode && <><label className="bulk-select-all"><input type="checkbox" checked={visibleIssues.length > 0 && visibleIssues.every((issue) => selectedIds.includes(issue.id))} onChange={toggleAllVisible} /> 表示中を全選択</label><span>{selectedIds.length}件選択中</span><button className="button danger" type="button" disabled={!selectedIds.length || busy} onClick={() => void deleteSelected()}>選択した課題を削除</button></>}</div><div className="issue-feed">{visibleIssues.map((issue) => <article className={`command-issue-card ${selectedId === issue.id ? 'selected' : ''} ${selectionMode && selectedIds.includes(issue.id) ? 'bulk-selected' : ''}`} key={issue.id}><label className={`command-checkbox ${selectionMode ? '' : 'visually-hidden'}`}><input type="checkbox" checked={selectedIds.includes(issue.id)} disabled={!selectionMode} onChange={() => toggleSelection(issue.id)} onClick={(event) => event.stopPropagation()} aria-label={`${issue.title}を選択`} /></label><button className="command-issue-main" type="button" onClick={() => selectionMode ? toggleSelection(issue.id) : selectIssue(issue)}><span className="issue-category-icon" aria-hidden="true">{iconForCategory(issue.category)}</span><span className="issue-card-copy"><span className="issue-card-top"><span className={`status-pill status-${issue.status}`}><i aria-hidden="true">{statusIcon[issue.status] ?? '•'}</i>{statusLabel[issue.status] ?? issue.status}</span><span className={`urgency-chip urgency-chip-${issue.urgency}`}>{urgencyLabel[issue.urgency] ?? issue.urgency}</span><time>{relativeLabel(issue.lastReportedAt)}</time></span><strong>{issue.title}</strong><small>{issue.location || '場所を確認中'} · 報告 {issue.reportCount}件{issue.affectedPeople ? ` · 影響 ${issue.affectedPeople}` : ''}</small><span className="issue-card-meta">{issue.assignedTeam || issue.assignedUser ? `担当：${issue.assignedTeam || issue.assignedUser}` : '担当未設定'}{issue.groupingMode === 'suggested' ? ' · 統合候補あり' : ''}</span></span><b className="issue-chevron" aria-hidden="true">›</b></button></article>)}{!visibleIssues.length && <div className="detail-empty">この条件の課題はありません。</div>}</div>{(page > 1 || hasMore) && <div className="pagination-controls"><button className="button secondary" type="button" disabled={page <= 1 || busy} onClick={() => changePage(page - 1)}>前の100件</button><span>ページ {page}</span><button className="button secondary" type="button" disabled={!hasMore || busy} onClick={() => changePage(page + 1)}>次の100件</button></div>}</section>
          <section className="command-pane summary-pane" aria-labelledby="summary-title">{selected ? <IssueSummary key={selected.id} issue={selected} mapIssues={issues} onOriginalViewed={() => void recordOriginalViewed()} onMerge={reviewMerge} onSelectIssue={selectIssue} onBack={() => setMobilePanel('list')} onNext={() => setMobilePanel('response')} busy={busy} /> : <div className="pane-empty"><span aria-hidden="true">▤</span><h2 id="summary-title">課題を選んでください</h2><p>左の一覧から課題を選ぶと、AIが整理した事実と必要な情報がここに表示されます。</p></div>}</section>
          <section className="command-pane response-pane" aria-labelledby="response-title">{selected ? <IssueResponsePanel key={selected.id} issue={selected} draft={drafts[selected.id]} answerText={answerText} setAnswerText={setAnswerText} answerUsesAi={answerUsesAi} setAnswerUsesAi={setAnswerUsesAi} displayName={displayName} busy={busy} onGenerateDraft={() => void generateDraft()} onApprove={() => void approveAnswer()} onStatus={updateIssue} onBack={() => setMobilePanel('summary')} /> : <div className="pane-empty"><span aria-hidden="true">✓</span><h2>対応パネル</h2><p>課題を選ぶと、住民に見える状態と次の操作が表示されます。</p></div>}</section>
        </div>
        <section className="command-secondary-panel" id="metrics"><div className="secondary-panel-heading"><div><p className="eyebrow">統計</p><h2>必要な支援の全体像</h2></div><span>Report数で集計</span></div><div className="compact-metrics"><span><b>{stats?.metrics?.reports ?? 0}</b>相談</span><span><b>{stats?.metrics?.issues ?? 0}</b>課題</span><span><b>{stats?.metrics?.autoGrouped ?? 0}</b>自動関連付け</span><span><b>{stats?.metrics?.originalNotOpened ?? 0}</b>原文を開かず対応</span></div><div className="category-bars">{(stats?.categoryCounts ?? []).slice(0, 8).map((item) => <div className="category-bar" key={item.category}><span>{item.category}</span><div><i style={{ width: `${Math.min(100, Math.max(5, item.count * 6))}%` }} /></div><b>{item.count}</b></div>)}{!stats?.categoryCounts.length && <p className="muted-block">相談が届くと、カテゴリー別に表示されます。</p>}</div></section><div id="faq-management"><FaqManagement apiBase="/api/admin/faqs" title="FAQ・避難所の最新案内" /></div><div id="settings"><section className="settings-card"><p className="eyebrow">設定</p><h2>安全な対応のために</h2><div className="settings-grid"><div><strong>原文の扱い</strong><p>原文は必要なときだけ確認します。開いた操作は匿名の指標として記録されます。</p></div><div><strong>AIの役割</strong><p>要約・事実・緊急度候補・返信案まで。重大な判断と送信は職員が行います。</p></div><div><strong>住民表示</strong><p>公開進捗は関連する相談へ反映され、住民の確認ページが自動更新されます。</p></div></div></section></div><AuditLogList apiBase="/api/admin/audit-logs" />
      </section>
    </div>
  </main>;
}

function IssueSummary({ issue, mapIssues, onOriginalViewed, onMerge, onSelectIssue, onBack, onNext, busy }: { issue: Issue; mapIssues: Issue[]; onOriginalViewed: () => void; onMerge: (candidateId: number, action: MergeAction) => Promise<void>; onSelectIssue: (issue: Issue) => void; onBack: () => void; onNext: () => void; busy: boolean }) {
  const activeStage = issue.status === 'waiting' ? 'in_progress' : issue.status === 'assigned' ? 'reviewing' : issue.status;
  const stageIndex = ['new', 'reviewing', 'field_checking', 'in_progress', 'resolved'].indexOf(activeStage);
  const stages = [['new', '未確認'], ['reviewing', '確認中'], ['field_checking', '現場確認中'], ['in_progress', '対応中'], ['resolved', '解決済み']] as const;
  const [tab, setTab] = useState<'summary' | 'original' | 'reports'>('summary');
  return <div className="summary-card"><button className="mobile-back-button" type="button" onClick={onBack}>← 相談一覧へ</button><div className="summary-topline"><div><p className="eyebrow">判断する</p><div className="summary-badges"><span className={`status-pill status-${issue.status}`}><i aria-hidden="true">{statusIcon[issue.status] ?? '•'}</i>{statusLabel[issue.status] ?? issue.status}</span><span className={`urgency-chip urgency-chip-${issue.urgency}`}>{urgencyLabel[issue.urgency] ?? issue.urgency}</span><span className="tag">{issue.category}</span></div><h2 id="summary-title">{issue.title}</h2><p className="summary-updated">最終更新 {dateLabel(issue.updatedAt || issue.lastReportedAt)}</p></div><span className="summary-main-icon" aria-hidden="true">{iconForCategory(issue.category)}</span></div><div className="status-track" aria-label="課題の進み具合">{stages.map(([key, label], index) => <div className={`${index <= stageIndex ? 'done' : ''} ${key === activeStage ? 'current' : ''}`} key={key}><span>{index <= stageIndex ? '●' : '○'}</span><small>{label}</small></div>)}</div><div className="detail-tabs" role="tablist"><button role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'active' : ''} type="button" onClick={() => setTab('summary')}>AI整理</button><button role="tab" aria-selected={tab === 'original'} className={tab === 'original' ? 'active' : ''} type="button" onClick={() => { setTab('original'); onOriginalViewed(); }}>原文を見る</button><button role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'active' : ''} type="button" onClick={() => setTab('reports')}>関連相談 {issue.reportCount}件</button></div>{tab === 'summary' && <div className="summary-scroll"><section className="ai-summary-callout"><span className="analysis-label">AIによる整理（候補）</span><p>{issue.summary || 'AI要約はありません。確認できた事実を見ながら対応してください。'}</p><small>AIの推定は確定情報ではありません。判断は職員が行います。</small></section><div className="fact-cards"><FactCard label="相談件数" value={`${issue.reportCount}件`} icon="▤" /><FactCard label="推定影響人数" value={issue.affectedPeople || '不明'} icon="♟" /><FactCard label="問題が起きている場所" value={issue.location || '確認中'} icon="⌖" /><FactCard label="発生傾向" value={relativeLabel(issue.lastReportedAt)} icon="◷" /></div><div className="summary-columns"><section><span className="analysis-label">住民から確認できた事実</span>{issue.facts.length ? <ul className="fact-list">{issue.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : <p className="muted-block">確認できた事実はまだありません。</p>}</section><section className="emotion-summary"><span className="analysis-label">感情の存在（業務判断の補助）</span><strong>{issue.emotions.length ? issue.emotions.join('・') : '不安や困りごと'}</strong><p>感情を削除せず認識し、職員はまず事実と要望から対応できます。</p></section></div><section className="missing-summary"><span className="analysis-label">確認が必要な情報</span>{issue.missingInformation.length ? <div>{issue.missingInformation.map((item) => <span key={item}>{item}</span>)}</div> : <p className="muted-block">必要な情報はそろっています。</p>}</section><section className="map-panel" id="map-panel"><div className="section-card-heading"><div><span className="analysis-label">発生場所</span><h3>避難所マップ</h3></div><small>問題が起きている場所</small></div><MiniShelterMap issues={mapIssues} selectedLocation={issue.location} onSelect={onSelectIssue} /></section>{issue.candidateId && issue.candidateIssueId && <section className="merge-candidate"><span className="analysis-label">統合候補</span><strong>{issue.candidateIssueTitle || `課題 #${issue.candidateIssueId}`}</strong><p>{issue.candidateReason || 'カテゴリ・場所・要望が近い課題です。'} 類似度 {Math.round((issue.candidateConfidence ?? 0) * 100)}%。</p><div className="merge-actions"><button className="button accent" type="button" disabled={busy} onClick={() => void onMerge(issue.candidateId!, 'accept')}>同じ課題に統合</button><button className="button secondary" type="button" disabled={busy} onClick={() => void onMerge(issue.candidateId!, 'reject')}>別の課題にする</button></div></section>}<button className="mobile-next-button" type="button" onClick={onNext}>対応パネルへ →</button></div>}{tab === 'original' && <div className="original-panel summary-scroll"><div className="original-warning"><strong>原文を確認する</strong><span>強い表現・感情的な文章を含む可能性があります</span></div>{issue.reports.map((report) => <details className="report-original" key={report.id}><summary><span>{dateLabel(report.createdAt)}</span><strong>{report.title}</strong></summary><p>{report.originalBody || report.displayBody}</p></details>)}<p className="input-hint">AI整理だけで通常業務ができるようにしています。開いた操作は記録されます。</p></div>}{tab === 'reports' && <div className="related-panel summary-scroll"><div className="related-group-heading"><span className="analysis-label">関連する相談</span><strong>同じ課題に {issue.reportCount}件 寄せられています</strong><p>個別の相談は削除せず、課題単位で進捗を共有できます。</p></div><div className="related-list">{issue.reports.map((report) => <div key={report.id}><span className="status-pill">{statusLabel[report.workflowStatus] ?? report.workflowStatus}</span><strong>{report.title}</strong><small>{report.location || '場所未確認'} · {dateLabel(report.createdAt)}</small></div>)}</div><button className="mobile-next-button" type="button" onClick={onNext}>対応パネルへ →</button></div>}</div>;
}

function FactCard({ label, value, icon }: { label: string; value: string; icon: string }) { return <div className="fact-card"><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{value}</strong></div>; }

function MiniShelterMap({ issues, selectedLocation, onSelect }: { issues: Issue[]; selectedLocation: string; onSelect: (issue: Issue) => void }) {
  const points = [...new Map(issues.filter((issue) => issue.location).map((issue) => [issue.location, issue])).values()].slice(0, 6);
  return <div className="mini-map"><div className="mini-map-canvas">{(points.length ? points : [{ id: 0, location: selectedLocation || '場所を確認中', category: 'その他', reportCount: 1 } as Issue]).map((point, index) => <button className={`map-point map-point-${index % 4} ${point.location === selectedLocation ? 'selected' : ''}`} type="button" key={`${point.id}-${point.location}`} onClick={() => onSelect(point)}><span>{iconForCategory(point.category)}</span><b>{point.location}</b><small>{point.reportCount}件</small></button>)}</div><p>※相談者のいる場所ではなく、問題が起きている場所を表示しています。</p></div>;
}

function IssueResponsePanel({ issue, draft, answerText, setAnswerText, answerUsesAi, setAnswerUsesAi, displayName, busy, onGenerateDraft, onApprove, onStatus, onBack }: { issue: Issue; draft?: Draft; answerText: string; setAnswerText: (value: string) => void; answerUsesAi: boolean; setAnswerUsesAi: (value: boolean) => void; displayName: string; busy: boolean; onGenerateDraft: () => void; onApprove: () => void; onStatus: (status: string, message: string, isPublic: boolean, assignedTeam: string, assignedUser: string, urgencyConfirmed: string, internalNote: string) => Promise<boolean>; onBack: () => void }) {
  const [previewClock, setPreviewClock] = useState<number | null>(null);
  const [actionStatus, setActionStatus] = useState(issue.status === 'new' ? 'reviewing' : issue.status);
  const [isPublic, setIsPublic] = useState(true);
  const [team, setTeam] = useState(issue.assignedTeam);
  const [assignee, setAssignee] = useState(issue.assignedUser);
  const [urgency, setUrgency] = useState(issue.urgencyConfirmed ?? '');
  const [internalNote, setInternalNote] = useState(issue.internalNote);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setPreviewClock(Date.now()), 0); return () => window.clearTimeout(timer); }, []);
  async function saveStatus(status = actionStatus) { setActionStatus(status); await onStatus(status, answerText, isPublic, team, assignee, urgency, internalNote); }
  const previewMessage = isPublic ? (answerText.trim() || issue.responseMessage || publicStatusMessage(actionStatus)) : 'この更新は職員用です。住民には表示されません。';
  const isResolved = issue.status === 'resolved' || issue.status === 'cannot_resolve';
  return <div className="response-card"><button className="mobile-back-button" type="button" onClick={onBack}>← 課題の内容へ</button><div className="response-heading"><div><p className="eyebrow">操作する</p><h2 id="response-title">対応パネル</h2><p>{issue.reportCount}件の相談へ同じ進捗を共有</p></div><span className={`response-status-icon status-icon-${actionStatus}`} aria-hidden="true">{statusIcon[actionStatus] ?? '•'}</span></div><section className="resident-preview" aria-live="polite"><div className="resident-preview-heading"><strong>現在、住民に見えている状態</strong><span>プレビュー</span></div><div className="resident-preview-status"><span>{statusIcon[actionStatus] ?? '•'}</span><strong>{statusLabel[actionStatus] ?? actionStatus}</strong></div><p>{previewMessage}</p><small>最終更新 {clockLabel(previewClock)}</small></section><div className="response-actions" aria-label="対応候補"><button type="button" disabled={busy || isResolved} onClick={onGenerateDraft}>▣ FAQで回答</button><button type="button" disabled={busy || isResolved} onClick={() => void saveStatus('field_checking')}>⌖ 現場確認</button><button type="button" disabled={busy || isResolved} onClick={() => void saveStatus('in_progress')}>▶ 対応開始</button><button type="button" disabled={busy || isResolved} onClick={() => void saveStatus('waiting')}>▤ 追加質問</button><button className="resolve-action" type="button" disabled={busy || isResolved} onClick={() => void saveStatus('resolved')}>✓ 解決済みにする</button><button type="button" disabled={busy} onClick={() => setAdvancedOpen((current) => !current)}>••• その他</button></div>{actionStatus === 'field_checking' && <section className="field-check-card"><strong>⌖ 現場確認中</strong><p>担当：{assignee || team || '未設定'}　場所：{issue.location || '確認中'}</p><small>この更新時刻 {clockLabel(previewClock)} を確認開始として記録します。</small></section>}<section className="reply-section"><div className="reply-heading"><div><span className="analysis-label">住民へ伝える内容</span><h3>短いメモで大丈夫です</h3></div><button className="text-button" type="button" disabled={busy} onClick={onGenerateDraft}>AIで整える</button></div>{draft ? <div className="reply-suggestion"><div><strong>AI返信案（FAQを根拠に作成）</strong><span>職員の確認が必要</span></div><p>{draft.draft}</p>{draft.grounds.length > 0 && <small>根拠：{draft.grounds.slice(0, 2).join('、')}</small>}<button className="button secondary" type="button" onClick={() => { setAnswerText(draft.draft); setAnswerUsesAi(true); }}>この案を編集欄へ</button>{draft.alternatives?.length ? <details><summary>別の案を見る</summary><div className="alternative-list">{draft.alternatives.slice(0, 3).map((option, index) => <button type="button" key={`${issue.id}-${index}`} onClick={() => { setAnswerText(option); setAnswerUsesAi(true); }}>案{index + 1}：{option}</button>)}</div></details> : null}</div> : <button className="draft-empty-button" type="button" disabled={busy || isResolved} onClick={onGenerateDraft}>FAQを確認してAI返信案を作る</button>}<label className="response-message-label">住民への公開文<textarea value={answerText} onChange={(event) => setAnswerText(event.target.value)} maxLength={4000} placeholder="例：飲料水の補充を進めています。準備が整い次第お知らせします。" /></label><label className="public-check"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /> 関連する {issue.reportCount}件の相談者に表示する</label><label className="public-check"><input type="checkbox" checked={answerUsesAi} onChange={(event) => setAnswerUsesAi(event.target.checked)} /> AI返信案を参考にした</label></section><section className="final-update"><label>送信後の状態<select value={actionStatus} onChange={(event) => setActionStatus(event.target.value)}><option value="reviewing">確認中</option><option value="field_checking">現場確認中</option><option value="in_progress">対応中</option><option value="waiting">追加情報を確認中</option><option value="resolved">解決済み</option></select></label><button className="button accent final-update-button" type="button" disabled={busy || isResolved} onClick={() => void saveStatus()}>この内容で送信＋状態を更新</button>{answerText.trim() && !isResolved && <button className="button secondary reply-resolve-button" type="button" disabled={busy} onClick={onApprove}>確認して返信・解決する</button>}</section>{advancedOpen && <section className="advanced-response"><label>担当班<input value={team} onChange={(event) => setTeam(event.target.value)} placeholder="例：物資班" /></label><label>担当職員<input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="自分が担当する場合は下のボタン" /></label><button className="button secondary" type="button" disabled={busy} onClick={() => { setAssignee(displayName); if (!team) setTeam('避難所スタッフ'); }}>自分が担当する</button><label>職員だけの内部メモ<textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="引き継ぎに必要なことだけ" maxLength={2000} /></label><label>職員が確定する緊急度<select value={urgency} onChange={(event) => setUrgency(event.target.value)}><option value="">未確定</option><option value="critical">要緊急確認</option><option value="high">高</option><option value="normal">通常</option><option value="low">低</option></select></label></section>}{issue.responseMessage && <section className="last-response"><span className="analysis-label">前回の住民向け更新</span><p>{issue.responseMessage}</p></section>}</div>;
}
