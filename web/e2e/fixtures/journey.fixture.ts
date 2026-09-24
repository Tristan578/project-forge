/**
 * Journey fixture: every release journey leaves a machine-readable evidence
 * record (#10157, parent #9723).
 *
 * Declare a journey with {@link describeJourney}, then drive it through the
 * `journey` fixture:
 *
 * ```ts
 * import { describeJourney, test } from '../fixtures/journey.fixture';
 *
 * describeJourney({ id: 'jrn:dev-canary@1', title: 'Journey canary', tier: 'none', tag: '@engine-smoke' }, () => {
 *   test('opens the editor', async ({ page, journey }) => {
 *     await journey.step('engine-ready', true, () => page.evaluate(() => window.__FORGE_ENGINE_READY === true));
 *   });
 * });
 * ```
 *
 * `journey.step(name, expected, observe)` records the declared expected value
 * and the observed one, and fails the test on the step that mismatched. At
 * teardown the fixture attaches ONE record for the attempt under the
 * `journey-evidence` attachment: the `jrn:` id, `GITHUB_SHA` (on a
 * pull_request event, the merge ref), the PR head SHA, the commit the server
 * under test reports on `/api/health`, `browser.version()` and the project, the
 * account tier, the token balance before/after and the provider cost (or
 * `unknown` with a reason), `testInfo.retry`, the declared substitutions
 * (#10158's `substitution` annotation), each step, and the outcome — pass,
 * fail, flaky or not-run. The rules live in `e2e/lib/journeyEvidence.ts`.
 *
 * That attachment is the record's ONLY sink. `e2e/lib/journeyEvidenceReporter.ts`
 * turns it into the `journey-evidence` artifact, and
 * `scripts/check-journey-evidence.ts` fails the job when any journey-tagged
 * test has no record — so removing the attach call turns CI red.
 *
 * TRACE AND VIDEO. `describeJourney` sets `trace: 'on'` and `video: 'on'` with
 * `test.use` for the spec file that declares the journey, so the @engine-ui
 * tests in other files keep the config's on-first-retry trace and
 * retain-on-failure video and do not inflate the artifact. It has to be file
 * level: both are worker-scoped options, and Playwright refuses them in a
 * describe-level `test.use` ("it forces a new worker"). And it has to happen
 * in describeJourney rather than at this module's top level, which a worker
 * evaluates once, attaching it to whichever spec file imported it first. Two
 * guards keep the scope exact: this fixture fails a journey whose trace or
 * video is not `on`, and the reporter fails a spec file that mixes journey and
 * non-journey tests.
 *
 * ENVIRONMENT. `GITHUB_SHA` is set by Actions; the engine-smoke step also sets
 * `JOURNEY_PR_HEAD_SHA` from `github.event.pull_request.head.sha` and starts the
 * server with `VERCEL_GIT_COMMIT_SHA` = `github.sha`, which is what
 * `/api/health` reports (its first 8 characters). Locally all three are unset:
 * the SHAs record as null and `/api/health` reports `local`.
 */
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import {
  JOURNEY_ANNOTATION_TYPE,
  JOURNEY_EVIDENCE_ATTACHMENT,
  JOURNEY_TAG,
  JourneyRecorder,
  journeyRecordingProblem,
  normalizeSha,
  readJourneyId,
  specPath,
  zJourneyTier,
  type ProviderCost,
  type TokenBalance,
  type JourneyTier,
} from '../lib/journeyEvidence';
import { zJourneyId } from '../../src/lib/observatory/schema';
import { test as editorTest, expect } from './editor.fixture';

/** Env var CI sets to the PR head commit (`github.event.pull_request.head.sha`). */
export const PR_HEAD_SHA_ENV = 'JOURNEY_PR_HEAD_SHA';

export interface Journey {
  /**
   * Observe one step. Records `expected` and what `observe` returned, and
   * throws on a mismatch so the test fails at this step and the record names
   * it. Wrapped in `test.step` so the trace and report show each step.
   */
  step(name: string, expected: unknown, observe: () => unknown): Promise<unknown>;
  /** Record why this journey cannot run (e.g. a required secret is absent) and skip it. */
  notRun(reason: string): never;
  /** Override the declared tier once the journey knows the account's real tier. */
  setTier(tier: JourneyTier): void;
  recordTokenBalance(when: 'before' | 'after', balance: TokenBalance): void;
  recordCost(cost: ProviderCost): void;
  /** The `commit` `/api/health` reported when the journey started, or null. */
  readonly healthCommit: string | null;
}

