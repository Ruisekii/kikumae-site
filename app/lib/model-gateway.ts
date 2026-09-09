import { env } from 'cloudflare:workers';

export type ModelRuntimeStatus = {
  mode: 'local-llm' | 'local-rules' | 'auto';
  configured: boolean;
  conversationConfigured: boolean;
  extractionConfigured: boolean;
  provider: 'openai-compatible' | 'not-configured';
  conversationModel: string | null;
  extractionModel: string | null;
  translationModel: string | null;
  extractionPromptVariant: 'full' | 'compact';
  streaming: boolean;
};

function value(name: keyof Cloudflare.Env): string {
  const localProcess = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env[name] ?? localProcess?.[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

function runtimeMode(): ModelRuntimeStatus['mode'] {
  const requested = value('AI_MODEL_MODE');
  return requested === 'local-llm' || requested === 'local-rules' || requested === 'auto' ? requested : 'auto';
}

function promptVariant(): 'full' | 'compact' {
  return value('AI_EXTRACTION_PROMPT_VARIANT') === 'compact' ? 'compact' : 'full';
}

export function allowsEvaluationOverrides(): boolean {
  return value('AI_ALLOW_EVAL_MODEL_OVERRIDE') === '1';
}

function timeoutMs(role: 'conversation' | 'extraction'): number {
  const raw = role === 'conversation' ? value('AI_CONVERSATION_TIMEOUT_MS') : value('AI_MODEL_TIMEOUT_MS');
  const roleSpecific = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(roleSpecific)) return Math.max(3000, Math.min(role === 'conversation' ? 30000 : 180000, Math.round(roleSpecific)));
  return role === 'conversation' ? 15000 : 120000;
}

export function getModelRuntimeStatus(): ModelRuntimeStatus {
  const mode = runtimeMode();
  const baseUrl = value('AI_MODEL_BASE_URL');
  const conversationModel = value('AI_CONVERSATION_MODEL');
  const extractionModel = value('AI_EXTRACTION_MODEL');
  const translationModel = value('AI_TRANSLATION_MODEL') || conversationModel || extractionModel;
  const conversationConfigured = mode !== 'local-rules' && Boolean(baseUrl && conversationModel);
  const extractionConfigured = mode !== 'local-rules' && Boolean(baseUrl && extractionModel);
  return {
    mode,
    // A missing extraction model must not make the resident-facing
    // conversation lane look disconnected.
    configured: conversationConfigured || extractionConfigured,
    conversationConfigured,
    extractionConfigured,
    provider: baseUrl ? 'openai-compatible' : 'not-configured',
    conversationModel: conversationModel || null,
    extractionModel: extractionModel || null,
    translationModel: translationModel || null,
    extractionPromptVariant: promptVariant(),
    streaming: value('AI_MODEL_STREAMING') !== 'false',
  };
}

export type ModelGatewayHealth = {
  state: 'connected' | 'unavailable' | 'disabled' | 'not-configured';
  elapsedMs: number | null;
  detail: string;
};

export async function probeModelGateway(): Promise<ModelGatewayHealth> {
  const status = getModelRuntimeStatus();
  if (status.mode === 'local-rules') return { state: 'disabled', elapsedMs: null, detail: 'local-rulesで無効化' };
  if (!status.configured) return { state: 'not-configured', elapsedMs: null, detail: '接続先未設定' };
  const base = value('AI_MODEL_BASE_URL').replace(/\/$/, '').replace(/\/chat\/completions$/, '');
  const started = performance.now();
  try {
    const response = await fetch(`${base}/models`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2500) });
    return { state: response.ok ? 'connected' : 'unavailable', elapsedMs: Math.round(performance.now() - started), detail: response.ok ? 'モデル一覧を取得' : `HTTP ${response.status}` };
  } catch (error) {
    return { state: 'unavailable', elapsedMs: Math.round(performance.now() - started), detail: error instanceof Error ? error.name : '接続失敗' };
  }
}

