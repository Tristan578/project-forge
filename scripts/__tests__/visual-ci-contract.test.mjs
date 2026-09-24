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
function validate(document, baselineDocument = baseline) {
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
