import { env } from 'cloudflare:workers';

export type ModelRuntimeStatus = {
  configured: boolean;
  provider: 'openai-compatible' | 'not-configured';
  conversationModel: string | null;
  extractionModel: string | null;
};

function value(name: keyof Cloudflare.Env): string {
  const raw = env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

export function getModelRuntimeStatus(): ModelRuntimeStatus {
  const baseUrl = value('AI_MODEL_BASE_URL');
  const conversationModel = value('AI_CONVERSATION_MODEL');
  const extractionModel = value('AI_EXTRACTION_MODEL');
  return {
    configured: Boolean(baseUrl && conversationModel && extractionModel),
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

export async function requestModelJson(model: string, system: string, user: string): Promise<unknown> {
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
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`MODEL_GATEWAY_${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  return extractJson(payload.choices?.[0]?.message?.content);
}

