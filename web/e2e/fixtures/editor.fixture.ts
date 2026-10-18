import { test as base, expect, type Page } from '@playwright/test';
import { E2E_HYDRATION_TIMEOUT_MS } from '../../src/lib/config/timeouts';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_LOAD_MS,
  E2E_TIMEOUT_TEST_MS,
} from '../constants';
import { hydrationWaitMs } from '../lib/hydrationWait';

/**
 * When the test that owns each page began, recorded by the `page` fixture
 * override in `test` below and read by `waitForEditorHydration` to size its
 * wait from the time the test has LEFT rather than its full timeout. Keyed by
 * the Page so a stamp dies with its page.
 */
const TEST_START_MS = new WeakMap<Page, number>();

/**
 * Wait for React hydration of the editor page (`__REACT_HYDRATED`), sized to
 * the running test's remaining budget.
 *
 * Why one helper and no reload fallback: `loadPage()` and eleven inline copies
 * in `template-flow.spec.ts` used to ask for a 90s wait and, on timeout, reload
 * and wait 40s more — for the webpack cold compile of a `next dev` server. Both
 * waits passed `{ timeout }` as the page function's ARGUMENT, so each was really
 * `actionTimeout` (10s). Honouring the numbers does not make the fallback
 * reachable: every shipped config ends the TEST first (30s ci, 45s journey, 60s
 * default, 90s engine), and CI serves `next start`, where there is no cold
 * compile. A fixed 90s wait inside a 30s test can only ever die as the generic
 * "Test timeout of 30000ms exceeded", pointing at nothing.
 *
 * The rule (`hydrationWaitMs`, e2e/lib/hydrationWait.ts): wait for
 * `E2E_HYDRATION_TIMEOUT_MS` or
 * `test.info().timeout - elapsed - E2E_TIMEOUT_TEST_MARGIN_MS`, whichever is
 * smaller, where `elapsed` is the time since this test's `page` fixture came
 * up. Remaining time, not the full timeout: fixture setup, `beforeEach` hooks,
 * `page.goto(..., { waitUntil: 'commit' })` and
 * `waitForLoadState('domcontentloaded')` have already spent part of the budget
 * by the time this runs, and a wait sized to the whole of it would overrun the
 * test by that much — the generic timeout again, the failure this helper exists
 * to remove. A hydration that never completes fails HERE, naming
 * `__REACT_HYDRATED`, with the margin left for Playwright to report it.
 *
 * The stamp is recorded for every spec that imports `test` from this module
 * (as `template-flow.spec.ts` does). It is taken once the built-in `page`
 * fixture has produced the page — context creation, a few hundred ms into the
 * budget — which the margin absorbs. A page with no stamp (a spec using
 * `@playwright/test`'s own `test`) counts `elapsed` as 0 and is sized from the
 * full timeout.
 *
 * When the remaining budget is not positive the full hydration budget applies:
 * a test with no timeout (`test.setTimeout(0)` or `--timeout=0`, where
 * `test.info().timeout` is 0), or one too short to hold the margin at all.
 * There is no "outside a test" case — `test.info()` throws there, so this
 * helper is only callable from a running test, its hooks or its fixtures.
 *
 * Deliberate narrowing: under the 60s default config a local `next dev`
 * webpack cold compile that finished after 45s but inside the test's 60s (the
 * board for #10363 cited 45-58s) used to pass, because the old 90s first wait
 * outlived the test and the compile only had to beat the test timeout; it now
 * fails at `E2E_HYDRATION_TIMEOUT_MS` (45s). Nothing that passed in CI changes
 * — `next start` has no cold compile, and the reload fallback was unreachable
 * under every shipped config. Locally, warm the dev server (open /dev once) or
 * run against `next start` before the @ui suite.
 */
export async function waitForEditorHydration(page: Page): Promise<void> {
  const startedAtMs = TEST_START_MS.get(page);
  const elapsedMs = startedAtMs === undefined ? 0 : Date.now() - startedAtMs;
  const timeout = hydrationWaitMs(base.info().timeout, elapsedMs);
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__REACT_HYDRATED === true,
    undefined,
    { timeout }
  );
}

/**
 * Page Object Model for the Project Forge editor.
 * Wraps common navigation, WASM wait, and interaction patterns.
 */
export class EditorPage {
  constructor(public page: Page) {}

