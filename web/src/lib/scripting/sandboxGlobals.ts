/**
 * Shared list of globals shadowed in the script sandbox.
 *
 * Each name is passed as a parameter to the sandboxed Function constructor
 * with `undefined` as its value, preventing user code from accessing these
 * APIs regardless of what the worker's global scope exposes.
 *
 * Security rationale:
 * - fetch / XMLHttpRequest / WebSocket / importScripts / EventSource /
 *   BroadcastChannel — network exfiltration (defence-in-depth; Worker has no
 *   DOM but some APIs are still available in service/shared workers)
 * - indexedDB / caches — persistent storage side-channels
 * - navigator / location — fingerprinting / URL leak
 * - self / globalThis / window — direct global scope access that bypasses
 *   parameter shadowing
 * - Function / eval — prototype-chain escape such as
 *   `(0).constructor.constructor("return fetch")()`
 * - Reflect / Proxy — meta-programming that can intercept property access on
 *   the forge API object and steal references
 * - SharedArrayBuffer / Atomics — timing side-channels via shared memory;
 *   also require crossOriginIsolated which the worker should not have
 *
 * Accepted risks (intentionally NOT shadowed):
 * - WeakRef / FinalizationRegistry — no network/storage access; timing-only
 * - Symbol.for() — creates realm-shared symbols but cannot escape Worker scope
 */
export const SHADOWED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'indexedDB', 'caches', 'navigator', 'location',
  'EventSource', 'BroadcastChannel',
  'self', 'globalThis', 'window',
  'Function', 'eval',
  'Reflect', 'Proxy',
  'SharedArrayBuffer', 'Atomics',
] as const;
