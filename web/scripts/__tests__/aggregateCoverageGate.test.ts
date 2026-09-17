// @vitest-environment node
/** Prove passing tests still fail when any aggregate root coverage metric is low. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('enforces all four aggregate thresholds after a successful fixture test', () => {
  const web = process.cwd();
  const directory = mkdtempSync(join(web, '.aggregate-coverage-negative-'));
  const relative = basename(directory);
  try {
    writeFileSync(join(directory, 'subject.ts'), [
      'export function reached(value: boolean) {',
      '  if (value) return 1;',
      '  return 2;',
      '}',
      'export function untouched(value: boolean) {',
      '  if (value) return 3;',
      '  return 4;',
      '}',
    ].join('\n'));
    writeFileSync(join(directory, 'subject.test.ts'), "import { expect, it } from 'vitest'; import { reached } from './subject'; it('positive test control', () => expect(reached(true)).toBe(1));");
    writeFileSync(join(directory, 'vitest.config.mjs'), [
      "import base from '../vitest.config.ts';",
      'export default { ...base, test: { ...base.test, projects: undefined, environment: "node",',
      'include: [' + JSON.stringify(relative + '/subject.test.ts') + '],',
      'coverage: { ...base.test.coverage, include: [' + JSON.stringify(relative + '/subject.ts') + '], exclude: [],',
      'reportsDirectory: ' + JSON.stringify(join(directory, 'coverage')) + ', reporter: ["json-summary"] } } };',
    ].join('\n'));
    const require = createRequire(import.meta.url);
    const cli = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    const results = join(directory, 'tests.json');
    let status = 0;
    let output = '';
    try {
      output = execFileSync(process.execPath, [cli, 'run', '--config', join(directory, 'vitest.config.mjs'), '--coverage', '--reporter=json', '--outputFile', results], {
        cwd: web, env: { ...process.env, CI: 'true' }, encoding: 'utf8', timeout: 60000,
        maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      status = failed.status ?? -1;
      output = String(failed.stdout ?? '') + String(failed.stderr ?? '');
    }
    expect(status).toBe(1);
    const report = JSON.parse(readFileSync(results, 'utf8'));
    expect(report.numPassedTests).toBe(1);
    expect(report.numFailedTests).toBe(0);
    const coverage = JSON.parse(readFileSync(join(directory, 'coverage/coverage-summary.json'), 'utf8'));
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      expect(output).toContain('Coverage for ' + metric);
      expect(coverage.total[metric].total).toBeGreaterThan(0);
      expect(Number.isFinite(coverage.total[metric].pct)).toBe(true);
      expect(coverage.total[metric].pct).toBeLessThan(75);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90000);
