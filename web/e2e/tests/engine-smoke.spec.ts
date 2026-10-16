import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_SHORT_MS,
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_INTERACTION_MS,
  E2E_TIMEOUT_LOAD_MS,
} from '../constants';

/**
 * #8602 (F10): curated per-PR @engine-smoke journey.
 *
 * One of the two curated specs run by the test-e2e-engine-smoke CI job
 * (playwright.engine.config.ts; the other is `pipeline-live-engine.spec.ts`,
 * which drives the game-creation pipeline through the same engine). This job is
 * the only per-PR job that actually boots the
 * WASM engine, under ANGLE/SwiftShader software WebGL2 (NOT --disable-gpu, which
 * leaves wgpu with no GL context and hangs `init_engine`).
 *
 * It exercises the critical end-to-end editor path through the REAL engine:
 *   load editor (WASM + Bevy init) -> spawn entity -> select + inspect transform
 *   -> Play -> Stop -> open export dialog.
 *
 * The broader full-walkthrough.spec.ts (@engine, 5 tests) covers the same path
 * but is NOT a curated subset; tagging this narrow flow with the distinct
 * `@engine-smoke` tag keeps the per-PR SwiftShader run small and fast (software
 * rendering is slow — a large @engine sweep would blow the job timeout). The
 * full @engine sweep remains available for a GPU-capable / nightly runner.
 *
 * DOCUMENTED GAP: SwiftShader is software WebGL2 — this validates ECS / picking
 * / play / export journeys but NOT WebGPU or real-GPU rendering correctness.
 */
/**
 * What the Step 2c script logs on each frame it is given. Asserted on in Step
 * 3b; a value no other code writes, so a match can only come from that script.
 */
const PLAY_TICK_MARKER = 'engine-smoke: onUpdate ran';
/**
 * Logged by the Step 2c script about once a second (on its own `dt` clock)
 * with CUMULATIVE counts appended: `frame=<frames> seen=<n> lost=<m>`, where
 * `seen`/`lost` count the times `forge.getTransform(entityId)` flipped to
 * non-null / null. Step 3c reads the LAST such line. The store keeps only the
 * last 200 `scriptLogs` entries (scriptSlice.ts), so a per-event line logged
 * early in the run could be evicted by a long or fast session and read as
 * "never seen"; a line that carries its own history cannot be.
 */
const ENTITY_STATE_PREFIX = 'engine-smoke: state ';

