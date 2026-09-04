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
 *    used by the direct @ai-sdk/anthropic path and the provider registry's
 *    MODEL_MAP translation layer.
 *
 * 2. Gateway-format names (`GATEWAY_MODEL_CHAT`, etc.): fully-qualified
 *    `provider/model` strings consumed directly by the Vercel AI SDK
 *    `gateway()` provider — e.g. `gateway(GATEWAY_MODEL_CHAT)`.
 *    No translation needed; the gateway resolves the provider prefix.
 */

// ---------------------------------------------------------------------------
// Legacy 4.x identifiers — kept for rollback, NOT the live defaults
// ---------------------------------------------------------------------------

/**
 * The 4.x ids this file pointed at before the Claude 5 migration (PF-1216 /
 * #9339). They stay exported and stay in every backend MODEL_MAP, so rolling
 * the product back is a one-line edit — point `AI_MODEL_PRIMARY` /
 * `AI_MODEL_PREMIUM` at these and nothing else has to change.
 *
 * That rollback does NOT revert the `thinking` request shape, and should not:
 * `thinkingModeFor()` keys off the model string, not this constant, and
 * `claude-sonnet-4-6` / `claude-opus-4-8` both already resolve to `adaptive`
 * there (Sonnet 4.6+, Opus 4.7+) — the same shape their Claude 5
 * replacements get. Neither 4.x id ever accepted the legacy
 * `{ type: 'enabled', budgetTokens }` form.
 */
export const AI_MODEL_PRIMARY_4X = 'claude-sonnet-4-6' as const;
/** @see AI_MODEL_PRIMARY_4X */
export const AI_MODEL_PREMIUM_4X = 'claude-opus-4-8' as const;

/**
 * Primary model for complex generation (GDD, world building, tutorials).
 *
 * This is the incident-response lever (PR #9672 review, dx finding): a
 * runtime `process.env` override was deliberately NOT added here. Doing so
 * would make this a plain `string` instead of a literal type, which widens
 * `ChatModel` (`chatStore.ts`) — `typeof AI_MODEL_PRIMARY | typeof
 * AI_MODEL_FAST | typeof AI_MODEL_PREMIUM` — to effectively `string`,
 * silently defeating the type it exists to constrain (`ChatInput.tsx`'s
 * model-select prop, `setModel()`'s parameter). The rollback path above
 * (repoint this constant at `AI_MODEL_PRIMARY_4X`) stays a code edit on
 * purpose: it goes through review and keeps the literal type intact, at the
 * cost of a deploy instead of an env var flip.
 */
export const AI_MODEL_PRIMARY = 'claude-sonnet-5';

/**
 * Fast model for simpler tasks (reviews, behavior trees, quick analysis).
 *
 * Deliberately NOT migrated to the Claude 5 family: there is no Haiku 5 in the
 * installed provider's model union (`@ai-sdk/anthropic` 4.0.45), and Haiku 4.5
 * is the only chat model we route that still requires the legacy
 * `{ type: 'enabled', budgetTokens }` thinking shape — see `thinkingModeFor()`
 * below.
 */
export const AI_MODEL_FAST = 'claude-haiku-4-5-20251001';

/**
 * Premium model — highest quality, restricted to Pro tier.
 *
 * Routed only when a Pro user explicitly requests it (via the model field
 * in the chat body). The chat route enforces the gate at request time so
 * lower tiers cannot self-promote by passing this string.
 */
export const AI_MODEL_PREMIUM = 'claude-opus-5';

/**
 * Deep model for highest-quality single-shot generations where latency
 * is secondary to output fidelity (GDD authoring, world building, cutscenes).
 * Routed via the feature flag helper in `deepTier.ts`. Falls back to
 * AI_MODEL_PRIMARY when the flag is off. Aliases AI_MODEL_PREMIUM — same
 * Opus 5 model, separate semantic role (deep generators vs. user request).
 */
export const AI_MODEL_DEEP = AI_MODEL_PREMIUM;

// ---------------------------------------------------------------------------
// Gateway-format model strings (for use with AI SDK gateway() provider)
// ---------------------------------------------------------------------------

/**
 * Primary chat model via Vercel AI Gateway — gateway('anthropic/claude-sonnet-5').
 * Derived from `AI_MODEL_PRIMARY` so the rollback documented on
 * `AI_MODEL_PRIMARY_4X` actually changes the gateway route too, not just the
 * direct-backend one.
 */
