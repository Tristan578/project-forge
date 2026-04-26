/**
 * Centralized AI model configuration.
 *
 * All AI feature modules MUST import model IDs from here instead of
 * hardcoding strings. When Anthropic releases new model versions,
 * update these constants once — not in 20+ files.
 *
 * Two naming conventions are used:
 *
 * 1. Short names (`AI_MODEL_PRIMARY`, `AI_MODEL_FAST`): provider-agnostic IDs
 *    used by the legacy @anthropic-ai/sdk path and the provider registry's
 *    MODEL_MAP translation layer.
 *
 * 2. Gateway-format names (`GATEWAY_MODEL_CHAT`, etc.): fully-qualified
 *    `provider/model` strings consumed directly by the Vercel AI SDK
 *    `gateway()` provider — e.g. `gateway(GATEWAY_MODEL_CHAT)`.
 *    No translation needed; the gateway resolves the provider prefix.
 */

/** Primary model for complex generation (GDD, world building, tutorials) */
export const AI_MODEL_PRIMARY = 'claude-sonnet-4-6';

/** Fast model for simpler tasks (reviews, behavior trees, quick analysis) */
export const AI_MODEL_FAST = 'claude-haiku-4-5-20251001';

/**
 * Premium model — highest quality, restricted to Pro tier.
 *
 * Routed only when a Pro user explicitly requests it (via the model field
 * in the chat body). The chat route enforces the gate at request time so
 * lower tiers cannot self-promote by passing this string.
 */
export const AI_MODEL_PREMIUM = 'claude-opus-4-7';

// ---------------------------------------------------------------------------
// Gateway-format model strings (for use with AI SDK gateway() provider)
// ---------------------------------------------------------------------------

/** Primary chat model via Vercel AI Gateway — gateway('anthropic/claude-sonnet-4-6') */
export const GATEWAY_MODEL_CHAT = 'anthropic/claude-sonnet-4-6' as const;

/** Fast chat model via Vercel AI Gateway */
export const GATEWAY_MODEL_FAST = 'anthropic/claude-haiku-4-5' as const;

/** Premium chat model via Vercel AI Gateway (Pro tier only) */
export const GATEWAY_MODEL_PREMIUM = 'anthropic/claude-opus-4-7' as const;

/** Embedding model via Vercel AI Gateway */
export const GATEWAY_MODEL_EMBEDDING = 'google/gemini-embedding-2-preview' as const;

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
  /** Premium model — Pro tier only, highest quality (Opus 4.7) */
  premium: AI_MODEL_PREMIUM,
  /** Embedding model used by semantic search (docs, assets) */
  embedding: 'gemini-embedding-2-preview',
  /** Default gateway chat model (routed through Vercel AI Gateway) */
  gatewayChat: GATEWAY_MODEL_CHAT,
  /** Premium gateway model — Pro tier only */
  gatewayPremium: GATEWAY_MODEL_PREMIUM,
  /** Default gateway embedding model */
  gatewayEmbedding: GATEWAY_MODEL_EMBEDDING,
  /** GitHub Models default */
  githubDefault: 'gpt-4o-mini',
  /** OpenRouter default */
  openrouterDefault: GATEWAY_MODEL_CHAT,
} as const;

export type AiModelKey = keyof typeof AI_MODELS;

/**
 * True when the model identifier names a premium-tier (Pro-only) model.
 *
 * Accepts both bare canonical IDs (`claude-opus-4-7`) and gateway-format
 * IDs (`anthropic/claude-opus-4-7`). Compares against a known set rather
 * than a substring so future Opus minor revisions must be opted in
 * explicitly — prevents accidental routing of new models that might be
 * priced differently.
 */
export function isPremiumModel(model: string | undefined | null): boolean {
  if (!model) return false;
  const bare = model.includes('/') ? model.split('/').slice(1).join('/') : model;
  return bare === AI_MODEL_PREMIUM;
}

// ---------------------------------------------------------------------------
// Image generation models (Replicate)
// ---------------------------------------------------------------------------

/** Replicate SDXL model identifier — used with the `model` field (NOT `version`) */
export const REPLICATE_MODEL_SDXL = 'stability-ai/sdxl' as const;
