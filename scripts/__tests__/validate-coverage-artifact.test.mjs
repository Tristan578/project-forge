import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCoverageArtifact } from '../validate-coverage-artifact.mjs';
const sha = 'a'.repeat(40), runId = '1234';
const metadata = { sha, run_id: runId };
const summary = () => ({ total: Object.fromEntries(['statements', 'branches', 'functions', 'lines'].map(key => [key, { pct: 85, total: 100, covered: 85 }])) });
test('accepts the exact successful producer and actual measured counts', () => {
  assert.doesNotThrow(() => validateCoverageArtifact(metadata, summary(), sha, runId));
});
for (const [name, bad] of [['SHA', { ...metadata, sha: 'b'.repeat(40) }], ['run ID', { ...metadata, run_id: '1235' }]]) {
  test('rejects mismatched ' + name, () => assert.throws(() => validateCoverageArtifact(bad, summary(), sha, runId)));
}
for (const value of [NaN, Infinity, -1, 101, '90']) {
  test('rejects invalid percentage ' + value, () => {
    const data = summary(); data.total.lines.pct = value;
    assert.throws(() => validateCoverageArtifact(metadata, data, sha, runId));
  });
}
test('rejects percentages not supported by actual counts', () => {
  const data = summary(); data.total.lines.pct = 99;
  assert.throws(() => validateCoverageArtifact(metadata, data, sha, runId));
});
test('rejects missing metrics and impossible counts', () => {
  const missing = summary(); delete missing.total.branches;
  assert.throws(() => validateCoverageArtifact(metadata, missing, sha, runId));
  const impossible = summary(); impossible.total.lines.covered = 101;
  assert.throws(() => validateCoverageArtifact(metadata, impossible, sha, runId));
});
test('accepts empty metrics and truncated Istanbul percentages', () => {
  const data = summary(); data.total.lines = { pct: 100, total: 0, covered: 0 };
  data.total.branches = { pct: 66.66, total: 3, covered: 2 };
  assert.doesNotThrow(() => validateCoverageArtifact(metadata, data, sha, runId));
});
