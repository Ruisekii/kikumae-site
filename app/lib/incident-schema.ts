import type { ShelterCategory } from '../../db/local-ai';

export const INCIDENT_SCHEMA_VERSION = '1.0';

export type CanonicalIncidentUrgency = 'unknown' | 'low' | 'normal' | 'medium' | 'high' | 'critical';

export type CanonicalIncidentTarget = {
  type: string | null;
  count: number | null;
  ageGroup: string | null;
};

/**
 * 正本として扱う、会話とは別の案件構造です。
 * AIの自然文要約をこの型に変換できない限り、職員向けカードへは採用しません。
 */
export type CanonicalIncidentState = {
  language: string;
  location: string | null;
  target: CanonicalIncidentTarget | null;
  facts: string[];
  request: string | null;
  urgency: CanonicalIncidentUrgency;
  safetyFlags: string[];
  missingFields: string[];
  askedFields: string[];
  originalText: string[];
  confidence: number | null;
  category: ShelterCategory | null;
};

export const incidentStateJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'kikumae://incident-state/1.0',
  type: 'object',
  additionalProperties: false,
  required: ['language', 'location', 'target', 'facts', 'request', 'urgency', 'safetyFlags', 'missingFields', 'askedFields', 'originalText', 'confidence', 'category'],
  properties: {
    language: { type: 'string' },
    location: { type: ['string', 'null'] },
    target: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['type', 'count', 'ageGroup'],
      properties: {
        type: { type: ['string', 'null'] },
        count: { type: ['integer', 'null'], minimum: 0 },
        ageGroup: { type: ['string', 'null'] },
      },
    },
    facts: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    request: { type: ['string', 'null'] },
    urgency: { type: 'string', enum: ['unknown', 'low', 'normal', 'medium', 'high', 'critical'] },
    safetyFlags: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    missingFields: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    askedFields: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    originalText: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    category: { type: ['string', 'null'] },
  },
} as const;

const URGENCY_VALUES = new Set<CanonicalIncidentUrgency>(['unknown', 'low', 'normal', 'medium', 'high', 'critical']);
const CATEGORIES = new Set<ShelterCategory>(['水・飲料', '食料・物資', '医療・薬', 'トイレ・衛生', '設備・充電', 'ペット', '安全・その他', 'その他']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : null;
}

function stringList(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value)) return null;
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function integerOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(999, Math.round(value)));
}

function confidenceOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

/** Model output is untrusted. Keep only schema-shaped values and preserve the raw text from the app state. */
export function normalizeIncidentCandidate(value: unknown, fallback: CanonicalIncidentState): CanonicalIncidentState {
  const source = record(value);
  if (!source) return fallback;
  const targetSource = source.target === null ? null : record(source.target);
  const target = targetSource ? {
    type: stringOrNull(targetSource.type),
    count: integerOrNull(targetSource.count),
    ageGroup: stringOrNull(targetSource.ageGroup),
  } : source.target === null ? null : fallback.target;
  const urgency = typeof source.urgency === 'string' && URGENCY_VALUES.has(source.urgency as CanonicalIncidentUrgency)
    ? source.urgency as CanonicalIncidentUrgency
    : fallback.urgency;
  const category = typeof source.category === 'string' && CATEGORIES.has(source.category as ShelterCategory)
    ? source.category as ShelterCategory
    : fallback.category;
  return {
    language: typeof source.language === 'string' && source.language.trim() ? source.language.trim().slice(0, 16) : fallback.language,
    location: source.location === null ? null : stringOrNull(source.location) ?? fallback.location,
    target,
    facts: stringList(source.facts, 20) ?? fallback.facts,
    request: source.request === null ? null : stringOrNull(source.request) ?? fallback.request,
    urgency,
    safetyFlags: stringList(source.safetyFlags, 20) ?? fallback.safetyFlags,
    missingFields: stringList(source.missingFields, 12) ?? fallback.missingFields,
    askedFields: stringList(source.askedFields, 12) ?? fallback.askedFields,
    originalText: fallback.originalText,
    confidence: source.confidence === null ? null : confidenceOrNull(source.confidence) ?? fallback.confidence,
    category,
  };
}

