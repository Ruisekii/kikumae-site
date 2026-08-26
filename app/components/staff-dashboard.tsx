'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SubmittedQuestion } from '../../db/repository';

type Props = { displayName: string };

export function StaffDashboard({ displayName }: Props) {
  const [questions, setQuestions] = useState<SubmittedQuestion[]>([]);
  const [message, setMessage] = useState('管理権限を確認しています…');
  useEffect(() => {
    async function load() {
      const claim = await fetch('/api/admin/claim', { method: 'POST' });
      if (!claim.ok) { const body = (await claim.json()) as { message?: string }; setMessage(body.message ?? 'このアカウントには管理権限がありません。'); return; }
      const response = await fetch('/api/admin/questions');
      if (!response.ok) { setMessage('質問一覧を読み込めませんでした。'); return; }
      const body = (await response.json()) as { questions: SubmittedQuestion[] };
      setQuestions(body.questions); setMessage('');
    }
    void load();
  }, []);
  return <main className="staff-page"><header className="site-header"><Link className="brand" href="/">🐣 きくまえ</Link><Link href="/">公開ページへ</Link></header><section className="staff-content"><p className="eyebrow">回答者用</p><h1>質問一覧</h1><p className="staff-note">{displayName} としてサインイン中。質問は14日後に自動削除され、連絡先は収集しません。</p>{message && <p className="form-status" role="status">{message}</p>}{!message && !questions.length && <p className="empty">現在、未確認の質問はありません。</p>}<div className="question-list">{questions.map((question) => <article className="question-card" key={question.id}><div><span className="tag">{question.category}</span><time dateTime={new Date(question.createdAt).toISOString()}>{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(question.createdAt)}</time></div><p>{question.body}</p></article>)}</div></section></main>;
}
