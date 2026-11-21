/**
 * Quantified performance targets for SpawnForge.
 *
 * These targets define measurable budgets for every performance-sensitive
 * surface. CI gates, Lighthouse assertions, and E2E load tests reference
 * these constants instead of hardcoding thresholds.
 *
 * Context: SpawnForge is a browser-based game engine with a WASM rendering
 * backend. Marketing pages are standard Next.js SSR; the editor loads a
 * multi-MB WASM binary and initializes a WebGPU/WebGL2 canvas.
 *
 * ## Consumer files (update when changing thresholds)
 *
 * These files duplicate numeric values because they cannot import TypeScript:
 * - `web/scripts/check-bundle-size.js` — BUNDLE_* constants (CJS script).
 *   This one is PINNED: `scripts/__tests__/check-bundle-size.test.ts` asserts
 *   the script's copies equal the constants below, so it cannot drift silently.
 * - `web/e2e/tests/load-budget.spec.ts` — EDITOR_* constants (Playwright)
 * - `.lighthouserc.js` — CWV_MARKETING_* constants (LHCI config)
 * - `.github/workflows/quality-gates.yml` — WASM_BINARY_* constants (bash)
 *
 * ## Changelog
 *
 * 2026-03-31: Initial creation. Bundle thresholds set at 4.75/5.25/5/5.5 MB
 *   (current build: ~4.56 MB first-load). Previous thresholds: 4/4.75/5/5.5 MB.
 *   WASM thresholds set to match existing CI gate (45 MB warn / 49.5 MB fail).
 * 2026-08-10 (PF-1132): `BUNDLE_FIRST_LOAD_*` replaced by
 *   `BUNDLE_ROUTE_FIRST_LOAD_*`. The old pair was applied to a number that was
 *   never a first-load figure (see the constants below and the header of
 *   `check-bundle-size.js`). `BUNDLE_TOTAL_*` keeps its original values — that
 *   number is unchanged, only its label was wrong.
 *
 * Updated: 2026-08-10
 */

// ---------------------------------------------------------------------------
// Core Web Vitals — marketing pages (/, /pricing, /docs)
// ---------------------------------------------------------------------------

/** LCP target for marketing pages (2026 "Good" threshold) */
export const CWV_MARKETING_LCP_MS = 2500;

/** INP target for marketing pages */
export const CWV_MARKETING_INP_MS = 200;

/** CLS target for marketing pages */
export const CWV_MARKETING_CLS = 0.1;

// ---------------------------------------------------------------------------
// Core Web Vitals — editor (/editor)
// ---------------------------------------------------------------------------

/** LCP target for editor (relaxed — WASM binary fetch) */
export const CWV_EDITOR_LCP_MS = 4000;

/** INP target for editor (interaction latency matters for creative tools) */
export const CWV_EDITOR_INP_MS = 200;

/** CLS target for editor (relaxed — panel resizes are expected) */
export const CWV_EDITOR_CLS = 0.25;

// ---------------------------------------------------------------------------
// API response time budgets (p95)
// ---------------------------------------------------------------------------

/** Health endpoint p95 response time */
export const API_P95_HEALTH_MS = 500;

/** Auth routes p95 response time */
export const API_P95_AUTH_MS = 1000;

/** Standard CRUD routes p95 (projects, scenes, etc.) */
export const API_P95_CRUD_MS = 2000;

/** Standard generation routes p95 (sprite, texture, skybox) */
export const API_P95_GENERATION_MS = 30_000;

/** Heavy generation routes p95 (3D model, music) */
export const API_P95_HEAVY_GENERATION_MS = 90_000;

/** Chat streaming TTFB p95 (time to first token) */
export const API_P95_CHAT_TTFB_MS = 2000;

// ---------------------------------------------------------------------------
// WASM engine loading
// ---------------------------------------------------------------------------

/** WASM fetch + compile cold load target (4G network) */
export const WASM_COLD_LOAD_MS = 8000;

/** WASM fetch + compile warm/cached load target */
export const WASM_WARM_LOAD_MS = 2000;

/** GPU adapter initialization target */
export const GPU_INIT_TARGET_MS = 3000;

// ---------------------------------------------------------------------------
// Bundle size budgets (bytes)
// ---------------------------------------------------------------------------

/**
 * Warning threshold for the HEAVIEST route's first-load JS: the root chunks
 * plus that route's client entry chunks, de-duplicated, as recorded by Next in
 * `build-manifest.json` and the route's `page_client-reference-manifest.js`.
 *
 * Measured on origin/main 2026-08-10 (production build, 27 routes):
 *   /editor/[id]  1.95 MB (23 chunks) — heaviest
 *   /sign-up      1.59 MB — runner-up
 *
 * Replaces `BUNDLE_FIRST_LOAD_WARN`/`_FAIL` (PF-1132). Those were applied to
 * the sum of every top-level file in `.next/static/chunks`, which under
 * Turbopack counts lazily-loaded chunks and counts a module graph once per
 * client entry that reaches it — so it moved by ~50 KB steps on chunk-grouping
 * changes that shipped no new bytes to any route. The prior re-baselines
 * (~4.56 MB 2026-03-31, ~5.28 MB 2026-07-04, creep tracked in #8910) were
 * chasing that accounting artefact as much as real growth.
 */
export const BUNDLE_ROUTE_FIRST_LOAD_WARN = 2.1 * 1024 * 1024;

/** Heaviest-route first-load JS hard failure threshold */
export const BUNDLE_ROUTE_FIRST_LOAD_FAIL = 2.3 * 1024 * 1024;

/**
 * Total JS warning threshold — every `.js` under `.next/static/chunks`,
 * recursively. This is a whole-output ceiling, NOT a first-load figure; it is
 * the number the old `BUNDLE_FIRST_LOAD_*` pair was really measuring. Values
 * unchanged since 2026-03-31 (measured 5.49 MB on origin/main 2026-08-10).
 */
export const BUNDLE_TOTAL_WARN = 5.5 * 1024 * 1024;

/** Total JS hard failure threshold */
export const BUNDLE_TOTAL_FAIL = 6 * 1024 * 1024;

/** WASM binary size warning threshold (per variant, matches quality-gates.yml) */
export const WASM_BINARY_WARN = 45 * 1024 * 1024;

/** WASM binary size hard failure threshold (per variant, 45 MB + 10% tolerance) */
export const WASM_BINARY_FAIL = Math.round(45 * 1024 * 1024 * 1.1);

// ---------------------------------------------------------------------------
// Editor startup
// ---------------------------------------------------------------------------

/** Editor time-to-interactive (canvas visible, no WASM) — local */
export const EDITOR_TTI_LOCAL_MS = 3000;

/** Editor time-to-interactive — CI (slower runners) */
export const EDITOR_TTI_CI_MS = 5000;

/** Editor full engine ready (WASM loaded + first frame) — local */
export const EDITOR_ENGINE_READY_LOCAL_MS = 10_000;

/** Editor full engine ready — CI */
export const EDITOR_ENGINE_READY_CI_MS = 15_000;

/** JS heap budget after editor load (conservative — WASM adds significant heap) */
export const EDITOR_HEAP_BUDGET_MB = 200;
