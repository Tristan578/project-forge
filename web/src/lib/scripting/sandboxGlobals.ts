/**
 * Shared list of globals shadowed in the script sandbox.
 *
 * Each name is passed as a parameter to the sandboxed Function constructor
 * with `undefined` as its value, so user code cannot *name* these APIs
 * directly regardless of what the worker's global scope exposes.
 *
 * ## This is ONE layer, not the boundary
 * Parameter shadowing hides names; it does NOT stop the constructor-chain
 * escape `(0).constructor.constructor("return fetch")()`, which reaches the
 * REAL Function constructor via the prototype chain and evaluates the lookup in
 * global scope — bypassing the shadow entirely. That escape cannot be blocked
 * in pure JS (we cannot shadow Function for real: the compiler needs it). The
 * network/storage capabilities are therefore *also* removed from the worker
 * global by `revokeNetworkGlobals()` at worker init, so an escaped
 * `Function("return fetch")()` resolves to `undefined`. See
 * `revokeNetworkGlobals.ts` and #8607. A fuller boundary (sandboxed origin with
 * `connect-src 'none'`, or an AST interpreter) is tracked as follow-up in #8700.
 *
 * Security rationale (per shadowed name):
 * - fetch / XMLHttpRequest / WebSocket / importScripts / EventSource /
 *   BroadcastChannel — network exfiltration. Names blocked here AND the
 *   capabilities revoked by revokeNetworkGlobals() (the actual enforcement,
 *   since the constructor chain bypasses the name shadow).
 * - indexedDB / caches — persistent storage side-channels (also revoked).
 * - navigator / location — fingerprinting / URL leak (name shadow only; these
 *   are not revoked because they carry no network/storage capability).
 * - self / globalThis / window — direct global scope access that bypasses
 *   parameter shadowing (name shadow only — these cannot be revoked; the worker
 *   needs `self` for postMessage).
 * - Function / eval — block the direct `Function(...)`/`eval(...)` names. NOTE:
 *   this does NOT block the constructor-chain escape above; it only raises the
 *   bar for the naive case.
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
