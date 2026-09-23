/**
 * Journey evidence records (#10157, parent #9723).
 *
 * WHY THIS EXISTS
 * ---------------
 * The release journeys (#9723) are only worth anything if a claim like
 * "journey 3 passed" can be checked against a commit, a browser, an account
 * tier, an attempt number and a cost instead of being taken on trust. Before
 * this module, nothing produced that: the engine config kept a trace only on
 * the first retry and a video only on failure, a journey that failed once and
 * passed on its retry read as green with no trace of the flake, and the server
 * under test answered `/api/health` with `commit: 'local'` because CI never
 * told it which commit it was.
 *
 * THE PIECES
 * ----------
 *   - `JourneyRecorder` (here) is the pure core of the Playwright fixture in
 *     `e2e/fixtures/journey.fixture.ts`. A journey declares each step's
 *     expected value; the recorder observes, compares, and at teardown turns
 *     the attempt's `testInfo` facts into ONE per-attempt record, which the
 *     fixture attaches under {@link JOURNEY_EVIDENCE_ATTACHMENT}. That
 *     attachment is the record's only sink: remove it and there is no record.
 *   - `buildJourneyEvidence` (here) folds every attempt of one test into the
 *     single evidence file the `journey-evidence` artifact carries, using
 *     Playwright's own per-attempt statuses as ground truth.
 *   - `journeyEvidenceReporter.ts` runs that fold for every journey-tagged test
 *     and copies each attempt's trace and video next to the record.
 *   - `journeyEvidenceCheck.ts` is the post-run check: exactly one valid record
 *     per journey-tagged test, never zero tests, SHAs matching the run.
 *
 * OUTCOMES
 * --------
 *   pass     every declared step matched, on the first attempt;
 *   fail     a step mismatched or errored (the record names it), or the test
 *            failed outside a step — a record with a failed step is NEVER pass;
 *   flaky    passed only on a retry. Playwright retries only after a failure,
 *            so `testInfo.retry > 0` on a pass means an earlier attempt failed;
 *   not-run  the journey could not run (for example a required secret is
 *            absent), with the reason.
 * Only `pass` counts as proven ({@link isProvenJourney}).
 *
 * Kept free of any `@playwright/test` runtime import so vitest can drive it
 * (`e2e/lib/__tests__/journeyEvidence.test.ts`).
 */
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { zJourneyId } from '../../src/lib/observatory/schema';

/** Tag that marks a test as a release journey. Distinct from `@journey`,
 *  which selects the store-injected strict gate (`playwright.journey.config.ts`). */
export const JOURNEY_TAG = '@release-journey';

/** Annotation type whose description carries the test's `jrn:<slug>@<version>` id. */
export const JOURNEY_ANNOTATION_TYPE = 'journey';

/** Annotation type #10158 uses to declare a substituted component. */
export const SUBSTITUTION_ANNOTATION_TYPE = 'substitution';

/** Attachment name of the per-attempt record the fixture writes. */
export const JOURNEY_EVIDENCE_ATTACHMENT = 'journey-evidence';

/** Wire-shape version of the attempt record, the evidence file and the index. */
export const JOURNEY_EVIDENCE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Account tiers. `none` is the unauthenticated `/dev` route. The non-`none`
 *  members are pinned to the billing `Tier` type by the unit suite. */
export const zJourneyTier = z.enum(['none', 'starter', 'hobbyist', 'creator', 'pro']);
export type JourneyTier = z.infer<typeof zJourneyTier>;

export const zJourneyOutcome = z.enum(['pass', 'fail', 'flaky', 'not-run']);
export type JourneyOutcome = z.infer<typeof zJourneyOutcome>;

