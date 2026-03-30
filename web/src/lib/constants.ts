/**
 * Shared application constants.
 *
 * This file centralizes commonly-duplicated values that appear across
 * multiple modules. Each constant is annotated with where it is (or
 * should be) used.
 *
 * Organization:
 *  - AI model tokens (max_tokens, thinking tokens)
 *  - Retry/backoff defaults
 *  - Billing / token cost multipliers
 *  - Generation limits (frame counts, batch sizes)
 *
 * Domain-specific constants (timeouts, providers, scopes) live in
 * the more specialized modules under `lib/config/`.
 */

// ---------------------------------------------------------------------------
// AI Model Token Limits
// ---------------------------------------------------------------------------

/**
 * Default max_tokens for Claude API calls (non-extended-thinking mode).
 * Used by: resolveChat.ts, aiSdkAdapter.ts, gameModifier.ts
 */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * Max tokens for extended-thinking (reasoning) mode.
 * Claude requires at least ~10 000 tokens for thinking budget, so 16 384
 * is the practical minimum that allows meaningful reasoning output.
 * Used by: resolveChat.ts, aiSdkAdapter.ts
 */
export const THINKING_MAX_TOKENS = 16384;

// ---------------------------------------------------------------------------
// Retry / Backoff
// ---------------------------------------------------------------------------

/** Default maximum number of attempts for retryWithBackoff. */
export const RETRY_DEFAULT_MAX_ATTEMPTS = 3;

/** Default base delay (ms) for exponential backoff. */
export const RETRY_DEFAULT_BASE_DELAY_MS = 500;

/** Default maximum delay (ms) cap for exponential backoff. */
export const RETRY_DEFAULT_MAX_DELAY_MS = 5_000;

/** Token deduction retry limit — prevents infinite loops on transient DB failures. */
export const TOKEN_DEDUCT_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Billing / Subscription Cycle
// ---------------------------------------------------------------------------

/** Billing cycle length in days (used to compute monthly token allocations). */
export const BILLING_CYCLE_DAYS = 30;

/** Billing cycle in milliseconds (= BILLING_CYCLE_DAYS × 24h × 60m × 60s × 1000ms). */
export const BILLING_CYCLE_MS = BILLING_CYCLE_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Generation Limits
// ---------------------------------------------------------------------------

/** Minimum number of frames for sprite-sheet generation. */
export const SPRITE_SHEET_MIN_FRAMES = 2;

/** Maximum number of frames for sprite-sheet generation. */
export const SPRITE_SHEET_MAX_FRAMES = 8;

/** Token cost per frame for sprite-sheet generation. */
export const SPRITE_SHEET_COST_PER_FRAME = 15;

/** Maximum number of items in a voice batch job. */
export const VOICE_BATCH_MAX_ITEMS = 20;

/** Token cost per item in a voice batch job. */
export const VOICE_BATCH_COST_PER_ITEM = 5;

// ---------------------------------------------------------------------------
// Asset Size Limits
// ---------------------------------------------------------------------------

/** Maximum preview image upload size for marketplace assets (bytes). */
export const MARKETPLACE_MAX_PREVIEW_BYTES = 5 * 1024 * 1024; // 5 MB

/** Maximum asset bundle upload size for marketplace assets (bytes). */
export const MARKETPLACE_MAX_ASSET_BYTES = 100 * 1024 * 1024; // 100 MB

/** Maximum request body size for the AI chat route (bytes). */
export const CHAT_BODY_MAX_BYTES = 1024 * 1024; // 1 MB

// ---------------------------------------------------------------------------
// AI Queue Defaults
// ---------------------------------------------------------------------------

/** Default maximum number of concurrent AI requests in the request queue. */
export const AI_QUEUE_DEFAULT_MAX_CONCURRENT = 3;

/** Default maximum depth of the AI request queue before requests are dropped. */
export const AI_QUEUE_DEFAULT_MAX_DEPTH = 20;

// ---------------------------------------------------------------------------
// Engine Init
// ---------------------------------------------------------------------------

/** Maximum number of retries for the WASM engine initialisation sequence. */
export const ENGINE_INIT_MAX_RETRIES = 3;
