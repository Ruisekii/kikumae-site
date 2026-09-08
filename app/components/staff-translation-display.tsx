'use client';

export type StaffTranslationSource = {
  originalLanguage: string;
  translatedTextJa: string;
  translationStatus: string;
  originalText: string;
  conversationMessages?: StaffTranslationMessage[];
};

export type StaffTranslationMessage = {
  role: 'user' | 'assistant';
  originalText: string;
  originalLanguage: string;
  translatedTextJa: string;
  translationStatus: string;
};

const inputLanguageLabels: Record<string, string> = {
  ja: '日本語',
  en: 'English',
  zh: '中文',
  ko: '한국어',
  other: 'その他の言語',
  unknown: '入力言語不明',
};

export function StaffTranslationDisplay({ source, onOriginalViewed, hideOriginal = false }: { source: StaffTranslationSource; onOriginalViewed?: () => void; hideOriginal?: boolean }) {
  const sourceLabel = inputLanguageLabels[source.originalLanguage] ?? inputLanguageLabels.other;
  const translated = source.translationStatus === 'translated' && source.translatedTextJa;
  const messages = source.conversationMessages?.filter((message) => message.originalText.trim()) ?? [];
  const renderMessage = (message: StaffTranslationMessage, index: number) => {
    const messageLanguage = inputLanguageLabels[message.originalLanguage] ?? inputLanguageLabels.other;
    const messageTranslated = message.translationStatus === 'not_needed' ? message.originalText : message.translatedTextJa;
    return <article className="translation-message" key={`${message.role}-${index}`}>
      <div className="translation-message-meta"><strong>{message.role === 'assistant' ? 'AI' : '相談者'}</strong><span>{messageLanguage} → 日本語</span></div>
      {messageTranslated ? <p>{messageTranslated}</p> : <><p className="translation-fallback">翻訳できませんでした。原文を表示しています。</p><p>{message.originalText}</p></>}
      {!hideOriginal && messageTranslated && <details className="translation-original"><summary onClick={onOriginalViewed}>原文を見る ▼</summary><p>{message.originalText}</p></details>}
    </article>;
  };
  return <section className="translation-display" aria-label="日本語訳">
    <div className="translation-display-heading"><strong>日本語訳</strong><span>{sourceLabel} → 日本語</span></div>
    {messages.length ? <div className="translation-message-list">{messages.map(renderMessage)}</div> : translated ? <p>{source.translatedTextJa}</p> : <><p className="translation-fallback">翻訳できませんでした。原文を表示しています。</p><p>{source.originalText}</p></>}
    {!messages.length && !hideOriginal && translated && <details className="translation-original"><summary onClick={onOriginalViewed}>原文を見る ▼</summary><p>{source.originalText}</p></details>}
  </section>;
}
