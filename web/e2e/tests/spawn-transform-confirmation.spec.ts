import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_PIPELINE_LIVE_MS,
} from '../constants';

/**
 * #9899 — confirm spawn/transform via a REAL engine query (op family
 * ai.FR-1.OP-01). Parent #9808; acceptance owner #9922.
 *
 * The slice's contract: an accepted dispatch is NOT an applied effect. The
 * confirmed result comes from querying the engine AFTER the deferred command
 * runs (`get_entity_details` -> `QUERY_ENTITY_DETAILS`, engine/src/bridge/
 * query.rs), never from dispatch acceptance plus two animation frames.
 *
 * WHAT THIS SPEC PROVES against real WASM (the deterministic, GPU-independent
 * half — tagged @engine so it runs only in the live-engine job):
 *
 *   Scenario "Manual and AI success" — the engine, queried after a spawn and an
 *   `update_transform`, reports crate-1 at (1,2,3). Run through BOTH creator
 *   surfaces: the manual dispatch path (`store.dispatchCommand`, the path the
 *   inspector and every manual control use) and the in-app AI path (the
 *   `forge-command` event `executeToolCall` fires). Both must observe the SAME
 *   confirmed position — the parity the issue requires — because both flow
 *   through one command contract.
 *
 * WHY THE OTHER TWO SCENARIOS ARE NOT DRIVEN HERE (and where they live):
 *
 *   "Negative case" (dropped deferred transform -> timed-out at 5 s, never
 *   completed) and "Boundary and recovery" (retry + cancel mid-observation ->
 *   no completion from the cancelled observation) are properties of the bounded
 *   observation adapter, not of the renderer. A real engine cannot be made to
 *   deterministically DROP a transform without instrumenting it, and a
 *   wall-clock 5-second timeout assertion under a software rasteriser would read
 *   as timing noise rather than a regression — the same reason
 *   `pipeline-live-engine.spec.ts` DEFERS its `game_win` assertion. They are
 *   covered deterministically, with an injected clock and cancellation token, in
 *   `src/lib/game-creation/executors/__tests__/engineDispatch.test.ts`
 *   (observeEngineEffect: applied / timed-out / cancelled / replayed-operation)
 *   and `entitySetupExecutor.test.ts` (dropped effect -> `EFFECT_TIMED_OUT`, no
 *   output; cancellation -> `ABORTED`; never `applied`).
 *
 * DOCUMENTED GAP: SwiftShader is software WebGL2 — this validates command
 * acceptance and the engine's post-apply query answer, not rendering.
 */

const CRATE_ID = 'crate-1';
const TARGET: [number, number, number] = [1, 2, 3];

type EditorStoreShape = {
  dispatchCommand: (command: string, payload: unknown) => unknown;
  setSelection: (ids: string[], primaryId: string | null, primaryName: string | null) => void;
  selectedIds: Set<string>;
  primaryTransform: { entityId?: string; position?: number[] } | null;
  sceneGraph: { nodes: Record<string, { name?: string }> };
};

type EditorHandle = { __EDITOR_STORE: { getState: () => EditorStoreShape } };

/** Count scene-graph nodes whose id OR name is crate-1 — the engine's own view. */
async function countCrates(page: Page): Promise<number> {
  return page.evaluate((id: string) => {
    const nodes = (window as unknown as EditorHandle).__EDITOR_STORE.getState().sceneGraph.nodes;
    return Object.entries(nodes).filter(
      ([nodeId, node]) => nodeId === id || node?.name === id,
    ).length;
  }, CRATE_ID);
}

/**
 * Select crate-1 and read the engine's CONFIRMED transform for it.
 *
 * `primaryTransform` is written only by the engine's own `TRANSFORM_CHANGED`
 * event for the selected entity (hooks/events/transformEvents.ts), so a value
 * here is the engine's real post-apply state — the same state the orchestrator's
 * `observeEntity` reads through `get_entity_details`, surfaced through a channel
 * a Playwright test can see without an app-only test hook.
 */
async function readConfirmedPosition(page: Page): Promise<number[] | null> {
  await page.evaluate((id: string) => {
    (window as unknown as EditorHandle).__EDITOR_STORE.getState().setSelection([id], id, id);
    // Fire the engine query too, so the confirmed-effect path is exercised end
    // to end even though its cache is asserted at the unit level.
    (window as unknown as EditorHandle).__EDITOR_STORE.getState().dispatchCommand('get_entity_details', { entityId: id });
  }, CRATE_ID);

  const handle = await page.waitForFunction(
    (target: number[]) => {
      const t = (window as unknown as EditorHandle).__EDITOR_STORE.getState().primaryTransform;
      if (!t || !Array.isArray(t.position)) return null;
      const ok =
        Math.abs(t.position[0] - target[0]) < 0.1 &&
        Math.abs(t.position[1] - target[1]) < 0.1 &&
        Math.abs(t.position[2] - target[2]) < 0.1;
      return ok ? t.position : null;
    },
    TARGET,
    { timeout: E2E_TIMEOUT_ELEMENT_MS },
  );
  return handle.jsonValue();
}

test.describe('Confirmed spawn/transform through the live engine @engine', () => {
  test.describe.configure({ timeout: E2E_TIMEOUT_PIPELINE_LIVE_MS });

  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('manual dispatch: engine query returns crate-1 at (1,2,3)', async ({ page }) => {
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Manual creator path — the exact API the inspector and manual controls use.
    await page.evaluate((id: string) => {
      const store = (window as unknown as EditorHandle).__EDITOR_STORE.getState();
      store.dispatchCommand('spawn_entity', { entityType: 'cube', name: id, id });
    }, CRATE_ID);
    await page.evaluate(({ id, position }: { id: string; position: number[] }) => {
      (window as unknown as EditorHandle).__EDITOR_STORE.getState()
        .dispatchCommand('update_transform', { entityId: id, position });
    }, { id: CRATE_ID, position: TARGET });

    const confirmed = await readConfirmedPosition(page);
    expect(confirmed, 'engine did not confirm crate-1 at (1,2,3)').not.toBeNull();
    expect(await countCrates(page), 'more than one crate-1 in the scene graph').toBe(1);
  });

  test('in-app AI path: engine query returns crate-1 at (1,2,3), matching the manual path', async ({ page }) => {
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // In-app AI creator path — `executeToolCall` dispatches through this event.
    await page.evaluate((id: string) => {
      window.dispatchEvent(new CustomEvent('forge-command', {
        detail: { command: 'spawn_entity', payload: { entityType: 'cube', name: id, id } },
      }));
    }, CRATE_ID);
    await page.evaluate(({ id, position }: { id: string; position: number[] }) => {
      window.dispatchEvent(new CustomEvent('forge-command', {
        detail: { command: 'update_transform', payload: { entityId: id, position } },
      }));
    }, { id: CRATE_ID, position: TARGET });

    const confirmed = await readConfirmedPosition(page);
    // PARITY: the AI surface must reach the identical confirmed engine state the
    // manual surface does — same command contract, same confirmation semantics.
    expect(confirmed, 'AI path did not reach the same confirmed (1,2,3) as manual').not.toBeNull();
    expect(await countCrates(page), 'more than one crate-1 in the scene graph').toBe(1);
  });
});
