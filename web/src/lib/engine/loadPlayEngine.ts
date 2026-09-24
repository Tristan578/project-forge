/**
 * WASM engine loader for the public `/play` surface.
 *
 * This exists as its own module purely to be a **test seam**. The import
 * specifier is a computed template literal (`${basePath}forge_engine.js`),
 * which Vitest can only intercept with a `vi.doMock` of the exact resolved
 * path (`useEngine.backend.test.ts` does that with a fixture tree). A named
 * module CAN be mocked, so `GamePlayer` calls this and tests replace it
 * wholesale; the loader itself takes an injectable importer for the same
 * reason.
 *
 * Keep this a leaf: `/play` is the public, unauthenticated bundle and must not
 * pull in the editor's engine graph. That is why the CDN resolution below is a
 * copy of `useEngine.getWasmBasePaths`, not an import of it — a parity test in
 * `loadPlayEngine.test.ts` pins the two copies to the same output.
 */

import { withTimeout } from '@/lib/async/withTimeout';
import { GPU_INIT_TIMEOUT_MS, PLAY_ENGINE_ORIGIN_TIMEOUT_MS } from '@/lib/config/timeouts';

/** The subset of the wasm-bindgen surface `/play` actually calls. */
export interface PlayEngineRuntime {
  init_engine: (canvasId: string) => void;
  handle_command: (command: string, payload: unknown) => unknown;
  set_event_callback: (callback: (event: unknown) => void) => void;
}

/**
 * Where the engine is served from, in the order to try (#7580).
 *
 * Until this existed, `/play` hardcoded the same-origin `/engine-pkg-*` path
 * and never consulted the engine CDN — only the editor did — so every player
 * pulled several megabytes of WASM through the Vercel origin while the CDN
 * that exists for exactly that sat unused. The play CSP already allowed the
 * CDN origin (`playCspOptionsFromEnv` → `engineCdn`); the loader just never
 * asked for it.
 *
 * Both variables MUST be read as literal `process.env.NEXT_PUBLIC_*` member
 * expressions: Next.js inlines only the fully-qualified form into the browser
 * bundle, so an aliased or destructured read is `undefined` in production and
 * the CDN path silently disappears (same rule as `mcpBridgeEnabled()`).
 *
 * The versioned prefix (`<cdn>/<sha>/`) carries immutable Cache-Control from
 * the upload step; `/latest/` is a short-TTL alias for builds with no version.
 * The same-origin path is always last: it is what serves local dev and a
 * self-hosted deploy, and it is the fallback when the CDN load fails.
 */
export function getPlayEngineBasePaths(backend: 'webgpu' | 'webgl2'): string[] {
  const cdnBase = (process.env.NEXT_PUBLIC_ENGINE_CDN_URL || '').replace(/\/+$/, '');
  const version = (process.env.NEXT_PUBLIC_ENGINE_VERSION || '').trim();
  const paths: string[] = [];
  if (cdnBase) {
    const root = version ? `${cdnBase}/${version}` : `${cdnBase}/latest`;
    paths.push(`${root}/engine-pkg-${backend}/`);
  }
  paths.push(`/engine-pkg-${backend}/`);
  return paths;
}

/** True for an absolute http(s) origin (the CDN); false for a same-origin path. */
export function isCdnOrigin(basePath: string): boolean {
  return /^https?:\/\//.test(basePath);
}

/**
 * A label for an origin that never carries its path: the host for the CDN,
 * `same-origin` otherwise. The versioned path carries the build SHA, and this
 * is what the loader's own error messages use so a breadcrumb built from them
 * stays host-only.
 */
export function describeOrigin(basePath: string): string {
  if (!isCdnOrigin(basePath)) return 'same-origin';
  try {
    return new URL(basePath).host;
  } catch {
    return 'cdn';
  }
}

/**
 * Pick the engine build, load its JS glue, and instantiate the WASM binary.
 *
 * The glue and the binary MUST come from the same origin — wasm-bindgen bakes
 * the import path into the glue, so a split origin fails to instantiate.
 *
 * Request a real adapter before selecting WebGPU. Browsers may expose
 * `navigator.gpu` while denying an adapter because of the driver, blocklist,
 * or runtime environment; those browsers must use the WebGL2 build.
 */
export async function selectPlayEngineBackend(): Promise<'webgpu' | 'webgl2'> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return 'webgl2';

  try {
    const adapter = await withTimeout(
      navigator.gpu.requestAdapter(),
      GPU_INIT_TIMEOUT_MS,
      'WebGPU adapter request',
    );
    return adapter ? 'webgpu' : 'webgl2';
  } catch {
    return 'webgl2';
  }
}

