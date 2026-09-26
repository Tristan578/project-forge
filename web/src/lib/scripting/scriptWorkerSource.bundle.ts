/**
 * BUILD-TIME PLACEHOLDER — the content of this file is never what ships.
 *
 * `web/scripts/sandbox-worker-loader.cjs` is registered for this exact file
 * name in `next.config.ts` (webpack for `next dev --webpack`, Turbopack for
 * `next build`). It discards this source and emits
 * `export default "<scriptWorker.ts and its whole import graph, bundled by
 * esbuild into one classic script>"` instead.
 *
 * The sandboxed-origin transport (`sandboxOrigin.ts`) boots that text as a
 * `blob:` Worker inside a null-origin iframe, where the bundler's own chunk
 * loading cannot reach the app origin. See the module doc there.
 *
 * Anything that imports this file WITHOUT the loader (vitest, a misconfigured
 * build) gets the empty string below, and `loadSandboxWorkerSource()` refuses
 * it with an error naming the loader — the transport fails loudly rather than
 * starting a worker with no code.
 */
const scriptWorkerSource = '';

export default scriptWorkerSource;
