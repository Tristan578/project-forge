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
    // script stops logging after five frames so it cannot flood the log.
    await page.evaluate(
      ({ entityId, marker }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        store.getState().setScript(
          entityId,
          [
            'let ticks = 0;',
            'function onUpdate(dt) {',
            '  if (ticks < 5) {',
            '    ticks += 1;',
            `    forge.log(${JSON.stringify(marker)});`,
            '  }',
            '}',
          ].join('\n'),
          true
        );
      },
      { entityId: targetId, marker: PLAY_TICK_MARKER }
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
      undefined,
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
      undefined,
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
