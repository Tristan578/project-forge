import { test, expect, type Page } from '@playwright/test';
import { E2E_TIMEOUT_ENGINE_FULL_MS, E2E_TIMEOUT_ELEMENT_MS, E2E_TIMEOUT_TEST_MS } from '../constants';
import {
  ENGINE_ERROR_TRUNCATED,
  MAX_ENGINE_ERROR_CHARS,
  emptySceneFile,
} from '../../src/lib/scenes/sceneValidation';

/**
 * #10267 / PR #10292: the scene-load lockout notice must fit a phone screen.
 *
 * The notice (`SceneLoadErrorNotice`) is `position: fixed` and cannot be
 * dismissed, and it covers the editor. When a rejected load appended up to 512
 * characters of engine text to its reason, it grew to 934-1474px tall on
 * 320-390px-wide screens and put the "Reload project" button below the bottom
 * edge, where nothing could scroll it into view. Its width was also wrong:
 * centring with `left-1/2 -translate-x-1/2` left it only half the screen, so a
 * max width on it never applied. jsdom has no layout, so the component's unit
 * test cannot see any of this. This spec measures the real layout in Chromium.
 *
 * It drives the real path: the editor page's cold-open `loadScene` is deferred
 * (no engine yet), a stand-in dispatcher installed through
 * `__FORGE_SET_DISPATCH` refuses `load_scene` with a long engine error, and
 * `sceneSlice` builds the lockout reason (bounded by `boundEngineError`, then
 * `describeSceneRefusal`) exactly as it does for the real engine. Two things
 * are stood in, and declared per #10158 (`e2e/lib/substitution.ts`): the WASM
 * engine (the stand-in dispatcher) and the project server (`page.route`
 * answers `GET /api/projects/:id`).
 */

const PROJECT_ID = 'e2e-scene-load-notice';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
] as const;

/** Repeat `unit` until it is longer than the editor's cap, so the reason is truncated to the cap. */
function longerThanCap(unit: string): string {
  return unit.repeat(Math.ceil((MAX_ENGINE_ERROR_CHARS * 2) / unit.length));
}

/**
 * Engine refusals longer than the editor keeps. `boundEngineError` cuts each
 * to 512 characters, so the notice gets the longest reason it can ever get.
 */
const ENGINE_ERRORS = {
  'spaced 512-character reason': `Invalid scene file: ${longerThanCap(
    'unknown variant `bloomSettingsLegacy`, expected one of `none`, `low`, `medium`, `high`, `ultra` for the post processing profile in entity Player Character, ',
  )}`,
  'unbroken token': `Invalid scene file: invalid type: string "${'A'.repeat(MAX_ENGINE_ERROR_CHARS)}", expected f32 at line 1 column 2`,
} as const;

