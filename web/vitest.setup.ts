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
expect.extend(matchers);

// Global test isolation — prevent state leaks between tests
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, vi } from 'vitest';

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
