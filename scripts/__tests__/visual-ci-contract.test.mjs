/** Keep the design-change visual job inside the required CI result. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const workflow = YAML.parse(readFileSync(fileURLToPath(new URL('../../.github/workflows/quality-gates.yml', import.meta.url)), 'utf8'));
const changed = "steps.check-design.outputs.changed == 'true'";
function validate(document) {
  const job = document.jobs.chromatic;
  assert.ok(job && job.if === undefined && !job['continue-on-error'], 'visual job must execute');
  const tokens = job.steps.filter(step => step.name === 'Require Chromatic token');
  assert.equal(tokens.length, 1, 'one required token step');
  const token = tokens[0];
  assert.equal(token.if, changed, 'token step must execute for design changes');
  assert.ok(!token['continue-on-error'], 'token failures cannot be ignored');
  assert.equal(token.env.CHROMATIC_TOKEN, '$' + '{{ secrets.CHROMATIC_PROJECT_TOKEN }}');
  assert.match(token.run, /if \[ -z "\$CHROMATIC_TOKEN" \]; then/);
  assert.match(token.run, /\bexit 1\b/, 'missing token must fail');
  const actions = job.steps.filter(step => step.name === 'Run Chromatic');
  assert.equal(actions.length, 1, 'one owning visual action');
  const action = actions[0];
  assert.equal(action.if, changed, 'visual action must execute for design changes');
  assert.ok(!action['continue-on-error'], 'visual failures cannot be ignored');
  assert.equal(action.uses, 'chromaui/action@259eda5f0e44c0c1eab38b672f1c4c967cc969b7');
  assert.equal(action.with.exitOnceUploaded, false, 'upload alone cannot certify visual results');
  assert.equal(action.with.exitZeroOnChanges, false, 'unaccepted visual changes must fail');
  assert.equal(action.with.autoAcceptChanges, false, 'visual changes require review');
  assert.equal(action.with.onlyChanged, true);
  assert.ok(job.steps.indexOf(token) < job.steps.indexOf(action), 'credentials must be checked before the action');
}

test('visual gate waits for completed accepted results and preserves the design-only skip', () => validate(workflow));
for (const [name, value, expected] of [['missing', '', 1], ['configured', 'public-test-token-do-not-log', 0]]) {
  test('visual token check ' + name + ' fails closed without logging credentials', () => {
    const step = workflow.jobs.chromatic.steps.find(step => step.name === 'Require Chromatic token') ?? workflow.jobs.chromatic.steps.find(step => step.id === 'check-token');
    const bash = process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe') : 'bash';
    const outputDirectory = mkdtempSync(join(tmpdir(), 'visual-token-contract-'));
    try {
      const outputFile = join(outputDirectory, 'github-output').replaceAll('\\', '/');
      const result = spawnSync(bash, ['-c', step.run], { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CHROMATIC_TOKEN: value, GITHUB_OUTPUT: outputFile } });
      assert.equal(result.error, undefined);
      assert.equal(result.status, expected, result.stderr);
      if (value) assert.ok(!(result.stdout + result.stderr).includes(value));
      if (!value) assert.match(result.stdout + result.stderr, /required for design changes/);
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
}
const controls = [
  ['upload-only success', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Run Chromatic').with.exitOnceUploaded = true; }],
  ['ignored visual differences', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Run Chromatic').with.exitZeroOnChanges = true; }],
  ['automatic visual acceptance', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Run Chromatic').with.autoAcceptChanges = true; }],
  ['disabled visual job', doc => { doc.jobs.chromatic.if = false; }],
  ['ignored visual job error', doc => { doc.jobs.chromatic['continue-on-error'] = true; }],
  ['disabled token check', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Require Chromatic token').if = false; }],
  ['missing token check', doc => { doc.jobs.chromatic.steps = doc.jobs.chromatic.steps.filter(s => s.name !== 'Require Chromatic token'); }],
  ['ignored token failure', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Require Chromatic token')['continue-on-error'] = true; }],
  ['successful missing token', doc => { const s = doc.jobs.chromatic.steps.find(s => s.name === 'Require Chromatic token'); s.run = s.run.replace('exit 1', 'exit 0'); }],
  ['disabled visual action', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Run Chromatic').if = false; }],
  ['ignored visual action error', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Run Chromatic')['continue-on-error'] = true; }],
  ['duplicate visual action', doc => { doc.jobs.chromatic.steps.push(structuredClone(doc.jobs.chromatic.steps.find(s => s.name === 'Run Chromatic'))); }],
];
for (const [name, mutate] of controls) {
  test('visual contract rejects ' + name, () => {
    const document = structuredClone(workflow);
    const before = YAML.stringify(document);
    mutate(document);
    assert.notEqual(YAML.stringify(document), before, 'control must change the actual fixture');
    assert.throws(() => validate(YAML.parse(YAML.stringify(document))));
  });
}
test('visual contracts remain imported by the required production CI suite', () => {
  const entry = readFileSync(fileURLToPath(new URL('./production-ci-contract.test.mjs', import.meta.url)), 'utf8');
  assert.match(entry, /^import '\.\/visual-ci-contract\.test\.mjs';$/m);
});
