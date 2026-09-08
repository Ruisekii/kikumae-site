'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Faq, RelatedFaq } from '../../db/repository';
import { generateShelterAnalysis, searchFaqs, shelterFollowUp } from '../../db/local-ai';
import { LocationSelector } from './shelter-map';
import { appendConsultHistory } from './consult-history';
import { ShelterHomeBoard } from './shelter-home-board';
import { VoiceConsultation } from './voice-consultation';
import { UserHeader, translatedCategoryKey, translatedChoiceKey, translatedDetailKey, translatedShelterCategoryKey, translatedZoneKey, translateUserFaq, useUserI18n } from '../user-i18n';

type Intake = { location: string; issueLocation: string; reporterLocation: string; peopleCount: string; resourceRemaining: string; lastReceivedAt: string; additionalDetails: string };
type Analysis = { title: string; overview: string; facts: string[]; emotion: string; missingInformation: string[]; urgencyCandidate: string; urgentReview: boolean; category: string; location: string; issueLocation: string; peopleCount: string; resourceRemaining: string; lastReceivedAt: string };
type Preview = { body: string; summary: string; category: string; related: RelatedFaq[]; analysis: Analysis; followUp: { question: string; options: string[] } | null; submissionKey: string };
type ChatMessage = { from: 'ai' | 'person'; text: string };
type SupplementKey = 'location' | 'peopleCount' | 'resourceRemaining' | 'lastReceivedAt' | 'additionalDetails';
type SupplementField = { key: SupplementKey; label: string; kind: 'choice' | 'select' | 'location' | 'stepper'; options?: string[]; help?: string };
type IntakeStep = 'category' | 'detail' | 'faq' | 'location' | 'people' | 'supplement' | 'confirm' | 'freeText';
type SavedDraft = { savedAt?: number; input?: string; originalBody?: string; contextBody?: string; intake?: Intake; chatOpen?: boolean; intakeOpen?: boolean; intakeStep?: IntakeStep; selectedCategoryId?: string; selectedDetail?: string; selectedLocation?: string; selectedPeople?: string; intakeNote?: string; messages?: ChatMessage[]; preview?: Preview | null; faqDecision?: boolean; readyToSubmit?: boolean; showSupplementSheet?: boolean };
type Props = { faqs: Faq[] };

type IntakeCategory = {
  id: string;
  icon: string;
  label: string;
  details: string[];
  needsLocationFor?: string[];
  needsPeople?: boolean;
};

const INTAKE_CATEGORIES: IntakeCategory[] = [
  { id: 'supplies', icon: '', label: '食べ物・飲み物', details: ['水が足りない', '食事が足りない', 'アレルギー・乳幼児向け', '配布場所を知りたい', 'その他'], needsLocationFor: ['水が足りない', '配布場所を知りたい'], needsPeople: true },
  { id: 'health', icon: '', label: '体調・けが', details: ['具合が悪い', 'けがをした', '薬が必要', '医療の相談をしたい', 'その他'], needsLocationFor: ['具合が悪い', 'けがをした', '薬が必要', '医療の相談をしたい'], needsPeople: true },
  { id: 'toilet', icon: '', label: 'トイレ・衛生', details: ['トイレが混んでいる', 'トイレが汚れている', '水が流れない', '紙や手洗い用品がない', 'その他'], needsLocationFor: ['トイレが混んでいる', 'トイレが汚れている', '水が流れない', '紙や手洗い用品がない'] },
  { id: 'comfort', icon: '', label: '寝る場所・暑さ寒さ', details: ['寒い', '暑い', '寝具がない', '場所が狭い', '明るさ・騒音が気になる'], needsLocationFor: ['寒い', '暑い', '寝具がない', '場所が狭い', '明るさ・騒音が気になる'], needsPeople: true },
  { id: 'care', icon: '', label: '子ども・高齢者・配慮', details: ['子どものことで相談', '高齢者のことで相談', '障害や配慮が必要', 'その他'], needsLocationFor: ['子どものことで相談', '高齢者のことで相談', '障害や配慮が必要'], needsPeople: true },
  { id: 'family', icon: '', label: '家族・安否', details: ['家族と連絡が取れない', '家族の居場所を知りたい', '安否を確認したい', 'その他'] },
  { id: 'facility', icon: '', label: '避難所の設備・情報', details: ['充電したい', '電気・照明について', '入口や通路について', 'その他'], needsLocationFor: ['充電したい', '電気・照明について', '入口や通路について'] },
  { id: 'information', icon: '', label: '騒音・人間関係', details: ['周りの音が気になる', '落ち着いて過ごせる場所を知りたい', '人との距離や関わり方を相談したい', 'その他'] },
  { id: 'other', icon: '', label: 'その他・うまく言えない', details: ['うまく説明できない', '相談したいことがある'], needsPeople: true }
];

const emptyIntake: Intake = { location: '', issueLocation: '', reporterLocation: '', peopleCount: '', resourceRemaining: '', lastReceivedAt: '', additionalDetails: '' };
const normalize = (value: string) => value.toLocaleLowerCase('ja-JP').replace(/\s/g, '');
const isUrgentAnalysis = (analysis: Analysis) => analysis.urgentReview || analysis.urgencyCandidate === '高';
const formatFaqUpdatedAt = (value: number, language: 'ja' | 'en' | 'zh' | 'ko' = 'ja') => new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function buildInstantPreview(body: string, intake: Intake, faqs: Faq[], submissionKey: string): Preview {
  const analysis = generateShelterAnalysis(body, intake);
  const ranked = searchFaqs(body, faqs, 6);
  const categoryFaqs = faqs.filter((faq) => faq.category === analysis.category).map((faq) => {
    const existing = ranked.find((item) => item.id === faq.id);
    return existing ?? { ...faq, score: 0.65 };
  });
  const related = [...categoryFaqs, ...ranked.filter((faq) => faq.category !== analysis.category)].slice(0, 3);
  return { body, summary: analysis.overview, category: analysis.category, related, analysis, followUp: analysis.missingInformation[0] ? shelterFollowUp(analysis.missingInformation[0], analysis.category) : null, submissionKey };
}

