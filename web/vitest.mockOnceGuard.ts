/**
 * mock*Once leak guard (#9542).
 *
 * WHAT IT CATCHES
 *
 * A test queues `mockResolvedValueOnce(...)` (or any `*Once` helper) on a mock
 * that outlives it, and the code under test never consumes the value. Vitest's
 * `restoreAllMocks` detaches spies only — it never drains a once-queue — so
 * the queued value survives into the next test, which then reads a
 * neighbour's fixture and passes for the wrong reason. #9501 found two such
 * files by hand after a runtime sweep over 113 candidates; nothing stopped
 * the next instance, and five more had recurred on `main` by the time this
 * guard was written.
 *
 * WHICH MOCKS ARE COVERED
 *
 * Every mock that can outlive a test, whichever way it was built:
 *
 * - `vi.fn()` at module scope — `vi.fn` is wrapped.
 * - Mocks built by a `vi.mock(path, factory)` factory — the factory runs
 *   inside the mocker's `callFunctionMock`, which is wrapped so everything
 *   created during it is registered as module-scoped, whenever it runs. A
 *   factory triggered lazily by a dynamic `import()` inside a test (or by the
 *   shared setup's `beforeEach`) still builds a module-scoped mock: vitest
 *   caches the mocked module and hands the same instance to every later test.
 * - Bare automocks — `vi.mock(path)` with no factory. Those never pass through
 *   `vi.fn`: the mocker builds them from `@vitest/spy`'s `createMockInstance`,
 *   read off the mocker's `spyModule` field at call time. That field is
 *   replaced with a copy whose `createMockInstance` registers what it makes.
 *   This is the repo's most common mocking shape (86 files bare-automock, 28
 *   of them also queue a `*Once` value); a first cut of this guard was blind
 *   to it while its documentation claimed otherwise.
 *
 * HOW DETECTION WORKS
 *
 * Each registered mock's `mockImplementationOnce` is wrapped to queue a fresh
 * per-call wrapper and record it with the test and the source line that
 * queued it. Every `*Once` helper delegates to `mockImplementationOnce`, so
 * the recorded functions are exactly what sits in the queue — and because
 * each wrapper is unique, a persistent implementation can never be mistaken
 * for an armed once-value, even when the same function object is used for
 * both.
 *
 * `getMockImplementation()` returns the HEAD of the once-queue while one is
 * pending and the persistent implementation otherwise (public API; no vitest
 * internals). So "the head is one of the wrappers we recorded" is precisely
 * "an unconsumed once-value is armed", and everything recorded from the head
 * onward is what is still armed. An `afterEach` fails the test that queued on
 * a mock it did not create, naming the mock and the queueing line(s) that are
 * still armed — never the ones that were consumed.
 *
 * WHAT IT DELIBERATELY IGNORES
 *
 * - Mocks created inside the current test (including in its `beforeEach`)
 *   outside a module-mock factory: garbage that dies with the test.
 * - `vi.spyOn` spies: `restoreAllMocks` reinstates the original property, so
 *   the spy object — once-queue and all — is unreachable from the next test.
 * - Values queued in an EARLIER test: that test was already failed for them.
 *   The queue is left as-is (the only public drain is `mockReset`, which
 *   would also drop the persistent implementation and break later tests).
 * - A test that already failed: its consuming call was probably never
 *   reached, so a second "leak" error would point at the wrong fix.
 *
 * Note on CI's `retry: 1`: a test that fails transiently between queueing and
 * consuming leaves the value armed, so its retry queues a second copy and
 * consumes only one — the retry then fails with THIS guard's message. The
 * original transient error is the one to chase in that case.
 *
 * `MOCK_ONCE_GUARD=off` disables the guard for a local run, e.g. while
 * bisecting. It is ignored under CI: a gate that one environment variable can
 * silence is not a gate.
 */

import { afterEach, expect, vi } from 'vitest';
import type { Mock } from 'vitest';

type AnyFn = (...args: never[]) => unknown;

interface QueuedEntry {
  /** The unique wrapper actually sitting in the once-queue. */
  fn: AnyFn;
  /** Test that queued it (undefined when queued at module scope). */
  test: string | undefined;
  /** `file:line:col` of the queueing call, outside node_modules. */
  site: string;
}

