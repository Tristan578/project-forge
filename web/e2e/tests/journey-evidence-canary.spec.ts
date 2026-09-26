import { describeJourney, test } from '../fixtures/journey.fixture';

/**
 * Journey evidence canary (#10157).
 *
 * The smallest real release journey: open /dev, boot the WASM engine, see the
 * canvas and the default scene. It exists to prove the evidence pipeline end to
 * end on every PR — the journey fixture attaches a record, the reporter writes
 * the `journey-evidence` artifact, and `scripts/check-journey-evidence.ts`
 * fails test-e2e-engine-smoke when a journey-tagged test has no record, or when
 * the server under test is not this run's commit.
 *
 * It is not one of the six #9723 journeys and proves no product capability on
 * its own. It carries `@engine-smoke` so the engine config's grep selects it;
 * `@release-journey` (added by describeJourney) is what makes the post-run
 * check count it.
 *
 * /dev is the auth-bypass route: there is no account, so the tier is `none`
 * and there is no token ledger or provider metering to read — balance and cost
 * are recorded as unknown, with that reason, rather than as a made-up zero.
 */
const NO_ACCOUNT =
  'unauthenticated /dev session: no account, so there is no token ledger or provider metering to read';

/**
 * The commit the server under test should report. CI starts it with
 * VERCEL_GIT_COMMIT_SHA = github.sha (= GITHUB_SHA); `/api/health` exposes the
 * first 8 characters. Locally neither is set and the server reports `local`.
 */
const EXPECTED_SERVER_COMMIT = (
  process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'
).slice(0, 8);

interface CanaryWindow {
  __FORGE_ENGINE_READY?: boolean;
  __EDITOR_STORE?: { getState(): { sceneGraph: { nodes: Record<string, unknown> } } };
}

describeJourney(
  { id: 'jrn:dev-canary@1', title: 'Journey evidence canary', tier: 'none', tag: ['@engine', '@engine-smoke'] },
  () => {
    test('opens /dev, boots the engine and shows the default scene', async ({ page, editor, journey }) => {
      journey.recordTokenBalance('before', { status: 'unknown', reason: NO_ACCOUNT });

      await journey.step('server-commit', EXPECTED_SERVER_COMMIT, () => journey.healthCommit);

      await journey.step('engine-ready', true, async () => {
        // load() seeds the WebGL2 backend and waits for __FORGE_ENGINE_READY.
        await editor.load();
        return page.evaluate(() => (window as unknown as CanaryWindow).__FORGE_ENGINE_READY === true);
      });

      await journey.step('game-canvas-count', 1, () => page.locator('#game-canvas').count());

      await journey.step('default-scene-has-entities', true, async () => {
        await editor.waitForEntityCount(1);
        return page.evaluate(() => {
          const store = (window as unknown as CanaryWindow).__EDITOR_STORE;
          return store !== undefined && Object.keys(store.getState().sceneGraph.nodes).length >= 1;
        });
      });

      journey.recordTokenBalance('after', { status: 'unknown', reason: NO_ACCOUNT });
      journey.recordCost({ status: 'unknown', reason: NO_ACCOUNT });
    });
  },
);