function supplementFields(analysis: Analysis, body: string, intake: Intake): SupplementField[] {
  const missing = new Set(analysis.missingInformation);
  const fields: SupplementField[] = [];
  if (missing.has('場所') && !intake.location) fields.push({ key: 'location', label: 'どこで困っていますか？', kind: 'location', help: 'MAPで選びにくい場合は、一覧から選べます。分からなければ「場所を指定しない」ままでも進めます。' });
  if (missing.has('人数') && !intake.peopleCount) fields.push({ key: 'peopleCount', label: '対象になる人数', kind: 'choice', options: ['1人', '2〜5人', '6〜10人', '11人以上', 'わからない'] });
  if (missing.has('残量') && !intake.resourceRemaining) {
    const isBlanket = /毛布|枚/.test(body);
    fields.push(isBlanket ? { key: 'resourceRemaining', label: '必要な毛布の枚数', kind: 'stepper', help: 'おおよその枚数で大丈夫です。' } : { key: 'resourceRemaining', label: '残り・不足の状況', kind: 'choice', options: ['ほとんどない', '少しある', 'まだある', 'わからない'] });
  }
  if (missing.has('最後に受け取った時刻') && !intake.lastReceivedAt) fields.push({ key: 'lastReceivedAt', label: 'いつから／いつ必要ですか', kind: 'choice', options: ['今すぐ', '数時間以内', '今日中', '急がない', 'わからない'] });
  if (analysis.category === 'トイレ・衛生' && /トイレ|便所/.test(body) && !intake.additionalDetails) fields.push({ key: 'additionalDetails', label: 'そのトイレは今使えますか', kind: 'choice', options: ['使える', '使えない', 'わからない'] });
  if (analysis.category === '医療・薬' && /熱|薬|痛|体調|具合/.test(body) && !intake.additionalDetails) fields.push({ key: 'additionalDetails', label: 'いちばん近い状況を教えてください', kind: 'choice', options: ['意識はある', '呼吸が苦しい', '痛みがある', '薬が必要', 'わからない'] });
  return fields;
}

type ReceptionFlowProps = {
  faqs: Faq[];
  intakeStep: IntakeStep;
  selectedCategory: IntakeCategory | null;
  selectedDetail: string;
  selectedLocation: string;
  selectedPeople: string;
  intakeNote: string;
  intake: Intake;
  preview: Preview | null;
  faqDecision: boolean;
  readyToSubmit: boolean;
  supplementValues: Partial<Record<SupplementKey, string>>;
  input: string;
  status: string;
  busy: boolean;
  checkUrl: string;
  questionId: number | null;
  emergencyOpen: boolean;
  voiceOpen: boolean;
  onChooseCategory: (category: IntakeCategory) => void;
  onChooseDetail: (detail: string) => void;
  onChooseLocation: (location: string) => void;
  onChoosePeople: (people: string) => void;
  onSetIntakeStep: (step: IntakeStep) => void;
  onSetIntakeNote: (value: string) => void;
  onSetInput: (value: string) => void;
  onSetSupplementValue: (key: SupplementKey, value: string) => void;
  onChangeQuantity: (delta: number) => void;
  onFaqResult: (resolved: boolean) => void;
  onConfirmSupplements: () => void;
  onSubmit: () => void;
  onSubmitFreeText: () => void;
  onStartOver: () => void;
  onCopyUrl: () => void;
  onOpenEmergency: () => void;
  onCloseEmergency: () => void;
  onSubmitEmergency: () => void;
  onOpenVoice: () => void;
  onUseText: () => void;
  onDirectStaff: () => void;
};