interface TrackedMock {
  mock: Mock;
  createdIn: string | undefined;
  entries: QueuedEntry[];
}

/** Minimal shape of vitest's mocker, reached through `globalThis.__vitest_mocker__`. */
export interface SpyModuleLike {
  createMockInstance: (options?: { restore?: unknown }) => Mock;
}
export interface MockerLike {
  spyModule?: SpyModuleLike;
  callFunctionMock?: (...args: unknown[]) => Promise<unknown>;
  mockObject?: (...args: unknown[]) => unknown;
}

const OFF_REQUESTED = process.env.MOCK_ONCE_GUARD === 'off';
const UNDER_CI = process.env.CI !== undefined && process.env.CI !== '';
export const ENABLED = !OFF_REQUESTED || UNDER_CI;

const tracked: TrackedMock[] = [];
const seen = new WeakSet<Mock>();
/** > 0 while the mocker is building a module mock (factory or automock). */
let moduleMockDepth = 0;

function currentTest(): string | undefined {
  try {
    return expect.getState().currentTestName ?? undefined;
  } catch {
    return undefined;
  }
}

const GUARD_FILE = 'vitest.mockOnceGuard';

/** First stack frame that is neither this file nor a dependency. */
export function captureSite(stack: string | undefined = new Error().stack): string {
  if (!stack) return '<unknown>';
  for (const raw of stack.split('\n').slice(1)) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    if (line.includes('node_modules') || line.includes(GUARD_FILE)) continue;
    // Both V8 frame shapes: `at fn (/path:1:2)` and `at /path:1:2`.
    const m = /((?:[A-Za-z]:)?[^\s():]+):(\d+):(\d+)\)?$/.exec(line);
    if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  }
  return '<unknown>';
}

/**
 * Register a mock. Module-scoped when created by the mocker (factory or
 * automock) or outside any test; otherwise owned by the test that built it.
 */
export function track(mock: Mock): void {
  if (seen.has(mock)) return;
  seen.add(mock);
  const rec: TrackedMock = {
    mock,
    createdIn: moduleMockDepth > 0 ? undefined : currentTest(),
    entries: [],
  };
  const original = {
    once: mock.mockImplementationOnce.bind(mock) as (fn: AnyFn) => Mock,
    reset: mock.mockReset.bind(mock) as () => Mock,
    restore: mock.mockRestore.bind(mock) as () => Mock,
  };
  const forget = () => {
    rec.entries.length = 0;
  };
  mock.mockImplementationOnce = ((fn: AnyFn) => {
    // A fresh wrapper per call: unique identity, so the queue head can never
    // equal a user-supplied persistent implementation.
    const wrapper = function (this: unknown, ...args: never[]) {
      return (fn as (...a: never[]) => unknown).apply(this, args);
    } as AnyFn;
    rec.entries.push({ fn: wrapper, test: currentTest(), site: captureSite() });
    return original.once(wrapper);
  }) as Mock['mockImplementationOnce'];
  mock.mockReset = (() => {
    forget();
    return original.reset();
  }) as Mock['mockReset'];
  mock.mockRestore = (() => {
    forget();
    return original.restore();
  }) as Mock['mockRestore'];
  tracked.push(rec);
}

export interface Leak {
  mockName: string;
  /** Queueing sites whose values are STILL armed, in queue order. */
  sites: string[];
}

/**
 * Leaks attributable to `test`: mocks it did not create whose once-queue still
 * holds a value this test queued.
 */
export function findLeaks(test: string | undefined): Leak[] {
  const leaks: Leak[] = [];
  for (const rec of tracked) {
    if (rec.createdIn !== undefined && rec.createdIn === test) continue;
    const head = rec.mock.getMockImplementation() as AnyFn | undefined;
    const headIndex = head ? rec.entries.findIndex((e) => e.fn === head) : -1;
    if (headIndex < 0) {
      // Drained (or reset): nothing armed. Forget the bookkeeping so a later
      // test's check does not re-attribute old entries.
      rec.entries.length = 0;
      continue;
    }
    // The queue is FIFO and only mockReset/mockRestore drain it, so everything
    // before the head has been consumed.
    rec.entries.splice(0, headIndex);
    const mine = rec.entries.filter((e) => e.test === test);
    if (mine.length === 0) continue; // reported when it was queued
    leaks.push({ mockName: rec.mock.getMockName(), sites: mine.map((e) => e.site) });
  }
  return leaks;
}

