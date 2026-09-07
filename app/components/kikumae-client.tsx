'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Faq, RelatedFaq } from '../../db/repository';
import { generateShelterAnalysis, searchFaqs, shelterFollowUp } from '../../db/local-ai';
import { LocationSelector } from './shelter-map';
import { appendConsultHistory } from './consult-history';
import { ShelterHomeBoard } from './shelter-home-board';

type Intake = { location: string; issueLocation: string; reporterLocation: string; peopleCount: string; resourceRemaining: string; lastReceivedAt: string; additionalDetails: string };
type Analysis = { title: string; overview: string; facts: string[]; emotion: string; missingInformation: string[]; urgencyCandidate: string; urgentReview: boolean; category: string; location: string; issueLocation: string; peopleCount: string; resourceRemaining: string; lastReceivedAt: string };
type Preview = { body: string; summary: string; category: string; related: RelatedFaq[]; analysis: Analysis; followUp: { question: string; options: string[] } | null; submissionKey: string };
type ChatMessage = { from: 'ai' | 'person'; text: string };
type SupplementKey = 'location' | 'peopleCount' | 'resourceRemaining' | 'lastReceivedAt' | 'additionalDetails';
type SupplementField = { key: SupplementKey; label: string; kind: 'choice' | 'select' | 'location' | 'stepper'; options?: string[]; help?: string };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
type IntakeStep = 'category' | 'detail' | 'faq' | 'location' | 'people' | 'supplement' | 'confirm' | 'freeText';
type SavedDraft = { savedAt?: number; input?: string; originalBody?: string; contextBody?: string; intake?: Intake; chatOpen?: boolean; intakeOpen?: boolean; intakeStep?: IntakeStep; selectedCategoryId?: string; selectedDetail?: string; selectedLocation?: string; selectedPeople?: string; intakeNote?: string; messages?: ChatMessage[]; preview?: Preview | null; faqDecision?: boolean; readyToSubmit?: boolean; showSupplementSheet?: boolean };
type Props = { faqs: Faq[] };
type Language = 'ja' | 'en' | 'zh' | 'ko';

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' }
];

const LANGUAGE_COPY: Record<Language, { selector: string; issues: string; faq: string; status: string; admin: string }> = {
  ja: { selector: '言語', issues: '困りごと', faq: 'よくある質問', status: '相談状況', admin: '管理者ページ' },
  en: { selector: 'Language', issues: 'What I need', faq: 'FAQs', status: 'My status', admin: 'Staff portal' },
  zh: { selector: '语言', issues: '我遇到的困难', faq: '常见问题', status: '咨询状态', admin: '工作人员页面' },
  ko: { selector: '언어', issues: '불편한 점', faq: '자주 묻는 질문', status: '상담 상황', admin: '관리자 페이지' }
};

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
const formatFaqUpdatedAt = (value: number) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

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
  language: Language;
  languageOpen: boolean;
  onToggleLanguage: () => void;
  onChangeLanguage: (language: Language) => void;
};

