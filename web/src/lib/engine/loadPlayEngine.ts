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
export async function loadPlayEngine(): Promise<PlayEngineRuntime> {
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const basePath = `/engine-pkg-${hasWebGPU ? 'webgpu' : 'webgl2'}/`;

  const wasm = await import(
    /* webpackIgnore: true */ `${basePath}forge_engine.js`
  );
  await wasm.default(`${basePath}forge_engine_bg.wasm`);

  return wasm as unknown as PlayEngineRuntime;
}
