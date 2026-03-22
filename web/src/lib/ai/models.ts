/**
 * Centralized AI model configuration.
 *
 * All AI feature modules MUST import model IDs from here instead of
 * hardcoding strings. When Anthropic releases new model versions,
 * update these constants once — not in 20+ files.
 *
 * Canonical model IDs are provider-agnostic short names. Provider backends
 * (vercelGateway, openrouter, githubModels) translate them to their own
 * namespaced IDs (e.g. 'anthropic/claude-sonnet-4-6') via their MODEL_MAP.
 */

/** Primary model for complex generation (GDD, world building, tutorials) */
export const AI_MODEL_PRIMARY = 'claude-sonnet-4-5-20250929';

/** Fast model for simpler tasks (reviews, behavior trees, quick analysis) */
export const AI_MODEL_FAST = 'claude-haiku-4-5-20251001';

/**
 * Centralized model constants object.
 *
 * Use named keys rather than raw strings throughout the codebase. Each key
 * represents a semantic role so callers don't need to know the exact version
 * string.
 */
export const AI_MODELS = {
  /** Primary chat/generation model — complex tasks, high quality output */
  chat: AI_MODEL_PRIMARY,
  /** Fast/cheap model — reviews, quick analysis, behavior trees */
  fast: AI_MODEL_FAST,
  /** Embedding model used by semantic search (docs, assets) */
  embedding: 'gemini-embedding-2-preview',
  /** Default gateway chat model (routed through Vercel AI Gateway) */
  gatewayChat: 'anthropic/claude-sonnet-4-6',
  /** Default gateway embedding model */
  gatewayEmbedding: 'google/gemini-embedding-2-preview',
  /** GitHub Models default */
  githubDefault: 'gpt-4o-mini',
  /** OpenRouter default */
  openrouterDefault: 'anthropic/claude-sonnet-4-6',
} as const;

export type AiModelKey = keyof typeof AI_MODELS;
