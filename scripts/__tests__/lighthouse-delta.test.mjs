import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