/** Playwright's `TestStatus`. */
export const zPlaywrightStatus = z.enum(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
export type PlaywrightStatus = z.infer<typeof zPlaywrightStatus>;

const zSha = z.string().regex(/^[0-9a-f]{40}$/, 'expected a 40-character lowercase hex SHA');
const zNonEmpty = z.string().trim().min(1);

/** A quantity the journey either measured, or could not, with the reason. */
function zMeasurement<U extends 'tokens' | 'usd'>(unit: U) {
  return z.discriminatedUnion('status', [
    z.object({
      status: z.literal('measured'),
      value: z.number().finite(),
      unit: z.literal(unit),
      source: zNonEmpty,
    }),
    z.object({ status: z.literal('unknown'), reason: zNonEmpty }),
  ]);
}
export const zTokenBalance = zMeasurement('tokens');
export const zProviderCost = zMeasurement('usd');
export type TokenBalance = z.infer<typeof zTokenBalance>;
export type ProviderCost = z.infer<typeof zProviderCost>;

export const zJourneyStep = z.object({
  name: zNonEmpty,
  expected: z.json(),
  /** `null` when the observation itself threw (`status: 'error'`). */
  observed: z.json(),
  status: z.enum(['pass', 'fail', 'error']),
  error: z.string().nullable(),
});
export type JourneyStep = z.infer<typeof zJourneyStep>;

export const zJourneyTestIdentity = z.object({
  /** `testInfo.testId` / `TestCase.id` — the join key between attempt and test. */
  id: zNonEmpty,
  title: zNonEmpty,
  titlePath: z.array(z.string()),
  /** Spec path relative to the Playwright config directory, `/`-separated. */
  file: zNonEmpty,
  project: z.string(),
});
export type JourneyTestIdentity = z.infer<typeof zJourneyTestIdentity>;

const zAttemptSummary = z.object({
  attempt: z.number().int().min(0),
  result: z.enum(['passed', 'failed', 'skipped']),
  /** `inferred-from-retry`: Playwright only schedules retry N after attempt N-1
   *  failed, so the earlier attempt is known to have failed even though this
   *  attempt's worker never saw it. The artifact's evidence file replaces
   *  these entries with the attempts Playwright actually reported. */
  source: z.enum(['this-attempt', 'inferred-from-retry']),
});

export const zJourneyAttemptRecord = z
  .object({
    schemaVersion: z.literal(JOURNEY_EVIDENCE_SCHEMA_VERSION),
    kind: z.literal('journey-attempt'),
    journeyId: zJourneyId,
    test: zJourneyTestIdentity,
    /** `testInfo.retry`. */
    attempt: z.number().int().min(0),
    attempts: z.array(zAttemptSummary).min(1),
    outcome: zJourneyOutcome,
    failedStep: z.string().nullable(),
    failure: z.string().nullable(),
    notRunReason: z.string().nullable(),
    sha: z.object({
      /** `GITHUB_SHA`: on a pull_request event this is the merge ref's commit. */
      github: zSha.nullable(),
      /** The PR head commit (`github.event.pull_request.head.sha`); null off-PR. */
      prHead: zSha.nullable(),
      /** The `commit` field `/api/health` reported (it exposes 8 characters). */
      health: z.string().min(1).nullable(),
      healthError: z.string().nullable(),
    }),
    browser: z.object({ name: zNonEmpty, version: zNonEmpty }),
    tier: zJourneyTier,
    tokens: z.object({ before: zTokenBalance, after: zTokenBalance }),
    cost: zProviderCost,
    substitutions: z.array(zNonEmpty),
    steps: z.array(zJourneyStep),
    recordedAt: z.iso.datetime({ offset: false }),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string, path: (string | number)[] = ['outcome']) =>
      ctx.addIssue({ code: 'custom', message, path });

    if (r.attempts.length !== r.attempt + 1) {
      issue(`attempts lists ${r.attempts.length} entries for attempt ${r.attempt}`, ['attempts']);
    }
    r.attempts.forEach((a, i) => {
      if (a.attempt !== i) issue(`attempts[${i}] is attempt ${a.attempt}`, ['attempts', i]);
    });
    const names = r.steps.map((s) => s.name);
    if (new Set(names).size !== names.length) issue('duplicate step names', ['steps']);

    const bad = r.steps.filter((s) => s.status !== 'pass');
    if (r.outcome === 'pass' || r.outcome === 'flaky') {
      if (bad.length > 0) issue(`a ${r.outcome} record cannot carry a ${bad[0].status} step (${bad[0].name})`);
      if (r.steps.length === 0) issue(`a ${r.outcome} record must carry at least one step`);
    }
    if (r.outcome === 'pass' && r.attempt !== 0) issue('pass is first-attempt only; a later pass is flaky');
    if (r.outcome === 'flaky' && r.attempt === 0) issue('flaky needs a retry: attempt 0 cannot be flaky');
    if (r.outcome === 'fail') {
      if (r.failedStep === null && r.failure === null) issue('a fail record must name the failed step or the failure');
      if (r.failedStep !== null && !bad.some((s) => s.name === r.failedStep)) {
        issue(`failedStep "${r.failedStep}" is not a failed step in steps`, ['failedStep']);
      }
    } else if (bad.length > 0) {
      issue(`a record with a ${bad[0].status} step (${bad[0].name}) must be fail`);
    }
    if (r.outcome === 'not-run' && (r.notRunReason === null || r.notRunReason.trim() === '')) {
      issue('a not-run record must carry its reason', ['notRunReason']);
    }
  });
