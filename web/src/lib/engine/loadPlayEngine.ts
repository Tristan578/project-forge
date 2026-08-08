/**
 * WASM engine loader for the public `/play` surface.
 *
 * This exists as its own module purely to be a **test seam**. The import
 * specifier is a computed template literal (`${basePath}forge_engine.js`),
 * which Vitest cannot intercept — `useEngine.test.ts` documents why mocking
 * the dynamic import directly is intractable. A named module CAN be mocked, so
 * `GamePlayer` calls this and tests replace it wholesale.
 *
 * Keep this a leaf: `/play` is the public, unauthenticated bundle and must not
 * pull in the editor's engine graph.
 */

/** The subset of the wasm-bindgen surface `/play` actually calls. */
export interface PlayEngineRuntime {
  init_engine: (canvasId: string) => void;
  handle_command: (command: string, payload: unknown) => unknown;
  set_event_callback: (callback: (event: unknown) => void) => void;
}

/**
 * Pick the engine build, load its JS glue, and instantiate the WASM binary.
 *
 * The glue and the binary MUST come from the same origin — wasm-bindgen bakes
 * the import path into the glue, so a split origin fails to instantiate.
 *
 * Note this selects the backend with a bare `'gpu' in navigator` check rather
 * than the editor's hardened `probeWebGPU()` adapter request. A browser that
 * exposes `navigator.gpu` but fails to hand out an adapter will pick the
 * `webgpu` build and fail at init — bounded by the caller's deadline, but a
 * fallback would be better. Tracked separately.
 */
async function instantiate(): Promise<PlayEngineRuntime> {
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const basePath = `/engine-pkg-${hasWebGPU ? 'webgpu' : 'webgl2'}/`;

  const wasm = await import(
    /* webpackIgnore: true */ `${basePath}forge_engine.js`
  );
  await wasm.default(`${basePath}forge_engine_bg.wasm`);

  return wasm as unknown as PlayEngineRuntime;
}

/**
 * In-flight/settled latch. `null` means "no load has been started, or the last
 * one failed".
 */
let loadLatch: Promise<PlayEngineRuntime> | null = null;

/**
 * Load the engine at most once per page.
 *
 * The caller bounds this with a deadline, and a deadline does NOT cancel the
 * work it gave up on — `withTimeout` races a timer against the promise, it
 * cannot abort a dynamic `import()` or a wasm-bindgen instantiation. So a
 * timeout leaves the previous attempt still running, and the retry it offers
 * would otherwise call `wasm.default()` a second time on the same glue module
 * while the first instantiation is still in flight: two WASM instances racing
 * to overwrite the module-level binding the exports close over, at double the
 * memory. The latch makes the retry *join* the attempt already running and
 * grant it another deadline's worth of time, rather than starting a rival one.
 *
 * A rejection clears the latch — that attempt produced no instance, so the next
 * call must genuinely retry. Fulfilment is cached forever: wasm-bindgen's init
 * is not idempotent, so there must never be a second one.
 *
 * `useEngine.loadWasm()` carries the same latch for the editor (PF-585); this
 * is deliberately a separate copy rather than a shared import, because `/play`
 * is the public bundle and must not pull in the editor's engine graph.
 */
export function loadPlayEngine(): Promise<PlayEngineRuntime> {
  if (loadLatch) return loadLatch;

  const attempt = instantiate();
  loadLatch = attempt;

  attempt.catch(() => {
    // Guarded so a late rejection can't clear a latch that has already been
    // replaced by a newer attempt.
    if (loadLatch === attempt) loadLatch = null;
  });

  return attempt;
}
