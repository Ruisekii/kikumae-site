# AI runtime audit and Phase 2 boundary

## Current implementation

The published MVP does not claim to be fully local or offline.

- ASR: `BrowserASRProvider` uses `SpeechRecognition` or `webkitSpeechRecognition` when the browser exposes it. It requests interim results and keeps the user-visible listening session alive when the browser ends a silent recognition sub-session.
- ASR privacy: `processLocally` is inspected when the browser exposes the property, but the current browser runtime reports `unknown` unless the API explicitly exposes a boolean. No local language pack is assumed. Web Speech API traffic may therefore be handled by the browser vendor's service.
- VAD: `BrowserVADProvider` obtains the microphone with echo cancellation, noise suppression, and automatic gain control, then runs a lightweight Web Audio RMS level detector. It is not Silero VAD.
- Live subtitles: browser ASR interim results.
- TTS: `BrowserTTSProvider` uses `SpeechSynthesis` and `SpeechSynthesisUtterance`. The selected voice and processing locality are browser-dependent.
- Interruption: current speech synthesis is cancelled before ASR starts. The ASR provider is explicitly stopped after a final transcript and when the resident presses stop.
- Conversation: the normal Phase 2 path calls `POST /api/ai/voice` with `mode=conversation`. When no model gateway is configured or the request fails, `LocalRulesConversationProvider` is used as the safe fallback.
- Incident extraction: the same route accepts `mode=extract`. Its JSON is normalized against `incidentStateJsonSchema` before it can update an Incident Card. The resident's original text is always taken from application state, not model output.
- Staff organization: `mode=organize` and `app/lib/staff-organization.ts` produce an evidence-bound staff card with separate facts, requests, context, emotional state, uncertain points, and Safety signals. This is intentionally not a second mandatory 4B call. Each item keeps source, confirmation state, evidence, and message ID.
- Safety: `Safety Guard` is a local rule lane and runs independently before model output is trusted. It can trigger the first urgent submission immediately.
- Similar incidents: existing D1 issue grouping and similarity logic remain in `db/repository.ts`; the browser `LocalEmbeddingProvider` is only a provider boundary placeholder and is not a Qwen embedding model.

## Canonical Incident State

`app/lib/incident-schema.ts` is the source of truth for the structured state. Conversation text is not used as the staff card. Model output is treated as untrusted JSON and reduced to the schema; unknown or missing values remain `null` or are listed in `missingFields`.

## Phase 2 model gateway

The gateway is OpenAI-compatible over HTTP so it can point to a local vLLM/Ollama-compatible service or another approved internal gateway without exposing credentials to the browser. It is opt-in and is not configured in the current public Site.

Required runtime secrets/configuration:

- `AI_MODEL_MODE` (`auto`, `local-llm`, or `local-rules`; default `auto`)
- `AI_MODEL_BASE_URL`
- `AI_CONVERSATION_MODEL`
- `AI_EXTRACTION_MODEL`
- `AI_MODEL_API_KEY` when the gateway requires it
- `AI_MODEL_TIMEOUT_MS` (optional; local evaluation uses `120000` milliseconds)
- `AI_MODEL_MAX_TOKENS` (optional gateway default; the route uses 120 for Conversation and 260 for Extraction)
- `AI_MODEL_STREAMING` (optional; defaults to streaming and records first-token/generation timings)
- `AI_EXTRACTION_PROMPT_VARIANT` (`full` or `compact`; default `full`)
- `AI_ALLOW_EVAL_MODEL_OVERRIDE=1` (local evaluation only; enables a guarded model/prompt header override and is not set on the public Site)

The runtime has three explicit modes:

- `local-llm`: require the configured OpenAI-compatible local gateway.
- `local-rules`: deliberately disable the model and use the deterministic safety/fallback lane.
- `auto`: try the local gateway and fall back to local-rules on configuration, timeout, invalid JSON, or provider errors.

