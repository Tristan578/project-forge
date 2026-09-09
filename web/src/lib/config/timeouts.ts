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

/**
 * Timeout for Testing Library's async utilities (`findBy*`, `waitFor`).
 *
 * Testing Library defaults this to 1000ms, and that default is measured in WALL
 * CLOCK. In a ~900-file run across many worker threads, a thread can simply not
 * be scheduled for a second, and a `findBy*` then fails while the component
 * under test is behaving perfectly. Observed on
 * `EditorLayout.test.tsx > opens keyboard shortcuts panel`, which passes alone
 * and fails in the full suite: the panel it waits for is a `vi.mock`'d stub that
 * renders instantly, so nothing slow is involved.
 *
 * The wait cannot be removed. Those panels are behind `React.lazy`, and Vitest
 * settles a dynamic import on a MACROTASK, so no amount of microtask flushing
 * (`await act(async () => {})`) resolves the boundary -- verified by trying it.
 * Polling is genuinely required.
 *
 * This budget therefore only bounds how long a wait may take before failing. It
 * asserts nothing about behaviour: a component that never renders still fails,
 * and nothing incorrect starts passing. It is deliberately far below
 * VITEST_TEST_TIMEOUT_MS so a genuinely hung wait still surfaces as a specific
 * "unable to find element" rather than an opaque test timeout.
 */
export const VITEST_ASYNC_UTIL_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Engine / WASM loading
// ---------------------------------------------------------------------------

/** GPU capability detection timeout (WebGPU requestAdapter) */
export const GPU_INIT_TIMEOUT_MS = 30_000;

/** WASM binary fetch + compile timeout */
export const WASM_FETCH_TIMEOUT_MS = 60_000;

/** Global engine status timeout (covers GPU + WASM + first frame) */
export const ENGINE_GLOBAL_TIMEOUT_MS = 30_000;

/**
 * Deadline for the published-game metadata fetch on `/play`.
 *
 * Bounds the "Loading game..." spinner. Deliberately much shorter than the
 * engine budget: this is a single JSON round-trip to our own API, so anything
 * approaching the engine's 30s means the request is not coming back.
 */
export const PLAY_GAME_FETCH_TIMEOUT_MS = 15_000;

/**
 * Settle delay between `load_scene` and entering play mode on `/play`.
 *
 * Bevy needs a frame or two to finish spawning the loaded scene before the
 * `play` command is meaningful.
 */
export const PLAY_ENGINE_SETTLE_MS = 500;

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

/**
 * Upper bound on one Upstash REST round-trip (`lib/upstash/restCommand.ts`):
 * the distributed rate limiter, its `/api/health` probe, the SDK limiter's own
 * `timeout`, and the response cache all use it. The limiter runs in front of
 * every rate-limited route and its degrade path only engages when the call
 * THROWS, so a stalled connection would otherwise hold the route for the
 * function's whole maxDuration.
 */
export const UPSTASH_REST_TIMEOUT_MS = 3_000;

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

/**
 * Rate limit window for the Core Web Vitals beacon (`/api/vitals`): 1 minute.
 *
 * Deliberately shorter than the 5-minute public default so a burst of page
 * views recovers quickly instead of locking a visitor out for minutes.
 */
export const RATE_LIMIT_VITALS_WINDOW_MS = 60_000;

/**
 * Max `/api/vitals` beacons per window, per IP.
 *
 * Derived from the endpoint's real traffic shape rather than picked round.
 * `web-vitals` reports five metrics per page view (LCP, FCP, CLS, INP, TTFB),
 * and CLS and INP are re-reported on each visibility-change flush, so a single
 * page view costs roughly 5-8 beacons. The previous budget of 10/minute was
 * therefore under two page views: a visitor who opened a third page inside a
 * minute had their telemetry silently dropped, and every visitor behind one
 * shared egress IP (corporate NAT, carrier CGNAT, a campus) shared that same
 * budget, so vitals from those networks were mostly 429s.
 *
 * 60/minute covers a heavy ~10-page-view burst with headroom while still
 * bounding abuse — the endpoint persists nothing and only emits a log line.
 */
export const RATE_LIMIT_VITALS_MAX = 60;

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

/**
 * Feature gating success TTL (#9725). The capabilities body is per-user (BYOK),
 * so a session-long client cache would keep serving the previous user's
 * availability after a sign-out/sign-in. Matches the route's
 * `Cache-Control: private, max-age=60`.
 */
export const CAPABILITIES_TTL_MS = 60_000;

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
