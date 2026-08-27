'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FaqCandidate, SubmittedQuestion } from '../../db/repository';

type Props = { displayName: string };
type Draft = { draft: string; grounds: string[]; mode: string };

const dateLabel = (value: number | null) => value ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';

export function StaffDashboard({ displayName }: Props) {
  const [questions, setQuestions] = useState<SubmittedQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [answerText, setAnswerText] = useState('');
  const [answerUsesAi, setAnswerUsesAi] = useState(false);
  const [message, setMessage] = useState('回答者権限を確認しています…');
  const [busy, setBusy] = useState(false);

  const loadQuestions = useCallback(async () => {
    const response = await fetch('/api/admin/questions', { cache: 'no-store' });
    if (!response.ok) { const body = await response.json() as { message?: string }; setMessage(body.message ?? '質問一覧を読み込めませんでした。'); return; }
    const body = await response.json() as { questions: SubmittedQuestion[] };
    setQuestions(body.questions); setMessage('');
    if (selectedId && !body.questions.some((question) => question.id === selectedId)) setSelectedId(null);
  }, [selectedId]);

  useEffect(() => {
    async function load() {
      const claim = await fetch('/api/admin/claim', { method: 'POST' });
      if (!claim.ok) { const body = await claim.json() as { message?: string }; setMessage(body.message ?? 'このアカウントには回答者権限がありません。'); return; }
      await loadQuestions();
    }
    void load();
  }, [loadQuestions]);

  const selected = useMemo(() => questions.find((question) => question.id === selectedId) ?? null, [questions, selectedId]);

  function selectQuestion(question: SubmittedQuestion) {
    setSelectedId(question.id); setAnswerText(question.answerBody ?? ''); setAnswerUsesAi(false); setMessage('');
  }

  async function generateDraft() {
    if (!selected) return;
    setBusy(true); setMessage('ローカル補助AIが承認済みFAQだけを根拠に下書きを作っています…');
    try {
      const response = await fetch(`/api/admin/questions/${selected.id}/draft`, { method: 'POST' });
      const body = await response.json() as Draft & { message?: string };
      if (!response.ok) { setMessage(body.message ?? '回答案を生成できませんでした。'); return; }
      setDrafts((current) => ({ ...current, [selected.id]: body })); setAnswerText(body.draft); setAnswerUsesAi(true); setMessage('回答案を表示しました。原文と根拠を確認してから、人が承認・修正してください。');
    } catch { setMessage('回答案の生成に失敗しました。'); }
    finally { setBusy(false); }
  }

  async function approveAnswer() {
    if (!selected || !answerText.trim()) return;
    const draft = drafts[selected.id];
    setBusy(true); setMessage('回答を保存しています…');
    try {
      const response = await fetch(`/api/admin/questions/${selected.id}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: answerText, usedAi: answerUsesAi, grounds: draft?.grounds ?? [] }) });
      const body = await response.json() as { candidate?: FaqCandidate | null; message?: string };
      if (!response.ok) { setMessage(body.message ?? '回答を保存できませんでした。'); return; }
      await loadQuestions(); setMessage(body.candidate ? '回答を承認しました。FAQ候補を作成しました。下の候補を確認してください。' : '回答を承認しました。個人情報の可能性があるためFAQ候補は作成していません。');
    } catch { setMessage('回答の保存に失敗しました。'); }
    finally { setBusy(false); }
  }

  async function candidateAction(candidate: FaqCandidate, action: string, qText: string, aText: string, category: string) {
    setBusy(true); setMessage('FAQ候補を更新しています…');
    try {
      const response = await fetch(`/api/admin/candidates/${candidate.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, qText, aText, category }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) { setMessage(body.message ?? 'FAQ候補を更新できませんでした。'); return; }
      await loadQuestions(); setMessage(action === 'publish_edited' ? '人の承認で公式FAQに公開しました。' : 'FAQ候補を更新しました。');
    } catch { setMessage('FAQ候補の更新に失敗しました。'); }
    finally { setBusy(false); }
  }

  const openCount = questions.filter((question) => question.status === 'open').length;
  const answeredCount = questions.filter((question) => question.status === 'answered').length;
  const pendingCandidates = questions.filter((question) => question.candidate).length;

  return <main className="staff-page"><header className="site-header"><Link className="brand" href="/">🐣 きくまえ</Link><Link href="/">公開ページへ</Link></header><section className="staff-content"><p className="eyebrow">回答者用</p><h1>質問への対応</h1><p className="staff-note">{displayName || 'サイトオーナー'}。質問者は匿名です。原文は保存したまま、AIは下書きだけを支援します。</p>{message && <p className="form-status" role="status">{message}</p>}{!message && <><div className="staff-stats"><span>未回答 <b>{openCount}</b></span><span>回答済み <b>{answeredCount}</b></span><span>FAQ候補 <b>{pendingCandidates}</b></span><button className="button secondary" type="button" onClick={() => void loadQuestions()} disabled={busy}>更新</button></div><div className="staff-layout"><div className="question-list">{questions.map((question) => <button className={`question-card question-select ${selectedId === question.id ? 'selected' : ''}`} key={question.id} type="button" onClick={() => selectQuestion(question)}><div><span className="tag">{question.category}</span><span className="status-pill">{question.status === 'open' ? '未回答' : '回答済み'}</span><time dateTime={new Date(question.createdAt).toISOString()}>{dateLabel(question.createdAt)}</time></div><strong>{question.aiSummary || 'AI要約なし・原文のみ'}</strong><p>{question.bodyOriginal}</p></button>)}{!questions.length && <p className="empty">現在、未確認の質問はありません。</p>}</div><div className="staff-detail">{selected ? <QuestionDetail question={selected} draft={drafts[selected.id]} answerText={answerText} setAnswerText={setAnswerText} answerUsesAi={answerUsesAi} setAnswerUsesAi={setAnswerUsesAi} busy={busy} onGenerateDraft={() => void generateDraft()} onApprove={() => void approveAnswer()} onCandidateAction={candidateAction} /> : <div className="detail-empty">左の質問を選ぶと、原文・要約・回答案が表示されます。</div>}</div></div></>}</section></main>;
}