function endpoint(): string {
  const base = value('AI_MODEL_BASE_URL').replace(/\/$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function extractJson(content: unknown): unknown {
  if (typeof content !== 'string') return null;
  const clean = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(clean); } catch { return null; }
}

export type ModelRequestOptions = {
  maxTokens?: number;
  stream?: boolean;
  role?: 'conversation' | 'extraction';
};

export type ModelRequestTimings = {
  requestBuildMs: number;
  httpHeadersMs: number;
  firstTokenMs: number | null;
  promptUntilFirstTokenMs: number | null;
  generationMs: number | null;
  bodyReadMs: number;
  jsonParseMs: number;
  totalMs: number;
  stream: boolean;
  promptEvalMs: number | null;
  generationEvalMs: number | null;
  serverTotalMs: number | null;
  modelLoadMs: number | null;
  queueMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
};

export type DetailedModelResult = {
  result: unknown;
  timings: ModelRequestTimings;
};

type ExtractionQueueState = { active: number; waiting: Array<() => void> };
const extractionQueue: ExtractionQueueState = { active: 0, waiting: [] };

function extractionConcurrency(): number {
  const configured = Number(value('AI_EXTRACTION_CONCURRENCY'));
  return Number.isFinite(configured) ? Math.max(1, Math.min(4, Math.round(configured))) : 1;
}

function extractionQueueLimit(): number {
  const configured = Number(value('AI_EXTRACTION_QUEUE_LIMIT'));
  return Number.isFinite(configured) ? Math.max(0, Math.min(20, Math.round(configured))) : 4;
}

/** Keep the slow 4B lane bounded so it cannot starve resident-facing replies. */
export async function withExtractionConcurrency<T>(job: () => Promise<T>): Promise<{ value: T; queueMs: number }> {
  const queuedAt = performance.now();
  if (extractionQueue.active >= extractionConcurrency()) {
    if (extractionQueue.waiting.length >= extractionQueueLimit()) throw new Error('EXTRACTION_QUEUE_FULL');
    await new Promise<void>((resolve) => extractionQueue.waiting.push(resolve));
  }
  const startedAt = performance.now();
  extractionQueue.active += 1;
  try { return { value: await job(), queueMs: Math.round(startedAt - queuedAt) }; }
  finally {
    extractionQueue.active -= 1;
    extractionQueue.waiting.shift()?.();
  }
}

function maxTokens(fallback: number): number {
  const configured = Number(value('AI_MODEL_MAX_TOKENS'));
  return Number.isFinite(configured) ? configured : fallback;
}

export async function requestModelJson(
  model: string,
  system: string,
  user: string,
  responseFormat?: unknown,
  options: ModelRequestOptions = {},
): Promise<unknown> {
  const detailed = await requestModelJsonDetailed(model, system, user, responseFormat, options);
  return detailed.result;
}

type ModelPayload = Record<string, unknown> & {
  choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function serverMetric(payload: Record<string, unknown>, name: string): number | null {
  const direct = numberOrNull(payload[name]);
  if (direct !== null) return direct;
  const nested = payload.timings;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return numberOrNull((nested as Record<string, unknown>)[name]);
  return null;
}

function extractContent(payload: ModelPayload): string {
  const choice = payload.choices?.[0];
  const delta = choice?.delta?.content;
  if (typeof delta === 'string') return delta;
  const message = choice?.message?.content;
  return typeof message === 'string' ? message : '';
}

async function readStreamingJson(response: Response): Promise<{ content: string; firstTokenAt: number | null; lastPayload: ModelPayload }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const payload = await response.json() as ModelPayload;
    return { content: extractContent(payload), firstTokenAt: null, lastPayload: payload };
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let firstTokenAt: number | null = null;
  let lastPayload: ModelPayload = {};
  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    try {
      const payload = JSON.parse(raw) as ModelPayload;
      lastPayload = payload;
      const piece = extractContent(payload);
      if (piece) {
        if (firstTokenAt === null) firstTokenAt = performance.now();
        content += piece;
      }
    } catch {
      // A provider may split a JSON event across chunks; the remaining line is
      // discarded only after the complete SSE line has been assembled.
    }
  };
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    lines.forEach(consumeLine);
  }
  buffer += decoder.decode();
  consumeLine(buffer);
  return { content, firstTokenAt, lastPayload };
}

export async function requestModelJsonDetailed(
  model: string,
  system: string,
  user: string,
  responseFormat?: unknown,
  options: ModelRequestOptions = {},
): Promise<DetailedModelResult> {
  const started = performance.now();
  const stream = options.stream ?? value('AI_MODEL_STREAMING') !== 'false';
  const requestBody = JSON.stringify({
    model,
    temperature: 0.1,
    max_tokens: Math.max(96, Math.min(900, Math.round(options.maxTokens ?? maxTokens(420)))),
    reasoning_effort: 'none',
    stream,
    response_format: responseFormat ?? { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  const requestBuildMs = Math.round(performance.now() - started);
  const apiKey = value('AI_MODEL_API_KEY');
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: requestBody,
    signal: AbortSignal.timeout(timeoutMs(options.role ?? 'extraction')),
  });
  if (!response.ok) throw new Error(`MODEL_GATEWAY_${response.status}`);
  const headersAt = performance.now();
  const bodyStarted = headersAt;
  const streamed = stream
    ? await readStreamingJson(response)
    : await (async () => {
      const payload = await response.json() as ModelPayload;
      return { content: extractContent(payload), firstTokenAt: null, lastPayload: payload };
    })();
  const bodyFinished = performance.now();
  const parseStarted = performance.now();
  const result = extractJson(streamed.content);
  const parseFinished = performance.now();
  const firstTokenAt = streamed.firstTokenAt;
  const promptUntilFirstTokenMs = firstTokenAt === null ? null : Math.max(0, Math.round(firstTokenAt - headersAt));
  const generationMs = firstTokenAt === null ? Math.round(bodyFinished - bodyStarted) : Math.max(0, Math.round(bodyFinished - firstTokenAt));
  const usage = streamed.lastPayload.usage;
  const promptEvalMs = serverMetric(streamed.lastPayload, 'prompt_eval_duration');
  const generationEvalMs = serverMetric(streamed.lastPayload, 'eval_duration');
  const serverTotalMs = serverMetric(streamed.lastPayload, 'total_duration');
  const modelLoadMs = serverMetric(streamed.lastPayload, 'load_duration');
  return {
    result,
    timings: {
      requestBuildMs,
      httpHeadersMs: Math.round(headersAt - started),
      firstTokenMs: firstTokenAt === null ? null : Math.round(firstTokenAt - started),
      promptUntilFirstTokenMs,
      generationMs,
      bodyReadMs: Math.round(bodyFinished - bodyStarted),
      jsonParseMs: Math.round(parseFinished - parseStarted),
      totalMs: Math.round(parseFinished - started),
      stream,
      promptEvalMs: promptEvalMs === null ? null : promptEvalMs / 1_000_000,
      generationEvalMs: generationEvalMs === null ? null : generationEvalMs / 1_000_000,
      serverTotalMs: serverTotalMs === null ? null : serverTotalMs / 1_000_000,
      modelLoadMs: modelLoadMs === null ? null : modelLoadMs / 1_000_000,
      // Ollama's OpenAI-compatible response does not expose scheduler queue
      // time. Keep the field explicit instead of presenting client overhead
      // as a measured queue value.
      queueMs: null,
      promptTokens: numberOrNull(usage?.prompt_tokens),
      completionTokens: numberOrNull(usage?.completion_tokens),
    },
  };
}