export const GATEWAY_MODEL_CHAT = `anthropic/${AI_MODEL_PRIMARY}` as const;

/**
 * Fast chat model via Vercel AI Gateway.
 *
 * NOTE (unverified): the `GatewayModelId` union in the installed
 * `@ai-sdk/gateway` spells Anthropic point releases with a DOT —
 * `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-4.6`,
 * `anthropic/claude-opus-4.8` — while this constant and both backend
 * MODEL_MAPs have always used a dash. The union has a `(string & {})` escape
 * hatch so TypeScript never caught it. The Claude 5 ids above have no point
 * release, so `anthropic/claude-sonnet-5` / `anthropic/claude-opus-5` match
 * the union exactly either way; only this Haiku string is still ambiguous.
 * Left as-is deliberately — it is a pre-existing production routing string
 * and nothing in this repo can prove which spelling the live Gateway accepts.
 * Not derived from `AI_MODEL_FAST` like the other two: that constant carries
 * a `-20251001` date suffix this gateway string must not repeat.
 */
export const GATEWAY_MODEL_FAST = 'anthropic/claude-haiku-4-5' as const;

/**
 * Premium chat model via Vercel AI Gateway (Pro tier only). Derived from
 * `AI_MODEL_PREMIUM` — see `GATEWAY_MODEL_CHAT` above for why.
 */
export const GATEWAY_MODEL_PREMIUM = `anthropic/${AI_MODEL_PREMIUM}` as const;

/** Deep chat model via Vercel AI Gateway — alias of GATEWAY_MODEL_PREMIUM */
export const GATEWAY_MODEL_DEEP = GATEWAY_MODEL_PREMIUM;

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
  /** Premium model — Pro tier only, highest quality (Opus 5) */
  premium: AI_MODEL_PREMIUM,
  /** Deep model — highest-quality generation for GDD, world building, cutscenes */
  deep: AI_MODEL_DEEP,
  /** Gateway-format deep model string */
  gatewayDeep: GATEWAY_MODEL_DEEP,
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
 * Strip a `provider/` prefix, leaving the bare canonical model id.
 * `anthropic/claude-opus-5` → `claude-opus-5`; a bare id passes through.
 */
export function bareModelId(model: string): string {
  return model.includes('/') ? model.split('/').slice(1).join('/') : model;
}

/**
 * Ordered fallback models the AI Gateway may route to when `model` is
 * unavailable (#9631): premium falls back to chat then fast; chat falls back
 * to fast; fast has nothing cheaper to fall back to. Unknown ids (another
 * provider's model) get no fallback rather than a guess.
 */
export function gatewayFallbackModels(model: string | undefined | null): string[] {
  const chain: string[] = [GATEWAY_MODEL_PREMIUM, GATEWAY_MODEL_CHAT, GATEWAY_MODEL_FAST];
  const index = model ? chain.indexOf(model) : -1;
  return index < 0 ? [] : chain.slice(index + 1);
}

/**
 * True when the model identifier names a premium-tier (Pro-only) model.
 *
 * Accepts both bare canonical IDs (`claude-opus-5`) and gateway-format
 * IDs (`anthropic/claude-opus-5`). Compares against a known set rather
 * than a substring so future Opus minor revisions must be opted in
 * explicitly — prevents accidental routing of new models that might be
 * priced differently. That known set includes `AI_MODEL_PREMIUM_4X`: a
 * caller that explicitly requests the pre-migration Opus id (a rollback, or
 * a stale request replayed from before this PR) must still gate on the
 * premium tier, not slip through as a non-premium model.
 */
export function isPremiumModel(model: string | undefined | null): boolean {
  if (!model) return false;
  const bare = bareModelId(model);
  return bare === AI_MODEL_PREMIUM || bare === AI_MODEL_PREMIUM_4X;
}

// ---------------------------------------------------------------------------
// Extended-thinking / reasoning-effort capability table
// ---------------------------------------------------------------------------

/**
 * Hard token budget used by the legacy `{ type: 'enabled', budgetTokens }`
 * thinking shape. One constant so the 4.x rollback path has a single knob.
 */
export const THINKING_BUDGET_TOKENS = 10_000;


// ---------------------------------------------------------------------------
// Extended thinking / effort support per model (#9626)
// ---------------------------------------------------------------------------

