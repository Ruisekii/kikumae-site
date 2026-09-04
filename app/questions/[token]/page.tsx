import Link from 'next/link';
import { getQuestionByCheckToken } from '../../../db/repository';

export const dynamic = 'force-dynamic';

const stages = [
  { key: 'received', label: '受付済み', description: '相談が届いています。' },
  { key: 'reviewing', label: '確認中', description: '避難所スタッフが状況を確認しています。' },
  { key: 'in_progress', label: '対応中', description: '必要な対応を進めています。' },
  { key: 'awaiting_info', label: '追加情報を確認中', description: '対応に必要な情報を確認しています。' },
  { key: 'resolved', label: '解決済み', description: '対応が完了しました。' },
] as const;

function timelineIndex(status: string): number {
  if (status === 'resolved') return 4;
  if (status === 'awaiting_info') return 3;
  if (status === 'in_progress') return 2;
  if (status === 'reviewing') return 1;
  return 0;
}

export default async function QuestionStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const question = await getQuestionByCheckToken(token);
  if (!question) return <main className="public-page evac-theme"><header className="site-header"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">相</span>相談窓口</Link><Link href="/">ホームへ戻る</Link></header><section className="status-card"><h1>確認用URLが見つかりません</h1><p>URLを確認して、もう一度開いてください。</p><Link className="button primary" href="/">ホームへ戻る</Link></section></main>;
  const currentIndex = timelineIndex(question.workflowStatus);
  const publicUpdates = question.updates.filter((update) => update.isPublic && update.message);
  const answered = question.workflowStatus === 'resolved' && question.answerBody;
  return <main className="public-page status-page evac-theme"><header className="site-header"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">相</span>相談窓口</Link><Link href="/">ホームへ戻る</Link></header><section className="status-card"><p className="eyebrow">相談状況</p><div className="status-card-heading"><div><h1>相談を受け付けました</h1><p>相談ID <strong>#{String(question.id).padStart(4, '0')}</strong></p></div><span className={`status-badge ${question.urgentReview ? 'urgent' : ''}`}>{question.urgentReview ? '要緊急確認' : stages[currentIndex].label}</span></div><div className="timeline" aria-label="相談の対応状況">{stages.map((stage, index) => <div className={`timeline-item ${index <= currentIndex ? 'done' : ''} ${index === currentIndex ? 'current' : ''}`} key={stage.key}><span className="timeline-dot" aria-hidden="true">{index <= currentIndex ? '●' : '○'}</span><div><strong>{stage.label}</strong><p>{index === currentIndex ? publicUpdates.at(-1)?.message || stage.description : index < currentIndex ? '対応状況が更新されました。' : stage.description}</p></div></div>)}</div>{publicUpdates.length > 0 && <section className="public-updates"><h2>避難所からのお知らせ</h2>{publicUpdates.map((update) => <div className="public-update" key={update.id}><time>{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(update.createdAt))}</time><p>{update.message}</p></div>)}</section>}{answered && <section className="answer-history public-answer"><h2>確認済みの返信</h2><p>{question.answerBody}</p></section>}<details className="status-original"><summary>自分が伝えた内容を見る</summary><p>{question.bodyOriginal}</p></details><p className="input-hint">この確認ページは、確認URLを知っている人だけが開けます。URLを他の人に共有しないでください。</p><Link className="button secondary" href="/">新しく相談する</Link></section></main>;
}
