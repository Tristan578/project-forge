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
