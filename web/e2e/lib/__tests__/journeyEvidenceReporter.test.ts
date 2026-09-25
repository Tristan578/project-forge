/**
 * `JourneyEvidenceReporter` materialises the `journey-evidence` artifact
 * (#10157): one evidence file per journey-tagged test plus every attempt's
 * trace and video, and an index the post-run check reads.
 *
 * The reporter is driven with fake Playwright suites and results — no browser —
 * and every case then runs the REAL post-run check over what it wrote, so the
 * producer and the consumer are pinned in the same test (lessons-learned #15):
 * a format drift between them turns this suite red, not a CI run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FullConfig, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JOURNEY_ANNOTATION_TYPE,
  JOURNEY_EVIDENCE_ATTACHMENT,
  JOURNEY_TAG,
  JourneyRecorder,
  zJourneyEvidenceIndex,
  type PlaywrightStatus,
} from '../journeyEvidence';
import { checkJourneyEvidence } from '../journeyEvidenceCheck';
import JourneyEvidenceReporter from '../journeyEvidenceReporter';

const SHA = '1'.repeat(40);
const HEAD = '2'.repeat(40);

let root: string;
let config: FullConfig;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-evidence-reporter-'));
  config = {
    configFile: path.join(root, 'playwright.engine.config.ts'),
    rootDir: path.join(root, 'e2e'),
  } as FullConfig;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const evidenceDir = () => path.join(root, 'journey-evidence');

interface FakeTest {
  id: string;
  title: string;
  describe: string;
  tags: string[];
  journeyId?: string;
  /** Spec path relative to testDir; defaults to the canary's file. */
  file?: string;
}

function fakeTest(t: FakeTest): TestCase {
  const project = { name: 'chromium' };
  const rel = t.file ?? 'tests/journey-evidence-canary.spec.ts';
  const rootSuite = { type: 'root', title: '', project: () => undefined };
  const projectSuite = { type: 'project', title: 'chromium', parent: rootSuite, project: () => project };
  const fileSuite = { type: 'file', title: rel, parent: projectSuite, project: () => project };
  const describeSuite = { type: 'describe', title: t.describe, parent: fileSuite, project: () => project };
  return {
    type: 'test',
    id: t.id,
    title: t.title,
    tags: t.tags,
    annotations: t.journeyId ? [{ type: JOURNEY_ANNOTATION_TYPE, description: t.journeyId }] : [],
    location: { file: path.join(root, 'e2e', rel), line: 1, column: 1 },
    parent: describeSuite,
    titlePath: () => ['', 'chromium', rel, t.describe, t.title],
  } as unknown as TestCase;
}

function suiteOf(tests: TestCase[]): Suite {
  return { allTests: () => tests } as unknown as Suite;
}

/** The record the fixture would attach for this attempt. */
async function record(test: TestCase, retry: number, status: PlaywrightStatus): Promise<string> {
  const r = new JourneyRecorder({
    journeyId: 'jrn:dev-canary@1',
    tier: 'none',
    test: {
      id: test.id,
      title: `${test.parent.title} › ${test.title}`,
      titlePath: test.titlePath().slice(2),
      file: 'e2e/tests/journey-evidence-canary.spec.ts',
      project: 'chromium',
    },
  });
  await r.step('engine-ready', true, () => status === 'passed').catch(() => undefined);
  return JSON.stringify(
    r.finish({
      status,
      retry,
      error: status === 'passed' ? null : 'journey step "engine-ready" …',
      annotations: [{ type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:dev-canary@1' }],
      browser: { name: 'chromium', version: '140.0.0.0' },
      sha: { github: SHA, prHead: HEAD, health: SHA.slice(0, 8), healthError: null },
      recordedAt: new Date('2026-09-22T12:00:00.000Z'),
    }),
  );
}

/** A result with trace + video files written under a fake test-results dir. */
function result(
  test: TestCase,
  retry: number,
  status: PlaywrightStatus,
  recordText: string | null,
  opts: { recordAsPath?: boolean } = {},
): TestResult {
  const out = path.join(root, 'test-results', `${test.id}-retry${retry}`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'trace.zip'), `trace ${test.id} ${retry}`);
  fs.writeFileSync(path.join(out, 'video.webm'), `video ${test.id} ${retry}`);
  const attachments: TestResult['attachments'] = [
    { name: 'trace', contentType: 'application/zip', path: path.join(out, 'trace.zip') },
    { name: 'video', contentType: 'video/webm', path: path.join(out, 'video.webm') },
  ];
  if (recordText !== null) {
    if (opts.recordAsPath) {
      const p = path.join(out, 'attachments', 'journey-evidence.json');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, recordText);
      attachments.push({ name: JOURNEY_EVIDENCE_ATTACHMENT, contentType: 'application/json', path: p });
    } else {
      attachments.push({ name: JOURNEY_EVIDENCE_ATTACHMENT, contentType: 'application/json', body: Buffer.from(recordText) });
    }
  }
  return { retry, status, attachments } as unknown as TestResult;
}

const JOURNEY_A: FakeTest = { id: 'aaaa-1111', title: 'opens the editor', describe: 'Journey canary', tags: ['@engine-smoke', JOURNEY_TAG], journeyId: 'jrn:dev-canary@1' };
const JOURNEY_B: FakeTest = { id: 'bbbb-2222', title: 'survives a retry', describe: 'Journey canary', tags: [JOURNEY_TAG, '@engine-smoke'], journeyId: 'jrn:dev-canary@1' };
const NOT_A_JOURNEY: FakeTest = { id: 'cccc-3333', title: 'plain engine-ui test', describe: 'Editor', tags: ['@engine-ui'], file: 'tests/editor.spec.ts' };