async function readHealthCommit(
  request: APIRequestContext,
): Promise<{ health: string | null; healthError: string | null }> {
  try {
    const response = await request.get('/api/health', { failOnStatusCode: false });
    const body: unknown = await response.json().catch(() => null);
    const commit =
      body !== null && typeof body === 'object' && 'commit' in body && typeof body.commit === 'string'
        ? body.commit
        : null;
    return commit
      ? { health: commit, healthError: null }
      : { health: null, healthError: `/api/health answered ${response.status()} without a commit field` };
  } catch (error) {
    return { health: null, healthError: `GET /api/health failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const test = editorTest.extend<{ journeyTier: JourneyTier; journey: Journey }>({
  journeyTier: ['none', { option: true }],

  // The fixture callback is named `provide`, not `use`: react-hooks lints any
  // call named `use` as a React hook (editor.fixture.ts disables the rule).
  journey: async ({ browser, request, journeyTier, trace, video }, provide, testInfo) => {
    const journeyId = readJourneyId(testInfo.annotations);
    if (!testInfo.tags.includes(JOURNEY_TAG)) {
      throw new Error(
        `journey ${journeyId} is not tagged ${JOURNEY_TAG}, so the post-run check cannot count it — ` +
          'declare it with describeJourney()',
      );
    }
    const recordingProblem = journeyRecordingProblem(trace, video);
    if (recordingProblem !== null) throw new Error(`journey ${journeyId}: ${recordingProblem}`);
    // Same base the reporter uses, so the record's `file` matches its index.
    const baseDir = testInfo.config.configFile ? path.dirname(testInfo.config.configFile) : testInfo.config.rootDir;
    const recorder = new JourneyRecorder({
      journeyId,
      tier: journeyTier,
      test: {
        id: testInfo.testId,
        title: testInfo.titlePath.slice(1).join(' › '),
        titlePath: [...testInfo.titlePath],
        file: specPath(baseDir, testInfo.file),
        project: testInfo.project.name,
      },
    });
    const sha = {
      github: normalizeSha(process.env.GITHUB_SHA),
      prHead: normalizeSha(process.env[PR_HEAD_SHA_ENV]),
      ...(await readHealthCommit(request)),
    };

    await provide({
      step: (name, expected, observe) =>
        test.step(`journey step: ${name}`, () => recorder.step(name, expected, observe), { box: true }),
      notRun: (reason) => {
        recorder.notRun(reason);
        test.skip(true, reason);
        // test.skip(true) throws; this line is unreachable at runtime.
        throw new Error(`journey not run: ${reason}`);
      },
      setTier: (tier) => recorder.setTier(tier),
      recordTokenBalance: (when, balance) => recorder.recordTokenBalance(when, balance),
      recordCost: (cost) => recorder.recordCost(cost),
      healthCommit: sha.health,
    });

    const status = testInfo.status ?? 'failed';
    const record = recorder.finish({
      status,
      retry: testInfo.retry,
      error: testInfo.error?.message ?? null,
      annotations: testInfo.annotations,
      browser: { name: browser.browserType().name(), version: browser.version() },
      sha,
      recordedAt: new Date(),
    });
    // AC5 MUTATION (throwaway, do not merge): attach removed.
    // await testInfo.attach(JOURNEY_EVIDENCE_ATTACHMENT, {
    //   body: JSON.stringify(record, null, 2),
    //   contentType: 'application/json',
    // });
    // A mismatch the test body swallowed (or a journey with no steps) must
    // still fail the test: the record says fail, so the run may not say pass.
    if (record.outcome === 'fail' && status === 'passed') {
      throw new Error(
        `journey ${journeyId} recorded fail although the test body passed: ` +
          (record.failedStep ? `step "${record.failedStep}" did not match` : (record.failure ?? 'unknown failure')),
      );
    }
  },
});

export { expect };

export interface JourneyDeclaration {
  /** `jrn:<slug>@<version>` — the version is part of the id. */
  id: string;
  title: string;
  /** Account tier the journey runs as; `none` on `/dev`. */
  tier: JourneyTier;
  /** Extra tags, e.g. `@engine-smoke` so a job's config grep selects the journey. */
  tag?: string | string[];
  /** Extra annotations, e.g. #10158's `{ type: 'substitution', description: '<component>' }`. */
  annotation?: { type: string; description?: string } | Array<{ type: string; description?: string }>;
}

/**
 * Declare a release journey: tags it {@link JOURNEY_TAG}, annotates its
 * `jrn:` id, and turns trace and video on.
 *
 * Call it at the TOP LEVEL of a spec file that holds only journeys. `trace`
 * and `video` are worker-scoped options, and Playwright refuses them in a
 * describe-level `test.use` ("it forces a new worker"), so this sets them for
 * the file. Two guards keep that scoped to journey tests: the journey fixture
 * fails a journey whose trace or video is not `on`, and the evidence reporter
 * fails a spec file that mixes journey and non-journey tests.
 */
export function describeJourney(declaration: JourneyDeclaration, body: () => void): void {
  if (!zJourneyId.safeParse(declaration.id).success) {
    throw new Error(`describeJourney: invalid journey id "${declaration.id}"; expected jrn:<slug>@<version>`);
  }
  const tier = zJourneyTier.parse(declaration.tier);
  const extraTags = declaration.tag === undefined ? [] : [declaration.tag].flat();
  const extraAnnotations = declaration.annotation === undefined ? [] : [declaration.annotation].flat();
  test.use({ trace: 'on', video: 'on' });
  test.describe(
    declaration.title,
    {
      tag: [JOURNEY_TAG, ...extraTags.filter((t) => t !== JOURNEY_TAG)],
      annotation: [{ type: JOURNEY_ANNOTATION_TYPE, description: declaration.id }, ...extraAnnotations],
    },
    () => {
      test.use({ journeyTier: tier });
      body();
    },
  );
}