Conversation and extraction use separate prompts and model selections. The gateway requests `reasoning_effort: none` for low-latency structured output; invalid or unavailable results fall back to local-rules. The current project does not yet ship Qwen, Gemma, Silero, VOICEVOX, or Qwen-TTS weights.

Phase 2B adds detailed request telemetry. The route records client-observable HTTP header wait, first token, prompt-to-first-token wait, body/generation, JSON parse, normalization, Safety Guard, and total times. When the provider returns Ollama server metrics, `prompt_eval_duration`, `eval_duration`, `total_duration`, token counts, and VRAM-related runtime data are recorded separately rather than being inferred as browser latency. The administrator dashboard reads `/api/admin/ai-status` and shows mode, connection, configured models, fallback state, and the independent Safety Guard lane.

Phase 2A was exercised locally with Ollama and `qwen3.5:4b` for both Conversation and Incident Extraction. The 10-case report is generated by `npm run eval:phase2a`; the latest result is stored in `docs/phase2a-evaluation-latest.md` and `.json`. The public Site intentionally has no localhost model configuration, so it remains on the safe local-rules fallback until a reachable internal AI Gateway is configured.

Phase 2A.5 adds a fixed 110-case synthetic regression set in `scripts/phase2a5-cases.mjs`. `npm run eval:phase2a5` compares local-rules and the configured Qwen Incident Extraction route, and records field accuracy, important-fact omission, approximate hallucination, Safety Guard critical recall/precision, and latency in `docs/phase2a5-evaluation-latest.*`. `npm run benchmark:phase2a5` records Ollama cold/warm load and token speed. `npm run eval:phase2a5:conversation` compares Qwen3.5:2B and 4B on the same short Conversation contract. These are evaluation tools; the public Site does not expose the local model.

Phase 2B re-evaluates the fixed 110 cases with stage telemetry and separates the recommended local roles: Qwen3.5:2B for Conversation and Qwen3.5:4B for Incident Extraction. The compact extraction prompt is available for A/B testing, but remains opt-in because the fixed-set schema rate dropped in the comparison. The local development configuration uses the role split; the public Site is unchanged and still falls back to local-rules when no reachable gateway is configured.

Phase 2D removed 4B from the mandatory resident path. Phase 2E further separates roles: Conversation listens and asks at most one missing item, Safety Guard runs independently, and the staff-facing organization card is generated from original text, Safety, resident selections, and validated Incident state. Qwen4B remains an optional asynchronous enrichment lane; it does not replace the original text or staff confirmation. See `docs/design-evolution.md` and `docs/phase2e-final-report.md`.

Phase 2F adds a fixed 100-case synthetic stress/effectiveness evaluation and an A/B human-evaluation protocol. The public fallback lane and local Qwen lane are reported separately. This is an evaluation scaffold, not evidence that staff psychological burden has already been reduced; no participant data has been collected. See `docs/phase2f-final-report.md`, `docs/phase2f-human-evaluation-protocol.md`, and the JSON artifacts under `docs/`.

## Candidate next adapters

- Conversation: Qwen3.5-2B with thinking disabled for low latency (current Phase 2B/2C role).
- Incident extraction: Qwen3.5-4B as optional asynchronous enrichment (current role; not mandatory for intake).
- Future larger extraction models remain unapproved until the same fixed evaluations and field tests show a practical benefit.
- ASR: Qwen3-ASR-0.6B, compared with Qwen3-ASR-1.7B and Kotoba-Whisper v2.2.
- VAD: Silero VAD.
- Similar incident retrieval: Qwen3-Embedding-0.6B.
- TTS: VOICEVOX Engine or Qwen3-TTS-0.6B.

These are candidates, not currently connected components.

## Conditions for “fully local”

The UI and reports must not use “fully local AI”, “works without the internet”, or “audio is never sent externally” until ASR, VAD, conversation, extraction, similarity, TTS, and safety have all been verified with network access disabled in an end-to-end test.