function QuestionDetail({ question, draft, answerText, setAnswerText, answerUsesAi, setAnswerUsesAi, busy, onGenerateDraft, onApprove, onCandidateAction }: { question: SubmittedQuestion; draft?: Draft; answerText: string; setAnswerText: (value: string) => void; answerUsesAi: boolean; setAnswerUsesAi: (value: boolean) => void; busy: boolean; onGenerateDraft: () => void; onApprove: () => void; onCandidateAction: (candidate: FaqCandidate, action: string, qText: string, aText: string, category: string) => Promise<void> }) {
  const [candidateQ, setCandidateQ] = useState(question.candidate?.qText ?? '');
  const [candidateA, setCandidateA] = useState(question.candidate?.aText ?? '');
  const [candidateCategory, setCandidateCategory] = useState(question.candidate?.category ?? 'その他');
  const [showOriginal, setShowOriginal] = useState(true);
  const candidate = question.candidate;
  return <article className="detail-card"><div className="detail-header"><span className="tag">{question.category}</span><span className="status-pill">{question.status === 'open' ? '未回答' : '回答済み'}</span><time>{dateLabel(question.createdAt)}</time></div><section className="summary-block"><h2>AIによる要約</h2><p>{question.aiSummary || '要約なし'}</p><p className="input-hint">{question.summaryEdited ? '質問者が確認・編集した要約です。' : '原文から作成した参考要約です。'}</p></section><section className="original-block"><button className="text-button" type="button" onClick={() => setShowOriginal(!showOriginal)}>{showOriginal ? '原文を閉じる' : '原文を表示'}</button>{showOriginal && <p>{question.bodyOriginal}</p>}</section>{question.answerBody && <section className="answer-history"><h2>承認済み回答</h2><p>{question.answerBody}</p><p className="input-hint">{question.answerUsedAi ? 'AI下書きを人が修正・承認' : '人が作成・承認'}{question.answeredAt ? `・${dateLabel(question.answeredAt)}` : ''}</p></section>}{question.status === 'open' && <section className="answer-editor"><h2>AI回答案（人の承認が必要）</h2>{!draft && <><p className="input-hint">承認済みFAQのみを根拠に、外部送信なしで下書きを作成します。根拠がない場合、AIは推測しません。</p><button className="button primary" type="button" disabled={busy} onClick={onGenerateDraft}>✨ 回答案を生成</button></>}{draft && <><div className="grounds"><b>根拠（承認済みFAQ）</b>{draft.grounds.length ? <ul>{draft.grounds.map((ground) => <li key={ground}>{ground}</li>)}</ul> : <p>根拠なし。担当者が本文を作成してください。</p>}<span className="input-hint">生成方式: Worker内ローカル補助AI（外部サービスへ送信しません）</span></div><textarea value={answerText} onChange={(event) => setAnswerText(event.target.value)} maxLength={4000} placeholder="回答を修正・入力してください" /><label className="check-label"><input type="checkbox" checked={answerUsesAi} onChange={(event) => setAnswerUsesAi(event.target.checked)} /> AI回答案を参考にした</label><button className="button accent" type="button" disabled={busy || !answerText.trim()} onClick={onApprove}>この回答を人が承認して保存</button></>}</section>}{candidate && <CandidateReview candidate={candidate} qText={candidateQ} aText={candidateA} category={candidateCategory} setQText={setCandidateQ} setAText={setCandidateA} setCategory={setCandidateCategory} disabled={busy} onAction={onCandidateAction} />}</article>;
}

function CandidateReview({ candidate, qText, aText, category, setQText, setAText, setCategory, disabled, onAction }: { candidate: FaqCandidate; qText: string; aText: string; category: string; setQText: (value: string) => void; setAText: (value: string) => void; setCategory: (value: string) => void; disabled: boolean; onAction: (candidate: FaqCandidate, action: string, qText: string, aText: string, category: string) => Promise<void> }) {
  return <section className="candidate-review"><h2>AIが作ったFAQ候補</h2><p className="input-hint">公式FAQにするかどうかは、人が内容を確認して決めます。自動公開はありません。</p><label>質問<input value={qText} onChange={(event) => setQText(event.target.value)} maxLength={300} /></label><label>回答<textarea value={aText} onChange={(event) => setAText(event.target.value)} maxLength={2000} /></label><label>カテゴリ<select value={category} onChange={(event) => setCategory(event.target.value)}>{['見学・参加方法', '初心者向け', '活動内容', '部費・持ち物', 'その他'].map((value) => <option key={value}>{value}</option>)}</select></label><div className="form-actions"><button className="button accent" type="button" disabled={disabled} onClick={() => void onAction(candidate, 'publish_edited', qText, aText, category)}>人が承認して公式FAQに公開</button><button className="button secondary" type="button" disabled={disabled} onClick={() => void onAction(candidate, 'individual', qText, aText, category)}>個別回答だけにする</button><button className="button danger" type="button" disabled={disabled} onClick={() => void onAction(candidate, 'reject', qText, aText, category)}>非公開にする</button></div></section>;
}
