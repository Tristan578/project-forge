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
