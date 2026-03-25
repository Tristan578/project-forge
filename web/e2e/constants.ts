/**
 * E2E test timing constants.
 *
 * All timeout values used across Playwright spec files must be imported
 * from this module instead of using inline numeric literals.
 */

/** Short timeout for quick element appearances (e.g. tooltip, toast) */
export const E2E_TIMEOUT_SHORT_MS = 3_000;

/** Standard element visibility timeout */
export const E2E_TIMEOUT_ELEMENT_MS = 5_000;

/** Page / component load timeout */
export const E2E_TIMEOUT_LOAD_MS = 10_000;

/** Navigation timeout (page.goto) */
export const E2E_TIMEOUT_NAV_MS = 15_000;

/** Auth flow timeout */
export const E2E_TIMEOUT_AUTH_MS = 30_000;

/** WASM engine init / hydration timeout */
export const E2E_TIMEOUT_WASM_MS = 45_000;

/** Global per-test timeout */
export const E2E_TIMEOUT_TEST_MS = 60_000;
