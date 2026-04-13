/**
 * E2E test timing constants.
 *
 * All timeout values used across Playwright spec files must be imported
 * from this module instead of using inline numeric literals.
 */

/** Very quick probe timeout (e.g. conditional visibility check) */
export const E2E_TIMEOUT_QUICK_MS = 2_000;

/** Short timeout for quick element appearances (e.g. tooltip, toast) */
export const E2E_TIMEOUT_SHORT_MS = 3_000;

/** Standard element visibility timeout */
export const E2E_TIMEOUT_ELEMENT_MS = 5_000;

/** Interaction timeout for UI responses after user actions */
export const E2E_TIMEOUT_INTERACTION_MS = 8_000;

/** Page / component load timeout */
export const E2E_TIMEOUT_LOAD_MS = 10_000;

/** Navigation timeout (page.goto) */
export const E2E_TIMEOUT_NAV_MS = 15_000;

/** Auth flow timeout */
export const E2E_TIMEOUT_AUTH_MS = 30_000;

/** Engine init timeout (reload path after cold start) */
export const E2E_TIMEOUT_ENGINE_INIT_MS = 40_000;

/** WASM engine init / hydration timeout */
export const E2E_TIMEOUT_WASM_MS = 45_000;

/** Global per-test timeout */
export const E2E_TIMEOUT_TEST_MS = 60_000;

/** Full engine cold-start timeout (first load, CI webpack compile) */
export const E2E_TIMEOUT_ENGINE_FULL_MS = 90_000;
