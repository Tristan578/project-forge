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
 *   `update_transform`, reports crate-1 at (1,2,3) with the requested scale. Run
 *   through BOTH creator surfaces: the manual dispatch path
 *   (`store.dispatchCommand`, the path the inspector and every manual control
 *   use) and the in-app AI path (the `forge-command` event `executeToolCall`
 *   fires). Both must observe the SAME confirmed transform — the parity the
 *   issue requires — because both flow through one command contract. The
 *   assertion reads the confirmation cache the slice adds (the typed
 *   `ObservedEntity` the orchestrator's `observeEntity` reads, via the read-only
 *   `__FORGE_READ_ENTITY_OBSERVATION` hook), not just the `TRANSFORM_CHANGED`
 *   store field — the same position/scale confirmation a production transform
 *   executor (`worldBuildExecutor`) now runs on.
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
const TARGET_SCALE: [number, number, number] = [2, 2, 2];

type EditorStoreShape = {
  dispatchCommand: (command: string, payload: unknown) => unknown;
  setSelection: (ids: string[], primaryId: string | null, primaryName: string | null) => void;
  selectedIds: Set<string>;
  primaryTransform: { entityId?: string; position?: number[] } | null;
  sceneGraph: { nodes: Record<string, { name?: string }>; rootIds: string[] };
};

type ObservedEntityShape = {
  entityId: string;
  transform?: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
};

type EditorHandle = {
  __EDITOR_STORE: { getState: () => EditorStoreShape };
  __FORGE_READ_ENTITY_OBSERVATION?: (entityId: string) => ObservedEntityShape | undefined;
};

/** Root IDs retain duplicate root entities; the nodes map collapses duplicate IDs. */
async function countCrates(page: Page): Promise<number> {
  return page.evaluate((id: string) => {
    const rootIds = (window as unknown as EditorHandle).__EDITOR_STORE.getState().sceneGraph.rootIds;
    return rootIds.filter(nodeId => nodeId === id).length;
  }, CRATE_ID);
}

async function waitForCrate(page: Page): Promise<void> {
  await page.waitForFunction(
    (id: string) => Object.hasOwn(
      (window as unknown as EditorHandle).__EDITOR_STORE.getState().sceneGraph.nodes,
      id,
    ),
    CRATE_ID,
    { timeout: E2E_TIMEOUT_ELEMENT_MS },
  );
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
    // Fire the engine query too, so the confirmed-effect cache is populated end
    // to end (it is asserted separately in `readConfirmationCache`).
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

/**
 * Read the CONFIRMATION CACHE the slice actually adds (#9899), not an adjacent
 * store field.
 *
 * This is the state the orchestrator's `observeEntity` reads: the typed
 * `ObservedEntity` recorded from the real `QUERY_ENTITY_DETAILS` event
 * (`lib/game-creation/engineObservation.ts`), surfaced through the read-only,
 * E2E-gated `__FORGE_READ_ENTITY_OBSERVATION` hook. It fires a fresh
 * `get_entity_details` each poll — exactly as `observeEngineEffect` does — and
 * resolves only once the cache shows BOTH the requested position and scale, the
 * same position/scale predicate `worldBuildExecutor` confirms transforms with.
 * A production transform executor now runs on this path, so this proves the new
 * transform-confirmation contract against real WASM rather than only at the unit
 * level.
 */
async function readConfirmationCache(page: Page): Promise<ObservedEntityShape> {
  const handle = await page.waitForFunction(
    ({ id, position, scale }: { id: string; position: number[]; scale: number[] }) => {
      const read = (window as unknown as EditorHandle).__FORGE_READ_ENTITY_OBSERVATION;
      if (typeof read !== 'function') return null;
      (window as unknown as EditorHandle).__EDITOR_STORE.getState()
        .dispatchCommand('get_entity_details', { entityId: id });
      const observed = read(id);
      const t = observed?.transform;
      if (!t) return null;
      const near = (a: number[], b: number[]) =>
        Math.abs(a[0] - b[0]) < 0.1 && Math.abs(a[1] - b[1]) < 0.1 && Math.abs(a[2] - b[2]) < 0.1;
      return near(t.position, position) && near(t.scale, scale) ? observed : null;
    },
    { id: CRATE_ID, position: TARGET, scale: TARGET_SCALE },
    { timeout: E2E_TIMEOUT_ELEMENT_MS },
  );
  // `waitForFunction` only resolves once the callback returns a truthy value, so
  // the observation is always present here — the predicate's `null` return is
  // the "keep polling" signal, never the resolved value.
  return handle.jsonValue() as Promise<ObservedEntityShape>;
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
    await waitForCrate(page);
    await page.evaluate(({ id, position, scale }: { id: string; position: number[]; scale: number[] }) => {
      (window as unknown as EditorHandle).__EDITOR_STORE.getState()
        .dispatchCommand('update_transform', { entityId: id, position, scale });
    }, { id: CRATE_ID, position: TARGET, scale: TARGET_SCALE });

    const confirmed = await readConfirmedPosition(page);
    expect(confirmed, 'engine did not confirm crate-1 at (1,2,3)').not.toBeNull();
    // Assert on the confirmation cache the slice adds — the typed ObservedEntity
    // the orchestrator reads — proving the transform (position AND scale) was
    // confirmed through the new path, not just the TRANSFORM_CHANGED store field.
    const observed = await readConfirmationCache(page);
    expect(observed.transform?.position, 'cached observation missing (1,2,3)').toBeTruthy();
    expect(observed.transform?.scale, 'cached observation missing the confirmed scale').toBeTruthy();
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
    await waitForCrate(page);
    await page.evaluate(({ id, position, scale }: { id: string; position: number[]; scale: number[] }) => {
      window.dispatchEvent(new CustomEvent('forge-command', {
        detail: { command: 'update_transform', payload: { entityId: id, position, scale } },
      }));
    }, { id: CRATE_ID, position: TARGET, scale: TARGET_SCALE });

    const confirmed = await readConfirmedPosition(page);
    // PARITY: the AI surface must reach the identical confirmed engine state the
    // manual surface does — same command contract, same confirmation semantics.
    expect(confirmed, 'AI path did not reach the same confirmed (1,2,3) as manual').not.toBeNull();
    // Same confirmation-cache assertion as the manual path — both surfaces reach
    // the identical typed ObservedEntity through the slice's real query path.
    const observed = await readConfirmationCache(page);
    expect(observed.transform?.position, 'AI path cached observation missing (1,2,3)').toBeTruthy();
    expect(observed.transform?.scale, 'AI path cached observation missing the confirmed scale').toBeTruthy();
    expect(await countCrates(page), 'more than one crate-1 in the scene graph').toBe(1);
  });
});
