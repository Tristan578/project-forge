/**
 * Unit tests for the per-attempt journey evidence record (#10157).
 *
 * `JourneyRecorder` is the pure core of `e2e/fixtures/journey.fixture.ts`: the
 * fixture feeds it the steps a journey declares and, at teardown, the attempt's
 * `testInfo` facts, then attaches the record it returns. Driving it directly
 * pins the four outcomes the issue names without a browser:
 *
 *   - pass      every declared step matched, first attempt;
 *   - fail      a step's observed value differs from its expected value — the
 *               record names that step and is NEVER `pass`;
 *   - flaky     passed only on a retry (`testInfo.retry = 1` after a failure),
 *               with both attempts listed and not counted as proven;
 *   - not-run   the journey could not run (a required secret is absent), with
 *               the reason, excluded from any count of proven journeys.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Tier } from '../../../src/lib/db/schema';
import {
  JOURNEY_ANNOTATION_TYPE,
  JOURNEY_TAG,
  JourneyRecorder,
  JourneyStepMismatchError,
  SUBSTITUTION_ANNOTATION_TYPE,
  countJourneyOutcomes,
  isProvenJourney,
  normalizeSha,
  readJourneyId,
  readSubstitutions,
  zJourneyAttemptRecord,
  type JourneyFinishContext,
  type JourneyTier,
} from '../journeyEvidence';

const GITHUB_SHA = 'a'.repeat(40);
const PR_HEAD_SHA = 'b'.repeat(40);

function recorder(overrides: Partial<ConstructorParameters<typeof JourneyRecorder>[0]> = {}) {
  return new JourneyRecorder({
    journeyId: 'jrn:dev-canary@1',
    tier: 'none',
    test: {
      id: 'test-0001',
      title: 'Journey canary › opens the editor',
      titlePath: ['tests/journey-evidence-canary.spec.ts', 'Journey canary', 'opens the editor'],
      file: 'e2e/tests/journey-evidence-canary.spec.ts',
      project: 'chromium',
    },
    ...overrides,
  });
}

function finishContext(overrides: Partial<JourneyFinishContext> = {}): JourneyFinishContext {
  return {
    status: 'passed',
    retry: 0,
    error: null,
    annotations: [{ type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:dev-canary@1' }],
    browser: { name: 'chromium', version: '140.0.7339.16' },
    sha: {
      github: GITHUB_SHA,
      prHead: PR_HEAD_SHA,
      health: GITHUB_SHA.slice(0, 8),
      healthError: null,
    },
    recordedAt: new Date('2026-09-22T12:00:00.000Z'),
    ...overrides,
  };
}

describe('JourneyRecorder — pass', () => {
  it('records every step with its expected and observed value and the pass outcome', async () => {
    const r = recorder();
    await r.step('editor-renders', true, () => true);
    await r.step('entity-count', 1, async () => 1);

    const record = r.finish(finishContext());

    expect(record.outcome).toBe('pass');
    expect(record.failedStep).toBeNull();
    expect(record.steps).toEqual([
      { name: 'editor-renders', expected: true, observed: true, status: 'pass', error: null },
      { name: 'entity-count', expected: 1, observed: 1, status: 'pass', error: null },
    ]);
    expect(record.attempt).toBe(0);
    expect(record.attempts).toEqual([{ attempt: 0, result: 'passed', source: 'this-attempt' }]);
    expect(isProvenJourney(record)).toBe(true);
  });

  it('carries the identity, SHAs, browser, tier, balance, cost and substitutions fields', async () => {
    const r = recorder();
    await r.step('editor-renders', true, () => true);
    r.recordTokenBalance('before', { status: 'measured', value: 500, unit: 'tokens', source: 'GET /api/tokens/balance' });
    r.recordTokenBalance('after', { status: 'measured', value: 480, unit: 'tokens', source: 'GET /api/tokens/balance' });
    r.recordCost({ status: 'unknown', reason: 'no provider was called' });

    const record = r.finish(
      finishContext({
        annotations: [
          { type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:dev-canary@1' },
          { type: SUBSTITUTION_ANNOTATION_TYPE, description: 'engine' },
        ],
      }),
    );

    expect(record.journeyId).toBe('jrn:dev-canary@1');
    expect(record.test.project).toBe('chromium');
    expect(record.sha).toEqual({
      github: GITHUB_SHA,
      prHead: PR_HEAD_SHA,
      health: GITHUB_SHA.slice(0, 8),
      healthError: null,
    });
    expect(record.browser).toEqual({ name: 'chromium', version: '140.0.7339.16' });
    expect(record.tier).toBe('none');
    expect(record.tokens.before).toEqual({ status: 'measured', value: 500, unit: 'tokens', source: 'GET /api/tokens/balance' });
    expect(record.tokens.after).toEqual({ status: 'measured', value: 480, unit: 'tokens', source: 'GET /api/tokens/balance' });
    expect(record.cost).toEqual({ status: 'unknown', reason: 'no provider was called' });
    expect(record.substitutions).toEqual(['engine']);
    expect(record.recordedAt).toBe('2026-09-22T12:00:00.000Z');
    // The record the fixture attaches is exactly what the schema accepts.
    expect(zJourneyAttemptRecord.parse(record)).toEqual(record);
  });

  it('defaults balance and cost to unknown WITH a reason rather than inventing a number', async () => {
    const r = recorder();
    await r.step('editor-renders', true, () => true);
    const record = r.finish(finishContext());
    for (const value of [record.tokens.before, record.tokens.after, record.cost]) {
      expect(value.status).toBe('unknown');
      expect(value.status === 'unknown' && value.reason.length).toBeGreaterThan(10);
    }
    expect(record.substitutions).toEqual([]);
  });

  it('compares structured values deeply, not by reference', async () => {
    const r = recorder();
    await expect(
      r.step('scene', { nodes: ['camera', 'cube'], mode: 'edit' }, () => ({ mode: 'edit', nodes: ['camera', 'cube'] })),
    ).resolves.toEqual({ mode: 'edit', nodes: ['camera', 'cube'] });
    expect(r.finish(finishContext()).outcome).toBe('pass');
  });
});

describe('JourneyRecorder — fail (forced mismatch)', () => {
  it('throws on the mismatching step, so the test fails, and names that step', async () => {
    const r = recorder();
    await r.step('editor-renders', true, () => true);
    const mismatch = r.step('entity-count', 2, () => 1);

    await expect(mismatch).rejects.toBeInstanceOf(JourneyStepMismatchError);
    await expect(mismatch).rejects.toThrow(/entity-count.*expected 2.*observed 1/);

    const record = r.finish(finishContext({ status: 'failed', error: 'journey step "entity-count" …' }));
    expect(record.outcome).toBe('fail');
    expect(record.failedStep).toBe('entity-count');
    expect(record.steps[1]).toEqual({
      name: 'entity-count',
      expected: 2,
      observed: 1,
      status: 'fail',
      error: null,
    });
    expect(isProvenJourney(record)).toBe(false);
  });

  it('is NEVER pass, even when the mismatch was swallowed and Playwright reports passed', async () => {
    const r = recorder();
    await r.step('entity-count', 2, () => 1).catch(() => undefined);
    const record = r.finish(finishContext({ status: 'passed' }));
    expect(record.outcome).toBe('fail');
    expect(record.failedStep).toBe('entity-count');
  });

  it('records an observation that throws as an errored step and names it', async () => {
    const r = recorder();
    await expect(
      r.step('engine-ready', true, () => {
        throw new Error('__FORGE_ENGINE_READY never flipped');
      }),
    ).rejects.toThrow('__FORGE_ENGINE_READY never flipped');
    const record = r.finish(finishContext({ status: 'failed' }));
    expect(record.outcome).toBe('fail');
    expect(record.failedStep).toBe('engine-ready');
    expect(record.steps[0]).toEqual({
      name: 'engine-ready',
      expected: true,
      observed: null,
      status: 'error',
      error: '__FORGE_ENGINE_READY never flipped',
    });
  });

  it('fails outside any step with the test error as the failure', async () => {
    const r = recorder();
    await r.step('editor-renders', true, () => true);
    const record = r.finish(finishContext({ status: 'timedOut', error: 'Test timeout of 90000ms exceeded.' }));
    expect(record.outcome).toBe('fail');
    expect(record.failedStep).toBeNull();
    expect(record.failure).toBe('Test timeout of 90000ms exceeded.');
  });

  it('fails a journey that passed without recording a single step', () => {
    const record = recorder().finish(finishContext({ status: 'passed' }));
    expect(record.outcome).toBe('fail');
    expect(record.failure).toMatch(/without recording any steps/i);
  });

  it('refuses a duplicate step name, which would make failedStep ambiguous', async () => {
    const r = recorder();
    await r.step('editor-renders', true, () => true);
    await expect(r.step('editor-renders', true, () => true)).rejects.toThrow(/duplicate step/i);
  });

  it('refuses an observation that is not JSON-serialisable', async () => {
    const r = recorder();
    await expect(r.step('fn', true, () => undefined as never)).rejects.toThrow(/JSON/);
    expect(r.finish(finishContext({ status: 'failed' })).failedStep).toBe('fn');
  });
});

describe('JourneyRecorder — flaky (retry after a failure)', () => {
  it('marks a pass on testInfo.retry = 1 as flaky, lists both attempts, and does not count it as proven', async () => {
    const r = recorder();
    await r.step('editor-renders', true, () => true);

    const record = r.finish(finishContext({ status: 'passed', retry: 1 }));

    expect(record.outcome).toBe('flaky');
    expect(record.attempt).toBe(1);
    expect(record.attempts).toEqual([
      { attempt: 0, result: 'failed', source: 'inferred-from-retry' },
      { attempt: 1, result: 'passed', source: 'this-attempt' },
    ]);
    expect(isProvenJourney(record)).toBe(false);
    expect(countJourneyOutcomes([record])).toEqual({ total: 1, proven: 0, pass: 0, flaky: 1, fail: 0, notRun: 0 });
  });

  it('keeps a failure on the retry as fail, not flaky', async () => {
    const r = recorder();
    await r.step('entity-count', 2, () => 1).catch(() => undefined);
    const record = r.finish(finishContext({ status: 'failed', retry: 1 }));
    expect(record.outcome).toBe('fail');
    expect(record.attempts.map((a) => a.result)).toEqual(['failed', 'failed']);
  });
});

describe('JourneyRecorder — not-run', () => {
  it('records the reason when a required secret is absent, and is excluded from proven', () => {
    const r = recorder();
    r.notRun('required secret E2E_AI_PROVIDER_KEY is not set');

    const record = r.finish(finishContext({ status: 'skipped' }));

    expect(record.outcome).toBe('not-run');
    expect(record.notRunReason).toBe('required secret E2E_AI_PROVIDER_KEY is not set');
    expect(record.attempts).toEqual([{ attempt: 0, result: 'skipped', source: 'this-attempt' }]);
    expect(isProvenJourney(record)).toBe(false);
    expect(countJourneyOutcomes([record])).toEqual({ total: 1, proven: 0, pass: 0, flaky: 0, fail: 0, notRun: 1 });
  });

  it('takes the reason from a plain test.skip annotation when notRun was not used', () => {
    const record = recorder().finish(
      finishContext({
        status: 'skipped',
        annotations: [
          { type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:dev-canary@1' },
          { type: 'skip', description: 'no Clerk test instance' },
        ],
      }),
    );
    expect(record.outcome).toBe('not-run');
    expect(record.notRunReason).toBe('no Clerk test instance');
  });

  it('refuses an empty reason', () => {
    expect(() => recorder().notRun('   ')).toThrow(/reason/i);
  });
});

describe('proven counting', () => {
  it('counts only first-attempt passes as proven across a mixed set', async () => {
    const pass = recorder();
    await pass.step('a', 1, () => 1);
    const flaky = recorder();
    await flaky.step('a', 1, () => 1);
    const fail = recorder();
    await fail.step('a', 1, () => 2).catch(() => undefined);
    const notRun = recorder();
    notRun.notRun('secret absent');

    const records = [
      pass.finish(finishContext()),
      flaky.finish(finishContext({ retry: 1 })),
      fail.finish(finishContext({ status: 'failed' })),
      notRun.finish(finishContext({ status: 'skipped' })),
    ];
    expect(records.map((r) => r.outcome)).toEqual(['pass', 'flaky', 'fail', 'not-run']);
    expect(countJourneyOutcomes(records)).toEqual({ total: 4, proven: 1, pass: 1, flaky: 1, fail: 1, notRun: 1 });
  });
});

describe('record schema', () => {
  it('rejects a journey id that does not match JOURNEY_ID_RE', () => {
    expect(() => recorder({ journeyId: 'dev-canary' })).toThrow(/journey id/i);
    expect(() => recorder({ journeyId: 'jrn:dev-canary' })).toThrow(/journey id/i);
  });

  it('rejects a pass record that hides a failed step', async () => {
    const r = recorder();
    await r.step('a', 1, () => 1);
    const record = r.finish(finishContext());
    const tampered = {
      ...record,
      steps: [{ ...record.steps[0], observed: 2, status: 'fail' as const }],
    };
    expect(zJourneyAttemptRecord.safeParse(tampered).success).toBe(false);
  });

  it('rejects a fail record that names no step and gives no failure', async () => {
    const r = recorder();
    await r.step('a', 1, () => 2).catch(() => undefined);
    const record = r.finish(finishContext({ status: 'failed' }));
    expect(zJourneyAttemptRecord.safeParse({ ...record, failedStep: null, failure: null }).success).toBe(false);
  });

  it('rejects a flaky record on attempt 0 and a not-run record without a reason', async () => {
    const r = recorder();
    await r.step('a', 1, () => 1);
    const pass = r.finish(finishContext());
    expect(zJourneyAttemptRecord.safeParse({ ...pass, outcome: 'flaky' }).success).toBe(false);
    expect(
      zJourneyAttemptRecord.safeParse({ ...pass, outcome: 'not-run', notRunReason: null }).success,
    ).toBe(false);
  });

  it('keeps its non-none tiers in lockstep with the billing Tier type', () => {
    expectTypeOf<Exclude<JourneyTier, 'none'>>().toEqualTypeOf<Tier>();
  });
});

describe('annotation readers', () => {
  it('reads exactly one valid journey id', () => {
    expect(readJourneyId([{ type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:dev-canary@1' }])).toBe(
      'jrn:dev-canary@1',
    );
    expect(() => readJourneyId([])).toThrow(/no .*journey.* annotation/i);
    expect(() =>
      readJourneyId([
        { type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:a@1' },
        { type: JOURNEY_ANNOTATION_TYPE, description: 'jrn:b@1' },
      ]),
    ).toThrow(/2 journey annotations/);
    expect(() => readJourneyId([{ type: JOURNEY_ANNOTATION_TYPE, description: 'canary' }])).toThrow(/journey id/i);
  });

  it('reads substitutions in declaration order, empty when there are none', () => {
    expect(readSubstitutions([])).toEqual([]);
    expect(
      readSubstitutions([
        { type: SUBSTITUTION_ANNOTATION_TYPE, description: 'engine' },
        { type: 'skip' },
        { type: SUBSTITUTION_ANNOTATION_TYPE, description: 'ai-provider' },
      ]),
    ).toEqual(['engine', 'ai-provider']);
  });

  it('uses the @release-journey tag, distinct from the store-injected @journey gate', () => {
    expect(JOURNEY_TAG).toBe('@release-journey');
  });
});

describe('normalizeSha', () => {
  it('accepts a full 40-hex SHA and treats empty or missing as null', () => {
    expect(normalizeSha(GITHUB_SHA)).toBe(GITHUB_SHA);
    expect(normalizeSha(GITHUB_SHA.toUpperCase())).toBe(GITHUB_SHA);
    expect(normalizeSha('')).toBeNull();
    expect(normalizeSha(undefined)).toBeNull();
  });

  it('refuses a value that is not a SHA rather than recording it as one', () => {
    expect(() => normalizeSha('main')).toThrow(/not a 40-character/);
  });
});