function ConsultCancelAction({ onStartOver }: { onStartOver: () => void }) {
  const { t } = useUserI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  return <>
    <div className="reception-cancel-area">
      <button className="reception-cancel-trigger" type="button" onClick={() => setDialogOpen(true)}>{t('reception.cancelTrigger')}</button>
    </div>
    {dialogOpen && <div className="reception-cancel-backdrop" role="presentation"><section className="reception-cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="reception-cancel-title"><p className="eyebrow">{t('reception.cancelEyebrow')}</p><h2 id="reception-cancel-title">{t('reception.cancelTitle')}</h2><p>{t('reception.cancelLead')}</p><div className="reception-cancel-actions"><button className="button secondary" type="button" onClick={() => setDialogOpen(false)}>{t('reception.continue')}</button><button className="button danger reception-cancel-confirm" type="button" onClick={onStartOver}>{t('reception.backToStart')}</button></div></section></div>}
  </>;
}

function ReceptionFlow({ faqs, intakeStep, selectedCategory, selectedDetail, selectedLocation, selectedPeople, intakeNote, intake, preview, faqDecision, readyToSubmit, supplementValues, input, status, busy, checkUrl, questionId, emergencyOpen, voiceOpen, onChooseCategory, onChooseDetail, onChooseLocation, onChoosePeople, onSetIntakeStep, onSetIntakeNote, onSetInput, onSetSupplementValue, onChangeQuantity, onFaqResult, onConfirmSupplements, onSubmit, onSubmitFreeText, onStartOver, onCopyUrl, onOpenEmergency, onCloseEmergency, onSubmitEmergency, onOpenVoice, onUseText, onDirectStaff }: ReceptionFlowProps) {
  const { t, language } = useUserI18n();
  const fields = preview ? supplementFields(preview.analysis, preview.body, intake) : [];
  const locationValue = intake.location || selectedLocation;
  const locationLabel = locationValue ? (translatedZoneKey(locationValue) ? t(translatedZoneKey(locationValue)!) : locationValue) : t('reception.unspecified');
  const peopleValue = intake.peopleCount || selectedPeople;
  const peopleLabel = peopleValue ? (translatedChoiceKey(peopleValue) ? t(translatedChoiceKey(peopleValue)!) : peopleValue) : t('reception.unspecified');
  const previewCategoryLabel = preview ? (translatedShelterCategoryKey(preview.category) ? t(translatedShelterCategoryKey(preview.category)!) : preview.category) : t('reception.unspecified');
  const stageIndex = checkUrl ? 1 : 0;
  const stages = ['status.received', 'status.reviewing', 'status.fieldChecking', 'status.inProgress', 'status.resolved'];
  const detailProgress = intakeStep === 'category' || intakeStep === 'freeText' ? '' : intakeStep === 'confirm' ? 'done' : 'current';
  return <main className="evac-theme reception-app">
    <UserHeader brand="◌ イセキ避難所" brandHref="/#reception-top" faqHref="#reception-faq" brandAria={t('reception.brandAria')} />
    <section className="reception-shell" id="reception-top">
      {!checkUrl && <button className="reception-emergency-link" type="button" onClick={onOpenEmergency}><span aria-hidden="true">🚨</span> {t('reception.emergency')}</button>}
      {!checkUrl && !emergencyOpen && <div className="reception-progress" aria-label={t('reception.progressAria')}><span className={intakeStep === 'category' ? 'current' : 'done'}>{t('reception.progressIssues')}</span><i>→</i><span className={detailProgress}>{t('reception.progressDetail')}</span><i>→</i><span className={intakeStep === 'confirm' ? 'current' : ''}>{t('reception.progressConfirm')}</span>{intakeStep !== 'category' && <small>{t('reception.progressAlmost')}</small>}</div>}
      {emergencyOpen && !checkUrl ? <section className="reception-step reception-emergency-panel" aria-labelledby="emergency-title"><button className="reception-back" type="button" onClick={onCloseEmergency}>← {t('reception.emergencyBack')}</button><p className="eyebrow">{t('reception.emergencyEyebrow')}</p><h1 id="emergency-title">{t('reception.emergencyTitle')}</h1><div className="emergency-instruction"><strong>{t('reception.emergencyCondition')}</strong><p>{t('reception.emergencyInstruction')}</p></div><button className="button emergency-primary" type="button" disabled={busy} onClick={onSubmitEmergency}>{busy ? t('reception.emergencySending') : t('reception.emergencySend')}</button><p className="emergency-note">{t('reception.emergencyNote')}</p></section> : <>
      {intakeStep === 'category' && !checkUrl && <>{voiceOpen ? <VoiceConsultation initialIntake={intake} onClose={onUseText} onUseText={onUseText} onDirectStaff={onDirectStaff} /> : <><section className="reception-step reception-category-step" aria-labelledby="reception-title"><p className="eyebrow">{t('reception.eyebrow')}</p><h1 id="reception-title">{t('reception.title')}</h1><p className="reception-lead">{t('reception.lead')}</p><button className="voice-entry-card" type="button" onClick={onOpenVoice}><span className="voice-entry-icon" aria-hidden="true">🎙</span><span><strong>{t('voice.title')}</strong><small>{t('voice.lead')}</small></span><b aria-hidden="true">›</b></button><div className="reception-category-grid">{INTAKE_CATEGORIES.map((category, index) => { const label = t(translatedCategoryKey(category.id)); return <button className="reception-category-card" type="button" key={category.id} onClick={() => onChooseCategory(category)}><span className={`reception-category-art art-${index + 1}`} role="img" aria-label={t('reception.artAria', { label })} /><strong>{label}</strong><span className="reception-card-arrow" aria-hidden="true">›</span></button>; })}</div><div className="reception-secondary-actions"><button type="button" onClick={() => onSetIntakeStep('freeText')}>{t('reception.freeTextTitle')}</button><button type="button" onClick={() => onSetIntakeStep('freeText')}>{t('reception.freeTextChoice')}</button></div></section><ShelterHomeBoard /></>}</>}
      {intakeStep === 'detail' && selectedCategory && !checkUrl && <section className="reception-step" aria-labelledby="detail-title"><button className="reception-back" type="button" onClick={() => onSetIntakeStep('category')}>← {t('reception.detailBack')}</button><p className="eyebrow">{t(translatedCategoryKey(selectedCategory.id))}</p><h1 id="detail-title">{t('reception.detailTitle')}</h1><p className="reception-lead">{t('reception.detailLead')}</p><div className="reception-choice-list">{selectedCategory.details.map((detail) => <button type="button" key={detail} onClick={() => onChooseDetail(detail)}>{translatedDetailKey(selectedCategory.id, detail) ? t(translatedDetailKey(selectedCategory.id, detail)!) : detail}<span>›</span></button>)}</div></section>}
      {intakeStep === 'faq' && !checkUrl && <section className="reception-step" aria-labelledby="faq-step-title"><p className="eyebrow">{t('reception.faqEyebrow')}</p><h1 id="faq-step-title">{t('reception.faqTitle')}</h1>{preview?.related.length && !faqDecision ? <div className="reception-faq-card"><p className="reception-faq-label">{t('reception.faqFound')}</p>{preview.related.slice(0, 2).map((faq) => { const translatedFaq = translateUserFaq(faq, language); return <article key={faq.id}><h2>{translatedFaq.question}</h2><p>{translatedFaq.answer}</p></article>; })}<div className="reception-faq-actions"><button className="button secondary" type="button" onClick={() => onFaqResult(true)}>{t('reception.faqSolved')}</button><button className="button accent" type="button" onClick={() => onFaqResult(false)}>{t('reception.faqStill')}</button></div></div> : faqDecision && !preview ? <div className="reception-resolved"><span aria-hidden="true">✓</span><h2>{t('reception.faqResolved')}</h2><p>{t('reception.faqNoSend')}</p><button className="button secondary" type="button" onClick={onStartOver}>{t('reception.faqOther')}</button></div> : <div className="reception-no-faq"><h2>{t('reception.forwardTitle')}</h2><p>{busy ? t('reception.forwardBusy') : t('reception.forwardLead')}</p>{!busy && <button className="button accent" type="button" onClick={() => onSetIntakeStep(fields.length ? 'supplement' : 'confirm')}>{t('reception.next')}</button>}</div>}</section>}
      {intakeStep === 'supplement' && preview && !checkUrl && <section className="reception-step" aria-labelledby="supplement-title"><p className="eyebrow">{t('reception.supplementEyebrow')}</p><h1 id="supplement-title">{t('reception.supplementTitle')}</h1><p className="reception-lead">{t('reception.supplementLead')}</p><div className="reception-supplement-list">{fields.map((field) => <div className="reception-field" key={field.key}><label>{t(field.key === 'location' ? 'field.locationLabel' : field.key === 'peopleCount' ? 'field.peopleLabel' : field.key === 'resourceRemaining' ? (/毛布|枚/.test(preview.body) ? 'field.resourceBlanketLabel' : 'field.resourceLabel') : field.key === 'lastReceivedAt' ? 'field.lastReceivedLabel' : 'field.additionalLabel')}</label>{field.kind === 'location' && <LocationSelector value={supplementValues.location ?? ''} onChange={(zoneId) => onSetSupplementValue('location', zoneId)} />}{field.kind === 'select' && <select value={supplementValues[field.key] ?? ''} onChange={(event) => onSetSupplementValue(field.key, event.target.value)}><option value="">{t('reception.selectPrompt')}</option>{field.options?.map((option) => <option key={option}>{translatedChoiceKey(option) ? t(translatedChoiceKey(option)!) : option}</option>)}</select>}{field.kind === 'choice' && <div className="reception-choice-grid">{field.options?.map((option) => <button className={supplementValues[field.key] === option ? 'selected' : ''} type="button" key={option} onClick={() => onSetSupplementValue(field.key, option)} aria-pressed={supplementValues[field.key] === option}>{translatedChoiceKey(option) ? t(translatedChoiceKey(option)!) : option}</button>)}</div>}{field.kind === 'stepper' && <div className="reception-stepper"><button type="button" onClick={() => onChangeQuantity(-1)} aria-label={t('reception.quantityDecrease')}>−</button><strong>{supplementValues[field.key] ?? '1'}{language === 'ja' ? '枚' : ''}</strong><button type="button" onClick={() => onChangeQuantity(1)} aria-label={t('reception.quantityIncrease')}>＋</button></div>}{field.help && <p>{field.key === 'location' ? t('field.locationHelp') : field.key === 'resourceRemaining' ? t('field.resourceBlanketHelp') : field.help}</p>}</div>)}</div><button className="button accent reception-next" type="button" onClick={onConfirmSupplements}>{t('reception.supplementNext')}</button></section>}
      {intakeStep === 'freeText' && !checkUrl && <section className="reception-step" aria-labelledby="free-text-title"><button className="reception-back" type="button" onClick={() => onSetIntakeStep('category')}>← {t('reception.freeTextBack')}</button><p className="eyebrow">{t('reception.freeTextEyebrow')}</p><h1 id="free-text-title">{t('reception.freeTextTitle')}</h1><p className="reception-lead">{t('reception.freeTextLead')}</p><textarea className="reception-free-text" value={input} onChange={(event) => onSetInput(event.target.value)} placeholder={t('reception.freeTextPlaceholder')} maxLength={500} autoFocus /><button className="button accent reception-next" type="button" disabled={!input.trim() || busy} onClick={onSubmitFreeText}>{busy ? t('reception.forwardBusy') : t('reception.freeTextCheck')}</button></section>}
      {intakeStep === 'confirm' && preview && !checkUrl && <section className="reception-step" aria-labelledby="confirm-title"><p className="eyebrow">{t('reception.confirmEyebrow')}</p><h1 id="confirm-title">{t('reception.confirmTitle')}</h1><dl className="reception-summary"><div><dt>{t('reception.summaryCategory')}</dt><dd>{selectedCategory ? t(translatedCategoryKey(selectedCategory.id)) : previewCategoryLabel}</dd></div><div><dt>{t('reception.summaryIssue')}</dt><dd>{selectedDetail && selectedCategory ? (translatedDetailKey(selectedCategory.id, selectedDetail) ? t(translatedDetailKey(selectedCategory.id, selectedDetail)!) : selectedDetail) : preview.analysis.title}</dd></div><div><dt>{t('reception.summaryLocation')}</dt><dd>{locationLabel}</dd></div><div><dt>{t('reception.summaryPeople')}</dt><dd>{peopleLabel}</dd></div><div><dt>{t('reception.summaryNote')}</dt><dd>{intakeNote || t('reception.none')}</dd></div></dl><label className="reception-note-label">{t('reception.noteLabel')}<textarea value={intakeNote} onChange={(event) => onSetIntakeNote(event.target.value)} placeholder={t('reception.notePlaceholder')} maxLength={500} /></label><div className="reception-confirm-actions"><button className="button secondary" type="button" onClick={() => onSetIntakeStep('detail')}>{t('reception.edit')}</button><button className="button accent" type="button" disabled={busy || !readyToSubmit} onClick={onSubmit}>{busy ? t('reception.sending') : t('reception.send')}</button></div></section>}
      </>}
      {checkUrl && <section className="reception-step reception-complete" aria-labelledby="complete-title"><p className="eyebrow">{t('reception.completeEyebrow')}</p><h1 id="complete-title">{t('reception.completeTitle')}</h1><p>{t('reception.completeLead')}</p>{questionId != null && <p className="reception-id">{t('reception.receiptNumber')} <strong>#{String(questionId).padStart(4, '0')}</strong></p>}<ol className="reception-status-timeline" aria-label={t('reception.statusAria')}>{stages.map((stage, index) => <li className={`${index <= stageIndex ? 'done' : ''} ${index === stageIndex ? 'current' : ''}`} key={stage}><span aria-hidden="true">{index <= stageIndex ? '✓' : '○'}</span><strong>{t(stage)}</strong></li>)}</ol><div className="reception-url-box"><input id="check-url-text" readOnly value={checkUrl} onFocus={(event) => event.currentTarget.select()} aria-label={t('reception.urlAria')} /><button className="button secondary" type="button" onClick={onCopyUrl}>{t('reception.copyUrl')}</button></div><Link className="button accent reception-next" href={checkUrl}>{t('reception.viewStatus')}</Link><button className="reception-text-button" type="button" onClick={onStartOver}>{t('reception.newConsult')}</button></section>}
      {!checkUrl && !emergencyOpen && !busy && intakeStep !== 'category' && <ConsultCancelAction onStartOver={onStartOver} />}
    </section>
    <section className="reception-faq-section" id="reception-faq" aria-labelledby="reception-faq-title"><p className="eyebrow">{t('reception.faqSectionEyebrow')}</p><h2 id="reception-faq-title">{t('reception.faqSectionTitle')}</h2><p>{t('reception.faqSectionLead')}</p>{faqs.slice(0, 6).map((faq) => { const translatedFaq = translateUserFaq(faq, language); return <details key={faq.id}><summary>{translatedFaq.question}</summary><p className="reception-faq-updated"><time dateTime={new Date(faq.updatedAt).toISOString()}>{t('reception.faqUpdated', { date: formatFaqUpdatedAt(faq.updatedAt, language) })}</time></p><p>{translatedFaq.answer}</p></details>; })}</section>
    {status && !checkUrl && <p className="reception-status" role="status">{status}</p>}
  </main>;
}

export function KikumaeClient({ faqs }: Props) {
  const { t } = useUserI18n();
  const [query, setQuery] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(true);
  const [intakeStep, setIntakeStep] = useState<IntakeStep>('category');
  const [selectedCategory, setSelectedCategory] = useState<IntakeCategory | null>(null);
  const [selectedDetail, setSelectedDetail] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedPeople, setSelectedPeople] = useState('');
  const [intakeNote, setIntakeNote] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [originalBody, setOriginalBody] = useState('');
  const [contextBody, setContextBody] = useState('');
  const [intake, setIntake] = useState<Intake>(emptyIntake);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [faqDecision, setFaqDecision] = useState(false);
  const [showFaqCard, setShowFaqCard] = useState(false);
  const [showSupplementSheet, setShowSupplementSheet] = useState(false);
  const [supplementValues, setSupplementValues] = useState<Partial<Record<SupplementKey, string>>>({});
  const [readyToSubmit, setReadyToSubmit] = useState(false);
  const [checkUrl, setCheckUrl] = useState('');
  const [questionId, setQuestionId] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const submitLockRef = useRef(false);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    const updateConnection = () => setOffline(!navigator.onLine);
    updateConnection(); window.addEventListener('online', updateConnection); window.addEventListener('offline', updateConnection);
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem('kikumae-shelter-draft');
        if (!saved) return;
        const draft = JSON.parse(saved) as SavedDraft;
        if (draft.savedAt && Date.now() - draft.savedAt >= 24 * 60 * 60 * 1000) return;
        if (draft.input) setInput(draft.input); if (draft.originalBody) setOriginalBody(draft.originalBody); if (draft.contextBody) setContextBody(draft.contextBody); if (draft.intake) setIntake({ ...emptyIntake, ...draft.intake }); if (draft.chatOpen) setChatOpen(true); if (draft.intakeOpen) { setIntakeOpen(true); setIntakeStep(draft.intakeStep ?? 'category'); setSelectedCategory(INTAKE_CATEGORIES.find((category) => category.id === draft.selectedCategoryId) ?? null); setSelectedDetail(draft.selectedDetail ?? ''); setSelectedLocation(draft.selectedLocation ?? ''); setSelectedPeople(draft.selectedPeople ?? ''); setIntakeNote(draft.intakeNote ?? ''); } if (draft.messages?.length) setMessages(draft.messages); if (draft.preview) setPreview(draft.preview); if (draft.faqDecision) setFaqDecision(true); if (draft.readyToSubmit) setReadyToSubmit(true); if (draft.showSupplementSheet) setShowSupplementSheet(true);
      } catch { /* 下書きの復元は利用できる場合だけ行う */ }
    }, 0);
    return () => { window.clearTimeout(restoreTimer); window.removeEventListener('online', updateConnection); window.removeEventListener('offline', updateConnection); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const location = params.get('location')?.trim().slice(0, 120) ?? '';
      const peopleCount = params.get('people')?.trim().slice(0, 80) ?? '';
      if (location || peopleCount) setIntake((current) => ({ ...current, ...(location ? { location } : {}), ...(peopleCount ? { peopleCount } : {}) }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (checkUrl) { try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ } return; }
    if (!input && !originalBody && !messages.length) return;
    try { localStorage.setItem('kikumae-shelter-draft', JSON.stringify({ savedAt: Date.now(), input, originalBody, contextBody, intake, chatOpen, intakeOpen, intakeStep, selectedCategoryId: selectedCategory?.id, selectedDetail, selectedLocation, selectedPeople, intakeNote, messages, preview, faqDecision, readyToSubmit, showSupplementSheet } satisfies SavedDraft)); } catch { /* 共用端末やプライベートモードでは保存しない */ }
  }, [input, originalBody, contextBody, intake, chatOpen, intakeOpen, intakeStep, selectedCategory, selectedDetail, selectedLocation, selectedPeople, intakeNote, messages, preview, faqDecision, readyToSubmit, showSupplementSheet, checkUrl]);

  const matches = useMemo(() => {
    const term = normalize(query);
    if (!term) return faqs;
    return faqs.filter((faq) => normalize(`${faq.question}${faq.answer}${faq.category}`).includes(term));
  }, [faqs, query]);

  function addMessage(message: ChatMessage) { setMessages((current) => [...current, message]); }

  function beginChat() {
    previewRequestRef.current += 1; setBusy(false);
    setChatOpen(false); setEmergencyOpen(false); setVoiceOpen(false); setIntakeOpen(true); setIntakeStep('category'); setSelectedCategory(null); setSelectedDetail(''); setSelectedLocation(intake.location); setSelectedPeople(intake.peopleCount); setIntakeNote(''); setMessages([]); setInput(''); setOriginalBody(''); setContextBody(''); setPreview(null); setFaqDecision(false); setShowFaqCard(false); setShowSupplementSheet(false); setSupplementValues({}); setReadyToSubmit(false); setQuestionId(null); setCheckUrl(''); setStatus('');
    try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ }
  }

  function openVoice() { setEmergencyOpen(false); setVoiceOpen(true); setIntakeStep('category'); }
  function useTextConsultation() { setVoiceOpen(false); setIntakeStep('freeText'); setStatus(''); }
  function directStaffFromVoice() { setVoiceOpen(false); setEmergencyOpen(true); setStatus(''); }

  function moveToNextFlowStep(category: IntakeCategory, detail: string) {
    const needsLocation = Boolean(category.needsLocationFor?.includes(detail)) && !intake.location;
    const needsPeople = Boolean(category.needsPeople) && !intake.peopleCount;
    if (needsLocation) setIntakeStep('location'); else if (needsPeople) setIntakeStep('people'); else setIntakeStep('confirm');
  }

  function chooseCategory(category: IntakeCategory) {
    setSelectedCategory(category); setSelectedDetail(''); setIntakeStep('detail');
  }

  function chooseDetail(detail: string) {
    if (!selectedCategory || busy) return;
    const nextIntake = { ...intake };
    const body = [`困りごとの種類：${selectedCategory.label}`, `困っていること：${detail}`].join('\n');
    const instantPreview = buildInstantPreview(body, nextIntake, faqs, crypto.randomUUID());
    const urgent = isUrgentAnalysis(instantPreview.analysis);
    const fields = supplementFields(instantPreview.analysis, instantPreview.body, nextIntake);
    setSelectedDetail(detail); setOriginalBody(body); setContextBody(body); setIntake(nextIntake); setIntakeStep('faq'); setPreview(instantPreview); setFaqDecision(false); setReadyToSubmit(urgent || (!instantPreview.related.length && !fields.length)); setStatus('');
    void inspect(body, nextIntake, instantPreview.submissionKey, true);
  }

  function chooseLocation(location: string) {
    setSelectedLocation(location); setIntake((current) => ({ ...current, location, issueLocation: location })); setIntakeStep(selectedCategory?.needsPeople && !intake.peopleCount ? 'people' : 'confirm');
  }

  function choosePeople(people: string) { setSelectedPeople(people); setIntake((current) => ({ ...current, peopleCount: people })); setIntakeStep('confirm'); }

  async function submitStructuredIntake() {
    if (busy) return;
    if ((!selectedCategory || !selectedDetail) && preview && readyToSubmit) { await submitQuestion(); return; }
    if (!selectedCategory || !selectedDetail) return;
    if (preview && readyToSubmit) { await submitQuestion(); return; }
    const nextLocation = selectedLocation || intake.issueLocation || intake.location;
    const nextIntake = { ...intake, location: nextLocation, issueLocation: nextLocation, peopleCount: selectedPeople || intake.peopleCount, additionalDetails: intakeNote };
    const body = [
      `困りごとの種類：${selectedCategory.label}`,
      `困っていること：${selectedDetail}`,
      nextIntake.location ? `場所：${nextIntake.location}` : '',
      nextIntake.peopleCount ? `対象人数：${nextIntake.peopleCount}` : '',
      intakeNote.trim() ? `補足：${intakeNote.trim()}` : ''
    ].filter(Boolean).join('\n');
    setIntake(nextIntake); setOriginalBody(body); setContextBody(body); setMessages([{ from: 'ai', text: t('messages.structuredOrganized') }, { from: 'person', text: body }]); setStatus(''); setIntakeStep('faq');
    await inspect(body, nextIntake);
  }

  async function inspect(body: string, nextIntake: Intake, submissionKey = preview?.submissionKey ?? crypto.randomUUID(), background = false) {
    const requestId = ++previewRequestRef.current;
    if (!background) { setBusy(true); setStatus(t('messages.organizing')); }
    try {
      const response = await fetch('/api/questions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, intake: nextIntake }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; body?: string; summary?: string; category?: string; related?: RelatedFaq[]; analysis?: Analysis; followUp?: Preview['followUp'] };
      if (requestId !== previewRequestRef.current || submitLockRef.current) return false;
      if (!response.ok || !payload.analysis) { if (!background) setStatus(t('reception.previewError')); return false; }
      const nextPreview: Preview = { body: payload.body ?? body, summary: payload.summary ?? '', category: payload.category ?? 'その他', related: payload.related ?? [], analysis: payload.analysis, followUp: payload.followUp ?? null, submissionKey };
      setPreview(nextPreview); setIntake(nextIntake); setFaqDecision(false);
      if (background) return true;
      setStatus('');
      const urgent = isUrgentAnalysis(nextPreview.analysis);
      const fields = supplementFields(nextPreview.analysis, nextPreview.body, nextIntake);
      setShowFaqCard(!urgent && nextPreview.related.length > 0);
      if (intakeOpen) setIntakeStep((current) => current === 'faq' || current === 'detail' ? 'faq' : current);
      if (urgent) addMessage({ from: 'ai', text: t('messages.urgent') });
      else if (nextPreview.related.length) addMessage({ from: 'ai', text: t('messages.faqFound') });
      else addMessage({ from: 'ai', text: fields.length ? t('messages.moreInfo') : t('messages.ready') });
      if (urgent || (!nextPreview.related.length && !fields.length)) setReadyToSubmit(true);
      else if (!nextPreview.related.length) { setSupplementValues({}); setShowSupplementSheet(!intakeOpen); if (intakeOpen) setIntakeStep((current) => current === 'faq' || current === 'detail' ? 'supplement' : current); setReadyToSubmit(false); }
      return true;
    } catch (error) { if (!background && requestId === previewRequestRef.current && !submitLockRef.current) setStatus(error instanceof Error && error.name === 'TimeoutError' ? t('errors.previewSlow') : t('errors.connection')); return false; }
    finally { if (!background && requestId === previewRequestRef.current) setBusy(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput(''); addMessage({ from: 'person', text: trimmed });
    setOriginalBody(trimmed); setContextBody(trimmed);
    const ok = await inspect(trimmed, intake);
    if (!ok) { setOriginalBody(''); setContextBody(''); }
  }

  async function submitFreeText() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setOriginalBody(trimmed); setContextBody(trimmed); setMessages([{ from: 'person', text: trimmed }]); setIntakeStep('faq');
    await inspect(trimmed, intake);
  }

  function setSupplementValue(key: SupplementKey, value: string) { setSupplementValues((current) => ({ ...current, [key]: value })); }

  function changeQuantity(delta: number) {
    const current = Number(supplementValues.resourceRemaining ?? '1');
    setSupplementValue('resourceRemaining', String(Math.max(1, Math.min(99, (Number.isFinite(current) ? current : 1) + delta))));
  }

  function editOriginal() {
    const original = originalBody;
    setShowSupplementSheet(false); setShowFaqCard(false); setReadyToSubmit(false); setPreview(null); setOriginalBody(''); setContextBody(''); setInput(original); setMessages([{ from: 'ai', text: t('messages.editable') }]);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.reception-free-text')?.focus(), 50);
  }

  function confirmSupplements() {
    if (!preview) return;
    const values = { ...supplementValues };
    for (const field of supplementFields(preview.analysis, preview.body, intake)) if (field.kind === 'stepper' && !values[field.key]) values[field.key] = '1';
    const normalizedValues = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'string' && value.length > 0).map(([key, value]) => [key, key === 'resourceRemaining' && supplementFields(preview.analysis, preview.body, intake).some((field) => field.key === 'resourceRemaining' && field.kind === 'stepper') && /^\d+$/.test(value) ? `${value}枚` : value]));
    const selectedIssueLocation = String(normalizedValues.location ?? intake.issueLocation ?? intake.location ?? '');
    const nextIntake = { ...intake, ...normalizedValues, location: selectedIssueLocation, issueLocation: selectedIssueLocation } as Intake;
    const facts = [...preview.analysis.facts];
    const factLabels: Array<[string, SupplementKey]> = [['場所', 'location'], ['人数', 'peopleCount'], ['残量・不足状況', 'resourceRemaining'], ['最後に受け取った時刻', 'lastReceivedAt'], ['追加確認', 'additionalDetails']];
    for (const [label, key] of factLabels) { const value = nextIntake[key]; if (!value) continue; const index = facts.findIndex((fact) => fact.startsWith(`${label}：`)); if (index >= 0) facts[index] = `${label}：${value}`; else facts.push(`${label}：${value}`); }
    setIntake(nextIntake); setPreview({ ...preview, analysis: { ...preview.analysis, location: nextIntake.location, issueLocation: nextIntake.issueLocation, peopleCount: nextIntake.peopleCount, resourceRemaining: nextIntake.resourceRemaining, lastReceivedAt: nextIntake.lastReceivedAt, facts, missingInformation: [] } }); setShowSupplementSheet(false); setReadyToSubmit(true); setStatus(''); if (intakeOpen) setIntakeStep('confirm');
  }

  async function faqResult(resolved: boolean) {
    setFaqDecision(true); setShowFaqCard(false);
    if (resolved) { const faqId = preview?.related[0]?.id ?? null; void fetch('/api/faq-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faqId, query: originalBody }) }); addMessage({ from: 'ai', text: t('messages.faqResolved') }); setPreview(null); setOriginalBody(''); setContextBody(''); setReadyToSubmit(false); if (intakeOpen) setIntakeStep('faq'); return; }
    addMessage({ from: 'ai', text: t('messages.stillNeedHelp') });
    if (preview) { const fields = supplementFields(preview.analysis, preview.body, intake); setSupplementValues({}); if (fields.length) { setShowSupplementSheet(!intakeOpen); setIntakeStep(intakeOpen ? 'supplement' : intakeStep); setReadyToSubmit(false); } else { setReadyToSubmit(true); if (intakeOpen) setIntakeStep('confirm'); } }
  }

  async function submitQuestion() {
    if (!preview || busy || submitLockRef.current) return;
    submitLockRef.current = true; previewRequestRef.current += 1; setBusy(true); setStatus(t('messages.delivering'));
    try {
      const response = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: originalBody, summary: preview.summary, category: preview.category, submissionKey: preview.submissionKey, intake }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; checkUrl?: string; id?: number };
      if (!response.ok) { setStatus(t('errors.deliver')); return; }
      const url = payload.checkUrl ?? ''; const id = typeof payload.id === 'number' ? payload.id : null;
      setCheckUrl(url); setQuestionId(id); setReadyToSubmit(false); setStatus(t('reception.receivedHint')); addMessage({ from: 'ai', text: t('messages.received', { id: id != null ? ` #${String(id).padStart(4, '0')}` : '' }) });
      if (id != null && url) { try { appendConsultHistory({ id, checkUrl: url, title: preview.category, savedAt: Date.now() }); } catch { /* 履歴保存はベストエフォート */ } }
      try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ }
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? t('errors.previewSlow') : t('errors.connection')); }
    finally { submitLockRef.current = false; setBusy(false); }
  }

  async function submitEmergency() {
    if (busy || submitLockRef.current) return;
    submitLockRef.current = true; previewRequestRef.current += 1; setBusy(true); setStatus(t('messages.emergencySending'));
    const body = '【緊急】命に関わる・今すぐ助けが必要です。近くの職員への即時対応をお願いします。';
    try {
      const response = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, summary: '緊急のため、職員による即時確認が必要です。', category: 'その他', submissionKey: crypto.randomUUID(), intake: { ...emptyIntake, additionalDetails: '近くの職員にも直接声をかけてください。' } }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; checkUrl?: string; id?: number };
      if (!response.ok) { setStatus(t('errors.emergencyDeliver')); return; }
      const url = payload.checkUrl ?? ''; const id = typeof payload.id === 'number' ? payload.id : null;
      setCheckUrl(url); setQuestionId(id); setEmergencyOpen(false); setStatus(t('reception.emergencyReceived')); addMessage({ from: 'ai', text: t('messages.emergencyReceived') });
      if (id != null && url) { try { appendConsultHistory({ id, checkUrl: url, title: '緊急の相談', savedAt: Date.now() }); } catch { /* 履歴保存はベストエフォート */ } }
      try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ }
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? t('reception.emergencyTimeout') : t('errors.emergencyConnection')); }
    finally { submitLockRef.current = false; setBusy(false); }
  }

  function closeChat() { setChatOpen(false); setStatus(''); }

  async function copyCheckUrl() {
    const field = document.getElementById('check-url-text') as HTMLInputElement | null;
    field?.select();
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(new URL(checkUrl, window.location.origin).toString()); setStatus(t('errors.copied')); return; } } catch { /* 手動コピーへ */ }
    setStatus(t('errors.copyManual'));
  }

  return <ReceptionFlow faqs={faqs} intakeStep={intakeStep} selectedCategory={selectedCategory} selectedDetail={selectedDetail} selectedLocation={selectedLocation} selectedPeople={selectedPeople} intakeNote={intakeNote} intake={intake} preview={preview} faqDecision={faqDecision} readyToSubmit={readyToSubmit} supplementValues={supplementValues} input={input} status={status} busy={busy} checkUrl={checkUrl} questionId={questionId} emergencyOpen={emergencyOpen} voiceOpen={voiceOpen} onChooseCategory={chooseCategory} onChooseDetail={(detail) => { void chooseDetail(detail); }} onChooseLocation={chooseLocation} onChoosePeople={choosePeople} onSetIntakeStep={setIntakeStep} onSetIntakeNote={setIntakeNote} onSetInput={setInput} onSetSupplementValue={setSupplementValue} onChangeQuantity={changeQuantity} onFaqResult={(resolved) => { void faqResult(resolved); }} onConfirmSupplements={confirmSupplements} onSubmit={() => { void submitStructuredIntake(); }} onSubmitFreeText={() => { void submitFreeText(); }} onStartOver={beginChat} onCopyUrl={() => { void copyCheckUrl(); }} onOpenEmergency={() => { setStatus(''); setEmergencyOpen(true); }} onCloseEmergency={() => setEmergencyOpen(false)} onSubmitEmergency={() => { void submitEmergency(); }} onOpenVoice={openVoice} onUseText={useTextConsultation} onDirectStaff={directStaffFromVoice} />;

}