/**
 * Which extended-thinking request shape a Claude model accepts.
 *
 * The Anthropic API is not uniform across the Claude 4 family. Opus 4.7+,
 * Sonnet 4.6+ and every model from 4.7 onward (Claude 5 included) accept only
 * the adaptive form (`{ type: 'adaptive' }`) and answer the legacy budget form
 * with HTTP 400; Haiku 4.5 and earlier accept only the budget form
 * (`{ type: 'enabled', budgetTokens }`) and answer adaptive with HTTP 400.
 * Emitting one shape for every model — which is what the chat route did —
 * 400s a Pro user with the thinking toggle on and the premium model selected.
 *
 * - `adaptive`: emit `{ type: 'adaptive' }`
 * - `budget`:   emit `{ type: 'enabled', budgetTokens }`
 * - `none`:     not a Claude model that supports extended thinking; emit nothing
 */
export type ThinkingMode = 'adaptive' | 'budget' | 'none';

interface ClaudeVersion {
  family: string;
  major: number;
  minor: number;
}

/**
 * Parse `claude-<family>-<major>-<minor>[-date]` (and the dotted
 * `claude-<family>-<major>.<minor>` spelling used in some fixtures) from a bare
 * or gateway-format id. Legacy `claude-3-x-<family>` ids parse with the numbers
 * first. Returns null for anything that is not a Claude id.
 */
function parseClaudeVersion(model: string): ClaudeVersion | null {
  const bare = model.includes('/') ? model.split('/').slice(1).join('/') : model;
  const modern = /^claude-([a-z]+)-(\d+)(?:[.-](\d+))?(?:$|[-.])/.exec(bare);
  if (modern) {
    return { family: modern[1], major: Number(modern[2]), minor: modern[3] === undefined ? 0 : Number(modern[3]) };
  }
  const legacy = /^claude-(\d+)(?:[.-](\d+))?-([a-z]+)/.exec(bare);
  if (legacy) {
    return { family: legacy[3], major: Number(legacy[1]), minor: legacy[2] === undefined ? 0 : Number(legacy[2]) };
  }
  return null;
}

export function thinkingModeFor(model: string | undefined | null): ThinkingMode {
  if (!model) return 'none';
  const v = parseClaudeVersion(model);
  if (!v) return 'none';
  if (v.major >= 5) return 'adaptive';
  if (v.major === 4) {
    if (v.minor >= 7) return 'adaptive';
    if (v.family === 'sonnet' && v.minor >= 6) return 'adaptive';
    return 'budget';
  }
  // Claude 3.7 introduced extended thinking (budget form); nothing older has it.
  if (v.major === 3 && v.minor >= 7) return 'budget';
  return 'none';
}

/**
 * `providerOptions.anthropic.effort` is accepted exactly where adaptive
 * thinking is (Opus 4.7+, Sonnet 4.6+, Claude 5); Haiku 4.5 answers it with
 * HTTP 400. The chat route accepts `effort` from any Creator/Pro request body,
 * so the agent must drop it for models that reject it.
 */
export function supportsEffort(model: string | undefined | null): boolean {
  return thinkingModeFor(model) === 'adaptive';
}

/** The `providerOptions.anthropic.thinking` literal for a given model. */
export type AnthropicThinkingOption =
  | { type: 'adaptive'; display?: 'summarized' | 'omitted' }
  | { type: 'enabled'; budgetTokens: number };

/**
 * Build the `providerOptions.anthropic.thinking` literal for a model, or
 * `undefined` when the model has no supported shape (caller omits the field).
 *
 * `display` is intentionally not set on the adaptive shape: nothing in the app
 * streams reasoning to the UI today (`/api/chat` never passes `sendReasoning`),
 * so there is no demonstrated need. Add `display: 'summarized'` here — in this
 * one place — if and when reasoning is surfaced.
 */
export function anthropicThinkingOption(
  model: string | undefined | null,
): AnthropicThinkingOption | undefined {
  switch (thinkingModeFor(model)) {
    case 'adaptive':
      return { type: 'adaptive' };
    case 'budget':
      return { type: 'enabled', budgetTokens: THINKING_BUDGET_TOKENS };
    case 'none':
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Image generation models (Replicate)
// ---------------------------------------------------------------------------

/** Replicate SDXL model identifier — used with the `model` field (NOT `version`) */
export const REPLICATE_MODEL_SDXL = 'stability-ai/sdxl' as const;
