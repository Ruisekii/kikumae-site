'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import type { FaqCandidate, SubmittedQuestion } from '../../db/repository';

type Props = { params: Promise<{ slug: string }> };
const dateLabel = (value: number | null) => value ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';

export function PortalStaffDashboard({ params }: Props) {
  const { slug } = use(params);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('この窓口');
  const [loggedIn, setLoggedIn] = useState(false);
  const [questions, setQuestions] = useState<SubmittedQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [draft, setDraft] = useState<{ draft: string; alternatives: string[]; grounds: string[] } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const selected = useMemo(() => questions.find((question) => question.id === selectedId) ?? null, [questions, selectedId]);
  function clearSession(message: string) {
    setLoggedIn(false); setQuestions([]); setSelectedId(null); setDraft(null); setAnswerText(''); setMessage(message);
  }
  async function loadQuestions() {
    const response = await fetch(`/api/portals/${slug}/admin/questions`, { cache: 'no-store' });
    const body = await response.json() as { questions?: SubmittedQuestion[]; message?: string };
    if (!response.ok) { if (response.status === 401) clearSession('セッションの有効期限が切れました。もう一度ログインしてください。'); else setMessage(body.message ?? '質問一覧を読み込めませんでした。'); return; }
    setQuestions(body.questions ?? []); setSelectedId((current) => current && body.questions?.some((q) => q.id === current) ? current : null);
  }
  async function login() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/portals/${slug}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const body = await response.json() as { portal?: { name: string }; message?: string };
      if (!response.ok) { setMessage(body.message ?? 'ログインできませんでした。'); return; }
      setName(body.portal?.name ?? 'この窓口'); setLoggedIn(true); await loadQuestions();
    } catch { setMessage('通信に失敗しました。'); }
    finally { setBusy(false); }
  }
  function selectQuestion(question: SubmittedQuestion) {
    setSelectedId(question.id); setAnswerText(question.answerBody ?? question.answerDraft ?? ''); setDraft(question.answerDraft ? { draft: question.answerDraft, alternatives: question.answerAlternatives, grounds: question.answerGrounds } : null); setMessage('');
  }
  async function generateDraft() {
    if (!selected) return; setBusy(true); setMessage('回答案を用意しています…');
    try { const response = await fetch(`/api/portals/${slug}/admin/questions/${selected.id}/draft`, { method: 'POST' }); const body = await response.json() as { draft?: string; alternatives?: string[]; grounds?: string[]; message?: string }; if (!response.ok) { if (response.status === 401) clearSession('セッションの有効期限が切れました。もう一度ログインしてください。'); else setMessage(body.message ?? '回答案を生成できませんでした。'); return; } setDraft({ draft: body.draft ?? '', alternatives: body.alternatives ?? [], grounds: body.grounds ?? [] }); setAnswerText(body.draft ?? ''); setMessage(''); }
    catch { setMessage('回答案の生成に失敗しました。'); } finally { setBusy(false); }
  }
  async function approveAnswer() {
    if (!selected || !answerText.trim()) return; setBusy(true); setMessage('回答を保存しています…');
    try { const response = await fetch(`/api/portals/${slug}/admin/questions/${selected.id}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: answerText, usedAi: Boolean(draft), grounds: draft?.grounds ?? [] }) }); const body = await response.json() as { message?: string }; if (!response.ok) { if (response.status === 401) clearSession('セッションの有効期限が切れました。もう一度ログインしてください。'); else setMessage(body.message ?? '回答を保存できませんでした。'); return; } await loadQuestions(); setMessage('人が確認した回答を保存しました。FAQ候補も確認できます。'); }
    catch { setMessage('回答の保存に失敗しました。'); } finally { setBusy(false); }
  }
  async function candidateAction(candidate: FaqCandidate, action: string) {
    setBusy(true); setMessage('FAQ候補を更新しています…');
    try { const response = await fetch(`/api/portals/${slug}/admin/candidates/${candidate.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, qText: candidate.qText, aText: candidate.aText, category: candidate.category }) }); const body = await response.json() as { message?: string }; if (!response.ok) { if (response.status === 401) clearSession('セッションの有効期限が切れました。もう一度ログインしてください。'); else setMessage(body.message ?? 'FAQ候補を更新できませんでした。'); return; } await loadQuestions(); setMessage(action === 'publish_edited' ? 'FAQを公開しました。' : '候補を更新しました。'); }
    catch { setMessage('FAQ候補の更新に失敗しました。'); } finally { setBusy(false); }
  }
  async function logout() {
    await fetch(`/api/portals/${slug}/logout`, { method: 'POST' });
    setLoggedIn(false); setQuestions([]); setSelectedId(null); setDraft(null); setAnswerText(''); setPassword(''); setMessage('ログアウトしました。');
  }
  async function deletePortal() {
    if (!confirmName || confirmName !== name) return;
    setBusy(true); setMessage('窓口と関連データを削除しています…');
    try {
      const response = await fetch(`/api/portals/${encodeURIComponent(slug)}/admin`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) { setMessage(body.message ?? '窓口を削除できませんでした。'); return; }
      window.location.assign('/');
    } catch { setMessage('窓口の削除に失敗しました。'); }
    finally { setBusy(false); }
  }
  if (!loggedIn) return <main className="staff-page"><header className="site-header"><Link className="brand" href="/">🐣 きくまえ</Link><Link href={`/${slug}`}>公開ページへ</Link></header><section className="portal-admin-login"><p className="eyebrow">管理者用</p><h1>この窓口の管理画面</h1><p className="staff-note">窓口作成時に設定したパスワードで入ります。</p><form onSubmit={(event) => { event.preventDefault(); void login(); }}><label>管理者パスワード<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required autoComplete="current-password" /></label><button className="button accent" type="submit" disabled={busy}>{busy ? '確認中…' : '管理画面に入る'}</button>{message && <p className="form-status" role="status">{message}</p>}</form></section></main>;
  const openCount = questions.filter((q) => q.status === 'open').length;
  const pendingCount = questions.filter((q) => q.candidate).length;
  return <main className="staff-page"><header className="site-header"><Link className="brand" href="/">🐣 きくまえ</Link><div className="header-actions"><Link href={`/${slug}`}>公開ページへ</Link><button className="button secondary" type="button" onClick={() => void logout()}>ログアウト</button></div></header><section className="staff-content"><p className="eyebrow">窓口管理</p><h1>{name}</h1><p className="staff-note">質問者は匿名です。原文は保存したまま、AIは下書きだけを支援します。</p>{message && <p className="form-status" role="status">{message}</p>}<div className="staff-stats"><span>未回答 <b>{openCount}</b></span><span>FAQ候補 <b>{pendingCount}</b></span><span>公開FAQは人が承認</span><button className="button secondary" type="button" onClick={() => void loadQuestions()} disabled={busy}>更新</button></div><div className="staff-layout"><div className="question-list">{questions.map((question) => <button className={`question-card question-select ${selectedId === question.id ? 'selected' : ''}`} key={question.id} type="button" onClick={() => selectQuestion(question)}><div><span className="tag">{question.category}</span><span className="status-pill">{question.status === 'open' ? '未回答' : '回答済み'}</span><time>{dateLabel(question.createdAt)}</time></div><strong>{question.aiSummary || '原文を確認してください'}</strong><p>{question.bodyOriginal}</p></button>)}{!questions.length && <p className="empty">まだ質問はありません。公開ページから匿名で質問できます。</p>}</div><div className="staff-detail">{selected ? <PortalQuestionDetail question={selected} draft={draft} answerText={answerText} setAnswerText={setAnswerText} busy={busy} onGenerateDraft={() => void generateDraft()} onApprove={() => void approveAnswer()} onCandidateAction={candidateAction} /> : <div className="detail-empty">左の質問を選ぶと、原文・要約・回答案が表示されます。</div>}</div></div><section className="danger-zone" aria-labelledby="portal-delete-title"><h2 id="portal-delete-title">危険な操作</h2><p>この窓口を削除すると、公開FAQ・質問・回答・FAQ候補・確認用データなど、窓口に保存された関連データも削除されます。この操作は取り消せません。</p>{!showDelete ? <button className="button danger" type="button" onClick={() => { setShowDelete(true); setConfirmName(''); setMessage(''); }}>この窓口を削除</button> : <div className="delete-confirm"><h3>「{name}」を削除しますか？</h3><p>削除を続けるには、確認のため窓口名を入力してください。</p><label htmlFor="portal-delete-name">窓口名<input id="portal-delete-name" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoComplete="off" placeholder={name} /></label><div className="form-actions"><button className="button danger" type="button" disabled={busy || confirmName !== name} onClick={() => void deletePortal()}>完全に削除する</button><button className="button secondary" type="button" disabled={busy} onClick={() => { setShowDelete(false); setConfirmName(''); }}>キャンセル</button></div></div>}</section></section></main>;
}

