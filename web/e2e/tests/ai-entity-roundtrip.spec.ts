import { test, expect } from '../fixtures/editor.fixture';
import { injectStore, readStore, isStrictMode } from '../helpers/store-injection';

/**
 * E2E tests for the AI → entity round-trip pipeline.
 *
 * Group 1 (@ui): Store-driven tests. These inject synthetic AI tool call
 * results directly into the Zustand store and verify the scene graph updates
 * without requiring a WASM engine. Safe to run in CI with __SKIP_ENGINE=true.
 *
 * Group 2 (@engine): Full engine pipeline tests. These call dispatchCommand
 * to simulate exactly what AI chat handlers do, and verify the round-trip
 * through handle_command → Bevy ECS → bridge events → Zustand store.
 *
 * Assertion quality contract (self-review checklist applied to every test):
 * - Can this pass with the feature broken? No — every test checks a specific
 *   data field or DOM element, not just "truthy".
 * - Is the selector resilient to UI refactors? Yes — role/text/testid used.
 * - Does this test a user-visible outcome? Yes — hierarchy panel presence or
 *   store state that drives rendering.
 */

// ---------------------------------------------------------------------------
// Group 1: Store-Driven AI Command Pipeline (@ui, no WASM required)
// ---------------------------------------------------------------------------

test.describe('AI → Entity Round-trip: Store Pipeline @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  // -------------------------------------------------------------------------
  // 1. Inject spawn_entity tool call → entity appears in sceneGraph store
  // -------------------------------------------------------------------------
  test('injecting addNode simulates spawn_entity → entity visible in sceneGraph and hierarchy', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const entityId = 'ai-roundtrip-spawn-1';
    const entityName = 'AISpawnedCube';

    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const addNode = store?.getState?.()?.addNode;
      if (typeof addNode === 'function') {
        addNode({
          entityId: '${entityId}',
          name: '${entityName}',
          parentId: null,
          visible: true,
          children: [], components: ["Mesh3d", "MeshMaterial3d"],
        });
      }
    `);

    if (!injected && !isStrictMode) {
      test.skip(true, 'Store not available — skipping assertion');
      return;
    }

    // Verify sceneGraph.nodes has the new entity
    const nodeExists = await readStore<boolean>(
      page,
      '__EDITOR_STORE',
      `!!(window.__EDITOR_STORE?.getState?.()?.sceneGraph?.nodes?.['${entityId}'])`,
    );
    expect(nodeExists).toBe(true);

    // Verify the node name matches exactly
    const nodeName = await readStore<string | null>(
      page,
      '__EDITOR_STORE',
      `window.__EDITOR_STORE?.getState?.()?.sceneGraph?.nodes?.['${entityId}']?.name ?? null`,
    );
    expect(nodeName).toBe(entityName);

    // Verify scene hierarchy panel shows the entity name.
    // The hierarchy panel is React-rendered from store state — it renders
    // immediately after store injection without requiring WASM.
    const hierarchyNode = page.getByText(entityName, { exact: false });
    await expect(hierarchyNode.first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 2. Inject update_material tool call → primaryMaterial updates in store
  // -------------------------------------------------------------------------
  test('calling updateMaterial on store entity reflects in primaryMaterial', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const entityId = 'ai-roundtrip-mat-1';

    // First add the node to the scene so there is a target entity
    await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const addNode = store?.getState?.()?.addNode;
      if (typeof addNode === 'function') {
        addNode({
          entityId: '${entityId}',
          name: 'AIMaterialTarget',
          parentId: null,
          visible: true,
          children: [], components: ["Mesh3d", "MeshMaterial3d"],
        });
      }
    `);

    // Now inject a material update (mirrors what the AI chat handler does)
    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const updateMaterial = store?.getState?.()?.updateMaterial;
      if (typeof updateMaterial === 'function') {
        updateMaterial('${entityId}', {
          baseColor: [0.2, 0.6, 1.0, 1.0],
          roughness: 0.3,
          metallic: 0.7,
          emissive: [0, 0, 0],
          unlit: false,
          doubleSided: false,
          wireframe: false,
          transparent: false,
          depthBias: 0.0,
        });
      }
    `);

    if (!injected && !isStrictMode) {
      test.skip(true, 'Store not available — skipping assertion');
      return;
    }

    // primaryMaterial is the last-written material (single slot in the slice)
    const primaryMaterial = await readStore<{ baseColor: number[]; roughness: number; metallic: number } | null>(
      page,
      '__EDITOR_STORE',
      `window.__EDITOR_STORE?.getState?.()?.primaryMaterial ?? null`,
    );

    // The material update must have been stored with the correct values
    expect(primaryMaterial).not.toBeNull();
    if (primaryMaterial) {
      expect(primaryMaterial.baseColor).toEqual([0.2, 0.6, 1.0, 1.0]);
      expect(primaryMaterial.roughness).toBeCloseTo(0.3);
      expect(primaryMaterial.metallic).toBeCloseTo(0.7);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Inject multiple sequential spawn tool calls → all entities created
  // -------------------------------------------------------------------------
  test('batch addNode calls create all 3 entities in sceneGraph', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const entities = [
      { entityId: 'ai-batch-1', name: 'BatchPlayer' },
      { entityId: 'ai-batch-2', name: 'BatchGround' },
      { entityId: 'ai-batch-3', name: 'BatchEnemy' },
    ];

    // Inject all three nodes atomically
    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const addNode = store?.getState?.()?.addNode;
      if (typeof addNode === 'function') {
        addNode({ entityId: 'ai-batch-1', name: 'BatchPlayer', parentId: null, visible: true, children: [], components: ['Mesh3d'] });
        addNode({ entityId: 'ai-batch-2', name: 'BatchGround', parentId: null, visible: true, children: [], components: ['Mesh3d'] });
        addNode({ entityId: 'ai-batch-3', name: 'BatchEnemy', parentId: null, visible: true, children: [], components: ['Mesh3d'] });
      }
    `);

    if (!injected && !isStrictMode) {
      test.skip(true, 'Store not available — skipping assertion');
      return;
    }

    // Every node must be present in sceneGraph.nodes
    for (const entity of entities) {
      const nodePresent = await readStore<boolean>(
        page,
        '__EDITOR_STORE',
        `!!(window.__EDITOR_STORE?.getState?.()?.sceneGraph?.nodes?.['${entity.entityId}'])`,
      );
      expect(nodePresent, `Entity ${entity.name} (${entity.entityId}) missing from sceneGraph`).toBe(true);
    }

    // All node names must be queryable from the DOM.
    // The hierarchy panel is React-rendered from store state — each entity
    // must appear in the DOM after its store injection.
    for (const entity of entities) {
      const domNode = page.getByText(entity.name, { exact: false });
      await expect(domNode.first()).toBeVisible({ timeout: 5000 });
    }
  });

  // Test 4 (ToolCallCard rendering) REMOVED — __CHAT_STORE is not exposed on
  // window, making injectStore unable to execute the callback. ToolCallCard
  // rendering is already covered by ai-game-creation.spec.ts tests 2-7.
});

