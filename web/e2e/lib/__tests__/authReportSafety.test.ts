
/** Exercise the real Playwright reporter pipeline with credential-shaped failures. */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import authConfig from '../../../playwright.auth.config';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

describe('auth report privacy boundary', () => {
  it('disables recordings and uses only the aggregate reporter in the actual config', async () => {
    expect(authConfig.reporter).toEqual([
      ['./e2e/lib/requiredRunReporter.ts', { minPassed: 2, summaryPath: 'auth-results/summary.json' }],
    ]);
    expect(authConfig.use).toMatchObject({ trace: 'off', screenshot: 'off', video: 'off' });
    expect(authConfig.webServer).toMatchObject({ stdout: 'ignore', stderr: 'ignore' });
    const workflow = parse(await readFile(resolve('../.github/workflows/ci.yml'), 'utf8')) as {
      jobs: Record<string, { steps: Array<{ name?: string; with?: Record<string, unknown> }> }>;
    };
    const upload = workflow.jobs['test-e2e-auth'].steps.find((step) => step.name === 'Upload auth-journey report');
    expect(upload?.with).toMatchObject({
      path: 'web/auth-results/summary.json',
      'if-no-files-found': 'error',
    });
  });

  it('does not leak failure arguments, stdout, stderr or attachments through the real CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'auth-reporter-cli-'));
    const secret = 'AUTH_SENTINEL_password_session_token_739';
    const summaryPath = join(dir, 'summary.json');
    const configPath = join(dir, 'playwright.config.cjs');
    try {
      await writeFile(configPath, 'module.exports = ' + JSON.stringify({
        testDir: dir, testMatch: '**/*.spec.cjs', workers: 1, retries: 0,
        outputDir: join(dir, 'raw-results'),
        reporter: [[resolve('e2e/lib/requiredRunReporter.ts'), { enabled: true, minPassed: 1, summaryPath }]],
      }) + ';');
      await writeFile(join(dir, 'failure.spec.cjs'), [
        'const { test } = require(' + JSON.stringify(require.resolve('@playwright/test')) + ');',
        'const secret = ' + JSON.stringify(secret) + ';',
        'test(secret, async () => {',
        '  test.fail();',
        '  console.log(secret); console.error(secret);',
        '  await test.info().attach(secret, { body: Buffer.from(secret), contentType: "text/plain" });',
        '  throw new Error(secret);',
        '});',
      ].join('\n'));
      let exitCode: number | string | undefined = 0;
      let output = '';
      try {
        const result = await run(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', configPath],
          { cwd: dir, timeout: 30_000, maxBuffer: 1_000_000 });
        output = result.stdout + result.stderr;
      } catch (error) {
        const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
        exitCode = failure.code;
        output = (failure.stdout ?? '') + (failure.stderr ?? '');
      }
      // An expected failure must fail this required journey gate, without a
      // fallback Playwright terminal reporter exposing its title/error/steps.
      expect(exitCode).toBe(1);
      expect(output).toContain('0 passed, 0 skipped, 1 failed of 1');
      expect(output).not.toContain(secret);
      const summary = await readFile(summaryPath, 'utf8');
      expect(JSON.parse(summary)).toEqual({
        schemaVersion: 1, status: 'failed', required: true,
        passed: 0, failed: 1, skipped: 0, total: 1,
      });
      expect(summary).not.toContain(secret);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
