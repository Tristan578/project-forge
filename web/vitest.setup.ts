import { createRequire } from 'node:module';

/**
 * Neutralize Sentry's BUILD-TIME orchestrion webpack plugin inside jsdom tests.
 *
 * `@sentry/nextjs` >= 10.72 made `build/cjs/index.server.js` eagerly
 * `require('./config/deprecatedWithSentryConfig.js')`, which drags the
 * build-time `@sentry/server-utils/orchestrion/webpack` plugin into the RUNTIME
 * server entry. 10.70.0 did not — that is the regression. The plugin's vendored
 * `import.meta.url` shim branches on `typeof document`:
 *
 *   typeof document === 'undefined'
 *     ? pathToFileURL(__filename).href        // Node — a file: URL, fine
 *     : new URL('...', document.baseURI).href // browser — an http: URL
 *
 * Under `environment: 'jsdom'` a global `document` exists, so it takes the
 * browser branch, hands `fileURLToPath()` an `http:` URL, and EVERY test file
 * that transitively imports `@sentry/nextjs` dies at import time with
 * `TypeError: The URL must be of scheme file` (132 files on the 10.72 bump).
 *
 * The five exports are all webpack/turbopack plugin construction, reached only
 * from `withSentryConfig` during `next build`; nothing under `src/` references
 * them, so inert stubs change nothing a test can observe. A Vite alias cannot
 * reach this — the module is externalized and loaded by Node's own CJS loader,
 * which makes `require.cache` the only interception point. `next build` is
 * unaffected: this file is loaded by vitest and nothing else.
 *
 * Remove once upstream stops loading the bundler plugin from the runtime entry
 * — tracked at #9618.
 */
if (typeof document !== 'undefined') {
  const nodeRequire = createRequire(import.meta.url);
  try {
    const id = nodeRequire.resolve('@sentry/server-utils/orchestrion/webpack');
    if (!nodeRequire.cache[id]) {
      nodeRequire.cache[id] = {
        id,
        filename: id,
        loaded: true,
        exports: {
          getOrchestrionLoaderPath: () => '',
          getSentryInstrumentations: () => [],
          resolveOrchestrionRuntimeRequest: () => undefined,
          sentryOrchestrionWebpackPlugin: () => ({ apply: () => {} }),
          serializeInstrumentations: () => '',
        },
      } as unknown as NodeJS.Module;
    }
  } catch {
    // Sentry absent, or the subpath moved — nothing to neutralize.
  }
}

/**
 * Vitest setup — polyfill localStorage for Node 22+.
 *
 * Node 22+ exposes a built-in `globalThis.localStorage` that is an empty
 * object without standard Web Storage methods (`getItem`, `setItem`,
 * `removeItem`, `clear`).  This breaks any test that calls
 * `localStorage.clear()` — even under jsdom, because Node's stub shadows
 * jsdom's implementation.
 *
 * This setup replaces it with a spec-compliant in-memory mock.
 */

const store: Record<string, string> = {};

const storageMock: Storage = {
  get length() {
    return Object.keys(store).length;
  },
  clear() {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  },
  getItem(key: string) {
    return store[key] ?? null;
  },
  setItem(key: string, value: string) {
    store[key] = String(value);
  },
  removeItem(key: string) {
    delete store[key];
  },
  key(index: number) {
    return Object.keys(store)[index] ?? null;
  },
};

// Only patch if the native implementation is broken (no `clear` method).
if (typeof globalThis.localStorage?.clear !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storageMock,
    writable: true,
    configurable: true,
  });
}

// jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.)
// Vitest 4.1.2 requires explicit expect.extend() — the side-effect import
// from '@testing-library/jest-dom/vitest' may use a different expect instance.
import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { configure } from '@testing-library/dom';
import { VITEST_ASYNC_UTIL_TIMEOUT_MS } from './src/lib/config/timeouts';
expect.extend(matchers);

// Global test isolation — prevent state leaks between tests
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, vi } from 'vitest';

// mock*Once leak guard (#9542): fails the test that arms a *Once value on a
// shared mock (module-scoped vi.fn, vi.mock factory mock, or bare automock)
// and never consumes it. Imported for its side effects — it wraps `vi.fn`,
// hooks the mocker so automocks and factories are registered however they are
// built, and registers its own afterEach. See the file header for the rules.
import './vitest.mockOnceGuard';

// queryWithResilience auto-passthrough for auto-mocked modules.
//
// WHY: Many route tests use `vi.mock('@/lib/db/client')` (auto-mock) which
// replaces queryWithResilience with a bare vi.fn() returning undefined.
// This causes all wrapped DB calls to silently return undefined instead of
// calling the inner function — breaking every route test that touches the DB.
//
// WHAT: If queryWithResilience is a mock with NO custom implementation, this
// sets it as a passthrough: `(fn) => fn()`. Tests with inline factory mocks
// that already set queryWithResilience are NOT affected (getMockImplementation
// returns their explicit implementation, so the guard short-circuits).
//
// WHEN TO CHANGE: If you need queryWithResilience to simulate failures (e.g.
// circuit breaker open), set an explicit mockImplementation in your test —
// the guard here will NOT override it.
beforeEach(async () => {
  try {
    const mod = await import('@/lib/db/client');
    const qwr = vi.mocked(mod).queryWithResilience;
    if (qwr && typeof qwr.mockImplementation === 'function' && !qwr.getMockImplementation()) {
      qwr.mockImplementation((fn: () => unknown) => fn() as never);
    }
  } catch {
    // Module not mocked or not available — skip
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  // Clear localStorage between tests to prevent shared state leaks
  if (typeof globalThis.localStorage?.clear === 'function') {
    globalThis.localStorage.clear();
  }
});

// See VITEST_ASYNC_UTIL_TIMEOUT_MS. Testing Library's 1s default is wall-clock,
// which a starved worker thread in a ~900-file parallel run can miss even when
// the component renders instantly.
//
// Imported from @testing-library/dom, not /react. `asyncUtilTimeout` is a DOM
// Testing Library option that the React binding merely re-exports, and this
// setup file is shared with 53 `@vitest-environment node` test files that have
// no reason to pull in the React DOM binding.
configure({ asyncUtilTimeout: VITEST_ASYNC_UTIL_TIMEOUT_MS });
