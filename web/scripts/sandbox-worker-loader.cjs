/**
 * Build-time loader for the sandboxed-origin script transport (#8700).
 *
 * Registered in `next.config.ts` for exactly one file,
 * `src/lib/scripting/scriptWorkerSource.bundle.ts`, under BOTH bundlers:
 * webpack (`next dev --webpack`) and Turbopack (`next build`, and the bare
 * `npx next build` the CI E2E jobs run — which is why this is a loader and not
 * an npm `prebuild` step: CI never runs `npm run build`).
 *
 * It ignores the placeholder's content and returns
 *
 *     export default "<scriptWorker.ts bundled into one classic script>";
 *
 * Why the worker has to be ONE self-contained script, rather than the chunk
 * URL the bundler gives `new Worker(new URL(...))`: the sandboxed transport
 * starts the worker from a `blob:` URL inside a null-origin iframe whose CSP
 * has `connect-src 'none'` and no script host. Such a worker can load nothing
 * from the app origin, so the bundler's run-time chunk loading (webpack's
 * `importScripts(publicPath + chunk)`, Turbopack's worker bootstrap) cannot
 * run there. Shipping the code as text is what lets that CSP stay closed —
 * see `src/lib/scripting/sandboxOrigin.ts`.
 *
 * `bundleScriptWorker` is also used by `e2e/tests/script-sandbox-isolation.spec.ts`,
 * so the real-browser proof boots the same bytes this loader emits.
 *
 * Loader API used: `this.async`, `this.resourcePath`, `this.addDependency` —
 * all within the subset Turbopack implements (no `emitFile`, `loadModule`,
 * `importModule`). `addDependency` makes `next dev` rebuild the string when
 * any file in the worker's graph changes.
 */
'use strict';

// CommonJS on purpose: webpack's and Turbopack's loader runners require() it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const esbuild = require('esbuild');

/** web/ — esbuild resolves the `@/` alias from web/tsconfig.json relative to this. */
const WEB_ROOT = path.join(__dirname, '..');
const WORKER_ENTRY = path.join(WEB_ROOT, 'src', 'lib', 'scripting', 'scriptWorker.ts');

/**
 * Bundle `scriptWorker.ts` and its imports into one IIFE.
 *
 * @param {{ minify?: boolean, plugins?: import('esbuild').Plugin[] }} [options]
 *   `plugins` exists for the E2E spec, which swaps one module out to prove the
 *   frame blocks network access without `revokeNetworkGlobals()`. Production
 *   passes none.
 * @returns {Promise<{ code: string, inputs: string[] }>} the script, and the
 *   absolute path of every file it was built from.
 */
async function bundleScriptWorker(options = {}) {
  const { minify = true, plugins = [] } = options;
  const result = await esbuild.build({
    absWorkingDir: WEB_ROOT,
    entryPoints: [WORKER_ENTRY],
    bundle: true,
    // A classic script: the frame starts it with `new Worker(blobUrl)` and no
    // `type: 'module'`, so there is no module loader that could fetch anything.
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify,
    legalComments: 'none',
    write: false,
    metafile: true,
    logLevel: 'silent',
    plugins,
  });
  if (result.outputFiles.length !== 1) {
    throw new Error(`sandbox-worker-loader: expected one output file, got ${result.outputFiles.length}`);
  }
  const inputs = Object.keys(result.metafile.inputs)
    .filter((input) => !input.includes(':'))
    .map((input) => path.resolve(WEB_ROOT, input));
  return { code: result.outputFiles[0].text, inputs };
}

/** The module this loader emits in place of the placeholder. */
function toModuleSource(code) {
  return `export default ${JSON.stringify(code)};\n`;
}

/** @this {{ async(): (err: Error | null, out?: string) => void, addDependency?(file: string): void }} */
function sandboxWorkerLoader() {
  const callback = this.async();
  bundleScriptWorker().then(
    ({ code, inputs }) => {
      if (typeof this.addDependency === 'function') {
        for (const input of inputs) this.addDependency(input);
      }
      callback(null, toModuleSource(code));
    },
    (err) => callback(err instanceof Error ? err : new Error(String(err))),
  );
}

module.exports = sandboxWorkerLoader;
module.exports.bundleScriptWorker = bundleScriptWorker;
module.exports.toModuleSource = toModuleSource;
module.exports.WORKER_ENTRY = WORKER_ENTRY;
