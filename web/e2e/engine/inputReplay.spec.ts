import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_INTERACTION_MS,
  E2E_TIMEOUT_PIPELINE_LIVE_MS,
  E2E_TIMEOUT_TEST_MS,
  REPLAY_NFR_ACK_P95_MS,
  REPLAY_NFR_PENDING_DISPLAY_MS,
} from '../constants';
import FX, { type ReplayFixture as Fixture } from '../fixtures/minimal-2d-replay-fixture';
import type { useEditorStore } from '@/stores/editorStore';

/**
 * #9902 (qa.FR-1.OP-01 / qa.FR-1.OP-03) → #10007 — record/replay against the
 * REAL engine, on a PINNED simulation clock, as a required per-PR gate.
 *
 * Builds the minimal 2D fixture through real engine commands, enters Play, and
 * replays a bounded 120-tick input trace through the REAL runtime input path via
 * `window.__FORGE_REPLAY` — the same `replayEntryPoints` the manual Replay
 * button and the in-app AI tool (`replay_input_trace`) call, labelled 'manual'.
 * It asserts on engine state: the player entity moved, and exactly one
 * collectible was collected (its `destroy_on_collect` despawn).
 *
 * WHY THIS CAN BE `@engine-smoke` NOW. Under the per-PR SwiftShader software
 * rasteriser the frame rate varies from frame to frame and run to run, and
 * every simulation system in the engine steps by `Time::delta_secs()`, so how
 * far 120 frames of "hold right" carried the player used to vary with it —
 * `pipeline-live-engine.spec.ts` defers `game_win` for exactly that reason.
 * The runner now dispatches `pin_frame_rate` before the first tick
 * (`core::simulation_clock`: Bevy's `TimeUpdateStrategy::ManualDuration`), so
 * every rendered frame advances the simulation by exactly 1/60 s regardless of
 * wall-clock cadence, and one trace frame is injected per engine frame. The
 * outcome records `pinned: true`, and this spec asserts it: a verdict reached
 * on an unpinned clock does not count.
 *
 * SCENARIO 3 (boundary and recovery) is the second half: a controlled replay
 * is paused at exactly tick 60 through `window.__FORGE_REPLAY_CONTROL`, then
 * cancelled; the engine's own evaluated input (`capture_input`, read off the
 * play-tick bus) must report the move action released once the runtime is
 * running again, so "cancellation releases input" is asserted on what the
 * engine reports, not on the runner's bookkeeping. Play is stopped (the engine
 * restores its edit snapshot, respawning the collected coin) and re-entered,
 * the full trace is replayed again, and the restarted run must collect exactly
 * one collectible and land within 0.01 world units of the first, uninterrupted
 * run — the determinism the pinned clock promises, measured end to end.
 *
 * NFR-C1 (#9773): the spec also measures, in the browser, how long a control is
 * acknowledged in (cancel → `cancelling` visible) and how long the pending
 * state takes to appear after `start` resolves, and attaches both; the
 * acceptance limits are `REPLAY_NFR_ACK_P95_MS` / `REPLAY_NFR_PENDING_DISPLAY_MS`.
 *
 * The AI entry point is proven equal to this one command-for-command on a
 * simulated engine (`src/lib/playtest/__tests__/replayParity.test.ts`); this
 * spec is the live-engine half of that evidence.
 *
 * Timeout: one cold WASM boot under SwiftShader, then three 120-tick replays
 * and two Play/Stop round-trips, so the describe block raises its cap to
 * E2E_TIMEOUT_PIPELINE_LIVE_MS like pipeline-live-engine.spec.ts does.
 * Justification for the curated-set minutes: docs/testing-principles.md §9.
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

/** Scenario 3's tolerance: a restarted run may differ from an uninterrupted one by this much. */
const RESTART_TOLERANCE_WORLD_UNITS = 0.01;
/** Where the second replay pauses — the tick the acceptance criteria name. */
const PAUSE_AT_TICK = 60;

async function engineMode(page: Page): Promise<string> {
  return page.evaluate(
    () => (window.__EDITOR_STORE as typeof useEditorStore).getState().engineMode,
  );
}

