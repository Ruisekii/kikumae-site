import type { IncidentState } from './voice-conversation';
import type { ShelterIntake } from '../../db/local-ai';

export type VoiceModelMode = 'conversation' | 'extract';
export type VoiceRuntimeMode = 'local-llm' | 'local-rules' | 'auto';

export type VoiceModelRequest = {
  mode: VoiceModelMode;
  text: string;
  state: IncidentState;
  intake: ShelterIntake;
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
  const timeout = setTimeout(() => controller.abort(), 120000);
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