export type JourneyAttemptRecord = z.infer<typeof zJourneyAttemptRecord>;

// ---------------------------------------------------------------------------
// Annotation and environment readers
// ---------------------------------------------------------------------------

export interface AnnotationLike {
  readonly type: string;
  readonly description?: string;
}

/** The one `jrn:` id a journey test declares; throws on none, several or malformed. */
export function readJourneyId(annotations: readonly AnnotationLike[]): string {
  const found = annotations.filter((a) => a.type === JOURNEY_ANNOTATION_TYPE);
  if (found.length === 0) {
    throw new Error(
      `no "${JOURNEY_ANNOTATION_TYPE}" annotation: a journey test must declare its jrn:<slug>@<version> id ` +
        '(use describeJourney() from e2e/fixtures/journey.fixture.ts)',
    );
  }
  if (found.length > 1) {
    throw new Error(`${found.length} journey annotations on one test; declare exactly one jrn: id`);
  }
  const parsed = zJourneyId.safeParse(found[0].description ?? '');
  if (!parsed.success) {
    throw new Error(`invalid journey id "${found[0].description ?? ''}": expected jrn:<slug>@<version>`);
  }
  return parsed.data;
}

/** Components the test declares it substitutes (#10158), in declaration order. */
export function readSubstitutions(annotations: readonly AnnotationLike[]): string[] {
  return annotations
    .filter((a) => a.type === SUBSTITUTION_ANNOTATION_TYPE)
    .map((a) => (a.description ?? '').trim());
}

/** A full commit SHA from the environment, or null when unset/empty. A value
 *  that is present but is not a SHA is refused rather than recorded as one. */
export function normalizeSha(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  const sha = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`"${value}" is not a 40-character commit SHA`);
  }
  return sha;
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

export class JourneyStepMismatchError extends Error {
  constructor(
    readonly step: string,
    readonly expected: z.infer<ReturnType<typeof z.json>>,
    readonly observed: z.infer<ReturnType<typeof z.json>>,
  ) {
    super(
      `journey step "${step}" expected ${JSON.stringify(expected)} but observed ${JSON.stringify(observed)}`,
    );
    this.name = 'JourneyStepMismatchError';
  }
}

type JsonValue = z.infer<ReturnType<typeof z.json>>;

