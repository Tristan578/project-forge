/**
 * Globals that are shadowed (set to undefined) inside the script sandbox.
 *
 * The sandbox uses the Function constructor with these as parameter names,
 * then passes `undefined` for each at call time. This prevents user scripts
 * from accessing these APIs directly by name.
 *
 * IMPORTANT LIMITATION: Parameter shadowing does NOT prevent prototype-chain
 * escapes like `(0).constructor.constructor('return fetch')()`. The real
 * security boundary is:
 * - Editor: Web Worker isolation + command whitelist
 * - Exported games: CSP headers (script-src without unsafe-eval)
 *
 * This list is the SINGLE SOURCE OF TRUTH. All consumers import from here:
 * - scriptWorker.ts (editor sandbox)
 * - scriptBundler.ts (export sandbox)
 * - scriptSandbox.test.ts (security tests)
 */
export const SHADOWED_GLOBALS = [
  // Network / storage — defence-in-depth (Worker has no DOM, but exported games do)
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'indexedDB', 'caches', 'navigator', 'location',
  'EventSource', 'BroadcastChannel',
  // Global scope access
  'self', 'globalThis', 'window',
  // Code execution
  'Function', 'eval',
  // Metaprogramming / prototype traversal (PF-2)
  'Reflect', 'Proxy',
  // Concurrency / timing side-channels
  'SharedArrayBuffer', 'Atomics',
] as const;

/**
 * Type for a single shadowed global name.
 */
export type ShadowedGlobal = (typeof SHADOWED_GLOBALS)[number];
