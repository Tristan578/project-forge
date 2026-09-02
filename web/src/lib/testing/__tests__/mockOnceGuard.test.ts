/**
 * Tests for web/vitest.mockOnceGuard.ts (#9542).
 *
 * Two layers, deliberately:
 *
 * 1. In-process checks of the exported helpers, run under the guard itself
 *    (the shared setup imports it), so every mock here is tracked exactly as
 *    it would be in any other file.
 * 2. A REAL child `vitest run` over fixture files with a config that uses the
 *    real setup file. A logic-only test of "would this report a leak" is the
 *    vacuous trap: the property that matters is that a leaking test FAILS in
 *    an actual run, with a message naming the queueing line, and that the
 *    balanced / in-test / beforeEach shapes do NOT. Only a run proves that.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { captureSite, findLeaks, formatLeaks, ENABLED } from '../../../../vitest.mockOnceGuard';

const WEB_ROOT = path.resolve(__dirname, '../../../..');
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

describe('guard helpers (in-process, under the guard)', () => {
  it('is enabled unless MOCK_ONCE_GUARD=off', () => {
    expect(ENABLED).toBe(process.env.MOCK_ONCE_GUARD !== 'off');
  });

  it('reports a once-value armed on a mock this test did not create, naming this file', () => {
    sharedMock.mockReturnValueOnce('armed');

    const leaks = findLeaks(expect.getState().currentTestName ?? undefined);

    expect(leaks).toHaveLength(1);
    expect(leaks[0].mockName).toBe('sharedMockUnderTest');
    expect(leaks[0].sites).toHaveLength(1);
    expect(leaks[0].sites[0]).toContain('mockOnceGuard.test.ts');
    expect(formatLeaks('some test', leaks)).toContain('sharedMockUnderTest');
    expect(formatLeaks('some test', leaks)).toContain('mock*Once leak');

    // Consume it, or the guard's own afterEach fails THIS test — which is the
    // behaviour under test, but not what this case is asserting.
    expect(sharedMock()).toBe('armed');
    expect(findLeaks(expect.getState().currentTestName ?? undefined)).toEqual([]);
  });

  it('reports nothing once the queue is consumed or reset', () => {
    sharedMock.mockReturnValueOnce(1).mockReturnValueOnce(2);
    expect(findLeaks(expect.getState().currentTestName ?? undefined)).toHaveLength(1);
    sharedMock();
    expect(findLeaks(expect.getState().currentTestName ?? undefined)).toHaveLength(1); // one left
    sharedMock();
    expect(findLeaks(expect.getState().currentTestName ?? undefined)).toEqual([]);

    sharedMock.mockReturnValueOnce('to-be-reset');
    sharedMock.mockReset();
    expect(findLeaks(expect.getState().currentTestName ?? undefined)).toEqual([]);
  });

  it('ignores mocks created inside the current test', () => {
    const local = vi.fn().mockName('local');
    local.mockReturnValueOnce('left armed on purpose');
    expect(findLeaks(expect.getState().currentTestName ?? undefined)).toEqual([]);
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
});

interface JsonAssertion { fullName: string; status: string; failureMessages: string[] }
interface JsonFile { name: string; assertionResults: JsonAssertion[] }
interface JsonReport { numTotalTests: number; testResults: JsonFile[] }

describe('guard in a real vitest run over the fixtures', () => {
  it('fails exactly the leaking tests, names the queueing line, and passes the balanced shapes', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'once-guard-'));
    const outFile = path.join(outDir, 'report.json');
    try {
      const run = spawnSync(
        process.execPath,
        [
          VITEST_CLI,
          'run',
          '--config', 'vitest.mockOnceGuard.fixtures.config.ts',
          '--reporter=json',
          `--outputFile=${outFile}`,
        ],
        {
          cwd: WEB_ROOT,
          env: { ...process.env, CI: 'true', MOCK_ONCE_GUARD: 'on', VITEST: undefined, VITEST_WORKER_ID: undefined, VITEST_POOL_ID: undefined },
          encoding: 'utf8',
          timeout: 120_000,
        },
      );
      // The child MUST fail: one fixture is a leak by construction. A green
      // child means the guard did not fire — the vacuous case.
      expect(run.status, `child vitest exit=${run.status}\n${run.stderr}`).not.toBe(0);

      const report = JSON.parse(readFileSync(outFile, 'utf8')) as JsonReport;
      const byName = new Map<string, JsonAssertion>();
      for (const file of report.testResults) {
        for (const a of file.assertionResults) byName.set(a.fullName, a);
      }
      // Anti-vacuity: every fixture ran.
      expect(report.numTotalTests).toBeGreaterThanOrEqual(8);

      const leak = byName.get('queues a once-value on the shared mock and never consumes it');
      expect(leak?.status).toBe('failed');
      const msg = leak?.failureMessages.join('\n') ?? '';
      expect(msg).toContain('mock*Once leak');
      expect(msg).toContain('sharedModuleMock');
      // The line that queued it — file AND line number.
      expect(msg).toMatch(/leaks\.fixture\.ts:8:\d+/);

      const factoryLeak = byName.get('arms a once-value on the factory mock without consuming it');
      expect(factoryLeak?.status).toBe('failed');
      expect(factoryLeak?.failureMessages.join('\n')).toMatch(/viMockFactory\.fixture\.ts:15:\d+/);

      for (const name of [
        'the next test consumes the leftover and is not blamed',
        'queues two values and consumes both',
        'queues via mockResolvedValueOnce and awaits it',
        'queues, then mockReset drains the queue',
        'a mock built inside the test may leave a once-value armed',
        'beforeEach-built mocks may also leave a once-value armed',
      ]) {
        expect(byName.get(name)?.status, name).toBe('passed');
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 150_000);
});