async function runReporter(
  tests: TestCase[],
  results: Array<[TestCase, TestResult]>,
  reporter = new JourneyEvidenceReporter(),
) {
  reporter.onBegin(config, suiteOf(tests));
  for (const [test, res] of results) reporter.onTestEnd(test, res);
  await reporter.onEnd();
}

describe('JourneyEvidenceReporter', () => {
  it('writes one evidence file per journey test with every attempt\'s trace and video, and the check accepts it', async () => {
    const a = fakeTest(JOURNEY_A);
    const b = fakeTest(JOURNEY_B);
    const c = fakeTest(NOT_A_JOURNEY);
    await runReporter(
      [a, b, c],
      [
        [a, result(a, 0, 'passed', await record(a, 0, 'passed'))],
        [b, result(b, 0, 'failed', await record(b, 0, 'failed'))],
        [b, result(b, 1, 'passed', await record(b, 1, 'passed'), { recordAsPath: true })],
        [c, result(c, 0, 'passed', null)],
      ],
    );

    const index = zJourneyEvidenceIndex.parse(JSON.parse(fs.readFileSync(path.join(evidenceDir(), 'index.json'), 'utf8')));
    expect(index.tests.map((t) => [t.test.id, t.evidence, t.problem])).toEqual([
      ['aaaa-1111', 'jrn-dev-canary-1--aaaa-1111/evidence.json', null],
      ['bbbb-2222', 'jrn-dev-canary-1--bbbb-2222/evidence.json', null],
    ]);
    expect(index.tests[0].test).toEqual({
      id: 'aaaa-1111',
      title: 'Journey canary › opens the editor',
      titlePath: ['tests/journey-evidence-canary.spec.ts', 'Journey canary', 'opens the editor'],
      file: 'e2e/tests/journey-evidence-canary.spec.ts',
      project: 'chromium',
    });

    // Artifacts were COPIED next to the record, with their content intact.
    expect(
      fs.readFileSync(path.join(evidenceDir(), 'jrn-dev-canary-1--bbbb-2222/attempt-0/trace.zip'), 'utf8'),
    ).toBe('trace bbbb-2222 0');
    expect(
      fs.readFileSync(path.join(evidenceDir(), 'jrn-dev-canary-1--bbbb-2222/attempt-1/video.webm'), 'utf8'),
    ).toBe('video bbbb-2222 1');

    const check = checkJourneyEvidence({ dir: evidenceDir(), expectGithubSha: SHA, expectPrHeadSha: HEAD });
    expect(check.problems).toEqual([]);
    expect(check.journeys.map((j) => [j.title, j.outcome])).toEqual([
      ['Journey canary › opens the editor', 'pass'],
      ['Journey canary › survives a retry', 'flaky'],
    ]);
    expect(check.counts).toEqual({ total: 2, proven: 1, pass: 1, flaky: 1, fail: 0, notRun: 0 });
  });

  it('with the record attach removed, the check fails because a journey test has no record', async () => {
    const a = fakeTest(JOURNEY_A);
    await runReporter([a], [[a, result(a, 0, 'passed', null)]]);

    const check = checkJourneyEvidence({ dir: evidenceDir() });
    expect(check.problems).toEqual([
      expect.stringMatching(/"Journey canary › opens the editor" .* has no record: no "journey-evidence" record attached on attempt 0/),
    ]);
  });

  it('with no journey-tagged test in the run, the check fails instead of passing vacuously', async () => {
    const c = fakeTest(NOT_A_JOURNEY);
    await runReporter([c], [[c, result(c, 0, 'passed', null)]]);
    expect(checkJourneyEvidence({ dir: evidenceDir() }).problems).toEqual([
      expect.stringMatching(/0 journey-tagged tests/),
    ]);
  });

  it('records a journey test that never ran an attempt as a problem', async () => {
    const a = fakeTest(JOURNEY_A);
    await runReporter([a], []);
    expect(checkJourneyEvidence({ dir: evidenceDir() }).problems).toEqual([
      expect.stringMatching(/has no record: .*no attempt/),
    ]);
  });

  it('fails a spec file that mixes a journey with a non-journey test', async () => {
    const a = fakeTest(JOURNEY_A);
    const stowaway = fakeTest({ ...NOT_A_JOURNEY, file: 'tests/journey-evidence-canary.spec.ts' });
    await runReporter(
      [a, stowaway],
      [
        [a, result(a, 0, 'passed', await record(a, 0, 'passed'))],
        [stowaway, result(stowaway, 0, 'passed', null)],
      ],
    );
    expect(checkJourneyEvidence({ dir: evidenceDir() }).problems).toEqual([
      expect.stringMatching(/journey-evidence-canary\.spec\.ts mixes journeys with non-journey test "Editor › plain engine-ui test"/),
    ]);
  });

  it('clears evidence left by an earlier run before this run writes any', () => {
    fs.mkdirSync(path.join(evidenceDir(), 'stale'), { recursive: true });
    fs.writeFileSync(path.join(evidenceDir(), 'stale/evidence.json'), '{}');
    new JourneyEvidenceReporter().onBegin(config, suiteOf([]));
    expect(fs.existsSync(evidenceDir())).toBe(false);
  });

  it('refuses an output directory outside the config directory rather than deleting it', () => {
    const reporter = new JourneyEvidenceReporter({ outputDir: '..' });
    expect(() => reporter.onBegin(config, suiteOf([]))).toThrow(/must be inside/);
    expect(fs.existsSync(root)).toBe(true);
  });
});
