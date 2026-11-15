import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Execute the workflow's actual comparison, so a fail-open edit cannot leave
// tests passing against a separate helper that the workflow no longer calls.
const workflow = readFileSync(new URL('../../.github/workflows/quality-gates.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const comparison = workflow.match(/node --input-type=module << 'NODE_EOF'\n([\s\S]*?)\n\s*NODE_EOF/);
assert.ok(comparison, 'Lighthouse comparison must remain testable');
const source = comparison[1].replace(/^          /gm, '');

function run(t, baseline, effects) {
  const cwd = mkdtempSync(join(tmpdir(), 'forge-lighthouse-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const [directory, reports] of [['.lhci-baseline', baseline], ['.lhci-effects', effects]]) {
    if (reports === undefined) continue;
    const target = join(cwd, directory);
    mkdirSync(target);
    reports.forEach((report, i) => writeFileSync(join(target, `lhr-${i}.json`), report));
  }
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    cwd, input: source, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

const reports = (...scores) => scores.map(score => JSON.stringify({ categories: { performance: { score } } }));
const healthy = reports(0.9, 0.9, 0.9);

test('passes complete reports within the performance budget', t => {
  assert.equal(run(t, healthy, reports(0.85, 0.86, 0.87)).status, 0);
});

test('accepts exactly ten points despite floating-point subtraction', t => {
  assert.equal(run(t, reports(0.8, 0.8, 0.8), reports(0.7, 0.7, 0.7)).status, 0);
});

test('fails when the median regression exceeds ten points', t => {
  const result = run(t, healthy, reports(0.7, 0.75, 1));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /point regression/);
});

test('preserves a legitimate zero score', t => {
  assert.equal(run(t, reports(0, 0, 0), reports(0, 0, 0)).status, 0);
});

for (const [name, broken] of [
  ['missing directory', undefined],
  ['empty directory', []],
  ['incomplete sample', reports(0.9, 0.9)],
  ['extra stale report', reports(0.9, 0.9, 0.9, 0.9)],
  ['malformed JSON', ['{', ...reports(0.9, 0.9)]],
  ['missing score', ['{}', ...reports(0.9, 0.9)]],
  ['null score', reports(null, 0.9, 0.9)],
  ['string score', reports('0.9', 0.9, 0.9)],
  ['negative score', reports(-0.1, 0.9, 0.9)],
  ['score over one', reports(1.1, 0.9, 0.9)],
  ['non-finite score', ['{"categories":{"performance":{"score":1e400}}}', ...reports(0.9, 0.9)]],
  ['runtime error', [JSON.stringify({ categories: { performance: { score: 0.9 } }, runtimeError: { code: 'NO_FCP' } }), ...reports(0.9, 0.9)]],
]) {
  test(`fails on ${name} in either collection`, t => {
    for (const [baseline, effects] of [[broken, healthy], [healthy, broken]]) {
      assert.equal(run(t, baseline, effects).status, 1);
    }
  });
}

test('workflow runs the regression suite and requests the validated sample size', () => {
  assert.match(workflow, /^\s+run: node --test scripts\/__tests__\/lighthouse-delta\.test\.mjs$/m);
  assert.equal((workflow.match(/--numberOfRuns=3/g) ?? []).length, 2);
});

test('workflow archives both real LHCI output directories before comparison', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'forge-lighthouse-archive-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const stepNames = [
    'Collect baseline Lighthouse runs (effects off)',
    'Collect effects-on Lighthouse runs',
  ];
  const directories = ['.lhci-baseline', '.lhci-effects'];
  for (const [index, name] of stepNames.entries()) {
    const marker = `      - name: ${name}\n`;
    const start = workflow.indexOf(marker);
    assert.notEqual(start, -1, `Missing collection step: ${name}`);
    const end = workflow.indexOf('\n      - ', start + marker.length);
    assert.notEqual(end, -1, `Missing step after ${name}`);
    const step = workflow.slice(start, end);
    const runStart = step.indexOf('        run: |\n');
    assert.notEqual(runStart, -1, `Missing run block in ${name}`);
    const run = step.slice(runStart + '        run: |\n'.length)
      .replace(/^          /gm, '').split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
    // collect has no outputDir option. The real collector always
    // writes .lighthouseci and clears prior reports on its next invocation.
    assert.doesNotMatch(run, /--outputDir/);
    assert.match(run, /lhci collect \\\n/);
    assert.match(run, /--numberOfRuns=3/);
    const archive = run.match(/^node --input-type=module -e "([^"]+)"$/m);
    assert.ok(archive, `Missing archive command in ${name}`);
    assert.ok(run.indexOf(archive[0]) > run.indexOf('--settings.chromeFlags='));

    // Model the collector's documented output, then execute the archive code
    // taken directly from this step instead of restating the move in the test.
    const collected = join(cwd, '.lighthouseci');
    mkdirSync(collected);
    const sample = reports(...Array(3).fill(index === 0 ? 0.9 : 0.85));
    sample.forEach((report, i) => writeFileSync(join(collected, `lhr-${i}.json`), report));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', archive[1]], {
      cwd, encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(collected), false);
    assert.equal(readFileSync(join(cwd, directories[index], 'lhr-0.json'), 'utf8'), sample[0]);
  }
  // Both collections must remain independently available to the real gate.
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    cwd, input: source, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Baseline \(effects off\): 90\.0/);
  assert.match(result.stdout, /Effects on: 85\.0/);
});