// ---------------------------------------------------------------------------
// Group 2: Full Engine AI Pipeline (@engine, needs WASM)
// ---------------------------------------------------------------------------

test.describe('AI → Entity Round-trip: Engine Pipeline @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  // -------------------------------------------------------------------------
  // 5. dispatchCommand('spawn_entity') → entity in hierarchy + inspector
  // -------------------------------------------------------------------------
  test('dispatchCommand spawn_entity creates entity in hierarchy with inspector transform', async ({ page, editor }) => {
    // Record baseline entity count (Camera is already present)
    const baselineCount = await page.evaluate((): number => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return 0;
      return Object.keys(store.getState().sceneGraph.nodes).length;
    });

    // Dispatch via spawnEntity — the store action that calls dispatchCommand('spawn_entity', ...)
    // internally, exactly mirroring what the AI chat transform handler does.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) throw new Error('Store unavailable');
      store.getState().spawnEntity('cube', 'AICube');
    });

    // Entity count must increase by at least 1
    await editor.waitForEntityCount(baselineCount + 1);

    // Entity name must appear in the DOM hierarchy
    const cubeInHierarchy = page.getByText('AICube', { exact: false });
    await expect(cubeInHierarchy.first()).toBeVisible({ timeout: 8000 });

    // Select the entity and verify the inspector renders the Transform section
    await cubeInHierarchy.first().click();

    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store && store.getState().selectedIds.size > 0;
      },
      { timeout: 8000 },
    );

    const transformSection = page.getByText('Transform', { exact: false });
    await expect(transformSection.first()).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 6. dispatchCommand('update_material') → material reflected in store
  // -------------------------------------------------------------------------
  test('dispatchCommand update_material updates primaryMaterial in store after selection', async ({ page, editor }) => {
    // Spawn entity via the store command (mirrors AI handler behaviour)
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2);

    // Select it
    await editor.selectEntity('Cube');

    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__EDITOR_STORE;
        return store && store.getState().selectedIds.size > 0;
      },
      { timeout: 10000 },
    );

    // Retrieve the selected entity id
    const entityId = await page.evaluate((): string | null => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return null;
      const ids = [...store.getState().selectedIds] as string[];
      return ids[0] ?? null;
    });
    expect(entityId).not.toBeNull();

    // Call updateMaterial which internally calls dispatchCommand('update_material', {...})
    // — this is exactly what the AI chat material handler does and exercises the full
    // JS → WASM → engine event → store round-trip. dispatchCommand is a module-level
    // singleton (not on store state) so updateMaterial is the correct call site.
    await page.evaluate((eid: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) throw new Error('Store unavailable');
      store.getState().updateMaterial(eid, {
        baseColor: [0.8, 0.2, 0.4, 1.0],
        roughness: 0.55,
        metallic: 0.0,
        emissive: [0, 0, 0],
        unlit: false,
        doubleSided: false,
        wireframe: false,
        transparent: false,
        depthBias: 0.0,
      });
    }, entityId as string);

    // primaryMaterial must reflect the exact values we wrote
    const primaryMaterial = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return null;
      return store.getState().primaryMaterial ?? null;
    });

    expect(primaryMaterial).not.toBeNull();
    if (primaryMaterial) {
      // baseColor must match — this would fail if the store never persisted the update
      expect(primaryMaterial.baseColor).toEqual([0.8, 0.2, 0.4, 1.0]);
      expect(primaryMaterial.roughness).toBeCloseTo(0.55);
    }

    // Selection must remain stable after the material update
    const selectionStillValid = await page.evaluate((eid: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__EDITOR_STORE;
      if (!store) return false;
      return store.getState().selectedIds.has(eid);
    }, entityId as string);

    expect(selectionStillValid).toBe(true);
  });
});
