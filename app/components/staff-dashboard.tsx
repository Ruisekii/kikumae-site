'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue, ShelterDashboardStats } from '../../db/repository';
import { FaqManagement } from './faq-management';
import { AuditLogList } from './audit-log-list';

type Props = { displayName: string; authorized?: boolean; adminApiToken?: string; signOutHref?: string };
type Draft = { draft: string; alternatives: string[]; grounds: string[]; mode: string };
type MergeAction = 'accept' | 'reject';

const statusLabel: Record<string, string> = { new: '未確認', reviewing: '確認中', assigned: '担当決定', in_progress: '対応中', waiting: '追加情報を確認中', resolved: '解決済み', cannot_resolve: '対応困難' };
const urgencyLabel: Record<string, string> = { critical: '要緊急確認', high: '高', normal: '通常', low: '低' };
const dateLabel = (value: number | null) => value ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';
const relativeLabel = (value: number) => { const minutes = Math.max(0, Math.round((Date.now() - value) / 60000)); return minutes < 1 ? 'いま' : minutes < 60 ? `${minutes}分前` : `${Math.floor(minutes / 60)}時間前`; };
const durationLabel = (seconds: number | null | undefined) => { if (seconds == null) return '—'; if (seconds < 60) return `${seconds}秒`; const minutes = Math.round(seconds / 60); return minutes < 60 ? `${minutes}分` : `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ''}`; };
const adminHeaders = (token: string | undefined, headers: Record<string, string> = {}) => token ? { ...headers, 'x-kikumae-admin-token': token } : headers;

