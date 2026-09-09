declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    KIKUMAE_OWNER_USER_ID?: string;
    KIKUMAE_ADMIN_PASSWORD?: string;
    /** Optional OpenAI-compatible gateway for Phase 2 conversation/extraction models. */
    AI_MODEL_BASE_URL?: string;
    AI_MODEL_API_KEY?: string;
    AI_CONVERSATION_MODEL?: string;
    AI_EXTRACTION_MODEL?: string;
    AI_MODEL_MODE?: string;
    AI_MODEL_TIMEOUT_MS?: string;
    AI_CONVERSATION_TIMEOUT_MS?: string;
    AI_MODEL_MAX_TOKENS?: string;
    AI_MODEL_STREAMING?: string;
    AI_EXTRACTION_PROMPT_VARIANT?: string;
    AI_ALLOW_EVAL_MODEL_OVERRIDE?: string;
  }
}