function ConsultCancelAction({ onStartOver }: { onStartOver: () => void }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return <>
    <div className="reception-cancel-area">
      <button className="reception-cancel-trigger" type="button" onClick={() => setDialogOpen(true)}>相談をやめて最初に戻る</button>
    </div>
    {dialogOpen && <div className="reception-cancel-backdrop" role="presentation"><section className="reception-cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="reception-cancel-title"><p className="eyebrow">入力途中の相談</p><h2 id="reception-cancel-title">この相談をやめて、最初に戻りますか？</h2><p>入力した内容は消えます。まだ続ける場合は「このまま続ける」を選んでください。</p><div className="reception-cancel-actions"><button className="button secondary" type="button" onClick={() => setDialogOpen(false)}>このまま続ける</button><button className="button danger reception-cancel-confirm" type="button" onClick={onStartOver}>最初に戻る</button></div></section></div>}
  </>;
}

function ReceptionFlow({ faqs, intakeStep, selectedCategory, selectedDetail, selectedLocation, selectedPeople, intakeNote, intake, preview, faqDecision, readyToSubmit, supplementValues, input, status, busy, checkUrl, questionId, emergencyOpen, onChooseCategory, onChooseDetail, onChooseLocation, onChoosePeople, onSetIntakeStep, onSetIntakeNote, onSetInput, onSetSupplementValue, onChangeQuantity, onFaqResult, onConfirmSupplements, onSubmit, onSubmitFreeText, onStartOver, onCopyUrl, onOpenEmergency, onCloseEmergency, onSubmitEmergency, language, languageOpen, onToggleLanguage, onChangeLanguage }: ReceptionFlowProps) {
  const fields = preview ? supplementFields(preview.analysis, preview.body, intake) : [];
  const stageIndex = checkUrl ? 1 : 0;
  const stages = ['受付済み', '確認中', '現場確認中', '対応中', '解決済み'];
  const detailProgress = intakeStep === 'category' || intakeStep === 'freeText' ? '' : intakeStep === 'confirm' ? 'done' : 'current';
  const copy = LANGUAGE_COPY[language];
  const selectedLanguage = LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? '日本語';
  return <main className="evac-theme reception-app">
    <header className="reception-header"><a className="brand" href="#reception-top" aria-label="イセキ避難所の受付画面の先頭へ">◌ イセキ避難所</a><div className="reception-header-tools"><nav aria-label="利用者メニュー"><a href="#reception-top" aria-current={!checkUrl && !emergencyOpen && intakeStep === 'category' ? 'page' : undefined}>{copy.issues}</a><a href="#reception-faq">{copy.faq}</a><Link href="/questions">{copy.status}</Link><Link className="reception-admin-link" href="/admin">{copy.admin}</Link></nav><div className="reception-language-picker"><button className="reception-language-trigger" type="button" aria-label={`${copy.selector}: ${selectedLanguage}`} aria-expanded={languageOpen} aria-controls="reception-language-menu" onClick={onToggleLanguage}><span aria-hidden="true">🌐</span><span>{selectedLanguage}</span><span aria-hidden="true">⌄</span></button>{languageOpen && <div className="reception-language-menu" id="reception-language-menu" role="menu" aria-label={copy.selector}><p>{copy.selector}</p>{LANGUAGE_OPTIONS.map((option) => <button type="button" role="menuitemradio" aria-checked={language === option.value} className={language === option.value ? 'selected' : ''} key={option.value} onClick={() => onChangeLanguage(option.value)}>{option.label}<span aria-hidden="true">{language === option.value ? '✓' : ''}</span></button>)}</div>}</div></div></header>
    <section className="reception-shell" id="reception-top">
      {!checkUrl && <button className="reception-emergency-link" type="button" onClick={onOpenEmergency}><span aria-hidden="true">🚨</span> 命に関わる・今すぐ助けが必要</button>}
      {!checkUrl && !emergencyOpen && <div className="reception-progress" aria-label="受付の進み具合"><span className={intakeStep === 'category' ? 'current' : 'done'}>困りごと</span><i>→</i><span className={detailProgress}>詳細</span><i>→</i><span className={intakeStep === 'confirm' ? 'current' : ''}>確認</span>{intakeStep !== 'category' && <small>あと少しです</small>}</div>}
      {emergencyOpen && !checkUrl ? <section className="reception-step reception-emergency-panel" aria-labelledby="emergency-title"><button className="reception-back" type="button" onClick={onCloseEmergency}>← 通常の相談に戻る</button><p className="eyebrow">緊急時の案内</p><h1 id="emergency-title">今すぐ助けが必要ですか？</h1><div className="emergency-instruction"><strong>命に関わる症状、呼吸が苦しい、意識がない、火事や暴力などの場合</strong><p>通常の相談フォームを使わず、近くの職員に直接声をかけてください。</p></div><button className="button emergency-primary" type="button" disabled={busy} onClick={onSubmitEmergency}>{busy ? '職員へ知らせています…' : '職員にも緊急で知らせる'}</button><p className="emergency-note">このボタンでも職員へ緊急の相談を送ります。送信後も、必ず近くの職員に直接声をかけてください。</p></section> : <>
      {intakeStep === 'category' && !checkUrl && <><section className="reception-step reception-category-step" aria-labelledby="reception-title"><p className="eyebrow">避難所の受付</p><h1 id="reception-title">今、困っていることはありますか？</h1><p className="reception-lead">近いものを選んでください。文章を書かなくても職員に伝わります。うまく当てはまらなくても大丈夫です。</p><div className="reception-category-grid">{INTAKE_CATEGORIES.map((category, index) => <button className="reception-category-card" type="button" key={category.id} onClick={() => onChooseCategory(category)}><span className={`reception-category-art art-${index + 1}`} role="img" aria-label={`${category.label}の生活イラスト`} /><strong>{category.label}</strong><span className="reception-card-arrow" aria-hidden="true">›</span></button>)}</div><div className="reception-secondary-actions"><button type="button" onClick={() => onSetIntakeStep('freeText')}>文章で伝えたい</button><button type="button" onClick={() => onSetIntakeStep('freeText')}>選択肢にない・うまく言えない</button></div></section><ShelterHomeBoard /></>}
      {intakeStep === 'detail' && selectedCategory && !checkUrl && <section className="reception-step" aria-labelledby="detail-title"><button className="reception-back" type="button" onClick={() => onSetIntakeStep('category')}>← 困りごとの選択に戻る</button><p className="eyebrow">{selectedCategory.label}</p><h1 id="detail-title">どんなことで困っていますか？</h1><p className="reception-lead">近い内容を選んでください。</p><div className="reception-choice-list">{selectedCategory.details.map((detail) => <button type="button" key={detail} onClick={() => onChooseDetail(detail)}>{detail}<span>›</span></button>)}</div></section>}
      {intakeStep === 'faq' && !checkUrl && <section className="reception-step" aria-labelledby="faq-step-title"><p className="eyebrow">選んだ内容を確認</p><h1 id="faq-step-title">この案内で解決できそうですか？</h1>{preview?.related.length && !faqDecision ? <div className="reception-faq-card"><p className="reception-faq-label">近い案内が見つかりました</p>{preview.related.slice(0, 2).map((faq) => <article key={faq.id}><h2>{faq.question}</h2><p>{faq.answer}</p></article>)}<div className="reception-faq-actions"><button className="button secondary" type="button" onClick={() => onFaqResult(true)}>解決した</button><button className="button accent" type="button" onClick={() => onFaqResult(false)}>まだ困っている</button></div></div> : faqDecision && !preview ? <div className="reception-resolved"><span aria-hidden="true">✓</span><h2>解決につながってよかったです</h2><p>職員への相談送信は不要です。</p><button className="button secondary" type="button" onClick={onStartOver}>別のことを相談する</button></div> : <div className="reception-no-faq"><h2>この内容を職員へ伝えます</h2><p>{busy ? '必要な情報を確認しています…' : 'このまま次へ進んでください。必要な項目だけお聞きします。'}</p>{!busy && <button className="button accent" type="button" onClick={() => onSetIntakeStep(fields.length ? 'supplement' : 'confirm')}>次へ</button>}</div>}</section>}
      {intakeStep === 'supplement' && preview && !checkUrl && <section className="reception-step" aria-labelledby="supplement-title"><p className="eyebrow">あと少しだけ</p><h1 id="supplement-title">対応に必要なことを教えてください</h1><p className="reception-lead">分かる範囲で大丈夫です。必要な項目だけ表示しています。</p><div className="reception-supplement-list">{fields.map((field) => <div className="reception-field" key={field.key}><label>{field.label}</label>{field.kind === 'location' && <LocationSelector value={supplementValues.location ?? ''} onChange={(zoneId) => onSetSupplementValue('location', zoneId)} />}{field.kind === 'select' && <select value={supplementValues[field.key] ?? ''} onChange={(event) => onSetSupplementValue(field.key, event.target.value)}><option value="">選んでください</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>}{field.kind === 'choice' && <div className="reception-choice-grid">{field.options?.map((option) => <button className={supplementValues[field.key] === option ? 'selected' : ''} type="button" key={option} onClick={() => onSetSupplementValue(field.key, option)} aria-pressed={supplementValues[field.key] === option}>{option}</button>)}</div>}{field.kind === 'stepper' && <div className="reception-stepper"><button type="button" onClick={() => onChangeQuantity(-1)} aria-label="枚数を減らす">−</button><strong>{supplementValues[field.key] ?? '1'}枚</strong><button type="button" onClick={() => onChangeQuantity(1)} aria-label="枚数を増やす">＋</button></div>}{field.help && <p>{field.help}</p>}</div>)}</div><button className="button accent reception-next" type="button" onClick={onConfirmSupplements}>この内容で次へ</button></section>}
      {intakeStep === 'freeText' && !checkUrl && <section className="reception-step" aria-labelledby="free-text-title"><button className="reception-back" type="button" onClick={() => onSetIntakeStep('category')}>← カテゴリ選択に戻る</button><p className="eyebrow">補助手段</p><h1 id="free-text-title">文章で伝えたいこと</h1><p className="reception-lead">短い言葉で大丈夫です。書かなくても、カテゴリから相談できます。</p><textarea className="reception-free-text" value={input} onChange={(event) => onSetInput(event.target.value)} placeholder="例：北トイレの水が流れません" maxLength={500} autoFocus /><button className="button accent reception-next" type="button" disabled={!input.trim() || busy} onClick={onSubmitFreeText}>{busy ? '確認しています…' : '内容を確認する'}</button></section>}
      {intakeStep === 'confirm' && preview && !checkUrl && <section className="reception-step" aria-labelledby="confirm-title"><p className="eyebrow">送信前の確認</p><h1 id="confirm-title">この内容で職員へ伝えます</h1><dl className="reception-summary"><div><dt>カテゴリ</dt><dd>{selectedCategory?.label ?? preview.category}</dd></div><div><dt>困っていること</dt><dd>{selectedDetail || preview.analysis.title}</dd></div><div><dt>場所</dt><dd>{intake.location || selectedLocation || '指定なし'}</dd></div><div><dt>人数</dt><dd>{intake.peopleCount || selectedPeople || '指定なし'}</dd></div><div><dt>補足</dt><dd>{intakeNote || 'なし'}</dd></div></dl><label className="reception-note-label">補足（任意）<textarea value={intakeNote} onChange={(event) => onSetIntakeNote(event.target.value)} placeholder="追加で伝えたいことがあれば書いてください" maxLength={500} /></label><div className="reception-confirm-actions"><button className="button secondary" type="button" onClick={() => onSetIntakeStep('detail')}>修正する</button><button className="button accent" type="button" disabled={busy || !readyToSubmit} onClick={onSubmit}>{busy ? '送信しています…' : 'この内容で送信する'}</button></div></section>}
      </>}
      {checkUrl && <section className="reception-step reception-complete" aria-labelledby="complete-title"><p className="eyebrow">相談を受け付けました</p><h1 id="complete-title">職員へ届きました</h1><p>今は「確認中」です。対応状況はあとから更新されます。</p>{questionId != null && <p className="reception-id">受付番号 <strong>#{String(questionId).padStart(4, '0')}</strong></p>}<ol className="reception-status-timeline" aria-label="相談の対応状況">{stages.map((stage, index) => <li className={`${index <= stageIndex ? 'done' : ''} ${index === stageIndex ? 'current' : ''}`} key={stage}><span aria-hidden="true">{index <= stageIndex ? '✓' : '○'}</span><strong>{stage}</strong></li>)}</ol><div className="reception-url-box"><input readOnly value={checkUrl} onFocus={(event) => event.currentTarget.select()} aria-label="相談状況の確認URL" /><button className="button secondary" type="button" onClick={onCopyUrl}>URLをコピー</button></div><Link className="button accent reception-next" href={checkUrl}>相談状況を見る</Link><button className="reception-text-button" type="button" onClick={onStartOver}>新しく相談する</button></section>}
      {!checkUrl && !emergencyOpen && !busy && intakeStep !== 'category' && <ConsultCancelAction onStartOver={onStartOver} />}
    </section>
    <section className="reception-faq-section" id="reception-faq" aria-labelledby="reception-faq-title"><p className="eyebrow">イセキ避難所の案内</p><h2 id="reception-faq-title">イセキ避難所でよくある質問</h2><p>今いる場所で確認できる、食事・水・トイレ・救護などの案内です。解決しないときは、そのまま職員へ相談できます。</p>{faqs.slice(0, 6).map((faq) => <details key={faq.id}><summary>{faq.question}</summary><p className="reception-faq-updated"><time dateTime={new Date(faq.updatedAt).toISOString()}>更新日時：{formatFaqUpdatedAt(faq.updatedAt)}</time></p><p>{faq.answer}</p></details>)}</section>
    {status && !checkUrl && <p className="reception-status" role="status">{status}</p>}
  </main>;
}

export function KikumaeClient({ faqs }: Props) {
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
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [offline, setOffline] = useState(false);
  const [language, setLanguage] = useState<Language>('ja');
  const [languageOpen, setLanguageOpen] = useState(false);
  const submitLockRef = useRef(false);
  const previewRequestRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const languageTags: Record<Language, string> = { ja: 'ja', en: 'en', zh: 'zh-CN', ko: 'ko' };
    document.documentElement.lang = languageTags[language];
  }, [language]);

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

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    const timer = window.setTimeout(() => setVoiceSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition)), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const matches = useMemo(() => {
    const term = normalize(query);
    if (!term) return faqs;
    return faqs.filter((faq) => normalize(`${faq.question}${faq.answer}${faq.category}`).includes(term));
  }, [faqs, query]);

  function addMessage(message: ChatMessage) { setMessages((current) => [...current, message]); }

  function beginChat() {
    previewRequestRef.current += 1; setBusy(false);
    setChatOpen(false); setEmergencyOpen(false); setIntakeOpen(true); setIntakeStep('category'); setSelectedCategory(null); setSelectedDetail(''); setSelectedLocation(intake.location); setSelectedPeople(intake.peopleCount); setIntakeNote(''); setMessages([]); setInput(''); setOriginalBody(''); setContextBody(''); setPreview(null); setFaqDecision(false); setShowFaqCard(false); setShowSupplementSheet(false); setSupplementValues({}); setReadyToSubmit(false); setQuestionId(null); setCheckUrl(''); setStatus('');
    try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ }
  }

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
    setIntake(nextIntake); setOriginalBody(body); setContextBody(body); setMessages([{ from: 'ai', text: '選んだ内容をもとに、職員へ届く形に整理しています。' }, { from: 'person', text: body }]); setStatus(''); setIntakeStep('faq');
    await inspect(body, nextIntake);
  }

  function startVoice() {
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) { setStatus('このブラウザでは音声入力が使えないため、文字でお話しください。'); inputRef.current?.focus(); return; }
    const recognition = new SpeechRecognition(); recognition.lang = 'ja-JP'; recognition.interimResults = false; setListening(true);
    recognition.onresult = (event) => { const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(''); setInput(transcript); setListening(false); };
    recognition.onerror = () => { setListening(false); setStatus('音声を聞き取れませんでした。文字でも入力できます。'); };
    recognition.onend = () => setListening(false);
    recognition.start();
  }

  async function inspect(body: string, nextIntake: Intake, submissionKey = preview?.submissionKey ?? crypto.randomUUID(), background = false) {
    const requestId = ++previewRequestRef.current;
    if (!background) { setBusy(true); setStatus('内容を整理しています…'); }
    try {
      const response = await fetch('/api/questions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, intake: nextIntake }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; body?: string; summary?: string; category?: string; related?: RelatedFaq[]; analysis?: Analysis; followUp?: Preview['followUp'] };
      if (requestId !== previewRequestRef.current || submitLockRef.current) return false;
      if (!response.ok || !payload.analysis) { if (!background) setStatus(payload.message ?? '内容を整理できませんでした。'); return false; }
      const nextPreview: Preview = { body: payload.body ?? body, summary: payload.summary ?? '', category: payload.category ?? 'その他', related: payload.related ?? [], analysis: payload.analysis, followUp: payload.followUp ?? null, submissionKey };
      setPreview(nextPreview); setIntake(nextIntake); setFaqDecision(false);
      if (background) return true;
      setStatus('');
      const urgent = isUrgentAnalysis(nextPreview.analysis);
      const fields = supplementFields(nextPreview.analysis, nextPreview.body, nextIntake);
      setShowFaqCard(!urgent && nextPreview.related.length > 0);
      if (intakeOpen) setIntakeStep((current) => current === 'faq' || current === 'detail' ? 'faq' : current);
      if (urgent) addMessage({ from: 'ai', text: '緊急の可能性がある内容として受け止めました。追加の確認を待たず、このまま職員へ届けられます。' });
      else if (nextPreview.related.length) addMessage({ from: 'ai', text: '近い案内が見つかりました。解決しなければ、整理した内容をそのまま職員へ届けられます。' });
      else addMessage({ from: 'ai', text: fields.length ? '内容を整理しました。必要な項目だけ、下からまとめて選んでください。' : '内容を整理しました。この内容を職員へ届ける前に確認できます。' });
      if (urgent || (!nextPreview.related.length && !fields.length)) setReadyToSubmit(true);
      else if (!nextPreview.related.length) { setSupplementValues({}); setShowSupplementSheet(!intakeOpen); if (intakeOpen) setIntakeStep((current) => current === 'faq' || current === 'detail' ? 'supplement' : current); setReadyToSubmit(false); }
      return true;
    } catch (error) { if (!background && requestId === previewRequestRef.current && !submitLockRef.current) setStatus(error instanceof Error && error.name === 'TimeoutError' ? '通信が遅いようです。もう一度お試しください。' : '通信に失敗しました。もう一度お試しください。'); return false; }
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
    setShowSupplementSheet(false); setShowFaqCard(false); setReadyToSubmit(false); setPreview(null); setOriginalBody(''); setContextBody(''); setInput(original); setMessages([{ from: 'ai', text: '内容を直せます。変更したいところを入力して、もう一度確認してください。' }]);
    window.setTimeout(() => inputRef.current?.focus(), 50);
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
    if (resolved) { const faqId = preview?.related[0]?.id ?? null; void fetch('/api/faq-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ faqId, query: originalBody }) }); addMessage({ from: 'ai', text: '解決につながってよかったです。必要なときは、いつでもここから相談してください。' }); setPreview(null); setOriginalBody(''); setContextBody(''); setReadyToSubmit(false); if (intakeOpen) setIntakeStep('faq'); return; }
    addMessage({ from: 'ai', text: 'まだ困っていることがあるのですね。必要な項目だけ、まとめて確認します。' });
    if (preview) { const fields = supplementFields(preview.analysis, preview.body, intake); setSupplementValues({}); if (fields.length) { setShowSupplementSheet(!intakeOpen); setIntakeStep(intakeOpen ? 'supplement' : intakeStep); setReadyToSubmit(false); } else { setReadyToSubmit(true); if (intakeOpen) setIntakeStep('confirm'); } }
  }

  async function submitQuestion() {
    if (!preview || busy || submitLockRef.current) return;
    submitLockRef.current = true; previewRequestRef.current += 1; setBusy(true); setStatus('相談を届けています…');
    try {
      const response = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: originalBody, summary: preview.summary, category: preview.category, submissionKey: preview.submissionKey, intake }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; checkUrl?: string; id?: number };
      if (!response.ok) { setStatus(payload.message ?? '相談を届けられませんでした。'); return; }
      const url = payload.checkUrl ?? ''; const id = typeof payload.id === 'number' ? payload.id : null;
      setCheckUrl(url); setQuestionId(id); setReadyToSubmit(false); setStatus('相談が届きました。この画面を写真に撮るか、確認URLを保存してください。'); addMessage({ from: 'ai', text: `相談を受け付けました。相談ID${id != null ? ` #${String(id).padStart(4, '0')}` : ''}で対応状況を確認できます。` });
      if (id != null && url) { try { appendConsultHistory({ id, checkUrl: url, title: preview.category, savedAt: Date.now() }); } catch { /* 履歴保存はベストエフォート */ } }
      try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ }
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? '通信が遅いようです。もう一度お試しください。' : '通信に失敗しました。もう一度お試しください。'); }
    finally { submitLockRef.current = false; setBusy(false); }
  }

  async function submitEmergency() {
    if (busy || submitLockRef.current) return;
    submitLockRef.current = true; previewRequestRef.current += 1; setBusy(true); setStatus('緊急の知らせを送っています…');
    const body = '【緊急】命に関わる・今すぐ助けが必要です。近くの職員への即時対応をお願いします。';
    try {
      const response = await fetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, summary: '緊急のため、職員による即時確認が必要です。', category: 'その他', submissionKey: crypto.randomUUID(), intake: { ...emptyIntake, additionalDetails: '近くの職員にも直接声をかけてください。' } }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json() as { message?: string; checkUrl?: string; id?: number };
      if (!response.ok) { setStatus(payload.message ?? '緊急の知らせを送れませんでした。近くの職員へ直接声をかけてください。'); return; }
      const url = payload.checkUrl ?? ''; const id = typeof payload.id === 'number' ? payload.id : null;
      setCheckUrl(url); setQuestionId(id); setEmergencyOpen(false); setStatus('緊急の相談が職員へ届きました。'); addMessage({ from: 'ai', text: '緊急の相談を受け付けました。送信後も、必ず近くの職員に直接声をかけてください。' });
      if (id != null && url) { try { appendConsultHistory({ id, checkUrl: url, title: '緊急の相談', savedAt: Date.now() }); } catch { /* 履歴保存はベストエフォート */ } }
      try { localStorage.removeItem('kikumae-shelter-draft'); } catch { /* 下書きは利用できる場合だけ消去 */ }
    } catch (error) { setStatus(error instanceof Error && error.name === 'TimeoutError' ? '送信に時間がかかっています。近くの職員へ直接声をかけてください。' : '通信に失敗しました。近くの職員へ直接声をかけてください。'); }
    finally { submitLockRef.current = false; setBusy(false); }
  }

  function closeChat() { setChatOpen(false); setStatus(''); }

  async function copyCheckUrl() {
    const field = document.getElementById('check-url-text') as HTMLInputElement | null;
    field?.select();
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(new URL(checkUrl, window.location.origin).toString()); setStatus('確認ページのURLをコピーしました。'); return; } } catch { /* 手動コピーへ */ }
    setStatus('コピーできなかったため、URLを選択しました。そのまま保存してください。');
  }

  const knownContext = [intake.location && `場所：${intake.location}`, intake.peopleCount && `人数：${intake.peopleCount}`].filter(Boolean);

  return <ReceptionFlow faqs={faqs} intakeStep={intakeStep} selectedCategory={selectedCategory} selectedDetail={selectedDetail} selectedLocation={selectedLocation} selectedPeople={selectedPeople} intakeNote={intakeNote} intake={intake} preview={preview} faqDecision={faqDecision} readyToSubmit={readyToSubmit} supplementValues={supplementValues} input={input} status={status} busy={busy} checkUrl={checkUrl} questionId={questionId} emergencyOpen={emergencyOpen} language={language} languageOpen={languageOpen} onToggleLanguage={() => setLanguageOpen((current) => !current)} onChangeLanguage={(nextLanguage) => { setLanguage(nextLanguage); setLanguageOpen(false); }} onChooseCategory={chooseCategory} onChooseDetail={(detail) => { void chooseDetail(detail); }} onChooseLocation={chooseLocation} onChoosePeople={choosePeople} onSetIntakeStep={setIntakeStep} onSetIntakeNote={setIntakeNote} onSetInput={setInput} onSetSupplementValue={setSupplementValue} onChangeQuantity={changeQuantity} onFaqResult={(resolved) => { void faqResult(resolved); }} onConfirmSupplements={confirmSupplements} onSubmit={() => { void submitStructuredIntake(); }} onSubmitFreeText={() => { void submitFreeText(); }} onStartOver={beginChat} onCopyUrl={() => { void copyCheckUrl(); }} onOpenEmergency={() => { setStatus(''); setEmergencyOpen(true); }} onCloseEmergency={() => setEmergencyOpen(false)} onSubmitEmergency={() => { void submitEmergency(); }} />;

}