export function StaffDashboard({ displayName, authorized = false, adminApiToken, signOutHref }: Props) {
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

  const loadIssues = useCallback(async ({ silent = false, pageNumber = page, searchTerm = search }: { silent?: boolean; pageNumber?: number; searchTerm?: string } = {}) => {
    setRefreshing(true);
    if (!silent) setMessage('指令盤を更新しています…');
    try {
      const query = new URLSearchParams({ page: String(Math.max(1, pageNumber)) });
      if (searchTerm.trim()) query.set('search', searchTerm.trim());
      const response = await fetch(`/api/admin/issues?${query.toString()}`, { cache: 'no-store', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { Accept: 'application/json' }) });
      const body = await response.json() as { issues?: Issue[]; stats?: ShelterDashboardStats; hasMore?: boolean; message?: string };
      if (!response.ok) {
        if (response.status === 401) { window.location.assign('/admin'); return; }
        if (!silent) setMessage(body.message ?? '課題を読み込めませんでした。');
        return;
      }
      const nextIssues = body.issues ?? [];
      setIssues(nextIssues);
      setStats(body.stats ?? null);
      setHasMore(Boolean(body.hasMore));
      if (!silent) setMessage('指令盤を更新しました。');
      setSelectedId((current) => current && !nextIssues.some((issue) => issue.id === current) ? null : current);
    } catch {
      if (!silent) setMessage('課題を読み込めませんでした。');
    } finally {
      setRefreshing(false);
    }
  }, [adminApiToken, page, search]);

  /* The selected issue is a server-backed form; reset it when the selected record changes. */
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
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
  const visibleIssues = useMemo(() => caseFilter === 'all' ? issues : issues.filter((issue) => issue.status === caseFilter), [caseFilter, issues]);
  const counts = stats?.counts ?? { new: 0, reviewing: 0, assigned: 0, in_progress: 0, waiting: 0, resolved: 0, cannot_resolve: 0 };

  function selectIssue(issue: Issue) {
    setSelectedId(issue.id);
    setAnswerText(issue.responseMessage || '');
    setAnswerUsesAi(false);
    setDrafts((current) => { const next = { ...current }; delete next[issue.id]; return next; });
    setMessage('');
  }

  function toggleSelection(id: number) { setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function toggleAllVisible() {
    const ids = visibleIssues.map((issue) => issue.id);
    const all = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => all ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]);
  }

  function changePage(nextPage: number) {
    if (nextPage < 1 || (nextPage > page && !hasMore)) return;
    setPage(nextPage);
    setSelectedId(null);
    setSelectedIds([]);
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = searchInput.trim().slice(0, 80);
    if (search === nextSearch && page === 1) {
      void loadIssues({ pageNumber: 1, searchTerm: nextSearch });
      return;
    }
    setSearch(nextSearch);
    setPage(1);
    setSelectedId(null);
    setSelectedIds([]);
  }

  function clearSearch() {
    if (!search && page === 1) {
      void loadIssues({ pageNumber: 1, searchTerm: '' });
      return;
    }
    setSearchInput('');
    setSearch('');
    setPage(1);
    setSelectedId(null);
    setSelectedIds([]);
  }

  async function deleteSelected() {
    if (!selectedIds.length || busy) return;
    if (!window.confirm(`${selectedIds.length}件の課題と関連する相談を削除します。確認ページからも見られなくなります。よろしいですか？`)) return;
    setBusy(true);
    setMessage(`${selectedIds.length}件の課題を削除しています…`);
    try {
      const response = await fetch('/api/admin/issues/bulk', { method: 'DELETE', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ ids: selectedIds }) });
      const body = await response.json() as { deleted?: number; message?: string };
      if (!response.ok) { setMessage(body.message ?? '課題を削除できませんでした。'); return; }
      if (selectedId && selectedIds.includes(selectedId)) setSelectedId(null);
      setSelectedIds([]);
      setSelectionMode(false);
      await loadIssues();
      setMessage(`${body.deleted ?? selectedIds.length}件の課題を削除しました。`);
    } catch {
      setMessage('課題の削除に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  async function generateDraft() {
    if (!selected) return;
    setBusy(true);
    setMessage('課題の状況に合わせた返信案を作っています…');
    try {
      const response = await fetch(`/api/admin/issues/${selected.id}/draft`, { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { Accept: 'application/json' }) });
      const body = await response.json() as Draft & { message?: string };
      if (!response.ok) { if (response.status === 401) { window.location.assign('/admin'); return; } setMessage(body.message ?? '返信案を生成できませんでした。'); return; }
      setDrafts((current) => ({ ...current, [selected.id]: body }));
      setAnswerText(body.draft);
      setAnswerUsesAi(true);
      setMessage('課題の内容に合わせた返信案を作成しました。');
    } catch {
      setMessage('返信案の生成に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  async function approveAnswer() {
    if (!selected || !answerText.trim()) return;
    setBusy(true);
    setMessage(`${selected.reportCount}件の相談へ返信しています…`);
    try {
      const response = await fetch(`/api/admin/issues/${selected.id}/answer`, { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ body: answerText, usedAi: answerUsesAi, grounds: drafts[selected.id]?.grounds ?? [] }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) { if (response.status === 401) { window.location.assign('/admin'); return; } setMessage(body.message ?? '一括返信を保存できませんでした。'); return; }
      await loadIssues();
      setMessage(`${selected.reportCount}件の相談へ返信し、解決済みにしました。`);
    } catch {
      setMessage('一括返信の保存に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  async function updateIssue(status: string, messageText: string, isPublic: boolean, assignedTeam: string, assignedUser: string, urgencyConfirmed: string, internalNote: string): Promise<boolean> {
    if (!selected) return false;
    setBusy(true);
    setMessage('課題の対応状況を更新しています…');
    try {
      const response = await fetch(`/api/admin/issues/${selected.id}/status`, { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ status, message: messageText, isPublic, assignedTeam, assignedUser, urgencyConfirmed, internalNote, expectedVersion: selected.version }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) { if (response.status === 401) { window.location.assign('/admin'); return false; } setMessage(body.message ?? '課題を更新できませんでした。'); await loadIssues({ silent: true }); return false; }
      await loadIssues();
      setMessage('課題の対応状況を更新しました。');
      return true;
    } catch {
      setMessage('課題の更新に失敗しました。');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function recordOriginalViewed() {
    if (!selected) return;
    void fetch(`/api/admin/issues/${selected.id}/events`, { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ event: 'original_opened' }) });
  }

  async function reviewMerge(candidateId: number, action: MergeAction) {
    if (busy) return;
    setBusy(true);
    setMessage(action === 'accept' ? '統合候補を処理しています…' : '統合候補を却下しています…');
    try {
      const response = await fetch('/api/admin/issues/merge', { method: 'POST', credentials: 'same-origin', headers: adminHeaders(adminApiToken, { 'Content-Type': 'application/json', Accept: 'application/json' }), body: JSON.stringify({ candidateId, action }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) { setMessage(body.message ?? '統合候補を処理できませんでした。'); return; }
      if (action === 'accept') setSelectedId(null);
      await loadIssues();
      setMessage(action === 'accept' ? '相談を同じ課題に統合しました。' : '統合候補を却下しました。');
    } catch {
      setMessage('統合候補の処理に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  return <main className="staff-page">
    <header className="site-header staff-topbar"><Link className="brand" href="/">◌ 避難所の相談窓口</Link><div className="header-actions"><span className="staff-user">{displayName || '職員'}さん</span><button className="staff-menu-toggle" type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="staff-navigation">☰ メニュー</button><Link href="/">避難者画面</Link>{signOutHref && <Link href={signOutHref}>ログアウト</Link>}</div></header>
    <div className="staff-shell">
      {menuOpen && <button className="staff-menu-backdrop" type="button" onClick={() => setMenuOpen(false)} aria-label="職員メニューを閉じる" />}
      <aside className={`staff-sidebar ${menuOpen ? 'is-open' : ''}`} id="staff-navigation" aria-label="職員メニュー"><div className="sidebar-mobile-heading"><strong>職員メニュー</strong><button className="text-button" type="button" onClick={() => setMenuOpen(false)}>閉じる</button></div><div className="sidebar-kicker">避難所スタッフ</div><a className="sidebar-link active" href="#overview" onClick={() => setMenuOpen(false)}>▦ 指令盤</a><a className="sidebar-link" href="#issues" onClick={() => setMenuOpen(false)}>▤ 対応すべき課題 <span>{issues.filter((issue) => !['resolved', 'cannot_resolve'].includes(issue.status)).length}</span></a><a className="sidebar-link" href="#faq-management" onClick={() => setMenuOpen(false)}>▧ FAQ・最新案内</a><a className="sidebar-link" href="#metrics" onClick={() => setMenuOpen(false)}>◔ 統計・分析</a><a className="sidebar-link" href="#settings" onClick={() => setMenuOpen(false)}>⚙ 設定</a><div className="sidebar-note">AIは声を課題に整理します。重大な判断と返信は、必ず職員が確認します。</div></aside>
      <section className="staff-content shelter-staff-content">
        <div className="staff-heading" id="overview"><div><p className="eyebrow">避難所の状況</p><h1>いま対応する課題</h1><p className="staff-note">原文を大量に読まなくても、必要な事実と要望を課題単位で確認できます。</p></div><button className="button secondary" type="button" onClick={() => void loadIssues()} disabled={busy || refreshing}>↻ {refreshing ? '更新中…' : '更新'}</button></div>
        {message && <p className="form-status" role="status">{message}</p>}
        <div className="metric-grid"><Metric label="未確認" value={counts.new} tone="blue" /><Metric label="確認中" value={counts.reviewing + counts.assigned} tone="soft" /><Metric label="対応中" value={counts.in_progress + counts.waiting} tone="yellow" /><Metric label="本日解決" value={stats?.metrics?.resolvedToday ?? 0} tone="green" /></div>
        <div className="command-summary"><span><b>{stats?.metrics?.reports ?? 0}</b>件の相談</span><span><b>{stats?.metrics?.issues ?? 0}</b>個の課題</span><span><b>{stats?.metrics?.autoGrouped ?? 0}</b>件を自動で関連付け</span><span><b>{stats?.metrics?.originalOpened ?? 0}</b>回 原文を確認</span></div>
        <div className="kpi-detail-grid"><Kpi label="FAQだけで解決" value={stats?.metrics?.faqResolved ?? 0} suffix="件" /><Kpi label="職員が対応" value={stats?.metrics?.staffHandled ?? 0} suffix="件" /><Kpi label="原文を開かず対応" value={stats?.metrics?.originalNotOpened ?? 0} suffix="件" /><Kpi label="平均初回確認" value={durationLabel(stats?.metrics?.averageFirstConfirmationSeconds)} /><Kpi label="平均解決まで" value={durationLabel(stats?.metrics?.averageResolutionSeconds)} /></div>
        <div className="priority-grid">
          <section className="priority-card urgent-card"><div className="section-card-heading"><div><p className="eyebrow">要緊急確認</p><h2>命・安全に関わる可能性</h2></div><span className="priority-count">{stats?.urgent.length ?? 0}</span></div>{stats?.urgent.length ? <div className="priority-list">{stats.urgent.slice(0, 4).map((issue) => <button type="button" key={issue.id} onClick={() => { selectIssue(issue); window.location.hash = 'issues'; }}><span className="alert-dot">!</span><span><strong>{issue.title}</strong><small>{issue.location || '場所未確認'} · 報告 {issue.reportCount}件</small></span><b>›</b></button>)}</div> : <p className="muted-block">現在、要緊急確認の課題はありません。</p>}</section>
          <section className="priority-card surge-card"><div className="section-card-heading"><div><p className="eyebrow">最近届いた相談</p><h2>30分間の傾向</h2></div><span className="trend-mark">↗</span></div>{stats?.surge ? <><strong className="surge-value">{stats.surge.category}</strong><p>直近30分で <b>{stats.surge.count}件</b>届いています。前の時間帯との比較ではなく、受付件数の目安として確認してください。</p></> : <p className="muted-block">まだ十分な件数がありません。</p>}</section>
        </div>
        <section className="category-card" id="metrics"><div className="section-card-heading"><div><p className="eyebrow">相談カテゴリー</p><h2>必要な支援の全体像</h2></div><span className="muted-small">Report数で集計</span></div><div className="category-bars">{(stats?.categoryCounts ?? []).slice(0, 12).map((item) => <div className="category-bar" key={item.category}><span>{item.category}</span><div><i style={{ width: `${Math.min(100, Math.max(5, item.count * 6))}%` }} /></div><b>{item.count}</b></div>)}{!stats?.categoryCounts.length && <p className="muted-block">相談が届くと、カテゴリー別に表示されます。</p>}</div></section>
        <section className="cases-section" id="issues">
          <div className="section-card-heading"><div><p className="eyebrow">課題指令盤</p><h2>現在対応すべき課題</h2></div><span className="muted-small">同じ状況の相談は1つにまとめて表示</span></div>
          <div className="case-filters">{[['all', 'すべて'], ['new', '未確認'], ['reviewing', '確認中'], ['assigned', '担当決定'], ['in_progress', '対応中'], ['waiting', '追加情報'], ['resolved', '解決済み']].map(([value, label]) => <button className={caseFilter === value ? 'selected' : ''} type="button" key={value} onClick={() => setCaseFilter(value)}>{label} <b>{value === 'all' ? stats?.metrics?.issues ?? issues.length : counts[value] ?? 0}</b></button>)}</div>
          <form className="issue-search" onSubmit={submitSearch}><label htmlFor="issue-search-input">相談・課題を検索</label><div><input id="issue-search-input" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="水・体育館・医療など" /><button className="button secondary" type="submit" disabled={refreshing}>検索</button>{search && <button className="button ghost" type="button" onClick={clearSearch}>検索を解除</button>}</div>{search && <p>「{search}」で検索中。ページをまたいで課題を探しています。</p>}</form>
          <div className="bulk-toolbar"><div className="bulk-toolbar-main"><button className="button secondary" type="button" onClick={() => setSelectionMode((current) => !current)}>{selectionMode ? '選択を終了' : '複数選択'}</button>{selectionMode && <><label className="bulk-select-all"><input type="checkbox" checked={visibleIssues.length > 0 && visibleIssues.every((issue) => selectedIds.includes(issue.id))} onChange={toggleAllVisible} /> 表示中を全選択</label><span className="bulk-selection-count">{selectedIds.length}件選択中</span></>}</div>{selectionMode && <button className="button danger bulk-delete-button" type="button" disabled={!selectedIds.length || busy} onClick={() => void deleteSelected()}>選択した課題を削除</button>}</div>
          <div className="staff-layout shelter-staff-layout"><div className="question-list">{visibleIssues.map((issue) => <article className={`question-card shelter-question-card issue-card ${selectedId === issue.id ? 'selected ' : ''}${selectionMode && selectedIds.includes(issue.id) ? 'bulk-selected' : ''}`} key={issue.id}><label className="bulk-row-checkbox"><input className="bulk-row-checkbox-input" type="checkbox" checked={selectedIds.includes(issue.id)} disabled={!selectionMode} onChange={() => toggleSelection(issue.id)} onClick={(event) => event.stopPropagation()} aria-label={`${issue.title}を選択`} /></label><button className="question-card-main" type="button" onClick={() => selectionMode ? toggleSelection(issue.id) : selectIssue(issue)} aria-pressed={selectionMode ? selectedIds.includes(issue.id) : undefined}><div><span className={`status-pill status-${issue.status}`}>{statusLabel[issue.status] ?? issue.status}</span><span className={`urgency-chip urgency-chip-${issue.urgency}`}>{urgencyLabel[issue.urgency] ?? issue.urgency}</span><span className="tag">{issue.category}</span><time>{relativeLabel(issue.lastReportedAt)}</time></div><strong>{issue.title}</strong><p>{issue.location || '場所を確認中'} · 報告 {issue.reportCount}件{issue.affectedPeople ? ` · 影響 ${issue.affectedPeople}` : ''}</p><span className="question-assignee">{issue.assignedTeam || issue.assignedUser ? `担当：${issue.assignedTeam || issue.assignedUser}` : '担当未設定'}{issue.groupingMode === 'suggested' ? ' · 統合候補あり' : ''}</span></button></article>)}{!visibleIssues.length && <div className="detail-empty">この状態の課題はありません。</div>}</div><div className="staff-detail">{selected ? <IssueDetail issue={selected} draft={drafts[selected.id]} answerText={answerText} setAnswerText={setAnswerText} answerUsesAi={answerUsesAi} setAnswerUsesAi={setAnswerUsesAi} displayName={displayName} busy={busy} onGenerateDraft={() => void generateDraft()} onApprove={() => void approveAnswer()} onStatus={updateIssue} onOriginalViewed={() => void recordOriginalViewed()} onMerge={reviewMerge} /> : <div className="detail-empty detail-sticky-empty">一覧から課題を選ぶと、職員向けの整理画面が表示されます。</div>}</div></div>
          {(page > 1 || hasMore) && <div className="pagination-controls"><button className="button secondary" type="button" disabled={page <= 1 || busy} onClick={() => changePage(page - 1)}>前の100件</button><span>ページ {page}</span><button className="button secondary" type="button" disabled={!hasMore || busy} onClick={() => changePage(page + 1)}>次の100件</button></div>}
        </section>
        <div id="faq-management"><FaqManagement apiBase="/api/admin/faqs" title="FAQ・避難所の最新案内" /></div>
        <div id="settings"><section className="settings-card"><p className="eyebrow">設定</p><h2>安全な対応のために</h2><div className="settings-grid"><div><strong>原文の扱い</strong><p>原文はReportとして保存します。職員が必要なときだけ確認し、開いた操作も匿名の指標として記録します。</p></div><div><strong>AIの役割</strong><p>要約・要望・事実・緊急度候補・課題統合候補までです。重大な判断と返信は確定しません。</p></div><div><strong>公開コメント</strong><p>Issueへの1回の公開更新を、関連する相談の確認ページへ反映します。</p></div></div></section></div>
        <AuditLogList apiBase="/api/admin/audit-logs" />
      </section>
    </div>
  </main>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className={`metric-card metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>件</small></div>; }
function Kpi({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) { return <div className="kpi-detail-card"><span>{label}</span><strong>{value}</strong>{suffix && <small>{suffix}</small>}</div>; }

function IssueDetail({ issue, draft, answerText, setAnswerText, answerUsesAi, setAnswerUsesAi, displayName, busy, onGenerateDraft, onApprove, onStatus, onOriginalViewed, onMerge }: { issue: Issue; draft?: Draft; answerText: string; setAnswerText: (value: string) => void; answerUsesAi: boolean; setAnswerUsesAi: (value: boolean) => void; displayName: string; busy: boolean; onGenerateDraft: () => void; onApprove: () => void; onStatus: (status: string, message: string, isPublic: boolean, assignedTeam: string, assignedUser: string, urgencyConfirmed: string, internalNote: string) => Promise<boolean>; onOriginalViewed: () => void; onMerge: (candidateId: number, action: MergeAction) => Promise<void> }) {
  const [tab, setTab] = useState<'summary' | 'original' | 'reports'>('summary');
  const [publicMessage, setPublicMessage] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [team, setTeam] = useState(issue.assignedTeam);
  const [assignee, setAssignee] = useState(issue.assignedUser);
  const [urgency, setUrgency] = useState(issue.urgencyConfirmed ?? '');
  const [internalNote, setInternalNote] = useState(issue.internalNote);
  const [dirty, setDirty] = useState(false);
  const [lastServerVersion, setLastServerVersion] = useState(issue.version);
  const [bulkResolveConfirmed, setBulkResolveConfirmed] = useState(false);

  useEffect(() => {
    setTab('summary');
    setPublicMessage('');
    setIsPublic(true);
    setTeam(issue.assignedTeam);
    setAssignee(issue.assignedUser);
    setUrgency(issue.urgencyConfirmed ?? '');
    setInternalNote(issue.internalNote);
    setDirty(false);
    setLastServerVersion(issue.version);
    setBulkResolveConfirmed(false);
  }, [issue.id]);

  useEffect(() => {
    if (issue.version === lastServerVersion || dirty) return;
    setTeam(issue.assignedTeam);
    setAssignee(issue.assignedUser);
    setUrgency(issue.urgencyConfirmed ?? '');
    setInternalNote(issue.internalNote);
    setLastServerVersion(issue.version);
  }, [dirty, issue.assignedTeam, issue.assignedUser, issue.internalNote, issue.urgencyConfirmed, issue.version, lastServerVersion]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function save(status: string) {
    const saved = await onStatus(status, publicMessage, isPublic, team, assignee, urgency, internalNote);
    if (!saved) return;
    setPublicMessage('');
    setDirty(false);
    setLastServerVersion(issue.version + 1);
  }

  return <article className="detail-card shelter-detail-card">
    <div className="detail-header"><div><span className={`status-pill status-${issue.status}`}>{statusLabel[issue.status] ?? issue.status}</span><span className={`urgency-chip urgency-chip-${issue.urgency}`}>{urgencyLabel[issue.urgency] ?? issue.urgency}</span><span className="tag">{issue.category}</span></div>{issue.urgency === 'critical' && <span className="urgent-badge">! 要緊急確認</span>}</div>
    <h2 className="detail-title">{issue.title}</h2>
    <div className="detail-facts-row"><span>報告 {issue.reportCount}件</span><span>影響 {issue.affectedPeople || '不明'}</span><span>最初 {dateLabel(issue.firstReportedAt)}</span><span>最新 {relativeLabel(issue.lastReportedAt)}</span></div>
    {issue.urgency === 'critical' && <div className="critical-warning"><strong>命に関わる可能性があります</strong><p>このシステムの回答を待たず、近くの避難所職員へ直接知らせてください。AIの候補は最終判断ではありません。</p></div>}
    <div className="detail-tabs" role="tablist"><button role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'active' : ''} type="button" onClick={() => setTab('summary')}>AI整理</button><button role="tab" aria-selected={tab === 'original'} className={tab === 'original' ? 'active' : ''} type="button" onClick={() => { setTab('original'); onOriginalViewed(); }}>原文を確認する</button><button role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'active' : ''} type="button" onClick={() => setTab('reports')}>報告 {issue.reportCount}件</button></div>
    {tab === 'summary' && <section className="analysis-panel"><div className="analysis-section overview-section"><span className="analysis-label">概要</span><p>{issue.summary || 'AI要約はありません。'}</p></div><div className="analysis-section request-section"><span className="analysis-label">住民の要望</span><p>{issue.request || '要望は確認中です。'}</p></div><div className="analysis-split"><div><span className="analysis-label">事実</span>{issue.facts.length ? <ul>{issue.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : <p className="muted-block">確認できた事実はまだありません。</p>}</div><div className="emotion-box"><span className="analysis-label">感情（業務判断の補助）</span><strong>{issue.emotions.length ? issue.emotions.join('・') : '不安や困りごと'}</strong><p>感情は捨てずに認識しますが、職員はまず要望と事実から対応できます。</p></div></div><div className="analysis-section"><span className="analysis-label">確認が必要な情報</span>{issue.missingInformation.length ? <div className="missing-chips">{issue.missingInformation.map((item) => <span key={item}>{item}</span>)}</div> : <p className="muted-block">必要な情報はそろっています。</p>}</div><div className="analysis-section"><span className="analysis-label">影響・配慮が必要な人</span><div className="vulnerable-list">{issue.vulnerablePeople.map((item) => <span key={item}>{item}</span>)}</div></div><div className="analysis-section urgency-section"><div><span className="analysis-label">AIによる緊急度候補</span><strong className={`urgency-${issue.urgency}`}>{urgencyLabel[issue.urgency] ?? issue.urgency}</strong><span className="confidence-note">confidence {Math.round(issue.urgencyConfidence * 100)}%（緊急度候補）</span>{issue.candidateIssueId && <p className="urgent-explain">似た課題への統合候補があります。下で職員が確認してください。</p>}</div><label>職員が確定<select value={urgency} onChange={(event) => { setUrgency(event.target.value); setDirty(true); }}><option value="">未確定</option><option value="critical">要緊急確認</option><option value="high">高</option><option value="normal">通常</option><option value="low">低</option></select></label></div></section>}
    {tab === 'original' && <section className="original-panel"><div className="original-warning"><strong>原文を確認する</strong><span>強い表現・感情的な文章を含む可能性があります</span></div>{issue.reports.map((report) => <details className="report-original" key={report.id}><summary><span>{dateLabel(report.createdAt)}</span><strong>{report.title}</strong></summary><p>{report.originalBody || report.displayBody}</p></details>)}<p className="input-hint">原文を見なくても通常業務が完結するよう、AI整理を先に表示しています。開いた操作は記録されます。</p></section>}
    {tab === 'reports' && <section className="related-panel"><div className="related-group-heading"><span className="analysis-label">関連するReport</span><strong>同様の相談が {issue.reportCount}件 寄せられています</strong><p>個別の相談は削除せず、この課題に紐付けています。原文は必要なときだけ確認できます。</p></div><div className="related-list">{issue.reports.map((report) => <div key={report.id}><span className="status-pill">{statusLabel[report.workflowStatus] ?? report.workflowStatus}</span><strong>{report.title}</strong><small>{report.location || '場所未確認'} · {dateLabel(report.createdAt)}</small></div>)}</div></section>}
    {issue.candidateId && issue.candidateIssueId && <section className="merge-candidate"><span className="analysis-label">統合候補の確認</span><h3>{issue.candidateIssueTitle || `課題 #${issue.candidateIssueId}`}</h3><p>{issue.candidateReason || 'カテゴリ・場所・要望が近い課題です。'} 類似度 {Math.round((issue.candidateConfidence ?? 0) * 100)}%。統合後も個別の相談原文は残ります。</p><div className="merge-actions"><button className="button accent" type="button" disabled={busy} onClick={() => void onMerge(issue.candidateId!, 'accept')}>この課題に統合する</button><button className="button secondary" type="button" disabled={busy} onClick={() => void onMerge(issue.candidateId!, 'reject')}>別の課題として残す</button></div></section>}
    <section className="response-panel"><div className="response-panel-heading"><div><span className="analysis-label">課題への対応</span><h3>{issue.reportCount}件の相談へ同じ進捗を反映</h3></div>{issue.status !== 'resolved' && <button className="button accent" type="button" disabled={busy} onClick={() => void save('in_progress')}>対応を開始</button>}</div><div className="response-grid"><label>担当班<input value={team} onChange={(event) => { setTeam(event.target.value); setDirty(true); }} placeholder="例：物資班" /></label><label>担当職員<input value={assignee} onChange={(event) => { setAssignee(event.target.value); setDirty(true); }} placeholder="自分が担当する場合は下のボタン" /></label><button className="button secondary self-assign" type="button" disabled={busy} onClick={() => { setAssignee(displayName); if (!team) setTeam('避難所スタッフ'); setDirty(true); }}>自分が担当する</button><label>避難者へ公開する進捗<textarea value={publicMessage} onChange={(event) => { setPublicMessage(event.target.value); setDirty(true); }} placeholder="例：物資班が追加の飲料水を運搬しています。23:30ごろ配布予定です。" maxLength={1000} /></label><label className="check-public"><input type="checkbox" checked={isPublic} onChange={(event) => { setIsPublic(event.target.checked); setDirty(true); }} /> 関連する相談者に表示する</label><label>内部メモ（職員のみ）<textarea value={internalNote} onChange={(event) => { setInternalNote(event.target.value); setDirty(true); }} placeholder="職員間の引き継ぎメモ" maxLength={2000} /></label></div><div className="status-actions"><button type="button" disabled={busy} onClick={() => void save('reviewing')}>確認中にする</button><button type="button" disabled={busy} onClick={() => void save('assigned')}>担当決定</button><button type="button" disabled={busy} onClick={() => void save('waiting')}>追加情報を確認中</button><button className="action-resolve" type="button" disabled={busy} onClick={() => void save('resolved')}>解決済みにする</button><button type="button" disabled={busy} onClick={() => void save('cannot_resolve')}>対応困難として記録</button></div></section>
    {issue.status !== 'resolved' && issue.status !== 'cannot_resolve' && <section className="answer-editor"><div className="response-panel-heading"><div><span className="analysis-label">AIによる返信案</span><h3>人が確認してから送信</h3></div><button className="button secondary" type="button" disabled={busy} onClick={onGenerateDraft}>返信案を作る</button></div>{draft && <div className="grounds"><b>根拠：承認済みFAQ</b>{draft.grounds.length ? <ul>{draft.grounds.map((ground) => <li key={ground}>{ground}</li>)}</ul> : <p>根拠なし。推測せず、職員が内容を作成してください。</p>}<p className="input-hint">外部サービスへ送信せず、登録済みFAQと課題情報だけを根拠にしています。</p>{draft.alternatives?.length ? <div className="draft-options">{draft.alternatives.slice(0, 3).map((option, index) => <button className="draft-option" type="button" key={`${issue.id}-${index}`} onClick={() => setAnswerText(option)}><strong>返信案 {index + 1}</strong><span>{option}</span></button>)}</div> : null}</div>}<textarea value={answerText} onChange={(event) => setAnswerText(event.target.value)} maxLength={4000} placeholder="避難者への返信を入力してください" />{issue.reportCount > 1 && <label className="check-label bulk-answer-confirm"><input type="checkbox" checked={bulkResolveConfirmed} onChange={(event) => setBulkResolveConfirmed(event.target.checked)} /> 関連する {issue.reportCount}件を同じ返信で解決済みにすることを確認しました</label>}<label className="check-label"><input type="checkbox" checked={answerUsesAi} onChange={(event) => setAnswerUsesAi(event.target.checked)} /> AIの返信案を参考にした</label><button className="button accent" type="button" disabled={busy || !answerText.trim() || (issue.reportCount > 1 && !bulkResolveConfirmed)} onClick={onApprove}>{issue.reportCount > 1 ? `確認して ${issue.reportCount}件へ返信・解決する` : '確認して返信・解決する'}</button></section>}
    {issue.responseMessage && <section className="answer-history"><span className="analysis-label">最新の一括回答</span><p>{issue.responseMessage}</p></section>}
    <div className="update-history"><span className="analysis-label">対応履歴</span>{issue.updates.filter((update) => update.isPublic && update.message).map((update) => <div key={update.id}><b>課題更新</b><p>{update.message}</p><time>{dateLabel(update.createdAt)}</time></div>)}{!issue.updates.length && <p className="muted-block">まだ対応履歴はありません。</p>}</div>
  </article>;
}
