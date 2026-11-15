/**
 * The CLI the test-e2e-engine-smoke job runs after Playwright (#10157). The
 * rules live in `e2e/lib/journeyEvidenceCheck.ts` and are tested there; this
 * suite pins the CLI contract CI depends on: argument parsing (including the
 * empty PR head of a push run), the exit codes, and the `::error::` lines.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JOURNEY_ANNOTATION_TYPE,
  JOURNEY_EVIDENCE_SCHEMA_VERSION,
  JOURNEY_TAG,
  JourneyRecorder,
  buildJourneyEvidence,
} from '../../e2e/lib/journeyEvidence';
import { parseCheckArgs, runCheckJourneyEvidence } from '../check-journey-evidence';

const SHA = '3'.repeat(40);
const HEAD = '4'.repeat(40);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-journey-evidence-cli-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A minimal valid evidence directory holding one passing journey. */
async function writeValidDir(prHead: string | null = HEAD): Promise<void> {
  const test = {
    id: 't-1',
    title: 'Journey canary › opens the editor',
    titlePath: ['tests/c.spec.ts', 'Journey canary', 'opens the editor'],
    file: 'e2e/tests/c.spec.ts',
    project: 'chromium',
  };
  const r = new JourneyRecorder({ journeyId: 'jrn:dev-canary@1', tier: 'none', test });
  await r.step('engine-ready', true, () => true);
  const record = r.finish({
    status: 'passed',
    retry: 0,
    error: null,
    annotations: [{ type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:dev-canary@1' }],
    browser: { name: 'chromium', version: '140.0.0.0' },
    sha: { github: SHA, prHead, health: SHA.slice(0, 8), healthError: null },
    recordedAt: new Date('2026-09-22T12:00:00.000Z'),
  });
  const built = buildJourneyEvidence(test, [
    { retry: 0, status: 'passed', recordTexts: [JSON.stringify(record)], trace: 'j/attempt-0/trace.zip', video: ['j/attempt-0/video.webm'] },
  ]);
  if (!built.ok) throw new Error(built.problem);
  fs.mkdirSync(path.join(dir, 'j/attempt-0'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'j/attempt-0/trace.zip'), 'zip');
  fs.writeFileSync(path.join(dir, 'j/attempt-0/video.webm'), 'webm');
  fs.writeFileSync(path.join(dir, 'j/evidence.json'), JSON.stringify(built.evidence));
  fs.writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify({
      schemaVersion: JOURNEY_EVIDENCE_SCHEMA_VERSION,
      kind: 'journey-evidence-index',
      tag: JOURNEY_TAG,
      generatedAt: '2026-09-22T12:00:00.000Z',
      problems: [],
      tests: [{ test, evidence: 'j/evidence.json', problem: null }],
    }),
  );
}

describe('parseCheckArgs', () => {
  it('reads the directory, the minimum and both SHAs', () => {
    expect(
      parseCheckArgs(['journey-evidence', '--min-journeys', '2', '--expect-github-sha', SHA, `--expect-pr-head-sha=${HEAD}`]),
    ).toEqual({ dir: 'journey-evidence', minJourneys: 2, expectGithubSha: SHA, expectPrHeadSha: HEAD });
  });

  it('treats an empty PR head (a push or dispatch run) as "expect none"', () => {
    expect(parseCheckArgs(['d', '--expect-pr-head-sha', ''])).toEqual({ dir: 'd', expectPrHeadSha: null });
  });

  it('leaves the PR head unchecked when the flag is absent', () => {
    expect(parseCheckArgs(['d'])).toEqual({ dir: 'd' });
  });

  it('refuses an empty or malformed GITHUB_SHA, a bad minimum, an unknown flag, and a missing directory', () => {
    expect(() => parseCheckArgs(['d', '--expect-github-sha', ''])).toThrow(/needs a SHA/);
    expect(() => parseCheckArgs(['d', '--expect-github-sha', 'main'])).toThrow(/40-character/);
    expect(() => parseCheckArgs(['d', '--min-journeys', '0'])).toThrow(/positive integer/);
    expect(() => parseCheckArgs(['d', '--min-journeys'])).toThrow(/needs a value/);
    expect(() => parseCheckArgs(['d', '--frobnicate'])).toThrow(/unknown option/);
    expect(() => parseCheckArgs([])).toThrow(/usage/i);
  });
});

describe('runCheckJourneyEvidence', () => {
  it('exits 0 and prints the journeys and proven count on valid evidence', async () => {
    await writeValidDir();
    const out = runCheckJourneyEvidence([dir, '--expect-github-sha', SHA, '--expect-pr-head-sha', HEAD], {});
    expect(out.exitCode).toBe(0);
    expect(out.lines).toContain(`journey-evidence: 1 journey-tagged test(s) in ${dir}, 1 with a record`);
    expect(out.lines).toContainEqual(expect.stringMatching(/^ {2}pass +jrn:dev-canary@1 +Journey canary › opens the editor/));
    expect(out.lines).toContain('proven 1 | pass 1 | flaky 0 | fail 0 | not-run 0');
    expect(out.lines.at(-1)).toBe('journey-evidence check passed');
  });

  it('exits 1 with a GitHub ::error:: line per problem in Actions', () => {
    const out = runCheckJourneyEvidence([dir], { GITHUB_ACTIONS: 'true' });
    expect(out.exitCode).toBe(1);
    expect(out.lines).toContainEqual(expect.stringMatching(/^::error title=journey evidence::no index\.json/));
    expect(out.lines.at(-1)).toBe('journey-evidence check FAILED: 1 problem(s)');
  });

  it('exits 1 on a SHA the run did not produce', async () => {
    await writeValidDir();
    const out = runCheckJourneyEvidence([dir, '--expect-github-sha', '5'.repeat(40)], {});
    expect(out.exitCode).toBe(1);
    expect(out.lines).toContainEqual(expect.stringMatching(/^ERROR: .*GITHUB_SHA 3{40}, expected 5{40}/));
  });

  it('exits 1 when a push run (no PR head) finds a record that carries one', async () => {
    await writeValidDir(HEAD);
    expect(runCheckJourneyEvidence([dir, '--expect-pr-head-sha', ''], {}).exitCode).toBe(1);
  });

  it('exits 2 on a usage error', () => {
    const out = runCheckJourneyEvidence(['--nope'], {});
    expect(out.exitCode).toBe(2);
    expect(out.lines[0]).toMatch(/unknown option --nope/);
  });
});
