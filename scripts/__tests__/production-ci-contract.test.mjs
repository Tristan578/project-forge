import './visual-ci-contract.test.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
const read = path => YAML.parse(readFileSync(fileURLToPath(new URL('../../' + path, import.meta.url)), 'utf8'));
test('docs build and real route smoke are required and protected against skip tampering', () => {
  const ci = read('.github/workflows/ci.yml'), docs = ci.jobs['docs-e2e'];
  assert.ok(ci.jobs['ci-success'].needs.includes('docs-e2e'));
  assert.match(docs.if, /needs-docs == 'true'/); assert.match(docs.if, /needs-ci == 'true'/);
  assert.ok(docs.steps.some(s => s.run === 'npm run build' && s['working-directory'] === 'apps/docs'));
  assert.ok(docs.steps.some(s => s.run === 'npm run test:e2e' && s['working-directory'] === 'apps/docs'));
});
test('every executable workflow step has a command or action', () => {
  for (const path of ['ci', 'cd', 'quality-gates', 'coverage-ratchet']) {
    for (const [job, value] of Object.entries(read('.github/workflows/' + path + '.yml').jobs)) {
      for (const step of value.steps ?? []) assert.ok(Boolean(step.run) !== Boolean(step.uses), path + ': ' + job + ': ' + step.name);
    }
  }
});
test('ratchet consumes only the completed successful trusted main push producer', () => {
  const ratchet = read('.github/workflows/coverage-ratchet.yml');
  assert.deepEqual(ratchet.on.workflow_run, { workflows: ['CI'], types: ['completed'], branches: ['main'] });
  assert.equal(ratchet.on.push, undefined);
  const job = ratchet.jobs.ratchet;
  for (const condition of ["conclusion == 'success'", "event == 'push'", "head_branch == 'main'", 'head_repository.full_name == github.repository']) assert.ok(job.if.includes(condition));
  assert.ok(job.steps[0].with.ref.includes('workflow_run.head_sha'));
  const download = job.steps.find(s => s.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download.with['digest-mismatch'], 'error');
  assert.ok(download.with['run-id'].includes('workflow_run.id'));
  assert.ok(download.with['artifact-ids']);
  assert.ok(job.steps.some(s => s.run?.includes('validate-coverage-artifact.mjs')));
  const selection = job.steps.find(s => s.id === 'coverage');
  assert.match(selection.run, /git\/ref\/heads\/main/);
  assert.match(selection.run, /current_main.*!=.*SHA/);
  assert.ok(selection.run.indexOf('current_main') < selection.run.indexOf('artifact_id'));
  const ci = read('.github/workflows/ci.yml');
  const suiteJob = Object.values(ci.jobs).find(j => j.steps?.some(s => s.run === 'node --test scripts/__tests__/production-ci-contract.test.mjs'));
  assert.ok(suiteJob.steps.findIndex(s => s.run === 'npm ci') < suiteJob.steps.findIndex(s => s.run === 'node --test scripts/__tests__/production-ci-contract.test.mjs'));
  assert.ok(!job.steps.some(s => /\bvitest(?:\s+(?:run|--))|\bnpm\s+ci\b/.test(s.run ?? '')));
});
test('trusted coverage upload requires summary plus producer identity files', () => {
  const quality = read('.github/workflows/quality-gates.yml');
  const upload = Object.values(quality.jobs).flatMap(j => j.steps ?? []).find(s => s.name === 'Upload trusted coverage summary');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.match(upload.with.path, /coverage-summary.json/);
  assert.match(upload.with.path, /coverage-artifact.json/);
});
test('every Vercel deployment uses the verified cached local CLI', () => {
  const cd = read('.github/workflows/cd.yml');
  let installs = 0;
  for (const job of Object.values(cd.jobs)) {
    for (const step of job.steps ?? []) {
      assert.ok(!/npm (?:i|install) -g vercel/.test(step.run ?? ''));
      if (step.run === 'bash scripts/install-vercel-cli.sh') {
        installs++;
        assert.equal(step.env.VERCEL_CLI_VERSION, '55.0.0');
        assert.ok(job.steps.some(s => s.name === 'Cache pinned Vercel CLI' && s.with.key.includes('runner.arch')));
      }
    }
  }
  assert.equal(installs, 5);
});