export function formatLeaks(test: string | undefined, leaks: Leak[]): string {
  const lines = leaks.map(
    (l) => `  - ${l.mockName} — still armed from ${[...new Set(l.sites)].join(', ')}`,
  );
  return [
    `mock*Once leak: "${test ?? '<unknown test>'}" queued a *Once value on a mock it did not create, and the value was never consumed.`,
    'It stays armed on the shared mock, and the next test in this file (if any) would read it (#9501, #9542). Either drive the code path that consumes it, or build the mock inside the test.',
    ...lines,
  ].join('\n');
}

/** An Error whose first stack frame is the queueing line, so reporters and editors land there. */
export function leakError(test: string | undefined, leaks: Leak[]): Error {
  const err = new Error(formatLeaks(test, leaks));
  const site = leaks[0]?.sites[0];
  if (site && site !== '<unknown>') {
    err.stack = `${err.name}: ${err.message}\n    at ${site}`;
  }
  return err;
}

/**
 * Hook the mocker so module mocks are registered however they are built.
 * Returns false when the mocker is not reachable (another runner) — the
 * guard's own test asserts that automocks ARE caught, so a silent fallback
 * cannot pass unnoticed.
 */
export function hookMocker(mocker: MockerLike | undefined): boolean {
  if (!mocker) return false;
  const wrappedModules = new WeakSet<object>();
  const wrapModule = (sm: SpyModuleLike | undefined): SpyModuleLike | undefined => {
    if (!sm || wrappedModules.has(sm)) return sm;
    const guarded: SpyModuleLike = {
      ...sm,
      createMockInstance: (options) => {
        const mock = sm.createMockInstance(options);
        // Spies (`restore` set) are detached by restoreAllMocks; not tracked.
        if (!options?.restore) track(mock);
        return mock;
      },
    };
    wrappedModules.add(guarded);
    return guarded;
  };
  // `spyModule` is loaded lazily by the mocker; an accessor wraps whatever is
  // assigned, whenever it is assigned.
  let current = wrapModule(mocker.spyModule);
  Object.defineProperty(mocker, 'spyModule', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (value: SpyModuleLike | undefined) => {
      current = wrapModule(value);
    },
  });
  // Factories and automocks: everything created while the mocker is building
  // a module mock is module-scoped, whichever test happens to be running.
  const callFunctionMock = mocker.callFunctionMock;
  if (typeof callFunctionMock === 'function') {
    mocker.callFunctionMock = async function guardedCallFunctionMock(this: unknown, ...args: unknown[]) {
      moduleMockDepth += 1;
      try {
        return await callFunctionMock.apply(this, args);
      } finally {
        moduleMockDepth -= 1;
      }
    };
  }
  const mockObject = mocker.mockObject;
  if (typeof mockObject === 'function') {
    mocker.mockObject = function guardedMockObject(this: unknown, ...args: unknown[]) {
      // Module automocks pass an exports object as the second argument;
      // `vi.mockObject(value)` inside a test passes undefined and is owned by
      // that test like any other in-test mock.
      const isModuleMock = args.length >= 2 && args[1] !== undefined;
      if (isModuleMock) moduleMockDepth += 1;
      try {
        return mockObject.apply(this, args);
      } finally {
        if (isModuleMock) moduleMockDepth -= 1;
      }
    };
  }
  return true;
}

if (OFF_REQUESTED && UNDER_CI) {
  console.warn('[mockOnceGuard] MOCK_ONCE_GUARD=off is ignored under CI; the guard stays on.');
}

if (ENABLED) {
  const originalFn = vi.fn;
  vi.fn = function guardedFn(this: unknown, ...args: unknown[]) {
    const mock = (originalFn as unknown as (...a: unknown[]) => Mock).apply(this, args);
    track(mock);
    return mock;
  } as typeof vi.fn;

  hookMocker((globalThis as { __vitest_mocker__?: MockerLike }).__vitest_mocker__);

  afterEach((ctx) => {
    if (ctx.task.result?.state === 'fail') return;
    const test = currentTest();
    const leaks = findLeaks(test);
    if (leaks.length > 0) {
      throw leakError(test, leaks);
    }
  });
}
