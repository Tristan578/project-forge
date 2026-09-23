/**
 * The post-run check over the `journey-evidence` directory (#10157): exactly
 * one valid record per journey-tagged test, never zero tests, every attempt's
 * trace and video present, and — in CI — SHAs that match the run.
 *
 * Every case below is a way the check could otherwise pass while the evidence
 * is missing or wrong (lessons-learned #1, #9, #11).
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
  type JourneyEvidence,
  type JourneyEvidenceIndex,
  type JourneyTestIdentity,
  type PlaywrightStatus,
} from '../journeyEvidence';
import { checkJourneyEvidence } from '../journeyEvidenceCheck';

const SHA = 'd'.repeat(40);
const HEAD = 'e'.repeat(40);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-evidence-check-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function identity(n: number): JourneyTestIdentity {
  return {
    id: `test-${n}`,
    title: `Journey ${n} › runs`,
    titlePath: ['tests/j.spec.ts', `Journey ${n}`, 'runs'],
    file: 'e2e/tests/j.spec.ts',
    project: 'chromium',
  };
}

async function evidenceFor(
  test: JourneyTestIdentity,
  statuses: PlaywrightStatus[],
  opts: { github?: string | null; prHead?: string | null; health?: string | null } = {},
): Promise<JourneyEvidence> {
  const attempts = [];
  for (const [retry, status] of statuses.entries()) {
    const r = new JourneyRecorder({ journeyId: 'jrn:dev-canary@1', tier: 'none', test });
    if (status === 'skipped') r.notRun('secret absent');
    else await r.step('s', 1, () => (status === 'passed' ? 1 : 2)).catch(() => undefined);
    const github = opts.github === undefined ? SHA : opts.github;
    const record = r.finish({
      status,
      retry,
      error: null,
      annotations: [{ type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:dev-canary@1' }],
      browser: { name: 'chromium', version: '140.0.0.0' },
      sha: {
        github,
        prHead: opts.prHead === undefined ? HEAD : opts.prHead,
        health: opts.health === undefined ? (github ?? 'local').slice(0, 8) : opts.health,
        healthError: null,
      },
      recordedAt: new Date('2026-09-22T12:00:00.000Z'),
    });
    const slug = `jrn-dev-canary-1--${test.id}`;
    attempts.push({
      retry,
      status,
      recordTexts: [JSON.stringify(record)],
      trace: `${slug}/attempt-${retry}/trace.zip`,
      video: [`${slug}/attempt-${retry}/video.webm`],
    });
  }
  const result = buildJourneyEvidence(test, attempts);
  if (!result.ok) throw new Error(result.problem);
  return result.evidence;
}

/** Write evidence + artifacts + index the way the reporter lays them out. */
function writeDir(
  entries: Array<{ test: JourneyTestIdentity; evidence: JourneyEvidence | null; problem?: string }>,
  opts: { artifacts?: boolean; runProblems?: string[] } = {},
) {
  const index: JourneyEvidenceIndex = {
    schemaVersion: JOURNEY_EVIDENCE_SCHEMA_VERSION,
    kind: 'journey-evidence-index',
    tag: JOURNEY_TAG,
    generatedAt: '2026-09-22T12:00:00.000Z',
    problems: opts.runProblems ?? [],
    tests: [],
  };
  for (const { test, evidence, problem } of entries) {
    if (evidence === null) {
      index.tests.push({ test, evidence: null, problem: problem ?? 'no record' });
      continue;
    }
    const rel = `jrn-dev-canary-1--${test.id}/evidence.json`;
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(evidence));
    if (opts.artifacts !== false) {
      for (const a of evidence.attempts) {
        for (const file of [a.trace, ...a.video]) {
          if (file === null) continue;
          fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
          fs.writeFileSync(path.join(dir, file), 'bytes');
        }
      }
    }
    index.tests.push({ test, evidence: rel, problem: null });
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
}

describe('checkJourneyEvidence — accepts', () => {
  it('one valid record per journey test with its trace and video', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['passed']) }]);
    const result = checkJourneyEvidence({ dir, expectGithubSha: SHA, expectPrHeadSha: HEAD });
    expect(result.problems).toEqual([]);
    expect(result.counts).toEqual({ total: 1, proven: 1, pass: 1, flaky: 0, fail: 0, notRun: 0 });
    expect(result.journeys).toEqual([
      { title: 'Journey 1 › runs', journeyId: 'jrn:dev-canary@1', outcome: 'pass', evidence: 'jrn-dev-canary-1--test-1/evidence.json' },
    ]);
  });

  it('records a flaky journey without failing the check, and does not count it as proven', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['failed', 'passed']) }]);
    const result = checkJourneyEvidence({ dir });
    expect(result.problems).toEqual([]);
    expect(result.counts).toMatchObject({ proven: 0, flaky: 1 });
  });

  it('does not demand a trace or video from a not-run attempt', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['skipped']) }], { artifacts: false });
    const result = checkJourneyEvidence({ dir });
    expect(result.problems).toEqual([]);
    expect(result.counts).toMatchObject({ proven: 0, notRun: 1 });
  });
});