/** JSON round-trip, so the recorded value is exactly what the artifact holds. */
function toJson(value: unknown, what: string): JsonValue {
  const text = value === undefined ? undefined : JSON.stringify(value);
  if (text === undefined) throw new Error(`${what} is not JSON-serialisable`);
  return JSON.parse(text) as JsonValue;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface JourneyRecorderInit {
  journeyId: string;
  tier: JourneyTier;
  test: JourneyTestIdentity;
}

/** Everything the fixture reads from `testInfo` and the environment at teardown. */
export interface JourneyFinishContext {
  status: PlaywrightStatus;
  retry: number;
  /** `testInfo.error?.message`, or null. */
  error: string | null;
  annotations: readonly AnnotationLike[];
  browser: { name: string; version: string };
  sha: { github: string | null; prHead: string | null; health: string | null; healthError: string | null };
  recordedAt: Date;
}

const UNRECORDED_BALANCE_REASON = 'the journey did not record a token balance';
const UNRECORDED_COST_REASON = 'the journey did not record a provider cost';

export class JourneyRecorder {
  private readonly steps: JourneyStep[] = [];
  private notRunReason: string | null = null;
  private tier: JourneyTier;
  private tokens: { before: TokenBalance; after: TokenBalance } = {
    before: { status: 'unknown', reason: UNRECORDED_BALANCE_REASON },
    after: { status: 'unknown', reason: UNRECORDED_BALANCE_REASON },
  };
  private cost: ProviderCost = { status: 'unknown', reason: UNRECORDED_COST_REASON };

  constructor(private readonly init: JourneyRecorderInit) {
    if (!zJourneyId.safeParse(init.journeyId).success) {
      throw new Error(`invalid journey id "${init.journeyId}": expected jrn:<slug>@<version>`);
    }
    this.tier = zJourneyTier.parse(init.tier);
  }

  /**
   * Observe one step. Records expected and observed; on a mismatch throws
   * {@link JourneyStepMismatchError} so the test fails at the step that broke.
   * An observation that throws is recorded as an errored step and rethrown.
   */
  async step(name: string, expected: unknown, observe: () => unknown): Promise<JsonValue> {
    if (name.trim() === '') throw new Error('a journey step needs a name');
    if (this.steps.some((s) => s.name === name)) {
      throw new Error(`duplicate step name "${name}": failedStep would be ambiguous`);
    }
    const expectedJson = toJson(expected, `expected value of step "${name}"`);
    let observed: JsonValue;
    try {
      observed = toJson(await observe(), `observed value of step "${name}"`);
    } catch (error) {
      this.steps.push({ name, expected: expectedJson, observed: null, status: 'error', error: errorMessage(error) });
      throw error;
    }
    const matched = isDeepStrictEqual(expectedJson, observed);
    this.steps.push({ name, expected: expectedJson, observed, status: matched ? 'pass' : 'fail', error: null });
    if (!matched) throw new JourneyStepMismatchError(name, expectedJson, observed);
    return observed;
  }

  /** Record that the journey cannot run. The fixture then skips the test. */
  notRun(reason: string): void {
    if (reason.trim() === '') throw new Error('a not-run journey must state its reason');
    this.notRunReason = reason.trim();
  }

  setTier(tier: JourneyTier): void {
    this.tier = zJourneyTier.parse(tier);
  }

  recordTokenBalance(when: 'before' | 'after', balance: TokenBalance): void {
    this.tokens = { ...this.tokens, [when]: zTokenBalance.parse(balance) };
  }

  recordCost(cost: ProviderCost): void {
    this.cost = zProviderCost.parse(cost);
  }

  /** Build this attempt's record. Validated against the schema before return. */
  finish(ctx: JourneyFinishContext): JourneyAttemptRecord {
    const failedStep = this.steps.find((s) => s.status !== 'pass')?.name ?? null;
    let outcome: JourneyOutcome;
    let failure: string | null = null;
    let notRunReason: string | null = null;

    if (failedStep !== null) {
      outcome = 'fail';
      failure = ctx.error;
    } else if (ctx.status === 'failed' || ctx.status === 'timedOut' || ctx.status === 'interrupted') {
      outcome = 'fail';
      failure = ctx.error ?? `test ended with status ${ctx.status}`;
    } else if (this.notRunReason !== null || ctx.status === 'skipped') {
      outcome = 'not-run';
      notRunReason =
        this.notRunReason ??
        ctx.annotations.find((a) => a.type === 'skip' && (a.description ?? '').trim() !== '')?.description ??
        'the test was skipped without a stated reason';
    } else if (this.steps.length === 0) {
      outcome = 'fail';
      failure = 'the journey passed without recording any steps; a journey that observes nothing proves nothing';
    } else {
      outcome = ctx.retry > 0 ? 'flaky' : 'pass';
    }

    const thisResult = ctx.status === 'passed' ? 'passed' : ctx.status === 'skipped' ? 'skipped' : 'failed';
    const attempts = Array.from({ length: ctx.retry + 1 }, (_, attempt) =>
      attempt === ctx.retry
        ? { attempt, result: thisResult, source: 'this-attempt' as const }
        : { attempt, result: 'failed' as const, source: 'inferred-from-retry' as const },
    );

    return zJourneyAttemptRecord.parse({
      schemaVersion: JOURNEY_EVIDENCE_SCHEMA_VERSION,
      kind: 'journey-attempt',
      journeyId: this.init.journeyId,
      test: this.init.test,
      attempt: ctx.retry,
      attempts,
      outcome,
      failedStep,
      failure,
      notRunReason,
      sha: ctx.sha,
      browser: ctx.browser,
      tier: this.tier,
      tokens: this.tokens,
      cost: this.cost,
      substitutions: readSubstitutions(ctx.annotations),
      steps: this.steps,
      recordedAt: ctx.recordedAt.toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/** Only a first-attempt pass is proven; flaky and not-run never are. */
export function isProvenJourney(record: { outcome: JourneyOutcome }): boolean {
  return record.outcome === 'pass';
}

export function countJourneyOutcomes(records: readonly { outcome: JourneyOutcome }[]) {
  const count = (o: JourneyOutcome) => records.filter((r) => r.outcome === o).length;
  return {
    total: records.length,
    proven: records.filter(isProvenJourney).length,
    pass: count('pass'),
    flaky: count('flaky'),
    fail: count('fail'),
    notRun: count('not-run'),
  };
}
