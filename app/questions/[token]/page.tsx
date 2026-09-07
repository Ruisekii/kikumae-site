import Link from 'next/link';
import { getQuestionByCheckToken } from '../../../db/repository';
import { StatusLiveRefresh } from '../../components/status-live-refresh';

export const dynamic = 'force-dynamic';

const stages = [
  { key: 'received', label: '受付済み', description: '相談が届いています。' },
  { key: 'reviewing', label: '確認中', description: '避難所スタッフが状況を確認しています。' },
  { key: 'field_checking', label: '現場確認中', description: '避難所スタッフが現場の状況を確認しています。' },
  { key: 'in_progress', label: '対応中', description: '必要な対応を進めています。' },
  { key: 'resolved', label: '解決済み', description: '対応が完了しました。' },
] as const;

function timelineIndex(status: string): number {
  if (status === 'resolved') return 4;
  if (status === 'in_progress' || status === 'awaiting_info') return 3;
  if (status === 'field_checking') return 2;
  if (status === 'reviewing' || status === 'assigned' || status === 'waiting') return 1;
  return 0;
}

function currentStatusLabel(status: string, index: number): string {
  if (status === 'waiting') return '追加情報を確認中';
  if (status === 'cannot_resolve') return '対応状況を記録済み';
  return stages[index].label;
}

export default async function QuestionStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const question = await getQuestionByCheckToken(token);
  if (!question) return <main className="evac-theme public-page"><section className="status-card"><h1>確認用URLが見つかりません</h1><p>URLを確認して、もう一度開いてください。</p><Link className="button primary" href="/">困りごとを選ぶ</Link></section></main>;
  const currentIndex = timelineIndex(question.workflowStatus);
  const publicUpdates = question.updates.filter((update) => update.isPublic && update.message);
  const stageTimes = new Map(question.updates.filter((update) => update.isPublic).map((update) => [update.status, update.createdAt]));
  const answered = question.workflowStatus === 'resolved' && question.answerBody;
  return <main className="evac-theme public-page status-page"><header className="site-header status-site-header"><Link className="brand" href="/">◌ 避難所の受付</Link><nav aria-label="利用者メニュー"><Link href="/">困りごと</Link><Link href="/#reception-faq">よくある質問</Link><Link href="/questions">相談状況</Link></nav></header><section className="status-card"><p className="eyebrow">相談状況</p><div className="status-card-heading"><div><h1>相談を受け付けました</h1><p>相談ID <strong>#{String(question.id).padStart(4, '0')}</strong></p></div><span className={`status-badge ${question.urgentReview ? 'urgent' : ''}`}>{question.urgentReview ? '要緊急確認' : currentStatusLabel(question.workflowStatus, currentIndex)}</span></div><StatusLiveRefresh />{question.similarCount > 0 && <p className="group-notice">同じ内容の相談が、ほかに {question.similarCount}件 寄せられています。対応状況はまとめて更新されます。</p>}<div className="timeline" aria-label="相談の対応状況">{stages.map((stage, index) => <div className={`timeline-item ${index <= currentIndex ? 'done' : ''} ${index === currentIndex ? 'current' : ''}`} key={stage.key}><span className="timeline-dot" aria-hidden="true">{index <= currentIndex ? '●' : '○'}</span><div><div className="timeline-heading"><strong>{stage.label}</strong>{stageTimes.has(stage.key) && <time dateTime={new Date(stageTimes.get(stage.key)!).toISOString()}>{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(stageTimes.get(stage.key)!))}</time>}</div><p>{index === currentIndex ? publicUpdates.at(-1)?.message || (question.workflowStatus === 'waiting' ? '対応に必要な情報を確認しています。' : stage.description) : index < currentIndex ? '対応状況が更新されました。' : stage.description}</p></div></div>)}</div>{publicUpdates.length > 0 && <section className="public-updates"><h2>避難所からのお知らせ</h2>{publicUpdates.map((update) => <div className="public-update" key={update.id}><time>{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(update.createdAt))}</time><p>{update.message}</p></div>)}</section>}{answered && <section className="answer-history public-answer"><h2>確認済みの返信</h2><p>{question.answerBody}</p></section>}<details className="status-original"><summary>自分が伝えた内容を見る</summary><p>{question.bodyOriginal}</p></details><p className="input-hint">この確認ページは、確認URLを知っている人だけが開けます。URLを他の人に共有しないでください。</p><Link className="button secondary" href="/">困りごとを選ぶ</Link></section></main>;
}