test.describe('Engine Smoke Journey @engine @engine-smoke', () => {
  /**
   * Every console warning the page writes, captured from before the first
   * navigation. Step 4b asserts on the slice written during the Play session
   * (#10375): the engine's per-frame Play event is `PLAY_TICK_DELTA`, and while
   * the editor's event hub did not know it, every frame surfaced here as
   * `Unknown engine event: PLAY_TICK_DELTA` (40+ per run in CI run 37546070304)
   * and scripts received no ticks at all. Nothing else in this spec could see
   * that: Play still "entered", Stop still "stopped", and the store never
   * learns that a frame was dropped.
   */
  let consoleWarnings: string[] = [];

  test.beforeEach(async ({ page, editor }) => {
    consoleWarnings = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning') consoleWarnings.push(msg.text());
    });
    // `editor.load()` seeds 'forge:preferred-backend' = 'webgl2' for every spec
    // that uses it, so SwiftShader is never asked for WebGPU here.
    await editor.load();
  });

  test('full engine journey: load -> spawn -> inspect -> play -> stop -> export', async ({
    page,
    editor,
  }) => {
    // Step 0: load() already proved the engine reached __FORGE_ENGINE_READY and
    // the editor layout (.dv-dockview) is visible. The canvas must be present.
    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: E2E_TIMEOUT_ELEMENT_MS,
    });

    // Step 1: spawn a Cube via the Add Entity menu and confirm it lands in the
    // scene graph (entity count grows past the default camera-only scene).
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);
    await expect(page.getByText(/Cube/, { exact: false }).first()).toBeVisible();

    // Step 2: select the entity and confirm the inspector shows its transform.
    await editor.selectEntity('Cube');
    await expect(page.getByText('Transform', { exact: false }).first()).toBeVisible({
      timeout: E2E_TIMEOUT_LOAD_MS,
    });
    const positionInputs = page.locator('input[type="text"]');
    expect(await positionInputs.count()).toBeGreaterThan(0);

    // Step 2b: satisfy the pre-play winnability gate (#8542) so Play can actually
    // enter play mode. play() (gameSlice) runs validateWinnability BEFORE
    // dispatching to the engine: a scene with no win condition can never be won,
    // so the gate surfaces a message and RETURNS — leaving engineMode 'edit' and
    // the Pause/Stop buttons disabled. A bare Cube is exactly that scene, so
    // without this the Step-3 transition below never fires. Attach a minimal,
    // genuinely-winnable condition — a `score` target > 0 needs no player or
    // collectibles (winnabilityValidator.ts evaluateCondition 'score') — via the
    // SAME store action the Game inspector calls (addGameComponent writes
    // allGameComponents, which is exactly what the gate's reader inspects). This
    // makes the gate pass on real state, so Step 3 exercises the genuine
    // Edit -> Play engine transition rather than being silently short-circuited.
    const targetId = await page.evaluate((): string => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      const state = store.getState();
      const targetId: string | undefined =
        state.primaryId ?? Object.keys(state.sceneGraph?.nodes ?? {})[0];
      if (!targetId) {
        throw new Error('engine-smoke: no entity to attach a win condition to');
      }
      state.addGameComponent(targetId, {
        type: 'winCondition',
        winCondition: {
          conditionType: 'score',
          targetScore: 100,
          targetEntityId: null,
        },
      });
      return targetId;
    });

    // Step 2c: attach a script that reports the frames it is given. This is the
    // tick-driven observation Step 3b asserts on (#10375): a script's
    // `onUpdate` runs ONLY when the engine's per-frame `PLAY_TICK_DELTA`
    // reaches the script runner through the event hub, so a Play session that
    // produced no such log entry is a Play session in which scripts received
    // no ticks — which the console-warning assertion in Step 4b alone could
    // not tell from an idle page. `setScript` is the same store action the
    // script inspector uses: it records the script locally (what the runner
    // gathers at Play start) and dispatches `set_script` to the engine. The
    // marker stops after five frames. Every frame the script checks whether it
    // can still see its OWN entity and counts the flips; about once a second
    // (its `dt` clock, first report on the first frame) it logs one state line
    // with the cumulative counts, which is what Step 3c asserts on. A few
    // lines per session: the 200-entry script log cannot overflow, and the
    // last state line always carries the whole history.
    await page.evaluate(
      ({ entityId, marker, statePrefix }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        store.getState().setScript(
          entityId,
          [
            'let frames = 0;',
            'let clock = 0;',
            'let lastReport = -1;',
            'let present = null;',
            'let seenCount = 0;',
            'let lostCount = 0;',
            'function onUpdate(dt) {',
            '  frames += 1;',
            '  clock += dt;',
            `  if (frames <= 5) forge.log(${JSON.stringify(marker)});`,
            '  const now = forge.getTransform(entityId) !== null;',
            '  if (now !== present) {',
            '    present = now;',
            '    if (now) seenCount += 1; else lostCount += 1;',
            '  }',
            '  if (clock - lastReport >= 1) {',
            '    lastReport = clock;',
            `    forge.log(${JSON.stringify(statePrefix)} + 'frame=' + frames + ' seen=' + seenCount + ' lost=' + lostCount);`,
            '  }',
            '}',
          ].join('\n'),
          true
        );
      },
      { entityId: targetId, marker: PLAY_TICK_MARKER, statePrefix: ENTITY_STATE_PREFIX }
    );

    // Step 3: enter Play mode — the engine snapshots state and inserts the
    // GameComponentRuntime. The Stop button is ALWAYS rendered (PlayControls.tsx
    // only toggles its `disabled` attribute), so its visibility proves nothing
    // about the mode. The mode-SENSITIVE signal is the `role="status"` indicator
    // span, which PlayControls renders ONLY when `!isEdit` with the text
    // 'Playing'/'Paused'. Assert it is absent in edit mode and appears after Play,
    // and cross-check the store's `engineMode` transitions 'edit' -> 'play'.
    const playStatus = page.getByRole('status').filter({ hasText: 'Playing' });
    await expect(playStatus).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store?.getState().engineMode;
      })
    ).toBe('edit');

    const playBtn = page
      .locator('button[title*="Play"], button[title*="play"]')
      .first();
    await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    // Everything the page warns from here until the return to edit mode is the
    // Play session's output; Step 4b reads that slice.
    const playSessionStart = consoleWarnings.length;
    await playBtn.click();

    // The 'Playing' indicator span becoming visible is true ONLY in play mode.
    // Use the interaction timeout (not the element one): entering Play is a full
    // JS->WASM->engine-snapshot->event->store->React round-trip, which under
    // SwiftShader CI can exceed the 5s element budget and flake.
    await expect(playStatus).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store?.getState().engineMode === 'play';
      },
      { timeout: E2E_TIMEOUT_INTERACTION_MS }
    );

    // Step 3b: the Play session must actually drive scripts (see Step 2c).
    // TWO entries, not one: the first frame of a run is a full keyframe, so a
    // hub that handled only that frame and dropped the deltas behind it would
    // still produce a single entry and read as healthy.
    await page.waitForFunction(
      (marker: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        const logs: Array<{ message: string }> = store?.getState().scriptLogs ?? [];
        return logs.filter((entry) => entry.message === marker).length >= 2;
      },
      PLAY_TICK_MARKER,
      { timeout: E2E_TIMEOUT_INTERACTION_MS }
    );

    // Step 3c: a pause and a resume applied in ONE engine update must not cost
    // the script its scene (#10375, Devin review on #10390). Two mode commands
    // sent back-to-back land in the same `apply_mode_change_requests` drain —
    // chat and MCP do exactly this — and the engine's per-frame delta cache
    // used to clear only on a frame it spent outside Play, which this sequence
    // never produces. The editor's hub, which did receive both mode events,
    // had dropped its snapshot, so the next delta (nothing moved: empty)
    // arrived as a frame with no entities; the script runner diffed every
    // entity away, the worker forgot the Cube, `forge.getTransform(entityId)`
    // went null and the script's `lost` count went to 1. The engine now clears
    // its cache on the transition itself (`core/play_tick_delta.rs`), so the
    // next frame is full. This is the one executable test of that bridge
    // wiring: `bridge/` is wasm32-only and never compiles into a native test
    // (a source pin, `playTickCacheClearPin.test.ts`, holds the call sites in
    // place between E2E runs).
    //
    // Raw commands through `__FORGE_DISPATCH`, not the Play controls, so both
    // are queued before the engine's next update.
    const stateBeforeBlip = await page.evaluate((prefix: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      const logs: Array<{ message: string }> = store?.getState().scriptLogs ?? [];
      const lines = logs.filter((entry) => entry.message.startsWith(prefix));
      const last = lines.length > 0 ? lines[lines.length - 1].message : '';
      const parsed = /frame=(\d+) seen=(\d+) lost=(\d+)/.exec(last);
      return { lines: lines.length, frame: parsed ? Number(parsed[1]) : 0 };
    }, ENTITY_STATE_PREFIX);
    // Non-vacuous: Step 3b saw two frames, and the script reports on its
    // first, so a state line exists before the blip.
    expect(stateBeforeBlip.lines).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dispatch = (window as any).__FORGE_DISPATCH;
      if (!dispatch('pause', {}) || !dispatch('resume', {})) {
        throw new Error('engine-smoke: __FORGE_DISPATCH refused a mode command');
      }
    });
    // Frames kept coming after the blip: wait for TWO more state lines. The
    // first may summarise frames that mostly ran before the blip; the second
    // is a full second of frames after it. A runtime that stalled on the
    // pause cannot pass this, and a Cube the script lost in that second shows
    // up in the cumulative `lost` count the last line carries.
    await page.waitForFunction(
      ({ prefix, atLeastLines }: { prefix: string; atLeastLines: number }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        const logs: Array<{ message: string }> = store?.getState().scriptLogs ?? [];
        return logs.filter((entry) => entry.message.startsWith(prefix)).length >= atLeastLines;
      },
      { prefix: ENTITY_STATE_PREFIX, atLeastLines: stateBeforeBlip.lines + 2 },
      { timeout: E2E_TIMEOUT_INTERACTION_MS }
    );
    const stateAfterBlip = await page.evaluate((prefix: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      const logs: Array<{ message: string }> = store?.getState().scriptLogs ?? [];
      const lines = logs.filter((entry) => entry.message.startsWith(prefix));
      const last = lines.length > 0 ? lines[lines.length - 1].message : '';
      const parsed = /frame=(\d+) seen=(\d+) lost=(\d+)/.exec(last);
      return {
        last,
        frame: parsed ? Number(parsed[1]) : 0,
        seen: parsed ? Number(parsed[2]) : -1,
        lost: parsed ? Number(parsed[3]) : -1,
        engineMode: store?.getState().engineMode as string,
      };
    }, ENTITY_STATE_PREFIX);
    // The last line is one of the newest log entries, so the cap cannot have
    // evicted it, and its counts cover the whole run. `seen` first: a script
    // that never saw its entity at all would count one `lost` on its first
    // frame, but say so in the assertion that names it. The raw line is in
    // each message so a failure shows what the script actually reported.
    expect(stateAfterBlip.frame, stateAfterBlip.last).toBeGreaterThan(stateBeforeBlip.frame);
    expect(stateAfterBlip.seen, stateAfterBlip.last).toBeGreaterThanOrEqual(1);
    expect(stateAfterBlip.lost, stateAfterBlip.last).toBe(0);
    expect(stateAfterBlip.engineMode).toBe('play');

    // Step 4: stop — the engine restores the edit snapshot and PlayControls drops
    // the indicator span (back to edit mode). Editor stays live.
    const stopBtn = page
      .locator('button[title*="Stop"], button[title*="stop"]')
      .first();
    await expect(stopBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await stopBtn.click();
    await expect(playStatus).toHaveCount(0);
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store?.getState().engineMode === 'edit';
      },
      // Stop is the reverse engine round-trip (restore snapshot); same generous
      // interaction budget as the Play transition above.
      { timeout: E2E_TIMEOUT_INTERACTION_MS }
    );
    await expect(page.locator('canvas').first()).toBeVisible();

    // Step 4b: the hub dropped no engine event during the Play session. Scoped
    // to the session (Play click through the return to edit mode) because that
    // is where the per-frame event lives; `toEqual([])` so a failure names the
    // event(s) that fell through. Step 3b is what keeps this from passing on a
    // page that produced no frames at all.
    expect(
      consoleWarnings
        .slice(playSessionStart)
        .filter((line) => line.startsWith('Unknown engine event:'))
    ).toEqual([]);

    // Step 5: open the export dialog and confirm it renders export options.
    // The toolbar Export button (SceneToolbar.tsx) is icon-only (Download icon,
    // aria-label="Export game", no text node) so it must be located by its
    // accessible name, not hasText.
    const exportBtn = page.getByRole('button', { name: 'Export game' });
    await expect(exportBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await exportBtn.click();

    // The Export dialog (ExportDialog.tsx) labels itself with
    // aria-labelledby="export-dialog-title" (settings-dialog-title belongs to a
    // different panel).
    const dialog = page.locator(
      '[role="dialog"][aria-labelledby="export-dialog-title"]'
    );
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    // Assert on REAL, known export options rendered by ExportDialog.tsx — not a
    // shape-only "non-empty" check. The "Export Mode" section lists concrete
    // format labels; "Single HTML File" is the default-selected radio and
    // "ZIP Bundle" / "Embed (iframe)" are sibling format options. Their presence
    // proves the export options actually rendered.
    await expect(
      dialog.getByText('Export Mode', { exact: false })
    ).toBeVisible();
    await expect(
      dialog.getByText('Single HTML File', { exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByText('Embed (iframe)', { exact: true })
    ).toBeVisible();

    // Close the dialog; editor remains responsive.
    await page.keyboard.press('Escape');
    await expect(page.locator('canvas').first()).toBeVisible({
      timeout: E2E_TIMEOUT_SHORT_MS,
    });
  });
});
