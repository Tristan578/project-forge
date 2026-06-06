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
