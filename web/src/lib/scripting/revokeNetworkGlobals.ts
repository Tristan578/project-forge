/**
 * Hard-revoke network and storage capabilities from the script worker's global
 * scope.
 *
 * ## Why parameter shadowing is not enough
 * The sandbox passes `fetch`/`XMLHttpRequest`/etc. as `undefined` parameters to
 * the compiled script function (see {@link SHADOWED_GLOBALS}), so user code
 * cannot *name* them directly. But that does NOT stop the constructor-chain
 * escape documented in `scriptSandbox.test.ts`:
 *
 *     (0).constructor.constructor('return fetch')()
 *
 * `.constructor` on a number yields `Number`, `.constructor` on that yields the
 * real `Function` constructor, and `Function('return fetch')()` evaluates
 * `fetch` in the *global* scope — bypassing the parameter shadow entirely. That
 * escape is impossible to block in pure JS (we cannot revoke `Function` itself —
 * the compiler needs it to build user scripts).
 *
 * ## The actual mitigation: remove the capability, not the name
 * Instead of hiding the name, delete the network/storage *bindings* from the
 * worker global. The constructor chain can still reach `Function`, but
 * `Function('return fetch')()` then resolves to `undefined` — there is nothing
 * left to fetch, connect, or persist with. The worker itself never uses any of
 * these APIs (it only `postMessage`s back to the main thread; the AI/asset
 * channels that do use `fetch` run on the main thread), so revoking them does
 * not affect legitimate operation.
 *
 * ## Scope and limits
 * This is **defence-in-depth, not a complete sandbox**. The editor CSP still
 * allows `unsafe-eval` (so the constructor chain reaches `Function`), and a
 * proper boundary — a sandboxed iframe/origin with `connect-src 'none'`, or an
 * AST/bytecode interpreter instead of `Function()` — is tracked as follow-up
 * work in #8700. What this closes is the concrete network-exfiltration capability of an
 * escaped script in the author's authenticated editing session.
 *
 * Call once at worker module init, before any user script is compiled or run.
 */

/**
 * Network + storage globals an escaped script could use to exfiltrate the
 * user's same-origin session (cookies/Clerk attached) or persist data.
 *
 * Deliberately excludes:
 * - `Function`/`eval` — the compiler needs them; revoking breaks the worker.
 * - `self`/`globalThis`/`postMessage`/`addEventListener` — the worker's own
 *   message transport.
 */
const REVOKED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'importScripts',
  'EventSource',
  'BroadcastChannel',
  'indexedDB',
  'caches',
] as const;

/**
 * Permanently remove network/storage capabilities from `scope` (defaults to the
 * worker's `globalThis`). Idempotent: each binding is locked to `undefined` as
 * a non-configurable, non-writable property, so repeated calls are safe no-ops
 * and user code cannot reassign a working implementation back.
 */
export function revokeNetworkGlobals(scope: typeof globalThis = globalThis): void {
  for (const name of REVOKED_GLOBALS) {
    try {
      Object.defineProperty(scope, name, {
        value: undefined,
        configurable: false,
        writable: false,
        enumerable: false,
      });
    } catch {
      // Already defined as non-configurable (e.g. revoke ran twice, or the host
      // froze the binding). Best-effort delete; if that also fails the binding
      // is already locked to undefined, which is the desired end state.
      try {
        delete (scope as Record<string, unknown>)[name];
      } catch {
        // Locked down already — idempotent no-op.
      }
    }
  }
}
