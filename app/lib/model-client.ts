import type { IncidentState } from './voice-conversation';
import type { ShelterIntake } from '../../db/local-ai';
import type { ConversationLanguage } from './conversation-language';

export type VoiceModelMode = 'conversation' | 'extract';
export type VoiceRuntimeMode = 'local-llm' | 'local-rules' | 'auto';

export type VoiceModelRequest = {
  mode: VoiceModelMode;
  text: string;
  state: IncidentState;
  intake: ShelterIntake;
  /** The resident-facing conversation language, separate from staff translation. */
  selectedLanguage: ConversationLanguage;
  runtimeMode?: VoiceRuntimeMode;
};

export type VoiceModelResponse = {
  ok?: boolean;
  aiMode?: string;
  runtimeMode?: VoiceRuntimeMode;
  provider?: string;
  reply?: string;
  nextField?: string | null;
  requiresConfirmation?: boolean;
  incident?: unknown;
};

export async function requestVoiceModel(payload: VoiceModelRequest): Promise<VoiceModelResponse> {
  const controller = new AbortController();
  // Conversation is a resident-facing lane. If the local gateway is not
  // reachable, return to the deterministic provider quickly instead of
  // showing a stalled conversation for two minutes. Extraction is deliberately
  // slower and runs in the background, so it keeps the server-side budget.
  const timeout = setTimeout(() => controller.abort(), payload.mode === 'conversation' ? 15000 : 180000);
  try {
    const response = await fetch('/api/ai/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json() as VoiceModelResponse;
    if (!response.ok || data.ok !== true) throw new Error(data.aiMode ?? 'AI_MODEL_UNAVAILABLE');
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