function PortalQuestionDetail({ question, draft, answerText, setAnswerText, busy, onGenerateDraft, onApprove, onCandidateAction }: { question: SubmittedQuestion; draft: { draft: string; alternatives: string[]; grounds: string[] } | null; answerText: string; setAnswerText: (value: string) => void; busy: boolean; onGenerateDraft: () => void; onApprove: () => void; onCandidateAction: (candidate: FaqCandidate, action: string) => Promise<void> }) {
  const candidate = question.candidate;
  return <article className="detail-card">
    <div className="detail-header"><span className="tag">{question.category}</span><span className="status-pill">{question.status === 'open' ? '未回答' : '回答済み'}</span></div>
    <section className="summary-block"><h2>AIによる要約</h2><p>{question.aiSummary || '要約なし'}</p></section>
    <section className="original-block"><h2>質問の原文</h2><p>{question.bodyOriginal}</p></section>
    {question.status === 'open' && <section className="answer-editor"><h2>AI回答案（人の承認が必要）</h2>{!draft ? <><p className="input-hint">この窓口の承認済みFAQだけを根拠に、外部送信なしで下書きを作成します。</p><button className="button primary" type="button" disabled={busy} onClick={onGenerateDraft}>✨ 回答案を表示</button></> : <>
      <div className="grounds"><b>根拠（承認済みFAQ）</b>{draft.grounds.length ? <ul>{draft.grounds.map((ground) => <li key={ground}>{ground}</li>)}</ul> : <p>根拠なし</p>}</div>
      {draft.alternatives.length > 0 && <div className="draft-options"><b>回答案を選ぶ（選んだ文章が編集欄に入ります）</b>{draft.alternatives.map((option, index) => <button className="draft-option" type="button" key={`${question.id}-${index}`} onClick={() => setAnswerText(option)}><strong>🟡 回答案{index + 1}：{index === 0 ? '簡潔に答える' : index === 1 ? '少し丁寧に説明する' : '別の観点から案内する'}</strong><span>{option}</span></button>)}</div>}
      <label htmlFor={`portal-answer-${question.id}`}>回答編集欄</label><textarea id={`portal-answer-${question.id}`} value={answerText} onChange={(event) => setAnswerText(event.target.value)} maxLength={4000} placeholder="回答を修正・入力してください" /><p className="input-hint">候補を選んだだけでは送信されません。必ず人が確認・修正してから保存してください。</p><button className="button accent" type="button" disabled={busy || !answerText.trim()} onClick={onApprove}>この回答を人が承認して保存</button>
    </>}</section>}
    {question.answerBody && <section className="answer-history"><h2>承認済み回答</h2><p>{question.answerBody}</p></section>}
    {candidate && <section className="candidate-review"><h2>AIが作ったFAQ候補</h2><p className="input-hint">公式FAQにするかは、人が確認して決めます。</p><div className="step-card"><b>Q. {candidate.qText}</b><p>{candidate.aText}</p><span className="tag">{candidate.category}</span></div><div className="form-actions"><button className="button accent" type="button" disabled={busy} onClick={() => void onCandidateAction(candidate, 'publish_edited')}>人が承認して公式FAQに公開</button><button className="button secondary" type="button" disabled={busy} onClick={() => void onCandidateAction(candidate, 'individual')}>個別回答だけにする</button><button className="button danger" type="button" disabled={busy} onClick={() => void onCandidateAction(candidate, 'reject')}>非公開にする</button></div></section>}
  </article>;
}