// Keep the standalone audit executable in its owning job, before real runtime tests.
const cdnAuditCommand = 'npm audit --prefix infra/engine-cdn --workspaces=false --include=dev --audit-level=moderate';
const cdnWorkflowPath = '.github/workflows/engine-cdn-test.yml';
const cdnWorkflowText = readFileSync(fileURLToPath(new URL('../../' + cdnWorkflowPath, import.meta.url)), 'utf8');
function assertStandaloneAudit(text) {
  const workflow = YAML.parse(text, { uniqueKeys: true });
  assert.deepEqual(workflow.on.pull_request, { paths: ['infra/engine-cdn/**', cdnWorkflowPath, '.node-version'] });
  const job = workflow.jobs.test;
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  const audits = job.steps.filter(step => step.name === 'Audit all standalone Workers dependencies');
  assert.equal(audits.length, 1);
  const audit = audits[0];
  assert.equal(audit.run, cdnAuditCommand);
  assert.equal(audit.uses, undefined);
  assert.equal(audit.if, undefined);
  assert.equal(audit['continue-on-error'], undefined);
  assert.equal(audit['working-directory'], undefined);
  const install = job.steps.findIndex(step => step.run === 'npm ci --prefix infra/engine-cdn --workspaces=false --ignore-scripts');
  const runtime = job.steps.findIndex(step => step.run === 'npm test' && step['working-directory'] === 'infra/engine-cdn');
  assert.ok(install >= 0 && install < job.steps.indexOf(audit));
  assert.ok(runtime > job.steps.indexOf(audit));
}
test('standalone CDN audit includes dev dependencies and executes before runtime tests', () => {
  assertStandaloneAudit(cdnWorkflowText);
  const ci = read('.github/workflows/ci.yml');
  assert.ok(ci.jobs['ci-success'].needs.includes('docs-e2e'));
  assert.match(ci.jobs['docs-e2e'].if, /needs-ci == 'true'/);
  const steps = ci.jobs['docs-e2e'].steps;
  const suite = steps.filter(step => step.run === 'node --test scripts/__tests__/production-ci-contract.test.mjs');
  assert.equal(suite.length, 1);
  assert.equal(suite[0].if, undefined);
  assert.equal(suite[0]['continue-on-error'], undefined);
  assert.ok(steps.findIndex(step => step.run === 'npm ci') < steps.indexOf(suite[0]));
});
const auditBlock = '      - name: Audit all standalone Workers dependencies\n        run: ' + cdnAuditCommand + '\n';
const auditMutations = {
  removed: text => text.replace(auditBlock, ''),
  commented: text => text.replace(auditBlock, auditBlock.split('\n').filter(Boolean).map(line => '#' + line).join('\n') + '\n'),
  disabledStep: text => text.replace(auditBlock, auditBlock.replace('        run:', '        if: false\n        run:')),
  disabledJob: text => text.replace('  test:\n', '  test:\n    if: false\n'),
  ignoredError: text => text.replace(auditBlock, auditBlock.replace('        run:', '        continue-on-error: true\n        run:')),
  omitDev: text => text.replace('--include=dev', '--omit=dev'),
  highOnly: text => text.replace('--audit-level=moderate', '--audit-level=high'),
  duplicateStep: text => text.replace(auditBlock, auditBlock + auditBlock),
  duplicateRun: text => text.replace(auditBlock, auditBlock + '        run: echo skipped\n'),
  movedAfterRuntime: text => text.replace(auditBlock, '').replace('        run: npm test\n', '        run: npm test\n\n' + auditBlock),
};
for (const [name, mutate] of Object.entries(auditMutations)) {
  test('standalone audit contract rejects ' + name, () => {
    const mutated = mutate(cdnWorkflowText);
    assert.notEqual(mutated, cdnWorkflowText, 'negative control must actually mutate the workflow');
    assert.throws(() => assertStandaloneAudit(mutated));
  });
}
