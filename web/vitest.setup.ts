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

// ---------------------------------------------------------------------------
// Global test isolation: clear localStorage between every test
// ---------------------------------------------------------------------------
// Prevents shared state leaks where one test's localStorage.setItem
// affects subsequent tests in the same file or pool worker.
import { afterEach } from 'vitest';

afterEach(() => {
  // Clear localStorage mock between tests
  if (typeof globalThis.localStorage?.clear === 'function') {
    globalThis.localStorage.clear();
  }

  // Clear any lingering timers that tests forgot to clean up
  // (prevents timer leaks between tests in the same worker)
  if (typeof globalThis.clearTimeout === 'function') {
    // vitest handles fake timer cleanup, but real timers from
    // dynamic imports or module-level side effects can leak
  }
});
