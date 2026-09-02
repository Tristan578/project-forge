/**
 * Tests for web/vitest.mockOnceGuard.ts (#9542).
 *
 * Two layers, deliberately:
 *
 * 1. In-process checks of the exported helpers, run under the guard itself
 *    (the shared setup imports it), so every mock here is tracked exactly as
 *    it would be in any other file.
 * 2. REAL child `vitest run`s over fixture files with a config that uses the
 *    real setup file. A logic-only test of "would this report a leak" is the
 *    vacuous trap: the property that matters is that a leaking test FAILS in
 *    an actual run — for a module-scoped vi.fn, a vi.mock factory (static or
 *    lazily triggered inside a test) and a bare automock alike — with a
 *    message naming the still-armed queueing line, and that the balanced /
 *    in-test / beforeEach / reused-implementation shapes do NOT. Only a run
 *    proves that. Two more child runs pin the switch: MOCK_ONCE_GUARD=off is
 *    honoured locally and ignored under CI.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { captureSite, findLeaks, formatLeaks, leakError, ENABLED } from '../../../../vitest.mockOnceGuard';

const WEB_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURES = path.join(WEB_ROOT, 'src/lib/testing/__fixtures__/onceGuard');
// Resolve vitest's CLI entry through module resolution: in a git worktree
// `node_modules` is a symlink into the main checkout and the package may be
// hoisted to the repo root, so a hard-coded `web/node_modules/vitest` path
// does not exist there.
const VITEST_CLI = path.join(
  path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);

// A module-scoped mock: the shape the guard exists for.
const sharedMock = vi.fn().mockName('sharedMockUnderTest');

const testName = () => expect.getState().currentTestName ?? undefined;

// With the guard off, `vi.fn` is not wrapped and nothing is tracked, so the
// in-process helper checks have nothing to observe. The child runs below pin
// the switch itself; under CI the guard cannot be off.
describe.skipIf(!ENABLED)('guard helpers (in-process, under the guard)', () => {
  it('reports a once-value armed on a mock this test did not create, naming this file', () => {
    sharedMock.mockReturnValueOnce('armed');

    const leaks = findLeaks(testName());

    expect(leaks).toHaveLength(1);
    expect(leaks[0].mockName).toBe('sharedMockUnderTest');
    expect(leaks[0].sites).toHaveLength(1);
    expect(leaks[0].sites[0]).toContain('mockOnceGuard.test.ts');
    expect(formatLeaks('some test', leaks)).toContain('sharedMockUnderTest');
    expect(formatLeaks('some test', leaks)).toContain('mock*Once leak');

    // Consume it, or the guard's own afterEach fails THIS test — which is the
    // behaviour under test, but not what this case is asserting.
    expect(sharedMock()).toBe('armed');
    expect(findLeaks(testName())).toEqual([]);
  });

  it('names only the still-armed queueing lines, then nothing once consumed or reset', () => {
    sharedMock.mockReturnValueOnce(1);
    sharedMock.mockReturnValueOnce(2);
    let leaks = findLeaks(testName());
    expect(leaks).toHaveLength(1);
    expect(leaks[0].sites).toHaveLength(2);
    const [firstSite, secondSite] = leaks[0].sites;

    sharedMock();
    leaks = findLeaks(testName());
    expect(leaks).toHaveLength(1);
    // The consumed line is gone from the report; the armed one remains.
    expect(leaks[0].sites).toEqual([secondSite]);
    expect(leaks[0].sites).not.toContain(firstSite);

    sharedMock();
    expect(findLeaks(testName())).toEqual([]);

    sharedMock.mockReturnValueOnce('to-be-reset');
    sharedMock.mockReset();
    expect(findLeaks(testName())).toEqual([]);
  });

  it('does not mistake a reused persistent implementation for an armed value', () => {
    const impl = () => 'same function';
    sharedMock.mockImplementationOnce(impl);
    expect(sharedMock()).toBe('same function');
    sharedMock.mockImplementation(impl);
    expect(sharedMock.getMockImplementation()).toBe(impl);
    expect(findLeaks(testName())).toEqual([]);
    sharedMock.mockReset();
  });

  it('ignores mocks created inside the current test', () => {
    const local = vi.fn().mockName('local');
    local.mockReturnValueOnce('left armed on purpose');
    expect(findLeaks(testName())).toEqual([]);
  });

  it('captureSite skips node_modules and the guard file and returns file:line:col', () => {
    const stack = [
      'Error',
      '    at track (/repo/web/vitest.mockOnceGuard.ts:80:5)',
      '    at Object.mockReturnValueOnce (/repo/node_modules/@vitest/spy/dist/index.js:159:40)',
      '    at /repo/web/src/lib/foo.test.ts:42:17',
      '    at run (/repo/node_modules/vitest/dist/x.js:1:1)',
    ].join('\n');
    expect(captureSite(stack)).toBe('/repo/web/src/lib/foo.test.ts:42:17');
    expect(captureSite('')).toBe('<unknown>');
    expect(captureSite('Error\n    at x (/repo/node_modules/a.js:1:1)')).toBe('<unknown>');
  });

  it('leakError anchors its stack at the queueing line, not at the guard', () => {
    const err = leakError('t', [{ mockName: 'm', sites: ['/repo/web/src/x.test.ts:12:3'] }]);
    expect(err.message).toContain('still armed from /repo/web/src/x.test.ts:12:3');
    expect(err.stack?.split('\n').pop()).toBe('    at /repo/web/src/x.test.ts:12:3');
    expect(err.stack).not.toContain('vitest.mockOnceGuard');
  });
});

interface JsonAssertion { fullName: string; status: string; failureMessages: string[] }
interface JsonFile { name: string; assertionResults: JsonAssertion[] }
interface JsonReport { numTotalTests: number; testResults: JsonFile[] }

interface ChildRun { status: number | null; stderr: string; byName: Map<string, JsonAssertion>; total: number }

/** Run the fixture config in a child vitest with `env` layered over a CI-free environment. */
function runFixtures(env: Record<string, string | undefined>): ChildRun {
  const outDir = mkdtempSync(path.join(tmpdir(), 'once-guard-'));
  const outFile = path.join(outDir, 'report.json');
  try {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    // A nested vitest must not inherit the parent's worker identity or CI.
    for (const key of ['VITEST', 'VITEST_WORKER_ID', 'VITEST_POOL_ID', 'CI', 'MOCK_ONCE_GUARD']) {
      delete childEnv[key];
    }
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete childEnv[key];
      else childEnv[key] = value;
    }
    const run = spawnSync(
      process.execPath,
      [VITEST_CLI, 'run', '--config', 'vitest.mockOnceGuard.fixtures.config.ts', '--reporter=json', `--outputFile=${outFile}`],
      { cwd: WEB_ROOT, env: childEnv, encoding: 'utf8', timeout: 120_000 },
    );
    const report = JSON.parse(readFileSync(outFile, 'utf8')) as JsonReport;
    const byName = new Map<string, JsonAssertion>();
    for (const file of report.testResults) {
      for (const a of file.assertionResults) byName.set(a.fullName, a);
    }
    return { status: run.status, stderr: run.stderr, byName, total: report.numTotalTests };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** 1-based line of the first fixture line carrying `marker` — so an edit to a fixture cannot silently desync the pin. */
function fixtureLine(fixture: string, marker: string): number {
  const lines = readFileSync(path.join(FIXTURES, fixture), 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.includes(marker));
  if (idx < 0) throw new Error(`${fixture} has no '${marker}' marker`);
  return idx + 1;
}

function sitePattern(fixture: string, marker: string): RegExp {
  return new RegExp(`${fixture.replace(/\./g, '\\.')}:${fixtureLine(fixture, marker)}:\\d+`);
}

const EVERY_FIXTURE_TEST = 16;

describe('guard in a real vitest run over the fixtures', () => {
  it('fails exactly the leaking tests, names the still-armed line, and passes the balanced shapes', () => {
    const run = runFixtures({ CI: 'true', MOCK_ONCE_GUARD: 'on' });
    // The child MUST fail: several fixtures leak by construction. A green
    // child means the guard did not fire — the vacuous case.
    expect(run.status, `child vitest exit=${run.status}\n${run.stderr}`).not.toBe(0);
    // Anti-vacuity: every fixture ran.
    expect(run.total).toBe(EVERY_FIXTURE_TEST);

    const failed = (name: string): string => {
      const a = run.byName.get(name);
      expect(a?.status, name).toBe('failed');
      const msg = a?.failureMessages.join('\n') ?? '';
      expect(msg, name).toContain('mock*Once leak');
      return msg;
    };

    // Module-scoped vi.fn.
    let msg = failed('queues a once-value on the shared mock and never consumes it');
    expect(msg).toContain('sharedModuleMock');
    expect(msg).toMatch(sitePattern('leaks.fixture.ts', '<- leak'));

    // vi.mock factory, statically imported.
    msg = failed('arms a once-value on the factory mock without consuming it');
    expect(msg).toMatch(sitePattern('viMockFactory.fixture.ts', '<- leak'));

    // vi.mock factory first triggered INSIDE a test by a dynamic import.
    msg = failed('arms a once-value on a lazily built factory mock without consuming it');
    expect(msg).toMatch(sitePattern('viMockFactoryLazy.fixture.ts', '<- leak'));

    // Bare automock: never passes through vi.fn.
    msg = failed('arms a once-value on a bare automock without consuming it');
    expect(msg).toMatch(sitePattern('automock.fixture.ts', '<- leak'));

    // The async helpers, and "only the still-armed line is named".
    msg = failed('queues mockResolvedValueOnce and never awaits it');
    expect(msg).toMatch(sitePattern('leaksAsync.fixture.ts', '<- leak'));
    msg = failed('queues mockRejectedValueOnce and never awaits it');
    expect(msg).toMatch(new RegExp(`leaksAsync\\.fixture\\.ts:${fixtureLine('leaksAsync.fixture.ts', 'mockRejectedValueOnce(new Error')}:\\d+`));
    msg = failed('queues two values and consumes only the first');
    expect(msg).toMatch(new RegExp(`leaksAsync\\.fixture\\.ts:${fixtureLine('leaksAsync.fixture.ts', "mockReturnValueOnce('armed')")}:\\d+`));
    expect(msg).not.toMatch(sitePattern('leaksAsync.fixture.ts', '<- consumed'));

    for (const name of [
      'the next test consumes the leftover and is not blamed',
      'the next test consumes the lazy leftover and is not blamed',
      'the next test consumes the automock leftover and is not blamed',
      'queues two values and consumes both',
      'queues via mockResolvedValueOnce and awaits it',
      'queues, then mockReset drains the queue',
      'a mock built inside the test may leave a once-value armed',
      'beforeEach-built mocks may also leave a once-value armed',
      'reuses a consumed once-implementation as the persistent one',
    ]) {
      expect(run.byName.get(name)?.status, name).toBe('passed');
    }
  }, 150_000);

  it('MOCK_ONCE_GUARD=off is honoured locally: the leaking fixtures pass and the child exits 0', () => {
    const run = runFixtures({ MOCK_ONCE_GUARD: 'off', CI: undefined });
    expect(run.status, `child vitest exit=${run.status}\n${run.stderr}`).toBe(0);
    expect(run.total).toBe(EVERY_FIXTURE_TEST);
    expect(run.byName.get('queues a once-value on the shared mock and never consumes it')?.status).toBe('passed');
    expect(run.byName.get('arms a once-value on a bare automock without consuming it')?.status).toBe('passed');
  }, 150_000);

  it('MOCK_ONCE_GUARD=off is ignored under CI: the leaking fixtures still fail', () => {
    const run = runFixtures({ MOCK_ONCE_GUARD: 'off', CI: 'true' });
    expect(run.status, `child vitest exit=${run.status}\n${run.stderr}`).not.toBe(0);
    expect(run.byName.get('queues a once-value on the shared mock and never consumes it')?.status).toBe('failed');
    expect(run.byName.get('arms a once-value on a bare automock without consuming it')?.status).toBe('failed');
  }, 150_000);
});
