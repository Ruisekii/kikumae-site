import { env } from 'cloudflare:workers';

export type ModelRuntimeStatus = {
  mode: 'local-llm' | 'local-rules' | 'auto';
  configured: boolean;
  provider: 'openai-compatible' | 'not-configured';
  conversationModel: string | null;
  extractionModel: string | null;
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

function timeoutMs(): number {
  const configured = Number(value('AI_MODEL_TIMEOUT_MS'));
  return Number.isFinite(configured) ? Math.max(3000, Math.min(180000, Math.round(configured))) : 120000;
}

export function getModelRuntimeStatus(): ModelRuntimeStatus {
  const mode = runtimeMode();
  const baseUrl = value('AI_MODEL_BASE_URL');
  const conversationModel = value('AI_CONVERSATION_MODEL');
  const extractionModel = value('AI_EXTRACTION_MODEL');
  return {
    mode,
    configured: mode !== 'local-rules' && Boolean(baseUrl && conversationModel && extractionModel),
    provider: baseUrl ? 'openai-compatible' : 'not-configured',
    conversationModel: conversationModel || null,
    extractionModel: extractionModel || null,
  };
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

export async function requestModelJson(model: string, system: string, user: string, responseFormat?: unknown): Promise<unknown> {
  const apiKey = value('AI_MODEL_API_KEY');
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 700,
      reasoning_effort: 'none',
      response_format: responseFormat ?? { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) throw new Error(`MODEL_GATEWAY_${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  return extractJson(payload.choices?.[0]?.message?.content);
}
