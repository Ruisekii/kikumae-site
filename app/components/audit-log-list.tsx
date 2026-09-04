'use client';

import { useEffect, useState } from 'react';
import type { AuditLog } from '../../db/repository';

const labels: Record<string, string> = {
  answer_saved: '回答を保存', faq_created: 'FAQを追加', faq_updated: 'FAQを更新', faq_deleted: 'FAQを削除',
  faq_published: 'FAQ候補を公開', faq_candidate_individual: '個別回答にする', faq_candidate_reject: 'FAQ候補を非公開', question_deleted: '質問を削除', questions_bulk_deleted: '相談を複数削除',
};

export function AuditLogList({ apiBase }: { apiBase: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [message, setMessage] = useState('操作履歴を読み込んでいます…');

  useEffect(() => {
    let active = true;
    fetch(apiBase, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json() as { logs?: AuditLog[]; message?: string };
      if (!active) return;
      if (!response.ok) { setMessage(body.message ?? '操作履歴を読み込めませんでした。'); return; }
      setLogs(body.logs ?? []); setMessage('');
    }).catch(() => { if (active) setMessage('操作履歴の取得に失敗しました。'); });
    return () => { active = false; };
  }, [apiBase]);

  return <section className="audit-log-section" aria-labelledby="audit-log-title"><div className="section-heading"><div><p className="eyebrow">運用記録</p><h2 id="audit-log-title">最近の操作履歴</h2></div></div>{message && <p className="input-hint" role="status">{message}</p>}{!message && !logs.length && <p className="empty">まだ操作履歴はありません。</p>}{!message && logs.length > 0 && <ol className="audit-log-list">{logs.map((log, index) => <li key={`${log.createdAt}-${index}`}><span>{labels[log.action] ?? log.action}</span><time dateTime={new Date(log.createdAt).toISOString()}>{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(log.createdAt))}</time></li>)}</ol>}</section>;
}