describe('checkJourneyEvidence — rejects', () => {
  it('a directory with no index: the reporter did not run', () => {
    const result = checkJourneyEvidence({ dir });
    expect(result.problems).toEqual([expect.stringMatching(/no index\.json.*reporter/)]);
  });

  it('zero journey-tagged tests, which would otherwise pass vacuously', () => {
    writeDir([]);
    expect(checkJourneyEvidence({ dir }).problems).toEqual([
      expect.stringMatching(/0 journey-tagged tests.*at least 1/),
    ]);
  });

  it('a journey test that has no record, naming the test and the reason', async () => {
    writeDir([
      { test: identity(1), evidence: await evidenceFor(identity(1), ['passed']) },
      { test: identity(2), evidence: null, problem: 'no "journey-evidence" record attached on attempt 0 (the final attempt)' },
    ]);
    const result = checkJourneyEvidence({ dir });
    expect(result.problems).toEqual([
      expect.stringMatching(/"Journey 2 › runs" \(e2e\/tests\/j\.spec\.ts\) has no record: no "journey-evidence" record attached/),
    ]);
    // The unrecorded test still counts as selected, so the summary cannot read "all recorded".
    expect(result.selected).toBe(2);
    expect(result.counts.total).toBe(1);
  });

  it('an evidence file the index names but the directory lacks', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['passed']) }]);
    fs.rmSync(path.join(dir, 'jrn-dev-canary-1--test-1/evidence.json'));
    expect(checkJourneyEvidence({ dir }).problems).toEqual([expect.stringMatching(/cannot read/)]);
  });

  it('a stray record that no journey test accounts for', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['passed']) }]);
    fs.mkdirSync(path.join(dir, 'leftover'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'leftover/evidence.json'), '{}');
    expect(checkJourneyEvidence({ dir }).problems).toEqual([
      expect.stringMatching(/leftover\/evidence\.json is not listed/),
    ]);
  });

  it('two index entries for the same test', async () => {
    const evidence = await evidenceFor(identity(1), ['passed']);
    writeDir([
      { test: identity(1), evidence },
      { test: identity(1), evidence },
    ]);
    expect(checkJourneyEvidence({ dir }).problems).toContainEqual(expect.stringMatching(/listed 2 times/));
  });

  it('a missing trace or video on an attempt that ran', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['passed']) }]);
    fs.rmSync(path.join(dir, 'jrn-dev-canary-1--test-1/attempt-0/trace.zip'));
    fs.writeFileSync(path.join(dir, 'jrn-dev-canary-1--test-1/attempt-0/video.webm'), '');
    const problems = checkJourneyEvidence({ dir }).problems;
    expect(problems).toContainEqual(expect.stringMatching(/attempt 0 trace .*missing or empty/));
    expect(problems).toContainEqual(expect.stringMatching(/attempt 0 video .*missing or empty/));
  });

  it('an attempt that ran with no trace or video recorded at all', async () => {
    const evidence = await evidenceFor(identity(1), ['passed']);
    evidence.attempts[0] = { ...evidence.attempts[0], trace: null, video: [] };
    writeDir([{ test: identity(1), evidence }]);
    const problems = checkJourneyEvidence({ dir }).problems;
    expect(problems).toContainEqual(expect.stringMatching(/attempt 0 has no trace/));
    expect(problems).toContainEqual(expect.stringMatching(/attempt 0 has no video/));
  });

  it('an artifact path that escapes the evidence directory', async () => {
    const evidence = await evidenceFor(identity(1), ['passed']);
    evidence.attempts[0] = { ...evidence.attempts[0], trace: '../outside.zip' };
    writeDir([{ test: identity(1), evidence }]);
    expect(checkJourneyEvidence({ dir }).problems).toContainEqual(expect.stringMatching(/escapes/));
  });

  it('an evidence file that fails the schema', async () => {
    const evidence = await evidenceFor(identity(1), ['failed', 'passed']);
    writeDir([{ test: identity(1), evidence: { ...evidence, proven: true } }]);
    expect(checkJourneyEvidence({ dir }).problems).toEqual([expect.stringMatching(/invalid evidence/)]);
  });

  it('a record whose GITHUB_SHA is not this run', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['passed'], { github: 'f'.repeat(40) }) }]);
    const problems = checkJourneyEvidence({ dir, expectGithubSha: SHA }).problems;
    expect(problems).toContainEqual(expect.stringMatching(/GITHUB_SHA f{40}, expected d{40}/));
  });

  it('a server under test that reports a different commit than GITHUB_SHA', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['passed'], { health: 'local' }) }]);
    expect(checkJourneyEvidence({ dir, expectGithubSha: SHA }).problems).toEqual([
      expect.stringMatching(/\/api\/health reported commit "local", expected "dddddddd"/),
    ]);
  });

  it('a PR head SHA that differs, or is present when the run has none', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['passed']) }]);
    expect(checkJourneyEvidence({ dir, expectPrHeadSha: 'a'.repeat(40) }).problems).toEqual([
      expect.stringMatching(/PR head e{40}, expected a{40}/),
    ]);
    expect(checkJourneyEvidence({ dir, expectPrHeadSha: null }).problems).toEqual([
      expect.stringMatching(/PR head e{40}, expected none/),
    ]);
  });

  it('a run-level problem the reporter recorded, such as a mixed spec file', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['passed']) }], {
      runProblems: ['e2e/tests/j.spec.ts mixes journeys with non-journey test "E › x"'],
    });
    expect(checkJourneyEvidence({ dir }).problems).toEqual([expect.stringMatching(/^e2e\/tests\/j\.spec\.ts mixes journeys/)]);
  });

  it('a raised minimum', async () => {
    writeDir([{ test: identity(1), evidence: await evidenceFor(identity(1), ['passed']) }]);
    expect(checkJourneyEvidence({ dir, minJourneys: 2 }).problems).toEqual([
      expect.stringMatching(/1 journey-tagged tests.*at least 2/),
    ]);
  });
});
