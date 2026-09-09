import { getModelRuntimeStatus, requestModelJson } from '../app/lib/model-gateway';

export type OriginalLanguage = 'ja' | 'en' | 'zh' | 'ko' | 'other' | 'unknown';
export type TranslationStatus = 'not_needed' | 'translated' | 'failed';

export type StaffTranslation = {
  originalText: string;
  originalLanguage: OriginalLanguage;
  translatedTextJa: string;
  translationStatus: TranslationStatus;
};

// Staff translation is not on the resident response path. Give the local
// 4B model enough time to finish on CPU, while still failing closed to the
// preserved original text instead of blocking the case indefinitely.
// Translation is staff-side enrichment. Never let a slow local model hold up
// the resident's receipt; the original text is already safely persisted.
const TRANSLATION_TIMEOUT_MS = 2_500;

const ENGLISH_HINTS = new Set([
  'a', 'an', 'and', 'any', 'are', 'but', 'can', 'child', 'children', 'cold', 'do', 'does', 'drink', 'fever',
  'food', 'have', 'help', 'hurt', 'need', 'no', 'not', 'one', 'pain', 'please', 'toilet', 'two', 'water',
  'we', 'where', 'with', 'without', 'yes', 'you', 'she', 'he', 'my', 'daughter', 'son', 'mother', 'father',
]);

function compact(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 500);
}

/**
 * This is intentionally conservative. It only labels the languages that can
 * be recognized without an external model. The original text remains the
 * source of truth even when this hint is imperfect.
 */
export function detectOriginalLanguage(value: string): OriginalLanguage {
  const text = compact(value);
  if (!text) return 'unknown';
  if (/[ぁ-ゖァ-ヺー]/u.test(text)) return 'ja';
  if (/[\uAC00-\uD7AF]/u.test(text)) return 'ko';
  if (/[\u4E00-\u9FFF]/u.test(text)) return 'zh';

  const latinWords = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (!latinWords.length) return 'other';
  const englishHintCount = latinWords.filter((word) => ENGLISH_HINTS.has(word)).length;
  return englishHintCount > 0 ? 'en' : 'other';
}

function timed<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TRANSLATION_TIMEOUT')), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function failedTranslation(originalText: string, originalLanguage: OriginalLanguage): StaffTranslation {
  return { originalText, originalLanguage, translatedTextJa: '', translationStatus: 'failed' };
}

/**
 * Translate only for staff display. This function never feeds its output into
 * incident extraction or the safety guard, and it never throws for provider
 * outages or malformed model output.
 */
export async function translateForStaff(value: string, languageHint?: string): Promise<StaffTranslation> {
  // Preserve the submitted wording for staff's original view. Compacting is
  // only used for detection/model context below, never for the stored source.
  const originalText = value.trim().slice(0, 500);
  const detectedLanguage = detectOriginalLanguage(originalText);
  const hintedLanguage = ['ja', 'en', 'zh', 'ko', 'other', 'unknown'].includes(languageHint ?? '') ? languageHint as OriginalLanguage : 'unknown';
  const originalLanguage = detectedLanguage === 'other' && hintedLanguage !== 'unknown' ? hintedLanguage : detectedLanguage;
  if (!originalText || originalLanguage === 'ja') {
    return { originalText, originalLanguage, translatedTextJa: originalText, translationStatus: 'not_needed' };
  }

  const runtime = getModelRuntimeStatus();
  if (runtime.mode === 'local-rules' || !runtime.configured || !runtime.translationModel) {
    return failedTranslation(originalText, originalLanguage);
  }

  try {
    const result = await timed(requestModelJson(
      runtime.translationModel,
      [
        'あなたは避難所職員向けの翻訳専用処理です。入力文を忠実に日本語へ翻訳してください。',
        '要約、言い換え、補足、推測、診断、緊急度の変更をしてはいけません。',
        '人数、場所、時刻、症状、否定、疑問、曖昧さ（たぶん・かもしれない等）を必ず維持してください。',
        '原文にない情報を追加しないでください。自信がない箇所は無理に補完せず、原文の語句を残してください。',
        'JSONオブジェクトだけを返し、キーは translatedTextJa と confidence にしてください。',
        '翻訳できない場合は translatedTextJa を空文字列にしてください。',
      ].join('\n'),
      JSON.stringify({ originalLanguage, originalText: compact(originalText) }),
      { type: 'json_object' },
      { maxTokens: 520 },
    ), TRANSLATION_TIMEOUT_MS);

    const candidate = result && typeof result === 'object' ? result as Record<string, unknown> : null;
    const translatedTextJa = typeof candidate?.translatedTextJa === 'string' ? compact(candidate.translatedTextJa) : '';
    const confidence = typeof candidate?.confidence === 'number' ? candidate.confidence : 0;
    // Kanji-only output can still be Chinese. Require a Japanese kana signal
    // before marking the staff translation as successful; the original stays
    // available whenever this conservative check fails.
    if (!translatedTextJa || confidence < 0.45 || !/[ぁ-ゖァ-ヺ]/u.test(translatedTextJa)) {
      return failedTranslation(originalText, originalLanguage);
    }
    return { originalText, originalLanguage, translatedTextJa, translationStatus: 'translated' };
  } catch (error) {
    console.error('KIKUMAE_TRANSLATION_FAILED', error instanceof Error ? error.message : String(error));
    return failedTranslation(originalText, originalLanguage);
  }
}
