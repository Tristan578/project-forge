/** Validate executable coverage-ratchet steps and reject disabled-command fixtures. */
'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
// This CI self-defense job intentionally runs before npm installation. Parse
// only its known block-style trusted-consumer workflow shape, rejecting
// unsupported step/run shapes and duplicate keys without npm dependencies.
function parse(source) {
  const trigger = source.match(/^on:\r?\n([\s\S]*?)(?=^\S)/m);
  assert(trigger, 'Missing block-style trigger');
  const producer = trigger[1].match(/^  workflow_run:\r?\n((?:^    [^\r\n]+\r?\n)+)/m);
  assert(producer, 'Missing trusted workflow_run trigger');
  assert(!/^  push:/m.test(trigger[1]), 'Duplicate push measurement trigger');
  const workflowRun = {};
  for (const key of ['workflows', 'types', 'branches']) {
    const prefix = '    ' + key + ': [';
    const fields = producer[1].split('\n').filter(line => line.startsWith(prefix));
    assert.equal(fields.length, 1, 'Missing or duplicate workflow_run field: ' + key);
    const field = fields[0].trimEnd();
    assert(field.endsWith(']'), 'Unsupported workflow_run list: ' + key);
    workflowRun[key] = field.slice(prefix.length, -1).split(',').map(item => item.trim());
  }
  const job = source.match(/^  ratchet:\r?\n([\s\S]*?)(?=^  \S|$(?![\s\S]))/m);
  assert(job, 'Missing ratchet job');
  const chunks = job[1].split(/^      - /m).slice(1);
  const steps = chunks.map(chunk => {
    const name = chunk.match(/^name: ([^\r\n]+)/)?.[1];
    const keys = chunk.match(/^        run:/gm) || [];
    assert(keys.length <= 1, 'Duplicate run key');
    if (!keys.length) return { name };
    const run = chunk.match(/^        run: \|\r?\n((?:^          [^\r\n]*\r?\n|^\s*\r?\n)*)/m);
    if (run) return { name, run: run[1] };
    const scalar = chunk.match(/^        run: (?![>|])([^\r\n]+)$/m);
    assert(scalar && !owners.includes(name), 'Expected owning literal block run');
    return { name, run: scalar[1] };
  });
  return { on: { workflow_run: workflowRun }, jobs: { ratchet: { steps } } };
}
function serialize(workflow) {
  return 'on:\n  workflow_run:\n' + ['workflows', 'types', 'branches'].map(key => '    ' + key + ': [' + (workflow.on.workflow_run[key] || []).join(', ') + ']\n').join('') +
    'jobs:\n  ratchet:\n    steps:\n' + workflow.jobs.ratchet.steps.map(step => '      - name: ' + (step.name || 'unnamed') + '\n' +
      (step.run === undefined ? '' : '        run: |\n' + step.run.split('\n').filter(Boolean).map(line => '          ' + line.trimStart() + '\n').join(''))).join('');
}
const owners = ['Sync onboarding coverage facts', 'Open or update ratchet PR'];
const triggerFields = { workflows: ['CI'], types: ['completed'], branches: ['main'] };
const executable = run => run.split('\n').filter(line => !/^\s*#/.test(line)).join('\n').replace(/\\\r?\n\s*/g, ' ');
function validate(source) {
  const workflow = parse(source);
  for (const [key, expected] of Object.entries(triggerFields)) assert.deepEqual(workflow.on.workflow_run[key], expected, 'Untrusted measurement trigger: ' + key);
  const steps = workflow.jobs.ratchet.steps;
  for (const owner of owners) {
    const matches = steps.filter(step => step.name === owner);
    assert.equal(matches.length, 1, 'Expected one owning step: ' + owner);
    assert.equal(typeof matches[0].run, 'string');
    const run = executable(matches[0].run);
    assert.equal((run.match(/^\s*if git diff --quiet web\/vitest\.config\.ts; then\s*$/gm) || []).length, 1, 'Missing or duplicate executable root guard: ' + owner);
    if (owner === owners[1]) assert.equal((run.match(/^\s*git add web\/vitest\.config\.ts(?:\s|$)/gm) || []).length, 1, 'Missing or duplicate executable root stage');
  }
  for (const step of steps) {
    const run = executable(step.run || '');
    assert(!run.includes('RATCHET_PROJECT_ROOT'), 'Test-only seam is wired into a workflow');
    assert(!/^\s*(?:if )?git (?:diff|add)[^\n]*vitest\.config\.(?:node|jsdom)\.ts/m.test(run), 'Child environment config is gated or staged');
    if (!owners.includes(step.name)) assert(!/^\s*if git diff --quiet web\/vitest\.config\.ts; then/m.test(run), 'Root guard moved outside owning step');
  }
}
const path = resolve(__dirname, '../../.github/workflows/coverage-ratchet.yml');
const source = readFileSync(path, 'utf8');
validate(source);
let controls = 0;
function reject(label, mutate) {
  const document = parse(source);
  mutate(document);
  assert.throws(() => validate(serialize(document)), undefined, label);
  controls++;
}
for (const owner of owners) {
  for (const disabled of ['commented', 'removed', 'duplicate']) reject(owner + ' ' + disabled + ' guard', workflow => {
    const step = workflow.jobs.ratchet.steps.find(step => step.name === owner);
    const command = 'if git diff --quiet web/vitest.config.ts; then';
    step.run = step.run.replace(command, disabled === 'commented' ? '# ' + command : disabled === 'removed' ? '' : command + '\n' + command);
  });
  reject(owner + ' duplicated owning step', workflow => workflow.jobs.ratchet.steps.push(structuredClone(workflow.jobs.ratchet.steps.find(step => step.name === owner))));
}
for (const disabled of ['commented', 'removed', 'duplicate']) reject(disabled + ' stage', workflow => {
  const step = workflow.jobs.ratchet.steps.find(step => step.name === owners[1]);
  const command = 'git add web/vitest.config.ts';
  step.run = step.run.replace(command, disabled === 'commented' ? '# ' + command : disabled === 'removed' ? '' : command + '\n' + command);
});
for (const key of Object.keys(triggerFields)) {
  reject('missing producer trigger ' + key, workflow => { workflow.on.workflow_run[key] = []; });
  reject('wrong producer trigger ' + key, workflow => { workflow.on.workflow_run[key] = ['untrusted']; });
}
reject('child staged on a continuation line', workflow => { workflow.jobs.ratchet.steps.find(step => step.name === owners[1]).run = workflow.jobs.ratchet.steps.find(step => step.name === owners[1]).run.replace('git add web/vitest.config.ts', 'git add web/vitest.config.ts \\\n web/vitest.config.node.ts'); });
reject('test-only seam', workflow => { workflow.jobs.ratchet.steps[0].run = 'RATCHET_PROJECT_ROOT=/tmp node ignored'; });
assert.throws(() => validate(source.replace('run: |', 'run: echo duplicate\n        run: |')), undefined, 'duplicate YAML run key');
assert.throws(() => validate(source.replace('workflows: [CI]', 'workflows: [CI]\n    workflows: [CI]')), undefined, 'duplicate producer list');
assert.throws(() => validate(source.replace('on:\n', 'on:\n  push:\n    branches: [main]\n')), undefined, 'duplicate push measurement');
console.log('Workflow contract passed; ' + (controls + 3) + ' disabled-command and trigger controls rejected.');
