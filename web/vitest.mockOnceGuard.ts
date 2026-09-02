/**
 * mock*Once leak guard (#9542).
 *
 * WHAT IT CATCHES
 *
 * A test queues `mockResolvedValueOnce(...)` (or any `*Once` helper) on a mock
 * that outlives it — a module-scoped `vi.fn()` or one built by a `vi.mock`
 * factory — and the code under test never consumes the value. Vitest's
 * `restoreAllMocks` restores spies only, so the queued value survives into the
 * next test, which then reads a neighbour's fixture and passes for the wrong
 * reason. #9501 found two such files by hand after a runtime sweep over 113
 * candidates; nothing stopped the next instance, and five more had recurred on
 * `main` by the time this guard was written.
 *
 * HOW IT WORKS
 *
 * `vi.fn` is wrapped so every mock it creates is registered with the test that
 * created it (undefined at module scope). Each mock's `mockImplementationOnce`
 * is wrapped to record the queued function and the source line that queued it
 * — every `*Once` helper delegates to `mockImplementationOnce` with a fresh
 * closure, so the recorded functions are exactly what sits in the queue.
 *
 * Detection needs no vitest internals: `getMockImplementation()` returns the
 * HEAD of the once-queue while one is pending and the persistent
 * implementation otherwise, so "the head is one of the functions we recorded"
 * is precisely "an unconsumed once-value is armed". An `afterEach` fails the
 * test that queued on a mock it did not create, naming the mock and the
 * queueing line(s).
 *
 * WHAT IT DELIBERATELY IGNORES
 *
 * - Mocks created inside the current test (including in its `beforeEach`):
 *   garbage that dies with the test, not contamination.
 * - `vi.spyOn` spies: never routed through `vi.fn`, and fully restored by
 *   `restoreAllMocks` in Vitest 4, once-queue included.
 * - Values queued in an EARLIER test: that test was already failed for them.
 *   The queue is left as-is (the only public drain is `mockReset`, which
 *   would also drop the persistent implementation and break later tests).
 *
 * Set MOCK_ONCE_GUARD=off to disable, e.g. while bisecting.
 */

import { afterEach, expect, vi } from 'vitest';
import type { Mock } from 'vitest';

type AnyFn = (...args: never[]) => unknown;

interface QueuedEntry {
  fn: AnyFn;
  /** Test that queued it (undefined when queued at module scope). */
  test: string | undefined;
  /** `file:line:col` of the queueing call, outside node_modules. */
  site: string;
}

interface TrackedMock {
  mock: Mock;
  createdIn: string | undefined;
  queued: Set<AnyFn>;
  entries: QueuedEntry[];
}

export const ENABLED = process.env.MOCK_ONCE_GUARD !== 'off';

const tracked: TrackedMock[] = [];

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

function track(mock: Mock): void {
  const rec: TrackedMock = { mock, createdIn: currentTest(), queued: new Set(), entries: [] };
  const original = {
    once: mock.mockImplementationOnce.bind(mock) as (fn: AnyFn) => Mock,
    reset: mock.mockReset.bind(mock) as () => Mock,
    restore: mock.mockRestore.bind(mock) as () => Mock,
  };
  const forget = () => {
    rec.queued.clear();
    rec.entries.length = 0;
  };
  // Every *Once helper delegates here with a fresh closure, so the function we
  // record is the one Vitest queues — and the one getMockImplementation()
  // hands back while it is still pending.
  mock.mockImplementationOnce = ((fn: AnyFn) => {
    rec.queued.add(fn);
    rec.entries.push({ fn, test: currentTest(), site: captureSite() });
    return original.once(fn);
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
  sites: string[];
}

/**
 * Leaks attributable to `test`: mocks created elsewhere whose once-queue head is
 * still one of the functions this test queued.
 */
export function findLeaks(test: string | undefined): Leak[] {
  const leaks: Leak[] = [];
  for (const rec of tracked) {
    if (rec.createdIn !== undefined && rec.createdIn === test) continue;
    const head = rec.mock.getMockImplementation() as AnyFn | undefined;
    if (!head || !rec.queued.has(head)) {
      // Drained (or reset): nothing armed. Forget the bookkeeping so a later
      // test's check does not re-attribute old entries.
      rec.queued.clear();
      rec.entries.length = 0;
      continue;
    }
    const mine = rec.entries.filter((e) => e.test === test);
    if (mine.length === 0) continue; // reported when it was queued
    leaks.push({ mockName: rec.mock.getMockName(), sites: mine.map((e) => e.site) });
  }
  return leaks;
}

export function formatLeaks(test: string | undefined, leaks: Leak[]): string {
  const lines = leaks.map(
    (l) => `  - ${l.mockName} — queued at ${[...new Set(l.sites)].join(', ')}`,
  );
  return [
    `mock*Once leak: "${test ?? '<unknown test>'}" queued a *Once value on a mock it did not create, and the value was never consumed.`,
    'It stays armed on the shared mock and the NEXT test reads it (#9501, #9542). Either drive the code path that consumes it, or build the mock inside the test.',
    ...lines,
  ].join('\n');
}

if (ENABLED) {
  const originalFn = vi.fn;
  vi.fn = function guardedFn(this: unknown, ...args: unknown[]) {
    const mock = (originalFn as unknown as (...a: unknown[]) => Mock).apply(this, args);
    track(mock);
    return mock;
  } as typeof vi.fn;

  afterEach(() => {
    const test = currentTest();
    const leaks = findLeaks(test);
    if (leaks.length > 0) {
      throw new Error(formatLeaks(test, leaks));
    }
  });
}
