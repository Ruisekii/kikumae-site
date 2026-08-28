import Link from 'next/link';
import { getQuestionByCheckToken } from '../../../db/repository';

export const dynamic = 'force-dynamic';

export default async function QuestionStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const question = await getQuestionByCheckToken(token);
  if (!question) return <main className="public-page"><section className="portal-complete"><h1>確認用URLが見つかりません</h1><p>URLを確認して、もう一度開いてください。</p><Link className="button primary" href="/">トップへ戻る</Link></section></main>;
  const answered = question.status === 'answered' && question.answerBody;
  return <main className="public-page"><section className="portal-complete"><p className="eyebrow">質問の確認</p><h1>{answered ? '回答が届いています' : '回答をお待ちください'}</h1><p>{answered ? '回答者が確認した内容です。' : '質問は受け付け済みです。回答者が確認しています。'}</p><div className="original-card"><h2>質問の原文</h2><p>{question.bodyOriginal}</p></div>{answered && <div className="answer-history"><h2>回答</h2><p>{question.answerBody}</p></div>}<p className="input-hint">このページは確認用URLを知っている人だけが開けます。URLを他の人に共有しないでください。</p><Link className="button primary" href="/">トップへ戻る</Link></section></main>;
}