  /** Navigate to /dev and wait for WASM engine to initialize */
  async load() {
    // Suppress onboarding overlays and the init overlay so they don't block
    // interactions. `InitOverlay` returns null only once `useEngineStatus`
    // reports the `'ready'` phase, which is emitted by the Rust first-frame
    // system (`detect_first_frame`, engine/src/core/observability.rs) — NOT
    // by `__FORGE_ENGINE_READY`, which useEngine.ts sets synchronously when
    // `init_engine()` returns, before the renderer has drawn anything. So the
    // overlay clears strictly LATER than the flag this fixture waits on. In
    // headless Chrome with --disable-gpu (every CI config except
    // playwright.engine.config.ts) `init_engine()` never completes, so the
    // overlay never clears on its own; on the engine config there is still a
    // window between the flag flipping and the first rendered frame. The CSS
    // suppression below is what keeps a click from landing on it in both cases.
    await this.page.addInitScript(() => {
      localStorage.setItem('forge-welcomed', '1');
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');

      // Undo `loadPage()`'s engine skip, so `load()` means "with engine" even
      // when a describe-level beforeEach already called `loadPage()`. Init
      // scripts accumulate and run in the order they were added, so this one
      // runs after that flag was set and wins.
      //
      // Without this a test could not opt back into a real engine, and the
      // canvas stays `invisible` forever — which is why 37 specs asserted on a
      // canvas that could never appear: they inherited `loadPage()`, which sets
      // `__SKIP_ENGINE = true`, and then asserted the engine's output (#9586).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = false;

      // Seed the persisted backend choice so `loadWasm()` (useEngine.ts) takes
      // the WebGL2 path directly: it reads this key before anything else and
      // only calls `probeWebGPU()` when it is not 'webgl2', so no config spends
      // GPU_INIT_TIMEOUT_MS probing for an adapter before falling back. This is
      // what playwright.engine.config.ts's header requires of the fixture —
      // SwiftShader cannot drive WebGPU, so the engine-smoke job must never
      // wait on that probe. It lives here rather than in each engine spec so a
      // third one cannot forget it. Same persisted key the in-app fallback
      // button writes (`PREFERRED_BACKEND_KEY`, useEngine.ts). A future
      // WebGPU-capable project must clear the key rather than inherit it.
      localStorage.setItem('forge:preferred-backend', 'webgl2');

      // Inject CSS to hide blocking overlays
      const style = document.createElement('style');
      style.setAttribute('data-e2e', 'suppress-overlays');
      style.textContent = [
        // Hide InitOverlay (absolute full-screen z-50 with bg-zinc-950/95)
        '[class*="absolute"][class*="inset-0"][class*="z-50"][class*="bg-zinc-950"] { display: none !important; }',
        // Hide Next.js dev overlay which intercepts pointer events in CI
        'nextjs-portal { display: none !important; pointer-events: none !important; }',
      ].join('\n');
      if (document.head) {
        document.head.appendChild(style);
      } else {
        document.addEventListener('DOMContentLoaded', () =>
          document.head.appendChild(style)
        );
      }
    });
    await this.page.goto('/dev');
    // Wait for the WASM engine to report ready (longer timeout for CI runners)
    await this.page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__FORGE_ENGINE_READY === true,
      undefined,
      { timeout: E2E_HYDRATION_TIMEOUT_MS }
    );
    // Wait for the editor layout to have mounted.
    //
    // This used to wait on `.dv-dockview`, which only exists in the full and
    // condensed layouts. At compact widths `EditorLayout` returns an entirely
    // different tree — MobileToolbar plus drawers, no Dockview at all — so
    // every mobile- and tablet-viewport spec timed out here waiting for an
    // element that layout never renders (9 of the 14 engine-gate failures on
    // this PR's first CI run).
    //
    // The canvas region is rendered by both branches, so it is the
    // layout-agnostic signal. `attached` rather than `visible`: CanvasArea
    // holds the canvas `invisible` until the first frame is drawn, which is
    // strictly later than the `__FORGE_ENGINE_READY` flag already awaited
    // above — waiting for visibility here would reintroduce a hang for a
    // different reason.
    await this.page
      .locator('[data-editor-region="canvas"], .dv-dockview')
      .first()
      .waitFor({ state: 'attached', timeout: E2E_TIMEOUT_ELEMENT_MS });
  }

  /** Navigate to /dev without waiting for WASM (for @ui tests in CI) */
  async loadPage() {
    // Suppress onboarding overlays, PerformanceProfiler, and engine loading
    await this.page.addInitScript(() => {
      localStorage.setItem('forge-welcomed', '1');
      localStorage.setItem('forge-mobile-dismissed', '1');
      localStorage.setItem('forge-checklist-dismissed', '1');

      // Skip WASM engine loading — prevents browser tab crash when
      // engine assets don't exist (CI) or GPU is unavailable
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__SKIP_ENGINE = true;

      // Inject CSS to hide PerformanceProfiler overlay and InitOverlay
      const style = document.createElement('style');
      style.setAttribute('data-e2e', 'suppress-overlays');
      style.textContent = [
        // Hide PerformanceProfiler (fixed bottom-left z-50)
        '.fixed.bottom-4.left-4.z-50 { display: none !important; }',
        // Hide InitOverlay (absolute full-screen z-50 with bg-zinc-950/95)
        // Using attribute selector since Tailwind's / in class names needs escaping
        '[class*="absolute"][class*="inset-0"][class*="z-50"][class*="bg-zinc-950"] { display: none !important; }',
        // Hide Next.js dev overlay (<nextjs-portal>) which intercepts pointer events in CI
        'nextjs-portal { display: none !important; pointer-events: none !important; }',
      ].join('\n');
      if (document.head) {
        document.head.appendChild(style);
      } else {
        document.addEventListener('DOMContentLoaded', () =>
          document.head.appendChild(style)
        );
      }
    });

    // Use 'commit' to avoid navigation timeout under parallel test load.
    // The actual readiness gate is __REACT_HYDRATED below.
    await this.page.goto('/dev', { waitUntil: 'commit', timeout: E2E_TIMEOUT_TEST_MS });
    await this.page.waitForLoadState('domcontentloaded');
    // Wait for React hydration — ensures all event handlers (keyboard shortcuts,
    // button clicks) are attached. This fires after EditorLayout mounts. The
    // wait is sized to the running config; see waitForEditorHydration.
    await waitForEditorHydration(this.page);
  }

  /** Wait for a minimum entity count in the scene graph */
  async waitForEntityCount(count: number) {
    await this.page.waitForFunction(
      (expected: number) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store && Object.keys(store.getState().sceneGraph.nodes).length >= expected;
      },
      count,
      { timeout: E2E_TIMEOUT_LOAD_MS }
    );
  }

  /** Get the canvas element */
  get canvas() {
    return this.page.locator('canvas').first();
  }

  /** Spawn an entity via the sidebar add menu */
  async spawnEntity(type: string) {
    const spawnBtn = this.page.getByRole('button', { name: new RegExp(type, 'i') });
    if (await spawnBtn.isVisible()) {
      await spawnBtn.click();
    }
  }

  /** Select an entity by clicking its name in the hierarchy panel */
  async selectEntity(name: string) {
    await this.page.getByText(name, { exact: false }).first().click();
  }

  /** Check that a dockview panel is visible */
  async expectPanelVisible(panelTitle: string) {
    await expect(
      this.page.locator(`.dv-tab, [data-testid="panel-${panelTitle}"]`).filter({ hasText: new RegExp(panelTitle, 'i') }).first()
    ).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  }

  /** Check that no visible text elements are invisible (zero opacity or transparent color) */
  async assertNoInvisibleElements() {
    const invisibleCount = await this.page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      let count = 0;
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        const hasText = el.textContent?.trim();
        if (hasText && style.color === 'rgba(0, 0, 0, 0)') count++;
        if (hasText && style.opacity === '0' && !el.closest('[aria-hidden]')) count++;
      }
      return count;
    });
    expect(invisibleCount).toBe(0);
  }

  /** Click a position in the 3D viewport */
  async clickViewport(x: number, y: number) {
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error('Canvas not visible');
    await this.page.mouse.click(box.x + x, box.y + y);
  }

  /** Open settings modal */
  async openSettings() {
    await this.page.getByRole('button', { name: /settings/i }).click();
    await expect(this.page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  }

  /** Press keyboard shortcut */
  async pressShortcut(keys: string) {
    await this.page.keyboard.press(keys);
  }

  /** Wait until __EDITOR_STORE is available (guards against hydration race). */
  async waitForEditorStore(timeout = E2E_TIMEOUT_LOAD_MS) {
    await this.page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => !!(window as any).__EDITOR_STORE,
      undefined,
      { timeout }
    );
  }

  async getStoreState<T>(selector: string): Promise<T> {
    // Ensure store is available before reading — prevents race after loadPage()
    await this.waitForEditorStore();
    return this.page.evaluate((sel: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) throw new Error('Store not available');
      const state = store.getState();
      return sel.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], state) as T;
    }, selector);
  }
}

export const test = base.extend<{ editor: EditorPage }>({
  // Wrap the built-in page fixture to stamp when this test's page came up.
  // Test-scoped fixtures set up inside the test's timeout, right before its
  // beforeEach hooks and body, so this is the closest thing to the test's start
  // that Playwright exposes — `test.info()` carries no start time. Read by
  // `waitForEditorHydration`; see its docblock for what the stamp misses.
  page: async ({ page }, use) => {
    TEST_START_MS.set(page, Date.now());
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
  editor: async ({ page }, use) => {
    const editor = new EditorPage(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(editor);
  },
});

export { expect };
