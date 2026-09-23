import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/editor.fixture';
import { injectStore, readStore } from '../helpers/store-injection';
import {
  E2E_TIMEOUT_SHORT_MS,
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_LOAD_MS,
} from '../constants';

/**
 * Why an injection can come back false: `injectStore` returns false (outside
 * E2E_STRICT_STORES) when the store is not on window, which only happens in a
 * build without the E2E hooks. Every injected subject below is asserted
 * unconditionally (#10160), so that case fails here instead of passing.
 */
const HOOKS_BUILD_REQUIRED =
  'is not on window: run against `next dev` or a NEXT_PUBLIC_E2E_HOOKS=true build';

/** One row of the Scene hierarchy tree, by exact entity name (SceneNode sets aria-label={node.name}). */
function hierarchyRow(page: Page, name: string) {
  return page
    .getByRole('tree', { name: 'Scene hierarchy' })
    .getByRole('treeitem', { name, exact: true });
}

/** Shape of the editor store this file reads through `page.evaluate`. */
type EditorStoreHandle = {
  __EDITOR_STORE: {
    getState: () => { sceneGraph: { nodes: Record<string, { name: string }> } };
  };
};

/**
 * Game Creation E2E Proof — exercises the full user journey through the editor.
 *
 * This test suite proves that SpawnForge works end-to-end:
 * 1. Editor loads and the layout renders
 * 2. Scene hierarchy is populated (Camera entity present)
 * 3. AI chat can create entities (via store injection)
 * 4. Inspector shows entity properties when an entity is selected
 * 5. Play mode starts and stops correctly
 * 6. Export dialog opens and renders export options
 *
 * All tests use loadPage() (not load()) so no WASM build is required, except
 * the ones tagged @engine-ui: they need the real engine and run in
 * test-e2e-engine-smoke, never in the @ui job.
 * Store state is manipulated via injectStore / window.__EDITOR_STORE.setState.
 */
