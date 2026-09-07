'use client';

import Link from 'next/link';
import { translatedStatusMessageKey, UserHeader, useUserI18n } from '../user-i18n';
import { StatusLiveRefresh } from './status-live-refresh';

export type PublicQuestion = {
  id: number;
  workflowStatus: string;
  urgentReview: boolean;
  similarCount: number;
  assigneeName: string;
  firstConfirmedAt: number | null;
  bodyOriginal: string;
  answerBody: string | null;
  updates: Array<{ id: number; status: string; createdAt: number; isPublic: boolean; message: string | null }>;
};

const stages = [
  { key: 'received', label: 'status.received', description: 'statusPage.stageReceived' },
  { key: 'reviewing', label: 'status.reviewing', description: 'statusPage.stageReviewing' },
  { key: 'field_checking', label: 'status.fieldChecking', description: 'statusPage.stageField' },
  { key: 'in_progress', label: 'status.inProgress', description: 'statusPage.stageInProgress' },
  { key: 'resolved', label: 'status.resolved', description: 'statusPage.stageResolved' },
] as const;

function timelineIndex(status: string): number {
  if (status === 'resolved' || status === 'cannot_resolve') return 4;
  if (status === 'in_progress' || status === 'awaiting_info') return 3;
  if (status === 'field_checking') return 2;
  if (status === 'reviewing' || status === 'assigned' || status === 'waiting') return 1;
  return 0;
}

function formatStatusTime(value: Date, language: 'ja' | 'en' | 'zh' | 'ko', options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Tokyo', ...options }).format(value);
}

export function QuestionStatusMissing() {
  const { t } = useUserI18n();
  return <main className="evac-theme public-page status-page"><UserHeader brand="◌ イセキ避難所" brandHref="/" faqHref="/#reception-faq" statusHref="/questions" /><section className="status-card"><h1>{t('statusPage.missingTitle')}</h1><p>{t('statusPage.missingLead')}</p><Link className="button primary" href="/">{t('statusPage.back')}</Link></section></main>;
}

export function QuestionStatusView({ question }: { question: PublicQuestion }) {
  const { t, language } = useUserI18n();
  const currentIndex = timelineIndex(question.workflowStatus);
  const publicUpdates = question.updates.filter((update) => update.isPublic && update.message);
  const stageTimes = new Map(question.updates.filter((update) => update.isPublic).map((update) => [update.status, update.createdAt]));
  const currentStatusLabel = question.workflowStatus === 'waiting' ? t('statusPage.waitingLabel') : question.workflowStatus === 'cannot_resolve' ? t('statusPage.cannotResolve') : t(stages[currentIndex].label);
  const displayPublicMessage = (message: string | null) => {
    if (!message) return '';
    const key = translatedStatusMessageKey(message);
    return key ? t(key) : message;
  };
  return <main className="evac-theme public-page status-page">
    <UserHeader brand="◌ イセキ避難所" brandHref="/" faqHref="/#reception-faq" statusHref="/questions" />
    <section className="status-card"><p className="eyebrow">{t('statusPage.eyebrow')}</p><div className="status-card-heading"><div><h1>{t('statusPage.title')}</h1><p>{t('statusPage.id')} <strong>#{String(question.id).padStart(4, '0')}</strong></p></div><span className={`status-badge ${question.urgentReview ? 'urgent' : ''}`}>{question.urgentReview ? t('statusPage.urgent') : currentStatusLabel}</span></div>
      <StatusLiveRefresh />
      {question.similarCount > 0 && <p className="group-notice">{t('statusPage.similar', { count: question.similarCount })}</p>}
      {question.assigneeName && <section className="status-assignee" aria-label={t('statusPage.assigneeAria')}><div className="status-assignee-mark" aria-hidden="true">担当</div><div className="status-assignee-copy"><span>{t('statusPage.assigneeLabel')}</span><strong>{question.assigneeName}</strong>{question.firstConfirmedAt && <time dateTime={new Date(question.firstConfirmedAt).toISOString()}>{t('statusPage.assigneeAt', { time: formatStatusTime(new Date(question.firstConfirmedAt), language, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })}</time>}</div></section>}
      <div className="timeline" aria-label={t('reception.statusAria')}>{stages.map((stage, index) => <div className={`timeline-item ${index <= currentIndex ? 'done' : ''} ${index === currentIndex ? 'current' : ''}`} key={stage.key}><span className="timeline-dot" aria-hidden="true">{index <= currentIndex ? '●' : '○'}</span><div><div className="timeline-heading"><strong>{t(stage.label)}</strong>{stageTimes.has(stage.key) && <time dateTime={new Date(stageTimes.get(stage.key)!).toISOString()}>{formatStatusTime(new Date(stageTimes.get(stage.key)!), language, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>}</div><p>{index === currentIndex ? displayPublicMessage(publicUpdates.at(-1)?.message ?? null) || (question.workflowStatus === 'waiting' ? t('statusPage.waiting') : t(stage.description)) : index < currentIndex ? t('statusPage.updated') : t(stage.description)}</p></div></div>)}</div>
      {publicUpdates.length > 0 && <section className="public-updates"><h2>{t('statusPage.updates')}</h2>{publicUpdates.map((update) => <div className="public-update" key={update.id}><time>{formatStatusTime(new Date(update.createdAt), language, { dateStyle: 'medium', timeStyle: 'short' })}</time><p>{displayPublicMessage(update.message)}</p></div>)}</section>}
      {question.answerBody && <section className="answer-history public-answer"><h2>{t('statusPage.answer')}</h2><p>{question.answerBody}</p></section>}
      <details className="status-original"><summary>{t('statusPage.original')}</summary><p>{question.bodyOriginal}</p></details>
      <p className="input-hint">{t('statusPage.privacy')}</p><Link className="button secondary" href="/">{t('statusPage.back')}</Link>
    </section>
  </main>;
}
