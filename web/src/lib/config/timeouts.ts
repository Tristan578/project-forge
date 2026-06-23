/**
 * Centralized timeout and timing constants.
 *
 * Every numeric timeout in the codebase MUST import from this module.
 * Hardcoded timeout literals in source files are flagged by the
 * pre-commit grep check.
 */

// ---------------------------------------------------------------------------
// E2E / Playwright timeouts
// ---------------------------------------------------------------------------

/** Global Playwright test timeout (per test) */
export const E2E_TEST_TIMEOUT_MS = 60_000;

/** Hydration / WASM engine init wait in E2E tests */
export const E2E_HYDRATION_TIMEOUT_MS = 45_000;

/** Element visibility assertion timeout in E2E tests */
export const E2E_VISIBILITY_TIMEOUT_MS = 30_000;

/** Navigation timeout for Playwright page.goto */
export const E2E_NAVIGATION_TIMEOUT_MS = 30_000;

/** Playwright expect assertion timeout */
export const E2E_EXPECT_TIMEOUT_MS = 15_000;

/** Playwright action (click, fill, etc.) timeout */
export const E2E_ACTION_TIMEOUT_MS = 10_000;

/** Playwright webServer startup timeout */
export const E2E_WEB_SERVER_TIMEOUT_MS = 120_000;

/** Short wait for E2E panel/mode/resize assertions */
export const E2E_SHORT_WAIT_MS = 5_000;

/** Medium wait for E2E entity/canvas assertions */
export const E2E_MEDIUM_WAIT_MS = 10_000;

// ---------------------------------------------------------------------------
// Vitest timeouts
// ---------------------------------------------------------------------------

/** Default vitest test timeout across all workspace configs */
export const VITEST_TEST_TIMEOUT_MS = 30_000;

/** Default vitest hook (beforeEach/afterEach) timeout */
export const VITEST_HOOK_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Engine / WASM loading
// ---------------------------------------------------------------------------

/** GPU capability detection timeout (WebGPU requestAdapter) */
export const GPU_INIT_TIMEOUT_MS = 30_000;

/** WASM binary fetch + compile timeout */
export const WASM_FETCH_TIMEOUT_MS = 60_000;

/** Global engine status timeout (covers GPU + WASM + first frame) */
export const ENGINE_GLOBAL_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// API / Server timeouts
// ---------------------------------------------------------------------------

/** Default Vercel function maxDuration for standard API routes (seconds) */
export const API_MAX_DURATION_DEFAULT_S = 10;

/** maxDuration for AI chat streaming route (seconds) */
export const API_MAX_DURATION_CHAT_S = 120;

/** maxDuration for expensive generation routes (3D model, music) (seconds) */
export const API_MAX_DURATION_HEAVY_GEN_S = 180;

/** maxDuration for standard generation routes (sprite, texture, etc.) (seconds) */
export const API_MAX_DURATION_STANDARD_GEN_S = 60;

/** maxDuration for batch operations (voice batch, localization) (seconds) */
export const API_MAX_DURATION_BATCH_S = 120;

/** maxDuration for simple DB operations (refund) (seconds) */
export const API_MAX_DURATION_SIMPLE_S = 10;

/** Health monitor cron route maxDuration (seconds) */
export const API_MAX_DURATION_CRON_S = 30;

/**
 * Margin (milliseconds) reserved between a generation step's wall-clock cap and
 * the function `maxDuration`. The abort must fire this far *before* Vercel kills
 * the function so the caller's refund-on-failure path still runs while the
 * function is alive.
 */
export const GENERATION_AGENT_TIMEOUT_BUFFER_MS = 5_000;

/**
 * Hard wall-clock cap for a single generation-agent step (milliseconds).
 *
 * The generation agent (PF-916) races each provider `execute` against this
 * deadline and aborts deterministically when exceeded, so a hung provider call
 * can never outlive the function `maxDuration` and strand a token deduction.
 *
 * CRITICAL: this base cap MUST be enforceable on the SHORTEST generate route.
 * Most generate routes (sprite, texture, sfx, voice, etc.) run with
 * `maxDuration = API_MAX_DURATION_STANDARD_GEN_S` (60s). A cap larger than
 * `60s - buffer` could never fire on those routes — Vercel would kill the
 * function first — which is exactly the bug this value used to carry (it was
 * 150_000, > every 60s route). So the cap is pinned below the standard route's
 * budget minus the buffer. It is the DEFAULT step cap (used by
 * {@link runGenerationAgent} when a caller passes no `timeoutMs`) and the floor
 * for the 60s standard route. Per-route enforceability is computed by
 * {@link deriveGenerationStepTimeoutMs}, which derives the cap from each route's
 * OWN `maxDuration` — so heavier routes (localize 120s, model/music 180s) get a
 * correspondingly larger cap and are NOT clamped down to this 60s-route base.
 */
