/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FaqCandidate, ShelterDashboardStats, SubmittedQuestion } from '../../db/repository';
import { FaqManagement } from './faq-management';
import { AuditLogList } from './audit-log-list';

type Props = { displayName: string; authorized?: boolean; signOutHref?: string };
type Draft = { draft: string; grounds: string[]; mode: string };
const statusLabel: Record<string, string> = { received: '受付済み', reviewing: '確認中', in_progress: '対応中', awaiting_info: '追加情報を確認中', resolved: '解決済み' };
const dateLabel = (value: number | null) => value ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';

export function StaffDashboard({ displayName, authorized = false, signOutHref }: Props) {
  const [questions, setQuestions] = useState<SubmittedQuestion[]>([]);
  const [stats, setStats] = useState<ShelterDashboardStats | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [answerText, setAnswerText] = useState('');
  const [answerUsesAi, setAnswerUsesAi] = useState(false);
  const [caseFilter, setCaseFilter] = useState('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [message, setMessage] = useState(authorized ? '相談を読み込んでいます…' : '管理権限を確認しています…');
  const [busy, setBusy] = useState(false);

  const loadQuestions = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const response = await fetch('/api/admin/questions?page=1', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json() as { questions?: SubmittedQuestion[]; stats?: ShelterDashboardStats; message?: string };
    if (!response.ok) {
      if (response.status === 401) { window.location.assign('/admin'); return; }
      if (!silent) setMessage(body.message ?? '相談一覧を読み込めませんでした。');
      return;
    }
    setQuestions(body.questions ?? []); setStats(body.stats ?? null);
    if (!silent) setMessage('相談一覧を更新しました。');
    setSelectedId((current) => current && !(body.questions ?? []).some((question) => question.id === current) ? null : current);
  }, []);

  useEffect(() => {
    async function load() {
      if (!authorized) {
        const claim = await fetch('/api/admin/claim', { method: 'POST', credentials: 'same-origin' });
        if (!claim.ok) { const body = await claim.json() as { message?: string }; setMessage(body.message ?? 'このアカウントには管理権限がありません。'); return; }
      }
      await loadQuestions();
    }
    void load();
  }, [authorized, loadQuestions]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || busy || selectedId !== null) return;
      void loadQuestions({ silent: true });
    };
    const timer = window.setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [busy, loadQuestions, selectedId]);

  useEffect(() => {
    if (!message || message.includes('権限') || message.includes('確認しています')) return;
    const timer = window.setTimeout(() => setMessage(''), 2200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const selected = useMemo(() => questions.find((question) => question.id === selectedId) ?? null, [questions, selectedId]);
  const visibleQuestions = useMemo(() => caseFilter === 'all' ? questions : questions.filter((question) => question.workflowStatus === caseFilter), [caseFilter, questions]);

  function selectQuestion(question: SubmittedQuestion) {
    setSelectedId(question.id); setAnswerText(question.answerBody ?? ''); setAnswerUsesAi(false); setDrafts((current) => { const next = { ...current }; delete next[question.id]; return next; }); setMessage('');
  }

  function toggleSelection(id: number) {
    setSelectedIds((current) => current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    const visibleIds = visibleQuestions.map((question) => question.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
  }

  async function deleteSelected() {
    if (!selectedIds.length || busy) return;
    if (!window.confirm(`${selectedIds.length}件の相談を削除します。削除した相談は避難者の確認画面からも見られなくなります。よろしいですか？`)) return;
    setBusy(true); setMessage(`${selectedIds.length}件の相談を削除しています…`);
    try {
      const response = await fetch('/api/admin/questions/bulk', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ids: selectedIds }) });
      const body = await response.json() as { deleted?: number; message?: string };
      if (!response.ok) { setMessage(body.message ?? '相談を削除できませんでした。'); return; }
      if (selectedId && selectedIds.includes(selectedId)) setSelectedId(null);
      setSelectedIds([]); setSelectionMode(false); await loadQuestions(); setMessage(`${body.deleted ?? selectedIds.length}件の相談を削除しました。`);
    } catch { setMessage('相談の削除に失敗しました。'); } finally { setBusy(false); }
  }

  async function generateDraft() {
    if (!selected) return; setBusy(true); setMessage('承認済みFAQを根拠に回答案を作っています…');
    try { const response = await fetch(`/api/admin/questions/${selected.id}/draft`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } }); const body = await response.json() as Draft & { message?: string }; if (!response.ok) { if (response.status === 401) { window.location.assign('/admin'); return; } setMessage(body.message ?? '回答案を生成できませんでした。'); return; } setDrafts((current) => ({ ...current, [selected.id]: body })); setAnswerText(body.draft); setAnswerUsesAi(true); setMessage('相談内容に合わせた返信案を作成しました。'); }
    catch { setMessage('回答案の生成に失敗しました。'); } finally { setBusy(false); }
  }

  async function approveAnswer() {
    if (!selected || !answerText.trim()) return; setBusy(true); setMessage('確認済みの返信を保存しています…');
    try { const response = await fetch(`/api/admin/questions/${selected.id}/answer`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ body: answerText, usedAi: answerUsesAi, grounds: drafts[selected.id]?.grounds ?? [] }) }); const body = await response.json() as { message?: string }; if (!response.ok) { if (response.status === 401) { window.location.assign('/admin'); return; } setMessage(body.message ?? '返信を保存できませんでした。'); return; } await loadQuestions(); setMessage('返信を保存し、解決済みにしました。'); }
    catch { setMessage('返信の保存に失敗しました。'); } finally { setBusy(false); }
  }

  async function updateWorkflow(status: string, messageText: string, isPublic: boolean, assigneeName: string, urgencyConfirmed: string, internalNote: string) {
    if (!selected) return; setBusy(true); setMessage('相談の状態を更新しています…');
    try { const response = await fetch(`/api/admin/questions/${selected.id}/status`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ status, message: messageText, isPublic, assigneeName, urgencyConfirmed, internalNote }) }); const body = await response.json() as { message?: string }; if (!response.ok) { if (response.status === 401) { window.location.assign('/admin'); return; } setMessage(body.message ?? '状態を更新できませんでした。'); return; } await loadQuestions(); setMessage('相談の対応状況を更新しました。'); }
    catch { setMessage('状態の更新に失敗しました。'); } finally { setBusy(false); }
  }

  async function recordOriginalViewed() {
    if (!selected) return;
    void fetch(`/api/admin/questions/${selected.id}/events`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ event: 'original_opened' }) });
  }

  async function candidateAction(candidate: FaqCandidate, action: string, qText: string, aText: string, category: string) {
    if (!selected) return; setBusy(true); setMessage('FAQ候補を更新しています…');
    try { const response = await fetch(`/api/admin/candidates/${candidate.id}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ action, qText, aText, category }) }); const body = await response.json() as { message?: string }; if (!response.ok) { if (response.status === 401) { window.location.assign('/admin'); return; } setMessage(body.message ?? 'FAQ候補を更新できませんでした。'); return; } await loadQuestions(); setMessage(action === 'publish_edited' ? 'FAQ候補を承認し、公開FAQに追加しました。' : 'FAQ候補を更新しました。'); }
    catch { setMessage('FAQ候補の更新に失敗しました。'); } finally { setBusy(false); }
  }

  const counts = stats?.counts ?? { received: 0, reviewing: 0, in_progress: 0, awaiting_info: 0, resolved: 0 };
  return <main className="staff-page"><header className="site-header staff-topbar"><Link className="brand" href="/">◌ 避難所の相談窓口</Link><div className="header-actions"><span className="staff-user">{displayName || '職員'}さん</span><Link href="/">避難者画面</Link>{signOutHref && <Link href={signOutHref}>ログアウト</Link>}</div></header><div className="staff-shell"><aside className="staff-sidebar" aria-label="職員メニュー"><div className="sidebar-kicker">避難所スタッフ</div><a className="sidebar-link active" href="#overview">▦ ダッシュボード</a><a className="sidebar-link" href="#cases">▤ 相談一覧 <span>{counts.received + counts.reviewing + counts.in_progress + counts.awaiting_info}</span></a><a className="sidebar-link" href="#faq-management">▧ FAQ管理</a><a className="sidebar-link" href="#metrics">◔ 統計・分析</a><a className="sidebar-link" href="#settings">⚙ 設定</a><div className="sidebar-note">AIは整理と下書きを支援します。重要な判断と返信は、必ず職員が確認します。</div></aside><section className="staff-content shelter-staff-content"><div className="staff-heading" id="overview"><div><p className="eyebrow">避難所の状況</p><h1>今日の相談対応</h1><p className="staff-note">強い言葉をそのまま受け続けなくても、必要な事実から確認できます。</p></div><button className="button secondary" type="button" onClick={() => void loadQuestions()} disabled={busy}>↻ 更新</button></div>{message && <p className="form-status" role="status">{message}</p>}<div className="metric-grid"><Metric label="未確認" value={counts.received} tone="blue" /><Metric label="確認中" value={counts.reviewing} tone="soft" /><Metric label="対応中" value={counts.in_progress} tone="yellow" /><Metric label="本日解決" value={counts.resolved} tone="green" /></div><div className="priority-grid"><section className="priority-card urgent-card"><div className="section-card-heading"><div><p className="eyebrow">要緊急確認</p><h2>先に見る相談</h2></div><span className="priority-count">{stats?.urgent.length ?? 0}</span></div>{stats?.urgent.length ? <div className="priority-list">{stats.urgent.slice(0, 3).map((question) => <button type="button" key={question.id} onClick={() => { selectQuestion(question); window.location.hash = 'cases'; }}><span className="alert-dot">!</span><span><strong>{question.title || question.aiSummary}</strong><small>{question.location || '場所未確認'} · {statusLabel[question.workflowStatus]}</small></span><b>›</b></button>)}</div> : <p className="muted-block">現在、要緊急確認の相談はありません。</p>}</section><section className="priority-card surge-card"><div className="section-card-heading"><div><p className="eyebrow">最近増えている相談</p><h2>30分間の傾向</h2></div><span className="trend-mark">↗</span></div>{stats?.surge ? <><strong className="surge-value">{stats.surge.category}</strong><p>直近30分で <b>{stats.surge.count}件</b> 届いています。複数の声をまとめて確認してください。</p></> : <p className="muted-block">まだ十分な件数がありません。</p>}</section></div><section className="category-card" id="metrics"><div className="section-card-heading"><div><p className="eyebrow">相談カテゴリー</p><h2>必要な支援の全体像</h2></div><span className="muted-small">受付中の相談を集計</span></div><div className="category-bars">{(stats?.categoryCounts ?? []).slice(0, 7).map((item) => <div className="category-bar" key={item.category}><span>{item.category}</span><div><i style={{ width: `${Math.min(100, Math.max(5, item.count * 8))}%` }} /></div><b>{item.count}</b></div>)}{!stats?.categoryCounts.length && <p className="muted-block">相談が届くと、カテゴリー別に表示されます。</p>}</div></section><section className="cases-section" id="cases"><div className="section-card-heading"><div><p className="eyebrow">対応が必要な声</p><h2>相談一覧</h2></div><span className="muted-small">感情ではなく、まず事実を確認</span></div><div className="case-filters">{[['all', 'すべて'], ['received', '未確認'], ['reviewing', '確認中'], ['in_progress', '対応中'], ['awaiting_info', '追加情報'], ['resolved', '解決済み']].map(([value, label]) => <button className={caseFilter === value ? 'selected' : ''} type="button" key={value} onClick={() => setCaseFilter(value)}>{label} <b>{value === 'all' ? questions.length : counts[value] ?? 0}</b></button>)}</div><div className="bulk-toolbar"><div className="bulk-toolbar-main"><button className="button secondary" type="button" onClick={() => setSelectionMode((current) => !current)}>{selectionMode ? '選択を終了' : '複数選択'}</button>{selectionMode && <><label className="bulk-select-all"><input type="checkbox" checked={visibleQuestions.length > 0 && visibleQuestions.every((question) => selectedIds.includes(question.id))} onChange={toggleAllVisible} /> 表示中を全選択</label><span className="bulk-selection-count">{selectedIds.length}件選択中</span></>}</div>{selectionMode && <button className="button danger bulk-delete-button" type="button" disabled={!selectedIds.length || busy} onClick={() => void deleteSelected()}>選択した相談を削除</button>}</div><div className="staff-layout shelter-staff-layout"><div className="question-list">{visibleQuestions.map((question) => <article className={'question-card shelter-question-card ' + (selectedId === question.id ? 'selected ' : '') + (selectionMode && selectedIds.includes(question.id) ? 'bulk-selected' : '')} key={question.id}><label className="bulk-row-checkbox"><input className="bulk-row-checkbox-input" type="checkbox" checked={selectedIds.includes(question.id)} disabled={!selectionMode} onChange={() => toggleSelection(question.id)} onClick={(event) => event.stopPropagation()} aria-label={(question.title || '相談') + 'を選択'} /><span aria-hidden="true" /></label><button className="question-card-main" type="button" onClick={() => selectionMode ? toggleSelection(question.id) : selectQuestion(question)} aria-pressed={selectionMode ? selectedIds.includes(question.id) : undefined}><div><span className={`status-pill status-${question.workflowStatus}`}>{statusLabel[question.workflowStatus] ?? question.workflowStatus}</span><span className="tag">{question.category}</span>{question.urgentReview && <span className="urgent-inline">要緊急確認</span>}<time>{dateLabel(question.createdAt)}</time></div><strong>{question.title || question.aiSummary || '相談内容を整理中'}</strong><p>{question.location || '場所を確認中'}{question.similarCount ? ' · 同様の相談 ' + question.similarCount + '件' : ''}</p><span className="question-assignee">{question.assigneeName ? '担当：' + question.assigneeName : '担当未設定'}</span></button></article>)}{!visibleQuestions.length && <div className="detail-empty">この状態の相談はありません。</div>}</div><div className="staff-detail">{selected ? <QuestionDetail question={selected} draft={drafts[selected.id]} answerText={answerText} setAnswerText={setAnswerText} answerUsesAi={answerUsesAi} setAnswerUsesAi={setAnswerUsesAi} busy={busy} onGenerateDraft={() => void generateDraft()} onApprove={() => void approveAnswer()} onStatus={updateWorkflow} onOriginalViewed={() => void recordOriginalViewed()} onCandidateAction={candidateAction} /> : <div className="detail-empty detail-sticky-empty">一覧から相談を選ぶと、職員向けの整理画面が表示されます。</div>}</div></div></section><div id="faq-management"><FaqManagement apiBase="/api/admin/faqs" title="FAQ・対応ナレッジ" /></div><div id="settings"><section className="settings-card"><p className="eyebrow">設定</p><h2>安全な対応のために</h2><div className="settings-grid"><div><strong>原文の扱い</strong><p>原文は削除せず保存します。職員が必要なときだけ原文タブから確認できます。</p></div><div><strong>AIの役割</strong><p>AIは感情と事実の整理、FAQ検索、回答案の下書きまでです。重大な判断は確定しません。</p></div><div><strong>公開コメント</strong><p>避難者に見える進捗と、職員だけの内部メモを分けて記録します。</p></div></div></section></div><AuditLogList apiBase="/api/admin/audit-logs" /></section></div></main>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className={`metric-card metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>件</small></div>; }

function QuestionDetail({ question, draft, answerText, setAnswerText, answerUsesAi, setAnswerUsesAi, busy, onGenerateDraft, onApprove, onStatus, onOriginalViewed, onCandidateAction }: { question: SubmittedQuestion; draft?: Draft; answerText: string; setAnswerText: (value: string) => void; answerUsesAi: boolean; setAnswerUsesAi: (value: boolean) => void; busy: boolean; onGenerateDraft: () => void; onApprove: () => void; onStatus: (status: string, message: string, isPublic: boolean, assigneeName: string, urgencyConfirmed: string, internalNote: string) => Promise<void>; onOriginalViewed: () => void; onCandidateAction: (candidate: FaqCandidate, action: string, qText: string, aText: string, category: string) => Promise<void> }) {
  const [tab, setTab] = useState<'summary' | 'original' | 'related'>('summary');
  const [publicMessage, setPublicMessage] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [assignee, setAssignee] = useState(question.assigneeName);
  const [urgency, setUrgency] = useState(question.urgencyConfirmed ?? '');
  const [internalNote, setInternalNote] = useState(question.internalNote);
  const [candidateQ, setCandidateQ] = useState(question.candidate?.qText ?? '');
  const [candidateA, setCandidateA] = useState(question.candidate?.aText ?? '');
  const [candidateCategory, setCandidateCategory] = useState(question.candidate?.category ?? 'その他');
  const candidate = question.candidate;
  useEffect(() => { setAssignee(question.assigneeName); setUrgency(question.urgencyConfirmed ?? ''); setInternalNote(question.internalNote); setCandidateQ(question.candidate?.qText ?? ''); setCandidateA(question.candidate?.aText ?? ''); setCandidateCategory(question.candidate?.category ?? 'その他'); setTab('summary'); }, [question]);

  async function saveStatus(status: string) { await onStatus(status, publicMessage, isPublic, assignee, urgency, internalNote); setPublicMessage(''); }
  return <article className="detail-card shelter-detail-card"><div className="detail-header"><div><span className="status-pill status-{question.workflowStatus}">{statusLabel[question.workflowStatus] ?? question.workflowStatus}</span><span className="tag">{question.category}</span><time>{dateLabel(question.createdAt)}</time></div>{question.urgentReview && <span className="urgent-badge">! 要緊急確認</span>}</div><h2 className="detail-title">{question.title || question.aiSummary || '相談の内容'}</h2><div className="detail-facts-row"><span>場所：{question.location || '未確認'}</span><span>同様の相談：{question.similarCount}件</span><span>担当：{question.assigneeName || '未設定'}</span></div><div className="detail-tabs" role="tablist"><button className={tab === 'summary' ? 'active' : ''} type="button" onClick={() => setTab('summary')}>AI要約</button><button className={tab === 'original' ? 'active' : ''} type="button" onClick={() => { setTab('original'); onOriginalViewed(); }}>原文</button><button className={tab === 'related' ? 'active' : ''} type="button" onClick={() => setTab('related')}>関連する相談 <b>{question.similarCount}</b></button></div>{tab === 'summary' && <section className="analysis-panel"><div className="analysis-section overview-section"><span className="analysis-label">概要</span><p>{question.aiSummary || 'AI要約がありません。原文を確認してください。'}</p></div><div className="analysis-split"><div><span className="analysis-label">事実</span>{question.factSummary.length ? <ul>{question.factSummary.map((fact) => <li key={fact}>{fact}</li>)}</ul> : <p className="muted-block">追加の事実はまだありません。</p>}</div><div className="emotion-box"><span className="analysis-label">感情</span><strong>{question.emotionSummary || '不安や困りごと'}</strong><p>感情を削除せず認識し、対応に必要な事実を先に確認します。</p></div></div><div className="analysis-section"><span className="analysis-label">確認が必要な情報</span>{question.missingInformation.length ? <div className="missing-chips">{question.missingInformation.map((item) => <span key={item}>{item}</span>)}</div> : <p className="muted-block">必要な情報はそろっています。</p>}</div><div className="analysis-section urgency-section"><div><span className="analysis-label">緊急度候補</span><strong className={`urgency-${question.urgencyCandidate}`}>{question.urgencyCandidate}</strong>{question.urgentReview && <p className="urgent-explain">重大なキーワードを検出しました。職員が優先して確認してください。</p>}</div><label>職員が確定<select value={urgency} onChange={(event) => setUrgency(event.target.value)}><option value="">未確定</option><option>高</option><option>中</option><option>低</option></select></label></div></section>}{tab === 'original' && <section className="original-panel"><div className="original-warning"><strong>原文</strong><span>AI整理前の内容をそのまま保存しています</span></div><p>{question.bodyOriginal}</p><p className="input-hint">原文を開いたことは記録されます。必要なときに確認し、まずAI要約と事実から対応できます。</p></section>}{tab === 'related' && <section className="related-panel"><div className="related-group-heading"><span className="analysis-label">共通案件候補</span><strong>{question.similarGroupTitle || question.title}</strong><p>個別の相談は消さず、同じ状況として関連付けています。</p></div>{question.similarQuestions.length ? <div className="related-list">{question.similarQuestions.map((item) => <div key={item.id}><span className="status-pill">{statusLabel[item.workflowStatus] ?? item.workflowStatus}</span><strong>{item.title}</strong><small>{item.location || '場所未確認'} · {dateLabel(item.createdAt)}</small></div>)}</div> : <p className="muted-block">まだ関連付けられた相談はありません。</p>}</section>}<section className="response-panel"><div className="response-panel-heading"><div><span className="analysis-label">対応操作</span><h3>状況を更新して、避難者へ返します</h3></div>{question.workflowStatus !== 'resolved' && <button className="button accent" type="button" disabled={busy} onClick={() => void saveStatus('in_progress')}>対応を開始</button>}</div><div className="response-grid"><label>担当者<input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="例：佐藤" /></label><label>公開する進捗コメント<textarea value={publicMessage} onChange={(event) => setPublicMessage(event.target.value)} placeholder="例：飲料水の補充を手配しています。" maxLength={500} /></label><label className="check-public"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /> 避難者に表示する</label><label>内部メモ（職員のみ）<textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="職員間の引き継ぎメモ" maxLength={2000} /></label></div><div className="status-actions"><button type="button" disabled={busy} onClick={() => void saveStatus('reviewing')}>確認中にする</button><button type="button" disabled={busy} onClick={() => void saveStatus('awaiting_info')}>追加情報を確認中</button><button className="action-resolve" type="button" disabled={busy} onClick={() => void saveStatus('resolved')}>解決済みにする</button></div></section>{question.workflowStatus !== 'resolved' && <section className="answer-editor"><div className="response-panel-heading"><div><span className="analysis-label">AIによる返信案</span><h3>人が確認してから送信</h3></div><button className="button secondary" type="button" disabled={busy} onClick={onGenerateDraft}>返信案を作る</button></div>{draft && <div className="grounds"><b>根拠：承認済みFAQ</b>{draft.grounds.length ? <ul>{draft.grounds.map((ground) => <li key={ground}>{ground}</li>)}</ul> : <p>根拠なし。推測せず、職員が内容を作成してください。</p>}<p className="input-hint">外部サービスへ送信せず、FAQの内容だけを根拠にしています。</p></div>}<textarea value={answerText} onChange={(event) => setAnswerText(event.target.value)} maxLength={4000} placeholder="避難者への返信を入力してください" /><label className="check-label"><input type="checkbox" checked={answerUsesAi} onChange={(event) => setAnswerUsesAi(event.target.checked)} /> AIの返信案を参考にした</label><button className="button accent" type="button" disabled={busy || !answerText.trim()} onClick={onApprove}>確認して返信・解決にする</button></section>}{question.answerBody && <section className="answer-history"><span className="analysis-label">避難者へ送った返信</span><p>{question.answerBody}</p></section>}{candidate && <section className="candidate-review"><span className="analysis-label">対応ナレッジ候補</span><h3>今回の対応をFAQに残しますか？</h3><p className="input-hint">AI候補は自動公開されません。内容を確認してから選択してください。</p><label>質問<input value={candidateQ} onChange={(event) => setCandidateQ(event.target.value)} maxLength={300} /></label><label>回答<textarea value={candidateA} onChange={(event) => setCandidateA(event.target.value)} maxLength={2000} /></label><label>カテゴリ<select value={candidateCategory} onChange={(event) => setCandidateCategory(event.target.value)}>{['水・飲料', '食料・物資', '医療・薬', 'トイレ・衛生', '設備・充電', 'ペット', '安全・その他', 'その他'].map((value) => <option key={value}>{value}</option>)}</select></label><div className="form-actions"><button className="button accent" type="button" disabled={busy} onClick={() => void onCandidateAction(candidate, 'publish_edited', candidateQ, candidateA, candidateCategory)}>承認してFAQに追加</button><button className="button secondary" type="button" disabled={busy} onClick={() => void onCandidateAction(candidate, 'individual', candidateQ, candidateA, candidateCategory)}>今回だけにする</button><button className="button danger" type="button" disabled={busy} onClick={() => void onCandidateAction(candidate, 'reject', candidateQ, candidateA, candidateCategory)}>見送る</button></div></section>}<div className="update-history"><span className="analysis-label">公開できる対応履歴</span>{question.updates.filter((update) => update.isPublic && update.message).map((update) => <div key={update.id}><b>{statusLabel[update.status] ?? update.status}</b><p>{update.message}</p><time>{dateLabel(update.createdAt)}</time></div>)}</div></article>;
}
