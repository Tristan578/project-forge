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
 * This includes capabilities that do NOT look like `fetch` but are equivalent
 * exfiltration primitives:
 *  - `navigator.sendBeacon` — a credentialed, fire-and-forget `no-cors` POST
 *    that carries the author's same-origin session cookies and is not blocked by
 *    CORS. `navigator` is otherwise left readable (it carries no other network
 *    capability in a worker), but `sendBeacon` is neutralised.
 *  - `Worker`/`SharedWorker` — an escaped script could construct a *nested*
 *    same-origin worker whose fresh global still has `fetch`/`importScripts`/etc.
 *    intact, fully restoring the capability this module removes. Revoking the
 *    constructors prevents spawning a clean-global child.
 *  - `WebTransport` — an HTTP/3 bidirectional transport; a non-`fetch` network
 *    primitive in the same class.
 *
 * ## Scope and limits
 * This is **defence-in-depth, not a complete sandbox**, and capability removal
 * is inherently enumerate-and-revoke: a future browser global that exposes a new
 * network/exec primitive would need to be added here. The editor CSP still
 * allows `unsafe-eval` (so the constructor chain reaches `Function`). The
 * durable boundary — a sandboxed iframe/origin with `connect-src 'none'`, or an
 * AST/bytecode interpreter instead of `Function()` — is tracked as a follow-up
 * in #8700. What this closes is the concrete network-exfiltration capability of
 * an escaped script in the author's authenticated editing session.
 *
 * Call {@link revokeNetworkGlobalsIfWorker} once at worker module init, before
 * any user script is compiled or run.
 */

/**
 * Network + storage globals an escaped script could use to exfiltrate the
 * user's same-origin session (cookies/Clerk attached), persist data, or spawn a
 * fresh capability-bearing global.
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
  // Nested execution contexts — see module doc: an escaped script can reach the
  // real constructor via the constructor chain and spawn a same-origin child
  // worker whose global still has fetch/importScripts intact.
  'Worker',
  'SharedWorker',
  // HTTP/3 bidirectional transport — a non-fetch network primitive.
  'WebTransport',
] as const;

function lockToUndefined(target: object, name: string): void {
  try {
    Object.defineProperty(target, name, {
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
      delete (target as Record<string, unknown>)[name];
    } catch {
      // Locked down already — idempotent no-op.
    }
  }
}

/**
 * Permanently remove network/storage capabilities from `scope` (defaults to the
 * worker's `globalThis`). Idempotent: each binding is locked to `undefined` as
 * a non-configurable, non-writable property, so repeated calls are safe no-ops
 * and user code cannot reassign a working implementation back.
 *
 * Prefer {@link revokeNetworkGlobalsIfWorker} at the worker entry point: it only
 * fires inside a real `WorkerGlobalScope`, so importing the worker module under
 * a test runner (jsdom/node) does not lock the shared test global (a
 * non-configurable binding cannot be deleted, which crashes jsdom env teardown).
 */
export function revokeNetworkGlobals(scope: typeof globalThis = globalThis): void {
  for (const name of REVOKED_GLOBALS) {
    lockToUndefined(scope, name);
  }
  // navigator stays readable (userAgent etc.), but its network primitive is
  // neutralised. In a real worker `sendBeacon` lives on WorkerNavigator.prototype;
  // an own non-configurable `undefined` shadows the inherited method.
  const nav = (scope as { navigator?: object }).navigator;
  if (nav) {
    lockToUndefined(nav, 'sendBeacon');
  }
}

/**
 * Revoke network/storage capabilities ONLY when running inside a real Web Worker
 * global scope. Returns whether the revocation ran.
 *
 * The worker entry module is also imported by jsdom/node test files (to exercise
 * the message protocol). Revoking unconditionally would lock non-configurable
 * `undefined` bindings onto the shared test `globalThis`, which then crashes
 * vitest's jsdom environment teardown when it tries to `delete window.fetch`
 * (and leaves the suite in vitest's "false positive" state). A real
 * `DedicatedWorkerGlobalScope` is an instance of `WorkerGlobalScope`; test
 * environments define neither, so this is a clean no-op there.
 */
export function revokeNetworkGlobalsIfWorker(scope: typeof globalThis = globalThis): boolean {
  const ctor = (scope as Record<string, unknown>).WorkerGlobalScope as
    | (new (...args: never[]) => unknown)
    | undefined;
  const inWorker = typeof ctor === 'function' && scope instanceof ctor;
  if (inWorker) {
    revokeNetworkGlobals(scope);
  }
  return inWorker;
}