async function waitForEngineMode(page: Page, mode: string): Promise<void> {
  await page.waitForFunction(
    (expected: string) =>
      (window.__EDITOR_STORE as typeof useEditorStore).getState().engineMode === expected,
    mode,
    { timeout: E2E_TIMEOUT_INTERACTION_MS },
  );
}

async function enterPlay(page: Page): Promise<void> {
  const playBtn = page.locator('button[aria-label="Play"]').first();
  await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  await playBtn.click();
  await waitForEngineMode(page, 'play');
}

async function stopPlay(page: Page): Promise<void> {
  // The store's stop() is what the Stop button calls; from Paused or Play it
  // asks the engine to restore the edit snapshot, which respawns the coin.
  await page.evaluate(() => (window.__EDITOR_STORE as typeof useEditorStore).getState().stop());
  await waitForEngineMode(page, 'edit');
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test.describe('Runtime input replay on the pinned clock @engine @engine-smoke', () => {
  test.describe.configure({ timeout: E2E_TIMEOUT_PIPELINE_LIVE_MS });

  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('replays 120 ticks deterministically (OP-01, OP-03), survives pause / cancel / restart within 0.01 units, and acknowledges controls within the NFR', async ({
    page,
  }, testInfo) => {
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
        state.setPhysics2d(id, entity.physics2d, true);
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
    const config = { playerEntityId: ids['player'], collectibleEntityIds: [ids['coin']] };

    // --- Run A: the uninterrupted reference replay on the pinned clock -----
    await enterPlay(page);
    const outcomeA = await page.evaluate(
      async ({ trace, config }) => {
        const replay = window.__FORGE_REPLAY;
        if (!replay) throw new Error('Replay test hook is unavailable');
        return replay(trace, config);
      },
      { trace: holdTrace(), config },
    );

    expect(outcomeA.command).toBe('replay_input_trace');
    expect(outcomeA.pinned, `run A was not pinned: ${JSON.stringify(outcomeA)}`).toBe(true);
    expect(outcomeA.pinHz).toBe(60);
    expect(outcomeA.ticksReplayed).toBe(FX.replay.ticks);
    const moveA = outcomeA.assertions.find((a) => a.operationId === 'qa.FR-1.OP-01');
    const collectA = outcomeA.assertions.find((a) => a.operationId === 'qa.FR-1.OP-03');
    expect(moveA?.passed, `player did not move: ${JSON.stringify(outcomeA)}`).toBe(true);
    expect(
      collectA?.passed,
      `expected exactly one collectible collected: ${JSON.stringify(outcomeA)}`,
    ).toBe(true);
    expect(outcomeA.collectiblesCollected).toBe(1);
    expect(outcomeA.verdict).toBe('passed');
    expect(outcomeA.endPosition, 'run A has no end position').not.toBeNull();

    // --- Scenario 3: pause at tick 60, cancel, restart from the snapshot ---
    await stopPlay(page);
    await enterPlay(page);

    const started = await page.evaluate(
      async ({ trace, config, pauseAtTick }) => {
        const control = window.__FORGE_REPLAY_CONTROL;
        if (!control) throw new Error('Replay control hook is unavailable');
        const t0 = performance.now();
        const id = await control.start(trace, config, { pauseAtTick });
        // The pending state is visible as soon as the session exists.
        const first = await control.state(id);
        const pendingMs = performance.now() - t0;
        return { id, pendingMs, firstState: first.state };
      },
      { trace: holdTrace(), config, pauseAtTick: PAUSE_AT_TICK },
    );
    expect(['pinning', 'running', 'pausing', 'paused']).toContain(started.firstState);

    await page.waitForFunction(
      async (id) => (await window.__FORGE_REPLAY_CONTROL!.state(id)).state === 'paused',
      started.id,
      { timeout: E2E_TIMEOUT_TEST_MS },
    );
    const paused = await page.evaluate((id) => window.__FORGE_REPLAY_CONTROL!.state(id), started.id);
    expect(paused.tick, `paused at the wrong tick: ${JSON.stringify(paused)}`).toBe(PAUSE_AT_TICK);
    expect(paused.heldKeys, 'synthetic keys still held while paused').toEqual([]);
    expect(paused.pinned).toBe(true);
    // The runner paused the RUNTIME too: the engine confirmed it through
    // ENGINE_MODE_CHANGED, which is what the store's engineMode mirrors.
    await waitForEngineMode(page, 'paused');

    // Cancel: acknowledged synchronously, input released, runtime resumed.
    const cancelled = await page.evaluate(async (id) => {
      const control = window.__FORGE_REPLAY_CONTROL!;
      const t0 = performance.now();
      const accepted = control.control(id, 'cancel');
      const ack = await control.state(id);
      const ackMs = performance.now() - t0;
      const result = await control.result(id);
      return { accepted, ackState: ack.state, ackMs, result };
    }, started.id);
    expect(cancelled.accepted).toBe(true);
    expect(['cancelling', 'cancelled']).toContain(cancelled.ackState);
    expect(cancelled.result).toEqual({ status: 'cancelled', ticksReplayed: PAUSE_AT_TICK });

    // The engine is running again (cancel leaves the runtime as the runner
    // found it) and ITS evaluated input — not the runner's list — says the
    // move action is released.
    await waitForEngineMode(page, 'play');
    await page.waitForFunction(
      async (id) => {
        const state = await window.__FORGE_REPLAY_CONTROL!.state(id);
        const input = state.engineInput;
        return (
          state.state === 'cancelled' &&
          state.heldKeys.length === 0 &&
          input !== null &&
          !input.pressed['move_right'] &&
          (input.axes['move_right'] ?? 0) === 0
        );
      },
      started.id,
      { timeout: E2E_TIMEOUT_INTERACTION_MS },
    );
    expect(await engineMode(page)).toBe('play');

    // Restart from the initial snapshot: Stop restores the scene (the coin
    // respawns), Play re-enters, and the full trace runs again.
    await stopPlay(page);
    await enterPlay(page);
    const outcomeC = await page.evaluate(
      async ({ trace, config }) => window.__FORGE_REPLAY!(trace, config),
      { trace: holdTrace(), config },
    );
    expect(outcomeC.pinned).toBe(true);
    expect(outcomeC.ticksReplayed).toBe(FX.replay.ticks);
    expect(outcomeC.collectiblesCollected, 'the collector did not fire exactly once on restart').toBe(1);
    expect(outcomeC.verdict).toBe('passed');
    expect(outcomeC.endPosition, 'run C has no end position').not.toBeNull();
    const drift = distance(outcomeA.endPosition!, outcomeC.endPosition!);
    expect(
      drift,
      `restarted run drifted ${drift} world units from the uninterrupted run (A=${JSON.stringify(outcomeA.endPosition)}, C=${JSON.stringify(outcomeC.endPosition)})`,
    ).toBeLessThanOrEqual(RESTART_TOLERANCE_WORLD_UNITS);

    // --- NFR-C1 evidence: measured in this browser, on this runner ---------
    const nfr = {
      fixture: FX.fixtureId,
      ticks: FX.replay.ticks,
      pinHz: outcomeA.pinHz,
      userAgent: await page.evaluate(() => navigator.userAgent),
      cancelAcknowledgementMs: cancelled.ackMs,
      pendingDisplayMs: started.pendingMs,
      limits: { ackP95Ms: REPLAY_NFR_ACK_P95_MS, pendingDisplayMs: REPLAY_NFR_PENDING_DISPLAY_MS },
      endPositions: { a: outcomeA.endPosition, c: outcomeC.endPosition, driftWorldUnits: drift },
    };
    await testInfo.attach('replay-nfr-timing.json', {
      body: JSON.stringify(nfr, null, 2),
      contentType: 'application/json',
    });
    expect(cancelled.ackMs).toBeLessThanOrEqual(REPLAY_NFR_ACK_P95_MS);
    expect(started.pendingMs).toBeLessThanOrEqual(REPLAY_NFR_PENDING_DISPLAY_MS);
  });
});