export const GENERATION_AGENT_STEP_TIMEOUT_MS =
  API_MAX_DURATION_STANDARD_GEN_S * 1000 - GENERATION_AGENT_TIMEOUT_BUFFER_MS; // 55_000

/**
 * Derive the enforceable per-step wall-clock cap for a generate route from its
 * Vercel `maxDuration` (seconds). The returned value is always
 * `routeMaxDurationSeconds * 1000 - GENERATION_AGENT_TIMEOUT_BUFFER_MS`, so the
 * step's abort always fires one buffer before the function is killed and the
 * refund path runs while the function is still alive.
 *
 * The cap is derived from the route's OWN budget — it is NOT clamped down to the
 * 60s-route base {@link GENERATION_AGENT_STEP_TIMEOUT_MS}. A longer route
 * (localize 120s, model/music 180s) declares a longer `maxDuration` precisely
 * because its single provider call legitimately takes longer; clamping every
 * route to the 60s base would abort a valid long job early and refund it
 * spuriously (#8833). The route budget is itself bounded by `maxDuration`, so
 * this can never grant an unbounded step. An explicit `configuredMs` override is
 * still clamped down to the route budget.
 *
 * @param routeMaxDurationSeconds the route's `export const maxDuration` value
 * @param configuredMs optional explicit cap; used as-is when below the route
 *   budget, clamped down to the route budget when above it. Omit to use the full
 *   route budget.
 */
export function deriveGenerationStepTimeoutMs(
  routeMaxDurationSeconds: number,
  configuredMs?: number,
): number {
  const routeBudgetMs =
    routeMaxDurationSeconds * 1000 - GENERATION_AGENT_TIMEOUT_BUFFER_MS;
  // Derive from the route's own budget; an explicit override only ever lowers it.
  // Never return a non-positive cap even for a pathologically small maxDuration:
  // floor at 1ms so the timer is always armable.
  const cap =
    configuredMs === undefined ? routeBudgetMs : Math.min(configuredMs, routeBudgetMs);
  return Math.max(1, cap);
}

/** External API call timeout (e.g., OpenAI, Replicate image generation) */
export const EXTERNAL_API_TIMEOUT_MS = 60_000;

/** Replicate status poll timeout */
export const REPLICATE_STATUS_TIMEOUT_MS = 15_000;

/** WebSocket message timeout (MCP transport) */
export const WEBSOCKET_MESSAGE_TIMEOUT_MS = 30_000;

/** Reaper bridge operation timeout */
export const REAPER_BRIDGE_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Rate limiting windows
// ---------------------------------------------------------------------------

/** Default rate limit window for public routes: 5 minutes */
export const RATE_LIMIT_PUBLIC_WINDOW_MS = 5 * 60 * 1000; // 300_000

/** Default rate limit window for admin/authenticated routes: 1 minute */
export const RATE_LIMIT_ADMIN_WINDOW_MS = 60_000;

/** Default rate limit window for moderation/appeal routes: 10 minutes */
export const RATE_LIMIT_APPEAL_WINDOW_MS = 10 * 60 * 1000; // 600_000

/** Default max requests for public routes per window */
export const RATE_LIMIT_PUBLIC_MAX = 30;

/** Default max requests for admin routes per window */
export const RATE_LIMIT_ADMIN_MAX = 10;

/** Default max requests for play/game routes per window */
export const RATE_LIMIT_PLAY_MAX = 60;

// ---------------------------------------------------------------------------
// Debounce / cooldown intervals
// ---------------------------------------------------------------------------

/** Viewport resize debounce interval */
export const DEBOUNCE_VIEWPORT_MS = 100;

/** Transform auto-save debounce interval */
export const DEBOUNCE_TRANSFORM_AUTOSAVE_MS = 2_000;

/** Onboarding tip cooldown */
export const TIP_COOLDOWN_MS = 30_000;

/** Feature gating error TTL */
export const ERROR_TTL_MS = 30_000;

/** Health endpoint cache TTL */
export const HEALTH_CACHE_TTL_MS = 30_000;

/** Bridge manager cache TTL */
export const BRIDGE_CACHE_TTL_MS = 60_000;

/** Docs index empty-response cache TTL */
export const DOCS_EMPTY_CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Circuit breaker timing
// ---------------------------------------------------------------------------

/** Circuit breaker sliding window duration */
export const CIRCUIT_BREAKER_WINDOW_MS = 5 * 60 * 1000;

/** Time before half-open probe after circuit opens */
export const CIRCUIT_BREAKER_HALF_OPEN_MS = 60_000;

// ---------------------------------------------------------------------------
// Webhook retry timing
// ---------------------------------------------------------------------------

/** Default max delay for exponential backoff in webhook retries */
export const WEBHOOK_RETRY_MAX_DELAY_MS = 60_000;
