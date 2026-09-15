import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_INTERACTION_MS,
} from '../constants';
import FX, { type ReplayFixture as Fixture } from '../fixtures/minimal-2d-replay-fixture';
import type { useEditorStore } from '@/stores/editorStore';

/**
 * #9902 (qa.FR-1.OP-01 / qa.FR-1.OP-03) — record/replay against the REAL engine.
 *
 * Builds the minimal 2D fixture through real engine commands, enters Play, and
 * replays a bounded 120-tick input trace through the REAL runtime input path via
 * `window.__FORGE_REPLAY` (the same `replay_input_trace` runner the manual
 * Replay button invokes; AI registration is pending #10007). It asserts on engine
 * state: the player entity moved, and exactly one collectible was collected
 * (its `destroy_on_collect` despawn). This is the real-boundary evidence the
 * mocked unit tests (`src/lib/playtest/__tests__/*`) cannot provide.
 *
 * TAG CHOICE — deliberately `@engine`/`@engine-replay`, NOT `@engine-smoke`.
 * `pipeline-live-engine.spec.ts` documents that a collectible/`game_win`
 * assertion is NON-DETERMINISTIC under the per-PR SwiftShader software
 * rasteriser (variable frame rate + physical traversal), and deliberately
 * defers it. Making this a REQUIRED per-PR gate would reintroduce exactly that
 * flakiness. So this spec is authored real-engine evidence runnable on a pinned
 * / GPU-capable runner (`playwright test --config=playwright.engine.config.ts
 * --grep @engine-replay`); PROMOTING it into the required `@engine-smoke` gate,
 * on a runtime pinned frame rate, is owned by the child issue that carries
 * qa.FR-1.OP-01/OP-03 forward (see the PR body). Recording, manual/AI parity,
 * source-label equivalence and the dead-input negative case use fake engines
 * in unit suites. This authored spec is not runtime evidence until it passes
 * against a live engine.
 */

/** The bounded trace a "hold move_right for 120 ticks" recording produces. */
function holdTrace() {
  return {
    version: 1 as const,
    fixtureId: FX.fixtureId,
    actionNames: FX.replay.actionNames,
    durationMs: FX.replay.ticks * 16,
    frames: Array.from({ length: FX.replay.ticks }, (_, tick) => ({
      tick,
      actions: Object.fromEntries(
        FX.replay.holdActions.map((name) => [name, { pressed: true, axis: 1 }]),
      ),
    })),
  };
}

test.describe('Runtime input replay @engine @engine-replay', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('records and replays 120 ticks: entity moves (OP-01) and one collectible collected (OP-03)', async ({
    page,
  }) => {
    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: E2E_TIMEOUT_ELEMENT_MS,
    });

    // --- Build the fixture scene through REAL engine commands ---------------
    const ids = await page.evaluate((fx: Fixture) => {
      const store = window.__EDITOR_STORE as typeof useEditorStore;
      const state = store.getState();
      state.setProjectType(fx.projectType);
      const spawned: Record<string, string> = {};
      for (const entity of fx.entities) {
        const id = state.spawnEntity(entity.entityType, entity.name, entity.position);
        if (!id) throw new Error(`spawnEntity failed for ${entity.name}`);
        spawned[entity.id] = id;
        state.updateTransform(id, 'scale', entity.scale);
        state.setPhysics2d(
          id,
          entity.physics2d,
          true,
        );
        for (const component of entity.gameComponents) {
          state.addGameComponent(id, component);
        }
      }
      for (const binding of fx.inputBindings) state.setInputBinding(binding);
      // A collectAll win condition on the one collectible makes the scene
      // winnable so the pre-play gate (#8542) admits Play.
      state.addGameComponent(spawned[fx.entities[1].id], {
        type: 'winCondition',
        winCondition: { conditionType: 'collectAll', targetScore: null, targetEntityId: null },
      });
      return spawned;
    }, FX);

    // --- Enter Play through the real button --------------------------------
    const playBtn = page.locator('button[aria-label="Play"]').first();
    await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await playBtn.click();
    await page.waitForFunction(
      () =>
        (window.__EDITOR_STORE as typeof useEditorStore).getState()
          .engineMode === 'play',
      undefined,
      { timeout: E2E_TIMEOUT_INTERACTION_MS },
    );

    // --- Replay the bounded trace through the real runtime runner ----------
    const outcome = await page.evaluate(
      async ({ trace, playerEntityId, collectibleEntityIds }) => {
        const replay = window.__FORGE_REPLAY;
        if (!replay) throw new Error('Replay test hook is unavailable');
        return replay(trace, { playerEntityId, collectibleEntityIds });
      },
      {
        trace: holdTrace(),
        playerEntityId: ids['player'],
        collectibleEntityIds: [ids['coin']],
      },
    );

    // --- Observed-state assertions (real engine) ---------------------------
    expect(outcome.command).toBe('replay_input_trace');
    expect(outcome.ticksReplayed).toBe(FX.replay.ticks);

    const move = outcome.assertions.find((a) => a.operationId === 'qa.FR-1.OP-01');
    const collect = outcome.assertions.find((a) => a.operationId === 'qa.FR-1.OP-03');
    expect(move?.passed, `player did not move: ${JSON.stringify(outcome)}`).toBe(true);
    expect(
      collect?.passed,
      `expected exactly one collectible collected: ${JSON.stringify(outcome)}`,
    ).toBe(true);
    expect(outcome.collectiblesCollected).toBe(1);
    expect(outcome.verdict).toBe('passed');
  });
});
