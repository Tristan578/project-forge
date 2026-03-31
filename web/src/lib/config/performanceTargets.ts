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
 * Updated: 2026-03-31
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

/** First-load JS warning threshold */
export const BUNDLE_FIRST_LOAD_WARN = 3.5 * 1024 * 1024;

/** First-load JS hard failure threshold */
export const BUNDLE_FIRST_LOAD_FAIL = 4 * 1024 * 1024;

/** Total JS warning threshold */
export const BUNDLE_TOTAL_WARN = 4.5 * 1024 * 1024;

/** Total JS hard failure threshold */
export const BUNDLE_TOTAL_FAIL = 5 * 1024 * 1024;

/** WASM binary size warning threshold (per variant) */
export const WASM_BINARY_WARN = 15 * 1024 * 1024;

/** WASM binary size hard failure threshold (per variant) */
export const WASM_BINARY_FAIL = 20 * 1024 * 1024;

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

/** JS heap budget after editor load */
export const EDITOR_HEAP_BUDGET_MB = 150;
