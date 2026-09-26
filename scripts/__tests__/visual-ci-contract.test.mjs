/** Keep the design-change visual job inside the required CI result. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { validateVisualResults } from '../check-visual-results.mjs';

const workflow = YAML.parse(readFileSync(fileURLToPath(new URL('../../.github/workflows/quality-gates.yml', import.meta.url)), 'utf8'));
const baseline = YAML.parse(readFileSync(fileURLToPath(new URL('../../.github/workflows/chromatic-baseline.yml', import.meta.url)), 'utf8'));
const changed = "steps.check-design.outputs.changed == 'true'";
// The pin is asserted by SHAPE plus LOCKSTEP, never by literal value: a literal
// reddened every Dependabot bump (#10136) while proving nothing a shape check
// does not. The comparer here and the baseline writer in chromatic-baseline.yml
// must run the same CLI commit, or the reference snapshots were captured by
// different code than the ones being diffed (#9621).
const pinned = /^chromaui\/action@[0-9a-f]{40}$/;
function baselinePin(document) {
  const writers = document.jobs.baseline.steps.filter(step => step.name === 'Publish and accept baseline');
  assert.equal(writers.length, 1, 'one baseline writer');
  assert.match(writers[0].uses, pinned, 'baseline writer must pin chromaui/action to a full commit SHA');
  return writers[0].uses;
}
// The ONLY job-level condition the visual job may carry is the explicit pause
// switch (#10279). Anything else (`if: false`, a hard-coded expression) is a
// silent unwiring and is rejected exactly as it was before the pause existed.
// Everything below the `if:` is the un-paused job body and is asserted
// independently of the switch's current value.
const pauseIf = '$' + '{{ !inputs.chromatic-paused }}';
function validate(document, baselineDocument = baseline) {
  const job = document.jobs.chromatic;
  assert.ok(job && (job.if === undefined || job.if === pauseIf) && !job['continue-on-error'], 'visual job must execute unless the explicit pause switch skips it');
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
  assert.match(action.uses, pinned, 'visual action must pin chromaui/action to a full commit SHA');
  assert.equal(action.uses, baselinePin(baselineDocument), 'visual action and baseline writer must run the same chromaui/action commit');
  assert.equal(action.with.exitOnceUploaded, false, 'upload alone cannot certify visual results');
  assert.equal(action.with.exitZeroOnChanges, false, 'unaccepted visual changes must fail');
  assert.equal(action.with.autoAcceptChanges, false, 'visual changes require review');
  assert.equal(action.with.onlyChanged, true);
  assert.equal(action.with.diagnosticsFile, 'chromatic-diagnostics.json');
  const clear = job.steps.filter(step => step.name === 'Clear stale visual diagnostics');
  assert.equal(clear.length, 1);
  assert.equal(clear[0].if, changed);
  assert.ok(!clear[0]['continue-on-error']);
  assert.equal(clear[0].run, 'rm -f apps/design/chromatic-diagnostics.json');
  assert.ok(job.steps.indexOf(clear[0]) < job.steps.indexOf(action));
  const results = job.steps.filter(step => step.name === 'Verify completed visual results');
  assert.equal(results.length, 1);
  assert.equal(results[0].if, changed);
  assert.ok(!results[0]['continue-on-error']);
  assert.equal(results[0].run, 'node scripts/check-visual-results.mjs apps/design/chromatic-diagnostics.json');
  assert.ok(job.steps.indexOf(results[0]) > job.steps.indexOf(action));
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
  ['missing diagnostics', doc => { delete doc.jobs.chromatic.steps.find(s => s.name === 'Run Chromatic').with.diagnosticsFile; }],
  ['disabled fresh report cleanup', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Clear stale visual diagnostics').if = false; }],
  ['ignored cleanup failure', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Clear stale visual diagnostics')['continue-on-error'] = true; }],
  ['disabled results verification', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Verify completed visual results').if = false; }],
  ['missing results verification', doc => { doc.jobs.chromatic.steps = doc.jobs.chromatic.steps.filter(s => s.name !== 'Verify completed visual results'); }],
  ['ignored results failure', doc => { doc.jobs.chromatic.steps.find(s => s.name === 'Verify completed visual results')['continue-on-error'] = true; }],
  ['results before action', doc => { const i = doc.jobs.chromatic.steps.findIndex(s => s.name === 'Verify completed visual results'); doc.jobs.chromatic.steps.unshift(doc.jobs.chromatic.steps.splice(i, 1)[0]); }],
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
// Each pin control names the assertion that must fire, so a mutation caught by
// some unrelated check cannot pass as proof that the pin contract works.
const comparerOf = doc => doc.jobs.chromatic.steps.find(s => s.name === 'Run Chromatic');
const writerOf = doc => doc.jobs.baseline.steps.find(s => s.name === 'Publish and accept baseline');
// A different, still well-formed commit SHA: only the lockstep check can see it.
const otherCommit = uses => uses.slice(0, -1) + (uses.endsWith('0') ? '1' : '0');
const pinControls = [
  ['mutable visual action tag', 'comparer', doc => { comparerOf(doc).uses = 'chromaui/action@v18.9.4'; }, /visual action must pin/],
  ['abbreviated visual action SHA', 'comparer', doc => { comparerOf(doc).uses = comparerOf(doc).uses.slice(0, -28); }, /visual action must pin/],
  ['forked visual action', 'comparer', doc => { comparerOf(doc).uses = comparerOf(doc).uses.replace('chromaui/', 'chromaui-fork/'); }, /visual action must pin/],
  ['visual action drifted from baseline', 'comparer', doc => { comparerOf(doc).uses = otherCommit(comparerOf(doc).uses); }, /same chromaui\/action commit/],
  ['baseline drifted from visual action', 'baseline', doc => { writerOf(doc).uses = otherCommit(writerOf(doc).uses); }, /same chromaui\/action commit/],
  ['mutable baseline tag', 'baseline', doc => { writerOf(doc).uses = 'chromaui/action@v18.9.4'; }, /baseline writer must pin/],
  ['missing baseline writer', 'baseline', doc => { doc.jobs.baseline.steps = doc.jobs.baseline.steps.filter(s => s.name !== 'Publish and accept baseline'); }, /one baseline writer/],
  ['duplicate baseline writer', 'baseline', doc => { doc.jobs.baseline.steps.push(structuredClone(writerOf(doc))); }, /one baseline writer/],
];
const reparse = doc => YAML.parse(YAML.stringify(doc));
for (const [name, side, mutate, expected] of pinControls) {
  test('visual contract rejects ' + name, () => {
    const documents = { comparer: structuredClone(workflow), baseline: structuredClone(baseline) };
    const before = YAML.stringify(documents[side]);
    mutate(documents[side]);
    assert.notEqual(YAML.stringify(documents[side]), before, 'control must change the actual fixture');
    assert.throws(() => validate(reparse(documents.comparer), reparse(documents.baseline)), expected);
  });
}
test('a lockstep bump of both chromaui/action pins keeps the visual contract green', () => {
  const comparer = structuredClone(workflow), writer = structuredClone(baseline);
  const next = otherCommit(comparerOf(comparer).uses);
  assert.notEqual(next, comparerOf(workflow).uses, 'control must move the pin');
  comparerOf(comparer).uses = next;
  writerOf(writer).uses = next;
  validate(reparse(comparer), reparse(writer));
});

// ---- Temporary pause (#10279) -------------------------------------------
// The pause must be EXPLICIT (one literal switch per workflow, in lockstep),
// SELF-ANNOUNCING (a paused design change always produces a warning that visual
// regression was NOT checked) and must never report the visual job as passed.
// None of these assertions depend on the switch's current value, so lifting
// the pause needs no edit here.
const callers = ['ci.yml', 'cd.yml'].map(name => [name, YAML.parse(readFileSync(fileURLToPath(new URL('../../.github/workflows/' + name, import.meta.url)), 'utf8'))]);
const noticeIf = '$' + '{{ inputs.chromatic-paused && inputs.design-changed }}';
const baselineIf = '$' + "{{ needs.pause-switch.outputs.paused == 'false' }}";
function noticeStep(document) {
  const job = document.jobs['chromatic-paused-notice'];
  assert.ok(job, 'a paused gate must announce itself through the notice job');
  assert.equal(job.steps.length, 1, 'the notice job only announces');
  return job.steps[0];
}
function validatePause(document, baselineDocument = baseline, callerDocuments = callers) {
  const input = document.on.workflow_call.inputs['chromatic-paused'];
  assert.ok(input, 'the pause switch input must exist');
  assert.equal(input.type, 'boolean');
  assert.equal(typeof input.default, 'boolean', 'the pause switch must be a literal boolean');
  const baselineSwitch = baselineDocument.env?.CHROMATIC_PAUSED;
  assert.ok(baselineSwitch === 'true' || baselineSwitch === 'false', 'baseline switch must be a literal true/false');
  assert.equal(baselineSwitch, String(input.default), 'pause switches must move in lockstep');
  for (const [name, caller] of callerDocuments) {
    for (const job of Object.values(caller.jobs)) {
      if (job.uses !== './.github/workflows/quality-gates.yml') continue;
      assert.ok(!(job.with && 'chromatic-paused' in job.with), name + ' must not override the pause switch');
    }
  }
  assert.equal(document.jobs.chromatic.if, pauseIf, 'the visual job must be skipped by, and only by, the pause switch');
  const notice = document.jobs['chromatic-paused-notice'];
  assert.ok(notice, 'a paused gate must announce itself through the notice job');
  assert.match(notice.name, /PAUSED/, 'the notice job name must say the gate is paused');
  assert.match(notice.name, /not checked/i, 'the notice job name must say the gate is paused');
  assert.equal(notice.if, noticeIf, 'notice must run on every paused design change');
  assert.ok(!notice['continue-on-error'] && notice.needs === undefined);
  const step = noticeStep(document);
  assert.equal(step.uses, undefined, 'the notice job must not run any visual action');
  assert.ok(!step['continue-on-error'] && step.if === undefined);
  assert.match(step.run, /::warning[^\n]*NOT checked/, 'the notice must warn that visual regression was NOT checked');
  const sw = baselineDocument.jobs['pause-switch'];
  assert.ok(sw, 'baseline pause switch job must exist');
  assert.match(sw.steps.find(s => s.id === 'read')?.run ?? '', /::warning[^\n]*NOT written/);
  assert.equal(baselineDocument.jobs.baseline.needs, 'pause-switch');
  assert.equal(baselineDocument.jobs.baseline.if, baselineIf, 'baseline writer must be skipped by, and only by, the pause switch');
  return input.default;
}
const bashPath = process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe') : 'bash';
function runStep(run, env) {
  const directory = mkdtempSync(join(tmpdir(), 'visual-pause-contract-'));
  try {
    const output = join(directory, 'out').replaceAll('\\', '/');
    const summary = join(directory, 'summary').replaceAll('\\', '/');
    writeFileSync(output, ''); writeFileSync(summary, '');
    const result = spawnSync(bashPath, ['-c', run], { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env } });
    assert.equal(result.error, undefined);
    return { status: result.status, text: result.stdout + result.stderr, output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8') };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('the pause is explicit, in lockstep, and self-announcing', () => validatePause(workflow));
test('the paused notice step emits a NOT-checked warning and summary', () => {
  const run = runStep(noticeStep(workflow).run, {});
  assert.equal(run.status, 0, run.text);
  assert.match(run.text, /^::warning title=Visual regression NOT checked::/m);
  assert.match(run.summary, /PAUSED - NOT checked/);
  assert.doesNotMatch(run.text + run.summary, /\bpass(ed)?\b/i, 'the notice must never claim a pass');
});
for (const [value, status, paused] of [['true', 0, 'true'], ['false', 0, 'false'], ['yes', 1, null], ['', 1, null]]) {
  test('baseline pause switch reads ' + JSON.stringify(value), () => {
    const run = runStep(baseline.jobs['pause-switch'].steps.find(s => s.id === 'read').run, { CHROMATIC_PAUSED: value });
    assert.equal(run.status, status, run.text);
    if (paused) assert.equal(run.output.trim(), 'paused=' + paused);
    else assert.equal(run.output, '', 'an invalid switch must not emit a paused value');
    if (value === 'true') assert.match(run.text, /::warning[^\n]*NOT written/);
    else assert.doesNotMatch(run.text, /::warning/);
  });
}
test('the un-paused configuration is the fully enforced gate', () => {
  const comparer = structuredClone(workflow), writer = structuredClone(baseline);
  comparer.on.workflow_call.inputs['chromatic-paused'].default = false;
  writer.env.CHROMATIC_PAUSED = 'false';
  assert.equal(validatePause(reparse(comparer), reparse(writer)), false);
  validate(reparse(comparer), reparse(writer));
});
const pauseControls = [
  ['a hard-coded skip in place of the switch', ({ comparer }) => { comparer.jobs.chromatic.if = '$' + '{{ false }}'; }, /skipped by, and only by, the pause switch|must execute/],
  ['a paused gate with no notice job', ({ comparer }) => { delete comparer.jobs['chromatic-paused-notice']; }, /announce itself/],
  ['a notice that does not warn', ({ comparer }) => { noticeStep(comparer).run = 'echo ok'; }, /must warn that visual regression was NOT checked/],
  ['a notice gated off', ({ comparer }) => { comparer.jobs['chromatic-paused-notice'].if = false; }, /every paused design change/],
  ['a notice that runs a visual action', ({ comparer }) => { noticeStep(comparer).uses = 'actions/checkout@v4'; }, /must not run any visual action/],
  ['a notice renamed to look like a pass', ({ comparer }) => { comparer.jobs['chromatic-paused-notice'].name = 'Chromatic Visual Regression'; }, /name must say the gate is paused/],
  ['switches out of lockstep', ({ writer }) => { writer.env.CHROMATIC_PAUSED = writer.env.CHROMATIC_PAUSED === 'true' ? 'false' : 'true'; }, /lockstep/],
  ['a non-literal baseline switch', ({ writer }) => { writer.env.CHROMATIC_PAUSED = '$' + '{{ vars.CHROMATIC_PAUSED }}'; }, /literal true\/false/],
  ['a non-literal quality-gates switch', ({ comparer }) => { comparer.on.workflow_call.inputs['chromatic-paused'].default = 'true'; }, /literal boolean/],
  ['a missing quality-gates switch', ({ comparer }) => { delete comparer.on.workflow_call.inputs['chromatic-paused']; }, /switch input must exist/],
  ['a baseline writer that ignores the switch', ({ writer }) => { delete writer.jobs.baseline.if; }, /baseline writer must be skipped/],
  ['a caller overriding the switch', ({ callers: list }) => { const ci = list.find(([n]) => n === 'ci.yml')[1]; ci.jobs['quality-gates'].with['chromatic-paused'] = false; }, /must not override the pause switch/],
];
for (const [name, mutate, expected] of pauseControls) {
  test('pause contract rejects ' + name, () => {
    const documents = { comparer: structuredClone(workflow), writer: structuredClone(baseline), callers: structuredClone(callers) };
    const before = JSON.stringify(documents);
    mutate(documents);
    assert.notEqual(JSON.stringify(documents), before, 'control must change the actual fixture');
    assert.throws(() => validatePause(reparse(documents.comparer), reparse(documents.writer), documents.callers.map(([n, d]) => [n, reparse(d)])), expected);
  });
}

test('visual contracts remain imported by the required production CI suite', () => {
  const entry = readFileSync(fileURLToPath(new URL('./production-ci-contract.test.mjs', import.meta.url)), 'utf8');
  assert.match(entry, /^import '\.\/visual-ci-contract\.test\.mjs';$/m);
});

const passing = { isPublishOnly: false, build: { features: { uiTests: true }, wasLimited: false, status: 'PASSED', completedAt: '2026-09-17T04:00:00Z', testCount: 27, changeCount: 0, errorCount: 0, interactionTestFailuresCount: 0, actualCaptureCount: 27, inheritedCaptureCount: 0 } };
test('completed visual snapshots pass', () => validateVisualResults(passing));
test('TurboSnap inherited accepted snapshots pass', () => {
  const report = structuredClone(passing);
  report.build.actualCaptureCount = 0;
  report.build.inheritedCaptureCount = 27;
  validateVisualResults(report);
});
const reports = [
  ['publish-only quota success', c => { c.isPublishOnly = true; c.skipSnapshots = true; c.build.features.uiTests = false; c.build.wasLimited = true; }],
  ['disabled tests', c => { c.build.features.uiTests = false; }],
  ['limited tests', c => { c.build.wasLimited = true; }],
  ['missing limit result', c => { delete c.build.wasLimited; }],
  ['skipped snapshots', c => { c.skipSnapshots = true; }],
  ['pending build', c => { c.build.status = 'PENDING'; }],
  ['unaccepted changes', c => { c.build.changeCount = 1; }],
  ['render errors', c => { c.build.errorCount = 1; }],
  ['interaction failures', c => { c.build.interactionTestFailuresCount = 1; }],
  ['missing completion', c => { delete c.build.completedAt; }],
  ['invalid completion', c => { c.build.completedAt = 'not-a-date'; }],
  ['zero tests', c => { c.build.testCount = 0; }],
  ['invalid test count', c => { c.build.testCount = '27'; }],
];
for (const [name, mutate] of reports) {
  test('results verification rejects ' + name, () => {
    const report = structuredClone(passing);
    mutate(report);
    assert.notDeepEqual(report, passing);
    assert.throws(() => validateVisualResults(report), /Visual results are incomplete/);
  });
}
test('results CLI fails safely on unreadable, malformed and publish-only reports', () => {
  const directory = mkdtempSync(join(tmpdir(), 'visual-result-contract-'));
  const script = fileURLToPath(new URL('../check-visual-results.mjs', import.meta.url));
  const marker = 'public-fake-secret-never-log';
  try {
    const path = join(directory, 'diagnostics.json');
    const report = structuredClone(passing);
    report.isPublishOnly = true;
    report.options = { projectToken: marker };
    const cases = [undefined, '{' + marker, JSON.stringify(report), JSON.stringify(passing)];
    for (const [index, source] of cases.entries()) {
      if (source !== undefined) writeFileSync(path, source);
      const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, index === 3 ? 0 : 1);
      assert.ok(!(result.stdout + result.stderr).includes(marker));
      if (index !== 3) assert.match(result.stderr, /Visual results are incomplete/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// The producer refreshes completion fields after testing, not its early capture counters.
test('completed passing builds do not rely on stale capture counters', () => {
  const report = structuredClone(passing);
  report.build.actualCaptureCount = 0;
  report.build.inheritedCaptureCount = 0;
  validateVisualResults(report);
});
