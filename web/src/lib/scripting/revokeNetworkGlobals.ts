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
 * Instead of hiding the name, revoke the network/storage *capability* from the
 * worker global. Per WebIDL these methods/constructors are NOT own properties of
 * the global — the `fetch`/`importScripts` operations and the
 * `XMLHttpRequest`/`WebSocket`/`Worker`/... interface objects are configurable
 * data properties on the global's PROTOTYPE chain
 * (`WorkerGlobalScope.prototype` / `DedicatedWorkerGlobalScope.prototype`). So
 * revocation walks the whole prototype chain ({@link lockMethodThroughChain}),
 * locking the binding to `undefined` wherever it actually lives — an
 * instance-only shadow would hide `globalThis.fetch` yet leave
 * `Object.getPrototypeOf(globalThis).fetch` live and callable. After this the
 * constructor chain can still reach `Function`, but `Function('return fetch')()`
 * resolves to `undefined` AND the prototype-walk
 * `Object.getPrototypeOf(globalThis).fetch` resolves to `undefined` too — there
 * is nothing left to fetch, connect, or persist with. The worker itself never
 * uses any of these APIs (it only `postMessage`s back to the main thread; the
 * AI/asset channels that do use `fetch` run on the main thread), so revoking
 * them does not affect legitimate operation.
 *
 * This includes capabilities that do NOT look like `fetch` but are equivalent
 * exfiltration primitives:
 *  - `navigator.sendBeacon` — a credentialed, fire-and-forget `no-cors` POST
 *    that carries the author's same-origin session cookies and is not blocked by
 *    CORS. `navigator` is otherwise left readable (it carries no other network
 *    capability in a worker), but `sendBeacon` is revoked. In a real worker the
 *    method lives on `WorkerNavigator.prototype`, not on the instance, so the
 *    revocation walks the whole prototype chain — an instance-only shadow would
 *    leave `Object.getPrototypeOf(navigator).sendBeacon` callable.
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
 * Lock `name` to a non-configurable `undefined` on `target` AND on every object
 * in its prototype chain (up to, but never including, `Object.prototype`).
 *
 * Web-platform methods such as `navigator.sendBeacon` live on a `*.prototype`
 * (`WorkerNavigator.prototype`), NOT as an own property of the instance. An
 * instance-only shadow ({@link lockToUndefined}) hides `nav.sendBeacon` yet
 * leaves the prototype method live and reachable through the constructor-chain +
 * prototype-walk bypass:
 *
 *     Object.getPrototypeOf(navigator).sendBeacon.call(navigator, url, data)
 *
 * Walking the chain revokes the capability where it actually lives; the trailing
 * instance lock additionally blocks an escaped script from reattaching a fresh
 * own property. `Object.prototype` is deliberately never touched — these
 * primitives never live there, and locking a binding onto it would corrupt every
 * object in the realm.
 */
function lockMethodThroughChain(target: object, name: string): void {
  let obj: object | null = target;
  while (obj && obj !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(obj, name)) {
      lockToUndefined(obj, name);
    }
    obj = Object.getPrototypeOf(obj) as object | null;
  }
  // Plant a non-configurable `undefined` own property even if no own copy
  // existed anywhere, so the capability cannot be reattached to the instance.
  lockToUndefined(target, name);
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
    // Walk the whole prototype chain, not just the instance. Per WebIDL, a
    // worker's network/storage globals (the `fetch`/`importScripts` operations
    // and the `XMLHttpRequest`/`WebSocket`/`Worker`/... interface objects) live
    // as configurable data properties on the global's PROTOTYPE chain
    // (WorkerGlobalScope.prototype / DedicatedWorkerGlobalScope.prototype), NOT
    // as own properties of the global. An instance-only own-property shadow
    // ({@link lockToUndefined}) defeats `scope.fetch` and the bareword
    // `Function('return fetch')()` lookup, but leaves the prototype-resident
    // capability live and callable via the constructor-chain + prototype-walk
    // bypass: `Object.getPrototypeOf(globalThis).fetch.call(globalThis, ...)` —
    // a same-origin credentialed exfil POST CORS does not block. Revoke the
    // capability where it actually lives.
    lockMethodThroughChain(scope, name);
  }
  // navigator stays readable (userAgent etc.), but its network primitive —
  // sendBeacon, a credentialed no-cors POST — is revoked. In a real worker
  // sendBeacon lives on WorkerNavigator.prototype, NOT on the instance, so an
  // instance-only own-property shadow would leave the prototype method callable
  // via `Object.getPrototypeOf(navigator).sendBeacon.call(navigator, ...)`. Walk
  // the whole chain to revoke the capability wherever it actually lives.
  const nav = (scope as { navigator?: object }).navigator;
  if (nav) {
    lockMethodThroughChain(nav, 'sendBeacon');
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
