import { getQuestionByCheckToken } from '../../../db/repository';
import { QuestionStatusMissing, QuestionStatusView } from '../../components/question-status-page';

export const dynamic = 'force-dynamic';

export default async function QuestionStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const question = await getQuestionByCheckToken(token);
  if (!question) return <QuestionStatusMissing />;
  return <QuestionStatusView question={question} />;
}