test.describe('Game Creation Flow @ui @dev', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  // ---------------------------------------------------------------------------
  // 1. Editor loads
  // ---------------------------------------------------------------------------
  test('editor layout renders without fatal errors', async ({ page }) => {
    // Collect JS errors before the page was fully loaded
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => {
      jsErrors.push(err.message);
    });

    // The dockview container is the canonical marker that EditorLayout mounted
    const container = page.locator('.dv-dockview').first();
    await expect(container).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    // No fatal JS errors during boot
    expect(jsErrors, `Unexpected JS errors: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('editor boots without console errors @engine-ui', async ({ page, editor }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Reload fresh so the listener captures everything from navigation start
    await editor.load();

    // Filter out known benign browser noise (extensions, CSP, Clerk 401 in CI)
    const appErrors = consoleErrors.filter(
      (msg) =>
        !msg.includes('favicon') &&
        !msg.includes('chrome-extension') &&
        !msg.includes('moz-extension') &&
        !msg.includes('Content Security Policy') &&
        !msg.includes('401 (Unauthorized)') &&
        !msg.includes('Failed to load resource'),
    );

    expect(appErrors, `Console errors: ${appErrors.join('\n')}`).toHaveLength(0);
  });

  test('editor store is available after hydration', async ({ editor }) => {
    // __EDITOR_STORE is set in EditorLayout on mount
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);
  });

  // ---------------------------------------------------------------------------
  // 2. Scene hierarchy is populated
  // ---------------------------------------------------------------------------
  test('scene hierarchy panel is visible after boot', async ({ page }) => {
    // SceneHierarchy panel is always rendered as part of the dockview layout
    const hierarchyPanel = page.locator('.dv-dockview').first();
    await expect(hierarchyPanel).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
  });

  test('scene graph contains at least a Camera node @engine-ui', async ({ page, editor }) => {
    // The Camera is spawned by the engine's startup scene ("Main Camera",
    // engine/src/core/scene.rs) and reaches the store only through
    // SCENE_GRAPH_UPDATE. The @ui job has no WASM and launches --disable-gpu,
    // so this runs in test-e2e-engine-smoke. Nothing is injected here: every
    // node counted below was created by the engine.
    await editor.load();
    await editor.waitForEntityCount(1);

    const nodeNames = await page.evaluate(() =>
      Object.values(
        (window as unknown as EditorStoreHandle).__EDITOR_STORE.getState().sceneGraph.nodes,
      ).map((node) => node.name),
    );
    expect(nodeNames.length).toBeGreaterThanOrEqual(1);
    expect(nodeNames).toContainEqual(expect.stringMatching(/Camera/));
  });

  test('Camera text appears in the scene hierarchy', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    // Inject a Camera node so CI (which skips WASM) can verify hierarchy rendering.
    // The node must have the store's SceneNode shape (sceneGraphSlice.addNode):
    // SceneNode reads `children.length`, and the old `{ id, childIds }` payload
    // crashed the editor to its error page. No `typeof` guard: a missing action
    // must throw here, not skip silently.
    const injected = await injectStore(page, '__EDITOR_STORE', `
      window.__EDITOR_STORE.getState().addNode({
        entityId: 'e2e-camera-node',
        name: 'Camera',
        parentId: null,
        children: [],
        components: [],
        visible: true,
      });
    `);
    expect(injected, `__EDITOR_STORE ${HOOKS_BUILD_REQUIRED}`).toBe(true);

    await expect(hierarchyRow(page, 'Camera')).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  // ---------------------------------------------------------------------------
  // 3. AI chat creates entities via store injection
  // ---------------------------------------------------------------------------
  test('Ctrl+K opens the chat panel', async ({ page }) => {
    await page.keyboard.press('Control+k');

    // Chat input should become visible
    const chatInput = page.getByRole('textbox', { name: 'Chat message' });
    await expect(chatInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('AI-created entity appears in scene hierarchy via store injection', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    // Simulate the AI spawning a game entity (SceneNode shape, as above)
    const injected = await injectStore(page, '__EDITOR_STORE', `
      window.__EDITOR_STORE.getState().addNode({
        entityId: 'ai-player-cube',
        name: 'PlayerCube',
        parentId: null,
        children: [],
        components: ['Mesh3d'],
        visible: true,
      });
    `);
    expect(injected, `__EDITOR_STORE ${HOOKS_BUILD_REQUIRED}`).toBe(true);

    await expect(hierarchyRow(page, 'PlayerCube')).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('tool call card is visible in chat after AI spawns an entity', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    // chatStore has no addMessage action (the old call here was a silent no-op
    // and the chat stayed empty), so append through the store's own setState.
    const injected = await injectStore(page, '__CHAT_STORE', `
      window.__CHAT_STORE.setState((s) => ({
        messages: [...s.messages, {
          id: 'e2e-spawn-msg',
          role: 'assistant',
          content: 'I created a player cube for your game.',
          toolCalls: [{
            id: 'e2e-tc-spawn',
            name: 'spawn_entity',
            input: { entityType: 'cube', name: 'PlayerCube' },
            status: 'success',
            undoable: true,
          }],
          timestamp: Date.now(),
        }],
      }));
    `);
    expect(injected, `__CHAT_STORE ${HOOKS_BUILD_REQUIRED}`).toBe(true);

    // Open chat to reveal messages
    await page.keyboard.press('Control+k');
    await expect(
      page.locator('span').filter({ hasText: /AI Chat/i }).first()
    ).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // ToolCallCard's label for spawn_entity, inside the chat transcript.
    await expect(
      page.locator('[aria-label="Chat messages"]').getByText('Spawn Entity', { exact: true }),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 4. Inspector shows entity properties
  // ---------------------------------------------------------------------------
  test('selecting an entity via store shows inspector panel', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    // Add an entity to the graph (SceneNode shape, as above)
    const added = await injectStore(page, '__EDITOR_STORE', `
      window.__EDITOR_STORE.getState().addNode({
        entityId: 'e2e-inspect-entity',
        name: 'InspectTarget',
        parentId: null,
        children: [],
        components: ['Mesh3d'],
        visible: true,
      });
    `);
    expect(added, `__EDITOR_STORE ${HOOKS_BUILD_REQUIRED}`).toBe(true);

    // Select the entity via store — mirrors what clicking in the hierarchy does.
    // selectEntity takes a mode; without one its switch matches nothing and
    // the selection never changes. The engine answers a selection with
    // TRANSFORM_CHANGED (transformEvents.ts -> setPrimaryTransform), and this
    // job has no engine, so the test delivers that event's payload itself —
    // the Inspector renders no Transform section without it.
    await injectStore(page, '__EDITOR_STORE', `
      const state = window.__EDITOR_STORE.getState();
      state.selectEntity('e2e-inspect-entity', 'replace');
      state.setPrimaryTransform({
        entityId: 'e2e-inspect-entity',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      });
    `);

    const inspector = page.getByRole('region', { name: 'Inspector' });
    await expect(inspector.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'InspectTarget',
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );
    // Rendered only inside the Transform section's header.
    await expect(inspector.getByRole('button', { name: 'Copy transform', exact: true })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 5. Play mode works
  // ---------------------------------------------------------------------------
  test('play controls are rendered in initial edit state', async ({ page }) => {
    const playBtn = page.locator('button[aria-label="Play"]');
    const pauseBtn = page.locator('button[aria-label="Pause"]');
    const stopBtn = page.locator('button[aria-label="Stop"]');

    await expect(playBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await expect(playBtn).toBeEnabled();
    await expect(pauseBtn).toBeDisabled();
    await expect(stopBtn).toBeDisabled();
  });

  test('injecting play mode into store enables pause and stop buttons', async ({ page }) => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });

    await expect(page.locator('button[aria-label="Play"]')).toBeDisabled();
    await expect(page.locator('button[aria-label="Pause"]')).toBeEnabled();
    await expect(page.locator('button[aria-label="Stop"]')).toBeEnabled();
  });

  test('injecting play mode shows Playing indicator', async ({ page }) => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });

    await expect(page.getByText('Playing').first()).toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });
  });

  test('reverting to edit mode from play restores correct button states', async ({ page }) => {
    // Set play, then revert to edit
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'edit' });
    });

    await expect(page.locator('button[aria-label="Play"]')).toBeEnabled();
    await expect(page.locator('button[aria-label="Pause"]')).toBeDisabled();
    await expect(page.locator('button[aria-label="Stop"]')).toBeDisabled();
  });

  test('engineMode in store reflects play state after injection', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });

    const mode = await readStore<string>(
      page,
      '__EDITOR_STORE',
      `window.__EDITOR_STORE?.getState?.()?.engineMode ?? null`,
    );

    expect(mode).toBe('play');

    // Restore to edit for subsequent tests
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'edit' });
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Export dialog opens
  // ---------------------------------------------------------------------------
  test('export button is present in the toolbar', async ({ page }) => {
    // SceneToolbar's Export button: an icon with aria-label="Export game" and no text.
    const exportBtn = page.getByRole('button', { name: 'Export game', exact: true });
    await expect(exportBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await expect(exportBtn).toBeEnabled();
  });

  test('export dialog opens from the toolbar and renders options', async ({ page }) => {
    // No store action opens this dialog: SceneToolbar holds it in local state,
    // and the openExportDialog / setExportDialogOpen calls this test used to
    // make never existed. Drive the real toolbar button instead.
    const exportBtn = page.getByRole('button', { name: 'Export game', exact: true });
    await expect(exportBtn).toBeEnabled({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await exportBtn.click();

    const exportDialog = page.getByRole('dialog', { name: 'Export Game' });
    await expect(exportDialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Export options (format selection) must be present
    await expect(exportDialog.getByRole('radio', { name: 'Single HTML File' })).toBeVisible();
    await expect(exportDialog.getByRole('radio', { name: /ZIP Bundle/ })).toBeVisible();

    // Close the dialog
    await exportDialog.getByRole('button', { name: 'Close export dialog', exact: true }).click();
    await expect(exportDialog).toBeHidden({ timeout: E2E_TIMEOUT_SHORT_MS });

    // The main layout must still be intact
    await expect(page.locator('.dv-dockview').first()).toBeVisible();
  });
});
