import { test, expect } from '../fixtures/editor.fixture';
import { injectStore, readStore } from '../helpers/store-injection';
import {
  E2E_TIMEOUT_SHORT_MS,
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_LOAD_MS,
} from '../constants';

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
 * the one @engine-ui test below, which needs the engine's own scene graph and
 * so runs on the engine gate (test-e2e-engine-smoke) rather than here.
 * Store state is manipulated via injectStore / window.__EDITOR_STORE.setState.
 *
 * Every assertion here is unconditional (#10160). The @ui job builds with
 * NEXT_PUBLIC_E2E_HOOKS, so the stores are on `window`; a test whose subject is
 * missing — injection refused, a node that did not render, a card that did not
 * appear — FAILS on that assertion. The count-guarded and strict-mode-only
 * branches that used to wrap these let every one pass with the subject absent
 * (lessons-learned #11), so a green shard proved nothing about the editor.
 *
 * Every test that injects store state in place of the component it exercises
 * declares that substitution (#10158, e2e/lib/substitution.ts): an annotation
 * `{ type: 'substitution', description }` plus a `[substituted: <component>]`
 * title marker, checked by scripts/check-substitution-naming.ts.
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
    // The Camera is ENGINE-created: nothing puts it in the scene graph but the
    // WASM engine booting. The @ui job has no engine (--disable-gpu, no WASM
    // artefacts), so this test is tagged @engine-ui and runs on the engine
    // gate, where `load()` boots the real engine and the count is real. It
    // used to assert only under E2E_STRICT_STORES, which no job set, so it
    // passed everywhere while checking nothing (#10160).
    await editor.load();
    await editor.waitForEditorStore();

    const nodeCount = () =>
      readStore<number>(
        page,
        '__EDITOR_STORE',
        `Object.keys(window.__EDITOR_STORE.getState().sceneGraph.nodes).length`,
      );
    // `expect.poll` drops its `message` on timeout (Playwright #28129), so the
    // one failure with a different cause — no store at all, i.e. the hooks
    // build is off — is asserted once, up front, where its message is shown.
    // The poll below then waits only for the engine.
    expect(await nodeCount(), 'store read requires the hooks build (NEXT_PUBLIC_E2E_HOOKS)').not.toBeNull();
    await expect
      .poll(nodeCount, {
        message: 'the engine-created Camera never reached sceneGraph.nodes',
        timeout: E2E_TIMEOUT_LOAD_MS,
      })
      .toBeGreaterThanOrEqual(1);

    const hierarchyContent = page.locator('.dv-dockview').first();
    await expect(hierarchyContent).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  test('Camera text appears in the scene hierarchy [substituted: WASM engine]', {
    annotation: { type: 'substitution', description: 'WASM engine' },
  }, async ({ page, editor }) => {
    await editor.waitForEditorStore();

    // Inject a Camera node so CI (which skips WASM) can verify hierarchy rendering
    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      // Only inject if there's no Camera node yet (prevents duplicate if WASM ran)
      const nodes = state?.sceneGraph?.nodes ?? {};
      const hasCamera = Object.values(nodes).some(n => n.name === 'Camera');
      if (!hasCamera) {
        state.addNode({
          entityId: 'e2e-camera-node',
          name: 'Camera',
          parentId: null,
          children: [],
          components: ['Camera3d'],
          visible: true,
        });
      }
    `);

    expect(injected, 'store injection requires the hooks build (NEXT_PUBLIC_E2E_HOOKS)').toBe(true);
    await expect(page.getByText(/Camera/i, { exact: false }).first()).toBeVisible({
      timeout: E2E_TIMEOUT_ELEMENT_MS,
    });
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

  test('AI-created entity appears in scene hierarchy via store injection [substituted: AI generation]', {
    annotation: { type: 'substitution', description: 'AI generation' },
  }, async ({ page, editor }) => {
    await editor.waitForEditorStore();

    // Simulate the AI spawning a game entity
    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      store.getState().addNode({
        entityId: 'ai-player-cube',
        name: 'PlayerCube',
        parentId: null,
        children: [],
        components: ['Mesh3d'],
        visible: true,
      });
    `);

    expect(injected, 'store injection requires the hooks build (NEXT_PUBLIC_E2E_HOOKS)').toBe(true);
    await expect(page.getByText(/PlayerCube/i, { exact: false }).first()).toBeVisible({
      timeout: E2E_TIMEOUT_ELEMENT_MS,
    });
  });

  test('tool call card is visible in chat after AI spawns an entity [substituted: AI generation]', {
    annotation: { type: 'substitution', description: 'AI generation' },
  }, async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const injected = await injectStore(page, '__CHAT_STORE', `
      // The chat store has no append action; a message is added
      // exactly the way streamOneTurn appends one.
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

    // Open chat to reveal messages
    await page.keyboard.press('Control+k');
    await expect(
      page.locator('span').filter({ hasText: /AI Chat/i }).first()
    ).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    expect(injected, 'store injection requires the hooks build (NEXT_PUBLIC_E2E_HOOKS)').toBe(true);
    await expect(page.getByText('Spawn Entity', { exact: false }).first()).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 4. Inspector shows entity properties
  // ---------------------------------------------------------------------------
  test('selecting an entity via store shows inspector panel [substituted: WASM engine] [substituted: hierarchy click]', {
    annotation: [
      { type: 'substitution', description: 'WASM engine' },
      { type: 'substitution', description: 'hierarchy click' },
    ],
  }, async ({ page, editor }) => {
    await editor.waitForEditorStore();

    // Add an entity to the graph and select it
    const added = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      state.addNode({
        entityId: 'e2e-inspect-entity',
        name: 'InspectTarget',
        parentId: null,
        children: [],
        components: ['Mesh3d'],
        visible: true,
      });
    `);

    // Select the entity via store — mirrors what clicking in the hierarchy does.
    // The inspector renders its Transform section from `primaryTransform`,
    // which the ENGINE reports for the selected entity (TRANSFORM_CHANGED);
    // with the engine skipped, the substitute has to supply it too.
    const selected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const state = store?.getState?.();
      state.selectEntity('e2e-inspect-entity', 'replace');
      store.setState({
        primaryTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      });
    `);

    expect(added && selected, 'store injection requires the hooks build (NEXT_PUBLIC_E2E_HOOKS)').toBe(true);
    await expect(page.locator('.dv-dockview').first()).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    // When an entity is selected the inspector shows a Transform section
    await expect(page.getByText('Transform', { exact: true }).first()).toBeVisible({
      timeout: E2E_TIMEOUT_ELEMENT_MS,
    });
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

  test('injecting play mode into store enables pause and stop buttons [substituted: WASM engine]', {
    annotation: { type: 'substitution', description: 'WASM engine' },
  }, async ({ page }) => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });

    await expect(page.locator('button[aria-label="Play"]')).toBeDisabled();
    await expect(page.locator('button[aria-label="Pause"]')).toBeEnabled();
    await expect(page.locator('button[aria-label="Stop"]')).toBeEnabled();
  });

  test('injecting play mode shows Playing indicator [substituted: WASM engine]', {
    annotation: { type: 'substitution', description: 'WASM engine' },
  }, async ({ page }) => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE?.setState({ engineMode: 'play' });
    });

    await expect(page.getByText('Playing').first()).toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });
  });

  test('reverting to edit mode from play restores correct button states [substituted: WASM engine]', {
    annotation: { type: 'substitution', description: 'WASM engine' },
  }, async ({ page }) => {
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

  test('engineMode in store reflects play state after injection [substituted: WASM engine]', {
    annotation: { type: 'substitution', description: 'WASM engine' },
  }, async ({ page, editor }) => {
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

    expect(mode, 'store read requires the hooks build (NEXT_PUBLIC_E2E_HOOKS)').toBe('play');

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
    // SceneToolbar's export control, by its accessible name. The old locator
    // fell back through two count-guarded branches to "the dockview root is
    // present", which is true of every test here (#10160).
    const exportBtn = page.getByRole('button', { name: 'Export game' });
    await expect(exportBtn).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await expect(exportBtn).toBeEnabled();
  });

  test('export dialog opens and renders options from the toolbar button', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    // Driven through the real control, not a store action: the dialog is
    // SceneToolbar's own `showExportDialog` state, and the store has never
    // carried an `openExportDialog` / `setExportDialogOpen`. The old version
    // injected a call to those non-existent actions, "succeeded" because the
    // store existed, and then guarded every assertion on a dialog count that
    // was always zero (#10160).
    await page.getByRole('button', { name: 'Export game' }).click();

    const exportDialog = page.locator('[data-testid="export-dialog"]');
    await expect(exportDialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Export options (format selection) must be present
    expect(await exportDialog.locator('input[type="radio"], select').count()).toBeGreaterThan(0);

    await exportDialog.getByRole('button', { name: 'Close export dialog' }).click();
    await expect(exportDialog).not.toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });

    // The main layout is still intact after the round trip
    await expect(page.locator('.dv-dockview').first()).toBeVisible();
  });
});
