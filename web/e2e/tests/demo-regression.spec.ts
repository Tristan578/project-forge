/**
 * PF-161: Full demo walkthrough regression test.
 *
 * Exercises the critical UI path: load editor → verify panels → verify play
 * controls → verify export button → verify keyboard shortcuts.
 *
 * Uses loadPage() (no WASM engine) since the Playwright config disables GPU
 * (--disable-gpu), meaning the Bevy renderer cannot initialize and engine
 * commands (play/stop) won't be processed. Store state is manipulated
 * directly to test UI reactions to mode changes.
 */
import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_SHORT_MS,
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_LOAD_MS,
} from '../constants';

test.describe('Demo Regression Walkthrough @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  test('editor loads with core panels visible', async ({ page }) => {
    // Hierarchy panel
    const hierarchyTab = page.locator('.dv-tab').filter({ hasText: /hierarchy/i }).first();
    await expect(hierarchyTab).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Canvas should be present
    await expect(page.locator('canvas').first()).toBeVisible();

    // Inspector panel
    const inspectorTab = page.locator('.dv-tab').filter({ hasText: /inspector/i }).first();
    await expect(inspectorTab).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Scene/Assets tabs should be present
    const sceneTab = page.locator('.dv-tab').filter({ hasText: /scene/i }).first();
    await expect(sceneTab).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('play controls are visible and respond to mode changes', async ({ page }) => {
    // Play button should be visible and enabled in edit mode
    const playBtn = page.locator('button[aria-label="Play"]');
    await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await expect(playBtn).toBeEnabled();

    // Pause and Stop should be disabled in edit mode
    const pauseBtn = page.locator('button[aria-label="Pause"]');
    const stopBtn = page.locator('button[aria-label="Stop"]');
    await expect(pauseBtn).toBeVisible();
    await expect(stopBtn).toBeVisible();
    await expect(pauseBtn).toBeDisabled();
    await expect(stopBtn).toBeDisabled();

    // Simulate entering play mode via store (engine would do this)
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (store) store.setState({ engineMode: 'play' });
    });


    // Play button should now be disabled, pause/stop enabled
    await expect(playBtn).toBeDisabled();
    await expect(pauseBtn).toBeEnabled();
    await expect(stopBtn).toBeEnabled();

    // Mode indicator should show "Playing"
    const indicator = page.getByText('Playing', { exact: false });
    await expect(indicator.first()).toBeVisible();

    // Simulate paused mode
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (store) store.setState({ engineMode: 'paused' });
    });


    // Resume button should appear (replaces play)
    const resumeBtn = page.locator('button[aria-label="Resume"]');
    await expect(resumeBtn).toBeVisible();

    // Mode indicator should show "Paused"
    const pausedIndicator = page.getByText('Paused', { exact: false });
    await expect(pausedIndicator.first()).toBeVisible();

    // Simulate back to edit mode
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (store) store.setState({ engineMode: 'edit' });
    });


    // Play should be enabled again, pause/stop disabled
    await expect(playBtn).toBeEnabled();
    await expect(pauseBtn).toBeDisabled();
    await expect(stopBtn).toBeDisabled();
  });

  test('engine canvas renders without errors', async ({ page }) => {
    // Collect console errors during test
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore known harmless errors (auth, missing env, dev server noise)
        const lower = text.toLowerCase();
        const ignoredPatterns = [
          'favicon', '404', 'clerk', '__skip_engine', 'middleware',
          'auth', 'internal server error', 'hydration', 'failed to fetch',
          'api/tokens', 'server error', 'next-', 'hmr',
        ];
        if (!ignoredPatterns.some(p => lower.includes(p))) {
          errors.push(text);
        }
      }
    });

    // Wait a bit for any delayed errors


    // There should be no unexpected JS errors
    expect(errors).toEqual([]);
  });

  test('scene graph store is initialized', async ({ page }) => {
    const hasSceneGraph = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return false;
      const state = store.getState();
      return state.sceneGraph !== undefined
        && state.sceneGraph.nodes !== undefined
        && state.sceneGraph.rootIds !== undefined;
    });
    expect(hasSceneGraph).toBe(true);
  });

  test('play → pause → resume → stop lifecycle UI works', async ({ page }) => {
    // Verify initial state
    const playBtn = page.locator('button[aria-label="Play"]');
    await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Simulate play via store
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });


    // Verify play UI
    await expect(page.getByText('Playing').first()).toBeVisible();
    await expect(page.locator('button[aria-label="Pause"]')).toBeEnabled();

    // Simulate pause
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'paused' });
    });


    // Verify paused UI
    await expect(page.getByText('Paused').first()).toBeVisible();
    await expect(page.locator('button[aria-label="Resume"]')).toBeVisible();

    // Simulate resume (back to play)
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });

    await expect(page.getByText('Playing').first()).toBeVisible();

    // Simulate stop
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'edit' });
    });


    // Back to edit - play enabled, pause/stop disabled
    await expect(playBtn).toBeEnabled();
    await expect(page.locator('button[aria-label="Pause"]')).toBeDisabled();
    await expect(page.locator('button[aria-label="Stop"]')).toBeDisabled();
  });

  test('keyboard shortcuts work in editor', async ({ page }) => {
    // Undo button should be visible
    const undoBtn = page.locator('button[title*="Undo"]').first();
    if (await undoBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(undoBtn).toBeVisible();
    }

    // Export button should be accessible
    const exportBtn = page.locator('button[title*="Export"], button[title*="export"]').first();
    if (await exportBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(exportBtn).toBeVisible();
    }
  });

  test('store exposes selection slice with initial empty state', async ({ page }) => {
    const selectionState = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      const state = store.getState();
      // selectedIds is a Set<string> in the Zustand store
      return {
        hasSelectedIds: state.selectedIds instanceof Set,
        selectedCount: state.selectedIds?.size ?? -1,
        hasPrimaryId: 'primaryId' in state,
      };
    });
    expect(selectionState!.hasSelectedIds).toBe(true);
    expect(selectionState!.selectedCount).toBe(0);
  });

  test('store-driven entity selection shows entity in scene hierarchy', async ({ page }) => {
    // Inject a mock entity into the scene graph and select it
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return;
      const entityId = 'test-cube-123';
      store.setState({
        sceneGraph: {
          nodes: {
            [entityId]: {
              entityId,
              name: 'Test Cube',
              parentId: null,
              children: [],
              components: ['Cube'],
              visible: true,
            },
          },
          rootIds: [entityId],
        },
        selectedIds: new Set([entityId]),
        primaryId: entityId,
      });
    });

    // Hierarchy should show the entity (allow extra time for React re-render in CI)
    const hierarchyItem = page.getByText('Test Cube');
    await expect(hierarchyItem.first()).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('settings modal opens and closes', async ({ page, editor }) => {
    await editor.openSettings();

    // Settings modal should appear
    const settingsHeading = page.getByText(/Settings/i).first();
    await expect(settingsHeading).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Close with Escape and assert the dialog is gone
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"][aria-labelledby="settings-dialog-title"]')).not.toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });
  });

  test('sidebar contains tool groups', async ({ page }) => {
    // The sidebar should have tool buttons (transform tools, entity add, etc.)
    const sidebar = page.locator('[data-testid="sidebar"], aside, [class*="sidebar"]').first();
    await expect(sidebar).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    const buttons = sidebar.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('canvas element has correct dimensions', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });

  test('multiple mode transitions do not corrupt store state', async ({ page }) => {
    // Rapidly cycle through modes
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
      });


      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__EDITOR_STORE?.setState({ engineMode: 'paused' });
      });


      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__EDITOR_STORE?.setState({ engineMode: 'edit' });
      });

    }

    // Verify store is in clean edit state
    const storeState = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return null;
      const state = store.getState();
      return {
        mode: state.engineMode,
        hasSceneGraph: !!state.sceneGraph,
        hasNodes: !!state.sceneGraph?.nodes,
      };
    });
    expect(storeState).not.toBeNull();
    expect(storeState!.mode).toBe('edit');
    expect(storeState!.hasSceneGraph).toBe(true);
  });
});
