/**
 * `buildJourneyEvidence` folds every attempt Playwright reported for one
 * journey test into the single evidence file the `journey-evidence` artifact
 * carries (#10157). Playwright's per-attempt status is ground truth; each
 * attempt's own record supplies the journey facts.
 */
import { describe, expect, it } from 'vitest';
import {
  JOURNEY_ANNOTATION_TYPE,
  JourneyRecorder,
  buildJourneyEvidence,
  zJourneyEvidence,
  type JourneyFinishContext,
  type JourneyTestIdentity,
  type PlaywrightStatus,
  type ReportedAttempt,
} from '../journeyEvidence';

const SHA = 'c'.repeat(40);
const TEST: JourneyTestIdentity = {
  id: 'abc123-def456',
  title: 'Journey canary › opens the editor',
  titlePath: ['tests/journey-evidence-canary.spec.ts', 'Journey canary', 'opens the editor'],
  file: 'e2e/tests/journey-evidence-canary.spec.ts',
  project: 'chromium',
};

async function recordText(opts: {
  status: PlaywrightStatus;
  retry: number;
  observed?: number;
  notRun?: string;
  test?: JourneyTestIdentity;
}): Promise<string> {
  const r = new JourneyRecorder({ journeyId: 'jrn:dev-canary@1', tier: 'none', test: opts.test ?? TEST });
  if (opts.notRun) {
    r.notRun(opts.notRun);
  } else {
    await r.step('entity-count', 1, () => opts.observed ?? 1).catch(() => undefined);
  }
  const ctx: JourneyFinishContext = {
    status: opts.status,
    retry: opts.retry,
    error: opts.status === 'passed' || opts.status === 'skipped' ? null : 'boom',
    annotations: [{ type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:dev-canary@1' }],
    browser: { name: 'chromium', version: '140.0.0.0' },
    sha: { github: SHA, prHead: null, health: SHA.slice(0, 8), healthError: null },
    recordedAt: new Date('2026-09-22T12:00:00.000Z'),
  };
  return JSON.stringify(r.finish(ctx));
}

function attempt(retry: number, status: PlaywrightStatus, texts: string[]): ReportedAttempt {
  return {
    retry,
    status,
    recordTexts: texts,
    trace: `attempt-${retry}/trace.zip`,
    video: [`attempt-${retry}/video.webm`],
  };
}

describe('buildJourneyEvidence', () => {
  it('a first-attempt pass is pass and proven', async () => {
    const result = buildJourneyEvidence(TEST, [attempt(0, 'passed', [await recordText({ status: 'passed', retry: 0 })])]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.outcome).toBe('pass');
    expect(result.evidence.proven).toBe(true);
    expect(result.evidence.journeyId).toBe('jrn:dev-canary@1');
    expect(result.evidence.attempts).toEqual([
      {
        attempt: 0,
        status: 'passed',
        recordedOutcome: 'pass',
        failedStep: null,
        trace: 'attempt-0/trace.zip',
        video: ['attempt-0/video.webm'],
      },
    ]);
    expect(zJourneyEvidence.parse(result.evidence)).toEqual(result.evidence);
  });

  it('fail on attempt 0 then pass on the retry is flaky, lists BOTH real attempts, and is not proven', async () => {
    const result = buildJourneyEvidence(TEST, [
      attempt(0, 'failed', [await recordText({ status: 'failed', retry: 0, observed: 2 })]),
      attempt(1, 'passed', [await recordText({ status: 'passed', retry: 1 })]),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.outcome).toBe('flaky');
    expect(result.evidence.proven).toBe(false);
    expect(result.evidence.attempts.map((a) => [a.attempt, a.status, a.recordedOutcome, a.failedStep])).toEqual([
      [0, 'failed', 'fail', 'entity-count'],
      [1, 'passed', 'flaky', null],
    ]);
    expect(result.evidence.record.attempt).toBe(1);
  });

  it('a failed final attempt is fail and keeps the named step', async () => {
    const result = buildJourneyEvidence(TEST, [
      attempt(0, 'failed', [await recordText({ status: 'failed', retry: 0, observed: 2 })]),
      attempt(1, 'failed', [await recordText({ status: 'failed', retry: 1, observed: 3 })]),
    ]);
    expect(result.ok && result.evidence.outcome).toBe('fail');
    expect(result.ok && result.evidence.record.failedStep).toBe('entity-count');
  });

  it('a skipped journey is not-run with its reason and not proven', async () => {
    const result = buildJourneyEvidence(TEST, [
      attempt(0, 'skipped', [await recordText({ status: 'skipped', retry: 0, notRun: 'E2E_AI_PROVIDER_KEY absent' })]),
    ]);
    expect(result.ok && result.evidence.outcome).toBe('not-run');
    expect(result.ok && result.evidence.proven).toBe(false);
    expect(result.ok && result.evidence.record.notRunReason).toBe('E2E_AI_PROVIDER_KEY absent');
  });

  it('trusts Playwright over the record: a pass record on a failed attempt is fail, with a note', async () => {
    // e.g. a later fixture's teardown threw after the journey record was attached.
    const result = buildJourneyEvidence(TEST, [attempt(0, 'failed', [await recordText({ status: 'passed', retry: 0 })])]);
    expect(result.ok && result.evidence.outcome).toBe('fail');
    expect(result.ok && result.evidence.note).toMatch(/Playwright reported failed/);
  });

  it('has NO evidence when the final attempt attached no record — the attach-removed mutation', () => {
    const result = buildJourneyEvidence(TEST, [attempt(0, 'passed', [])]);
    expect(result).toEqual({
      ok: false,
      problem: expect.stringMatching(/no "journey-evidence" record attached on attempt 0/),
    });
  });

  it('refuses two records on one attempt', async () => {
    const text = await recordText({ status: 'passed', retry: 0 });
    const result = buildJourneyEvidence(TEST, [attempt(0, 'passed', [text, text])]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem).toMatch(/2 "journey-evidence" records on attempt 0/);
  });

  it('refuses a record that belongs to another test', async () => {
    const other = { ...TEST, id: 'someone-else' };
    const result = buildJourneyEvidence(TEST, [attempt(0, 'passed', [await recordText({ status: 'passed', retry: 0, test: other })])]);
    expect(!result.ok && result.problem).toMatch(/belongs to test someone-else/);
  });

  it('refuses an invalid record and says why', () => {
    const result = buildJourneyEvidence(TEST, [attempt(0, 'passed', ['{"kind":"journey-attempt"}'])]);
    expect(!result.ok && result.problem).toMatch(/invalid/);
    const garbled = buildJourneyEvidence(TEST, [attempt(0, 'passed', ['not json'])]);
    expect(!garbled.ok && garbled.problem).toMatch(/not JSON/);
  });

  it('refuses a test that ran no attempt at all', () => {
    const result = buildJourneyEvidence(TEST, []);
    expect(!result.ok && result.problem).toMatch(/no attempt/);
  });

  it('refuses a gap in the attempt numbers', async () => {
    const result = buildJourneyEvidence(TEST, [attempt(1, 'passed', [await recordText({ status: 'passed', retry: 1 })])]);
    expect(!result.ok && result.problem).toMatch(/attempts 1/);
  });
});
