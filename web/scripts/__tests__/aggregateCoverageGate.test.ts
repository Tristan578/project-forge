// @vitest-environment node
/** Prove two real environments jointly pass coverage and fail below aggregate thresholds. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('enforces all four aggregate thresholds across successful Node and DOM projects', () => {
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
    writeFileSync(join(directory, 'node.test.ts'), "import { expect, it } from 'vitest'; import { reached } from './subject'; it('Node positive control', () => { expect(typeof document).toBe('undefined'); expect(reached(true)).toBe(1); });");
    writeFileSync(join(directory, 'dom.test.ts'), "import { expect, it } from 'vitest'; import { reached } from './subject'; it('DOM positive control', () => { expect(typeof document).toBe('object'); expect(reached(false)).toBe(2); });");
    writeFileSync(join(directory, 'vitest.config.mjs'), [
      "import base from '../vitest.config.ts';",
      "import node from '../vitest.config.node.ts'; import dom from '../vitest.config.jsdom.ts';",
      "const configs = { './vitest.config.node.ts': node, './vitest.config.jsdom.ts': dom };",
      'export default { ...base, test: { ...base.test,',
      'projects: base.test.projects.map(name => ({ ...configs[name], test: { ...configs[name].test, exclude: [], include: [' + JSON.stringify(relative) + ' + (configs[name].test.environment === "node" ? "/node.test.ts" : "/dom.test.ts")] } })),',
      'coverage: { ...base.test.coverage, include: [' + JSON.stringify(relative + '/subject.ts') + '], exclude: [],',
      'reportsDirectory: ' + JSON.stringify(join(directory, 'coverage')) + ' } } };',
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
    expect(report.numPassedTests).toBe(2);
    expect(report.numFailedTests).toBe(0);
    const coverage = JSON.parse(readFileSync(join(directory, 'coverage/coverage-summary.json'), 'utf8'));
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      expect(output).toContain('Coverage for ' + metric);
      expect(coverage.total[metric].total).toBeGreaterThan(0);
      expect(Number.isFinite(coverage.total[metric].pct)).toBe(true);
      expect(coverage.total[metric].pct).toBeLessThan(75);
    }
    // Each project covers only one side of each branch; only their union clears
    // the unchanged production thresholds.
    writeFileSync(join(directory, 'node.test.ts'), "import { expect, it } from 'vitest'; import { reached, untouched } from './subject'; it('Node passing aggregation control', () => { expect(typeof document).toBe('undefined'); expect(reached(true)).toBe(1); expect(untouched(true)).toBe(3); });");
    writeFileSync(join(directory, 'dom.test.ts'), "import { expect, it } from 'vitest'; import { reached, untouched } from './subject'; it('DOM passing aggregation control', () => { expect(typeof document).toBe('object'); expect(reached(false)).toBe(2); expect(untouched(false)).toBe(4); });");
    execFileSync(process.execPath, [cli, 'run', '--config', join(directory, 'vitest.config.mjs'), '--coverage', '--reporter=json', '--outputFile', results], {
      cwd: web, env: { ...process.env, CI: 'true' }, timeout: 60000,
      maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const passing = JSON.parse(readFileSync(results, 'utf8'));
    expect(passing.numPassedTests).toBe(2);
    expect(passing.numFailedTests).toBe(0);
    const aggregate = JSON.parse(readFileSync(join(directory, 'coverage/coverage-summary.json'), 'utf8'));
    for (const metric of ['statements', 'branches', 'functions', 'lines']) {
      expect(aggregate.total[metric].total).toBeGreaterThan(0);
      expect(aggregate.total[metric].pct).toBe(100);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90000);
