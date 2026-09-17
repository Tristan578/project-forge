/** Validate executable coverage-ratchet steps and reject disabled-command fixtures. */
'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const YAML = require('yaml');
const rootConfig = 'web/vitest.config.ts';
const owners = ['Sync onboarding coverage facts', 'Open or update ratchet PR'];
const inputs = ['web/src/**', rootConfig, 'web/vitest.config.node.ts', 'web/vitest.config.jsdom.ts', 'web/vitest.test-selection.ts', 'web/package.json'];
const executable = run => run.split('\n').filter(line => !/^\s*#/.test(line)).join('\n').replace(/\\\r?\n\s*/g, ' ');
function validate(source) {
  const workflow = YAML.parse(source);
  const paths = workflow.on.push.paths;
  for (const path of inputs) assert(paths.includes(path), 'Missing measurement trigger: ' + path);
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
  const document = YAML.parse(source);
  mutate(document);
  assert.throws(() => validate(YAML.stringify(document)), undefined, label);
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
for (const path of inputs) reject('missing trigger ' + path, workflow => { workflow.on.push.paths = workflow.on.push.paths.filter(input => input !== path); });
reject('child staged on a continuation line', workflow => { workflow.jobs.ratchet.steps.find(step => step.name === owners[1]).run = workflow.jobs.ratchet.steps.find(step => step.name === owners[1]).run.replace('git add web/vitest.config.ts', 'git add web/vitest.config.ts \\\n web/vitest.config.node.ts'); });
reject('test-only seam', workflow => { workflow.jobs.ratchet.steps[0].run = 'RATCHET_PROJECT_ROOT=/tmp node ignored'; });
assert.throws(() => validate(source.replace('run: |', 'run: echo duplicate\n        run: |')), undefined, 'duplicate YAML run key');
console.log('Workflow contract passed; ' + (controls + 1) + ' disabled-command and trigger controls rejected.');
