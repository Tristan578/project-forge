import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const schedule = readFileSync(new URL('.github/workflows/hook-tests-scheduled.yml', root), 'utf8');
const ci = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
// Extract literal run blocks from these workflows; refuse a missing/empty block.
function runBlock(source, name) {
  const start = source.indexOf('      - name: ' + name + '\n');
  assert.ok(start >= 0, 'missing step: ' + name);
  const step = source.slice(start).split(/\n      - /)[0];
  const match = step.match(/        run: \|\n((?:          .*\n|\n)+)/);
  assert.ok(match, 'missing literal run block: ' + name);
  return match[1].split('\n').map(line => line.slice(10)).join('\n');
}
const bash = process.env.TEST_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
function execute(script, cwd) {
  return spawnSync(bash, ['-e', '-o', 'pipefail', '-c', script], { cwd, encoding: 'utf8' });
}

test('weekly gate keeps the complete PR ShellCheck scope', () => {
  const scheduled = runBlock(schedule, 'Shellcheck the hooks this gate owns');
  const current = runBlock(ci, 'Shellcheck the hooks owned by this change');
  assert.equal(scheduled.slice(scheduled.indexOf('shellcheck -x')).trimEnd(), current.slice(current.indexOf('shellcheck -x')).trimEnd());
});

test('runner rejects empty suites, propagates failures, and runs later suites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hook-schedule-'));
  try {
    const script = runBlock(schedule, 'Run hook test suites');
    assert.equal(execute(script, dir).status, 1);
    const suites = join(dir, '.claude/hooks/__tests__');
    mkdirSync(suites, { recursive: true });
    writeFileSync(join(suites, 'a.test.sh'), 'exit 0\n');
    assert.equal(execute(script, dir).status, 0);
    writeFileSync(join(suites, 'a.test.sh'), 'exit 1\n');
    writeFileSync(join(suites, 'z.test.sh'), 'echo later-suite-ran\n');
    const result = execute(script, dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /later-suite-ran/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scheduled failures create or update one issue and propagate API errors', () => {
  const reportingStep = schedule.slice(schedule.indexOf('      - name: Report failure')).split(/\n      - /)[0];
  const condition = /^        if: failure\(\) && github.event_name == 'schedule'$/m;
  assert.match(reportingStep, condition);
  assert.doesNotMatch(reportingStep.replace('        if:', '        # if:'), condition);
  const script = runBlock(schedule, 'Report failure');
  for (const existing of ['', '123']) {
    const mock = 'gh() { if [ "$2" = list ]; then printf "%s" "' + existing + '"; else printf "GH_CALL:"; printf "<%s>" "$@"; fi; }\n';
    const result = execute(mock + 'RUN_URL=https://example.test/run\n' + script, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, existing ? /<issue><comment><123>/ : /<issue><create>/);
    assert.match(result.stdout, /https:\/\/example.test\/run/);
  }
  assert.notEqual(execute('gh() { return 1; }\nRUN_URL=test\n' + script, undefined).status, 0);
});