/** Open the real editor page for a mocked project with no WASM engine. */
async function openEditorWithoutEngine(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('forge-welcomed', '1');
    localStorage.setItem('forge-mobile-dismissed', '1');
    localStorage.setItem('forge-checklist-dismissed', '1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__SKIP_ENGINE = true;
  });
  await page.route(`**/api/projects/${PROJECT_ID}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'Notice layout', sceneData: emptySceneFile('Notice layout') }),
    });
  });
  // 'commit', as the editor fixture does: a cold dev-server compile of the
  // editor route can outlast a domcontentloaded wait. Readiness is the hook below.
  await page.goto(`/editor/${PROJECT_ID}`, { waitUntil: 'commit', timeout: E2E_TIMEOUT_TEST_MS });
  // `EditorLayout` installs this hook when it mounts, which is after the page
  // has fetched the project and deferred its cold-open load.
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => typeof (window as any).__FORGE_SET_DISPATCH === 'function',
    undefined,
    { timeout: E2E_TIMEOUT_ENGINE_FULL_MS },
  );
}

/** Have a stand-in engine refuse every scene load with `engineError`, then load the project's scene. */
async function rejectSceneLoad(page: Page, engineError: string) {
  await page.evaluate(
    ([error, sceneJson]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.__FORGE_SET_DISPATCH((command: string) =>
        command === 'load_scene' ? { success: false, error } : undefined,
      );
      // Attaching may already have replayed the deferred cold open; loading
      // again is idempotent here (same refusal, same reason) and does not
      // depend on whether that replay happened.
      w.__EDITOR_STORE.getState().loadScene(sceneJson);
    },
    [engineError, JSON.stringify(emptySceneFile('Notice layout'))] as const,
  );
}

test.describe('Scene-load lockout notice on phone screens [substituted: WASM engine] [substituted: project server] @ui', {
  annotation: [
    { type: 'substitution', description: 'WASM engine' },
    { type: 'substitution', description: 'project server' },
  ],
}, () => {
  for (const viewport of VIEWPORTS) {
    for (const [label, engineError] of Object.entries(ENGINE_ERRORS)) {
      test(`${viewport.width}x${viewport.height}, ${label}: the notice and its Reload button stay on screen`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openEditorWithoutEngine(page);
        await rejectSceneLoad(page, engineError);

        const notice = page.getByRole('alert').filter({ hasText: 'Saving is turned off' });
        await expect(notice).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
        const reload = notice.getByRole('button', { name: 'Reload project' });
        const details = notice.getByRole('region', { name: 'Error details' });

        // The fixture really is the longest reason the editor can show: the
        // engine text was cut to the cap. Without this, a shorter reason could
        // make every layout assertion below pass trivially.
        await expect(details).toContainText(ENGINE_ERROR_TRUNCATED.trim());
        const reasonLength = await details.evaluate((el) => (el.textContent ?? '').length);
        expect(reasonLength).toBeGreaterThan(MAX_ENGINE_ERROR_CHARS);

        const m = await reload.evaluate((button) => {
          const alert = button.closest('[role="alert"]');
          if (!alert) throw new Error('the Reload button is not inside the alert');
          const n = alert.getBoundingClientRect();
          const b = button.getBoundingClientRect();
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            notice: { left: n.left, right: n.right, top: n.top, bottom: n.bottom, width: n.width },
            button: { top: b.top, bottom: b.bottom },
            buttonIsHit: hit !== null && button.contains(hit),
          };
        });

        // Width: inside both edges, and using the screen (12px gutters), not
        // half of it.
        expect(m.notice.left).toBeGreaterThanOrEqual(0);
        expect(m.notice.right).toBeLessThanOrEqual(m.innerWidth);
        expect(m.notice.width).toBeGreaterThanOrEqual(m.innerWidth - 24 - 1);

        // Height: the notice fits, and the Reload button is fully on screen
        // and is the element under its own centre (not clipped or covered).
        expect(m.notice.top).toBeGreaterThanOrEqual(0);
        expect(m.notice.bottom).toBeLessThanOrEqual(m.innerHeight);
        expect(m.button.top).toBeGreaterThanOrEqual(0);
        expect(m.button.bottom).toBeLessThanOrEqual(m.innerHeight);
        expect(m.buttonIsHit, 'the Reload button is hidden behind something').toBe(true);

        // The long reason scrolls inside its own box, and that box is
        // keyboard-reachable (axe scrollable-region-focusable).
        const scrolls = await details.evaluate((el) => el.scrollHeight > el.clientHeight);
        expect(scrolls).toBe(true);
        await details.focus();
        await expect(details).toBeFocused();
      });
    }
  }

  // Shorter than any phone in portrait, standing in for a landscape phone with
  // the on-screen keyboard up or enlarged text: here even the capped reason
  // plus the explanation does not fit, so the NOTICE's own height cap and
  // scrolling are what keep the Reload button reachable. The two phone cases
  // above never reach that cap, so without this test it would be unpinned.
  // 240px, not a gentler height: at 320px wide the uncapped notice is about
  // 266px tall here, so dropping either the cap or the scrolling puts the
  // button off the screen. At 300px the overflow was ~20px, small enough to
  // hide in the bottom gutter, and dropping the scrolling stayed green.
  test('320x240, spaced 512-character reason: the notice fits and the Reload button scrolls into view on focus', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 240 });
    await openEditorWithoutEngine(page);
    await rejectSceneLoad(page, ENGINE_ERRORS['spaced 512-character reason']);

    const notice = page.getByRole('alert').filter({ hasText: 'Saving is turned off' });
    await expect(notice).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    const reload = notice.getByRole('button', { name: 'Reload project' });

    const fit = await notice.evaluate((el) => {
      const n = el.getBoundingClientRect();
      return { top: n.top, bottom: n.bottom, innerHeight: window.innerHeight, scrolls: el.scrollHeight > el.clientHeight };
    });
    expect(fit.top).toBeGreaterThanOrEqual(0);
    expect(fit.bottom).toBeLessThanOrEqual(fit.innerHeight);
    // The notice really is taller than the screen here; otherwise this case
    // would not be testing the cap at all.
    expect(fit.scrolls).toBe(true);

    // Geometry only, no hit test: on a 240px screen the transient "Couldn't
    // load the scene" toast that the same rejection raises sits over the
    // bottom of the screen until it times out. That toast is not part of this
    // notice and behaves the same on main.
    await reload.focus();
    await expect(reload).toBeFocused();
    const button = await reload.evaluate((b) => {
      const r = b.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, innerHeight: window.innerHeight };
    });
    expect(button.top).toBeGreaterThanOrEqual(0);
    expect(button.bottom).toBeLessThanOrEqual(button.innerHeight);
  });
});