/** The wasm-bindgen glue module: `default()` instantiates the binary. */
interface GlueModule {
  default: (wasmUrl: string) => Promise<unknown>;
}

/** Loads the glue module at `specifier`; the default is the real dynamic import. */
export type GlueImporter = (specifier: string) => Promise<GlueModule>;

const importGlue: GlueImporter = (specifier) =>
  import(/* webpackIgnore: true */ specifier) as Promise<GlueModule>;

export interface PlayEngineLoadOptions {
  /**
   * Called each time an origin is given up on (it failed or exceeded the
   * per-origin deadline) and the next one is about to be tried. This is the
   * ONLY signal that the CDN was skipped: a fallback that succeeds looks like a
   * success from the outside, and a broken CDN prefix would otherwise route
   * every player through the same-origin path with nothing to show for it.
   */
  onOriginSkipped?: (basePath: string, error: unknown) => void;
  /** Called once, with the origin that produced the runtime. */
  onOriginUsed?: (basePath: string) => void;
  /** Test seam: replaces the dynamic `import()`. */
  load?: GlueImporter;
  /** Per-origin deadline for the GLUE import; defaults to PLAY_ENGINE_ORIGIN_TIMEOUT_MS. */
  originTimeoutMs?: number;
}

/**
 * Try each base path in order and return the first runtime that instantiates.
 *
 * Each origin's GLUE import gets its own deadline. Without one, a CDN that
 * stalls (a blackholed connection, a hung edge) would never reject, the loop
 * would never reach the same-origin path, and the caller's single global
 * deadline would expire on a page that had a working fallback the whole time
 * — and because `loadPlayEngine`'s latch only clears on rejection, Retry
 * would join the same hung attempt.
 *
 * The deadline deliberately covers ONLY the glue file (a few KB): that is the
 * stall signal, and a stalled origin never delivers it. The binary that
 * `wasm.default()` then fetches is ~23 MiB and runs under the page's global
 * budget alone, exactly as it did before the CDN was in front — bounding it
 * per origin would turn a slow-but-working link into a failed load, and a
 * Retry into the same failure with double the bytes.
 *
 * `withTimeout` bounds the wait, not the work: a glue import that arrives
 * after its deadline is simply never instantiated, because `default()` is
 * only reached through the deadline's fulfilment. A binary fetch that fails
 * falls through to the next origin like any other error.
 */
export async function instantiateFromPaths(
  paths: readonly string[],
  options: PlayEngineLoadOptions = {},
): Promise<PlayEngineRuntime> {
  const load = options.load ?? importGlue;
  const originTimeoutMs = options.originTimeoutMs ?? PLAY_ENGINE_ORIGIN_TIMEOUT_MS;
  let lastErr: unknown = new Error('No engine base path to load from');

  for (let i = 0; i < paths.length; i++) {
    const basePath = paths[i];
    const origin = describeOrigin(basePath);
    const glueImport = load(`${basePath}forge_engine.js`);
    // A glue import abandoned by its deadline may still reject later; that
    // rejection is ours, not the page's.
    glueImport.catch(() => {});
    try {
      const wasm = await withTimeout(glueImport, originTimeoutMs, `Engine glue from ${origin}`);
      await wasm.default(`${basePath}forge_engine_bg.wasm`);
      options.onOriginUsed?.(basePath);
      return wasm as unknown as PlayEngineRuntime;
    } catch (err) {
      lastErr = err;
      if (i < paths.length - 1) options.onOriginSkipped?.(basePath, err);
    }
  }
  throw lastErr;
}

/**
 * Resolve the backend and the ordered origins, then instantiate. Exported so
 * the composition — env → base paths → loader — can be tested end to end with
 * an injected importer; `loadPlayEngine` is this plus the latch.
 */
export async function resolveAndInstantiate(
  options: PlayEngineLoadOptions = {},
): Promise<PlayEngineRuntime> {
  const backend = await selectPlayEngineBackend();
  return instantiateFromPaths(getPlayEngineBasePaths(backend), options);
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
 * `options` apply to the attempt that is started; a caller that joins an
 * in-flight attempt gets that attempt's callbacks, not its own.
 *
 * `useEngine.loadWasm()` carries the same latch for the editor (PF-585); this
 * is deliberately a separate copy rather than a shared import, because `/play`
 * is the public bundle and must not pull in the editor's engine graph.
 */
export function loadPlayEngine(options: PlayEngineLoadOptions = {}): Promise<PlayEngineRuntime> {
  if (loadLatch) return loadLatch;

  const attempt = resolveAndInstantiate(options);
  loadLatch = attempt;

  attempt.catch(() => {
    // Guarded so a late rejection can't clear a latch that has already been
    // replaced by a newer attempt.
    if (loadLatch === attempt) loadLatch = null;
  });

  return attempt;
}
