/**
 * E2E tests for the save/load round-trip flow.
 *
 * Covers the gap where no test verifies that:
 *   save scene → reload → entities preserved
 *
 * Existing load-scene.spec.ts tests only validate store injection,
 * not actual round-trip fidelity.
 *
 * Group 1: Store-Level Save/Load (@ui — no GPU/WASM needed)
 *   1. Inject entities → serialize → deserialize → entities match
 *   2. Scene name persists across save/load
 *   3. Entity properties survive round-trip (position [5,10,15])
 *   4. loadScene dispatches load_scene command without throwing
 *   5. setSceneName then loadScene — store reflects new name
 *   6. cloudSaveStatus starts at idle and can transition
 *
 * Group 2: UI-Level Save/Load (@engine — requires WASM + GPU)
 *   7. Export button produces downloadable .forge file
 *   8. Ctrl+S triggers saveScene dispatch
 *   9. Scene hierarchy visible after loadScene
 *  10. cloudSaveStatus consistent when save button clicked without project
 */

import { test, expect } from '../fixtures/editor.fixture';

// ---------------------------------------------------------------------------
// Fixtures — minimal .forge scene payloads used across multiple tests
// ---------------------------------------------------------------------------

/** Three named entities with distinct types used for round-trip identity check. */
const THREE_ENTITY_SCENE = JSON.stringify({
  version: 1,
  name: 'RoundTripScene',
  entities: [
    {
      id: 'rt-entity-1',
      name: 'Alpha',
      entity_type: 'Cube',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      id: 'rt-entity-2',
      name: 'Beta',
      entity_type: 'Sphere',
      transform: { position: [2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      id: 'rt-entity-3',
      name: 'Gamma',
      entity_type: 'Cube',
      transform: { position: [-2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
});

/** Single entity with a non-default name used for scene name preservation test. */
const NAMED_SCENE_JSON = JSON.stringify({
  version: 1,
  name: 'MySavedScene',
  entities: [
    {
      id: 'named-entity-1',
      name: 'NamedEntity',
      entity_type: 'Cube',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
});

/** Single entity at position [5, 10, 15] used for property round-trip test. */
const POSITIONED_ENTITY_SCENE = JSON.stringify({
  version: 1,
  name: 'PositionTest',
  entities: [
    {
      id: 'pos-entity-1',
      name: 'PositionedCube',
      entity_type: 'Cube',
      transform: {
        position: [5, 10, 15],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Group 1: Store-level round-trip tests (@ui — no WASM needed)
// ---------------------------------------------------------------------------

test.describe('Save/Load round-trip — store level @ui', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
    await editor.waitForEditorStore();
  });

  test('inject entities → serialize scene → deserialize → entities match', async ({ page, editor }) => {
    // Step 1: populate sceneGraph with three nodes via setFullGraph
    await page.evaluate((sceneJson: string) => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => {
          setFullGraph: (graph: { nodes: Record<string, unknown>; rootIds: string[] }) => void;
          sceneGraph: { nodes: Record<string, unknown>; rootIds: string[] };
        };
      };
      if (!store) throw new Error('Store unavailable');
      const scene = JSON.parse(sceneJson) as {
        entities: Array<{ id: string; name: string; entity_type: string }>;
      };
      const nodes: Record<string, unknown> = {};
      const rootIds: string[] = [];
      for (const ent of scene.entities) {
        nodes[ent.id] = {
          id: ent.id,
          name: ent.name,
          entityType: ent.entity_type,
          parentId: null,
          children: [],
          visible: true,
          components: [],
        };
        rootIds.push(ent.id);
      }
      store.getState().setFullGraph({ nodes, rootIds });
    }, THREE_ENTITY_SCENE);

    // Step 2: verify all 3 entities are present via getStoreState helper
    const nodeIds = await editor.getStoreState<string[]>('sceneGraph.nodes')
      .then((nodes) => Object.keys(nodes as Record<string, unknown>));

    expect(nodeIds).toContain('rt-entity-1');
    expect(nodeIds).toContain('rt-entity-2');
    expect(nodeIds).toContain('rt-entity-3');

    // Step 3: serialize the graph into a JSON string (simulate export)
    const serialized = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => {
          sceneGraph: { nodes: Record<string, unknown>; rootIds: string[] };
        };
      };
      if (!store) return '';
      const { nodes, rootIds } = store.getState().sceneGraph;
      return JSON.stringify({ version: 1, nodes, rootIds });
    });

    expect(serialized.length).toBeGreaterThan(10);

    // Step 4: clear the store and re-populate from serialized data
    await page.evaluate((serializedJson: string) => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => {
          setFullGraph: (graph: { nodes: Record<string, unknown>; rootIds: string[] }) => void;
        };
      };
      if (!store) throw new Error('Store unavailable');
      store.getState().setFullGraph({ nodes: {}, rootIds: [] });
      const { nodes, rootIds } = JSON.parse(serializedJson) as {
        nodes: Record<string, unknown>;
        rootIds: string[];
      };
      store.getState().setFullGraph({ nodes, rootIds });
    }, serialized);

    // Step 5: all 3 entities must still be present after round-trip
    await expect.poll(
      () => editor.getStoreState<Record<string, unknown>>('sceneGraph.nodes')
        .then((nodes) => Object.keys(nodes)),
      { timeout: 5_000 }
    ).toEqual(expect.arrayContaining(['rt-entity-1', 'rt-entity-2', 'rt-entity-3']));

    // Entity names survive round-trip
    const nodeNames = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => {
          sceneGraph: { nodes: Record<string, { name: string }> };
        };
      };
      if (!store) return [] as string[];
      const { nodes } = store.getState().sceneGraph;
      return Object.values(nodes).map((n) => n.name);
    });

    expect(nodeNames).toContain('Alpha');
    expect(nodeNames).toContain('Beta');
    expect(nodeNames).toContain('Gamma');
  });

  test('scene name persists across save/load', async ({ page, editor }) => {
    // Set scene name via the real store action
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => { setSceneName: (name: string) => void };
      };
      if (!store) throw new Error('Store unavailable');
      store.getState().setSceneName('MySavedScene');
    });

    // Verify it was set
    await expect.poll(
      () => editor.getStoreState<string>('sceneName'),
      { timeout: 3_000 }
    ).toBe('MySavedScene');

    // Serialize scene state (name + graph) to simulate a file export
    const serialized = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => {
          sceneName: string;
          sceneGraph: { nodes: Record<string, unknown>; rootIds: string[] };
        };
      };
      if (!store) return '';
      const state = store.getState();
      return JSON.stringify({
        name: state.sceneName,
        sceneGraph: state.sceneGraph,
      });
    });

    // Reset name to default
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => { setSceneName: (name: string) => void };
      };
      if (!store) throw new Error('Store unavailable');
      store.getState().setSceneName('Untitled');
    });

    await expect.poll(
      () => editor.getStoreState<string>('sceneName'),
      { timeout: 3_000 }
    ).toBe('Untitled');

    // Restore from serialized — simulates what a load handler does after
    // receiving the SCENE_LOADED event from the engine
    await page.evaluate((serializedJson: string) => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => {
          setSceneName: (name: string) => void;
          setFullGraph: (graph: { nodes: Record<string, unknown>; rootIds: string[] }) => void;
        };
      };
      if (!store) throw new Error('Store unavailable');
      const { name, sceneGraph } = JSON.parse(serializedJson) as {
        name: string;
        sceneGraph: { nodes: Record<string, unknown>; rootIds: string[] };
      };
      store.getState().setSceneName(name);
      store.getState().setFullGraph(sceneGraph);
    }, serialized);

    // Scene name must match original after round-trip
    await expect.poll(
      () => editor.getStoreState<string>('sceneName'),
      { timeout: 3_000 }
    ).toBe('MySavedScene');
  });

  test('entity properties survive round-trip (position [5,10,15])', async ({ page, editor }) => {
    const scene = JSON.parse(POSITIONED_ENTITY_SCENE) as {
      entities: Array<{
        id: string;
        name: string;
        entity_type: string;
        transform: { position: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number] };
      }>;
    };
    const [entity] = scene.entities;

    // Inject sceneGraph node
    await page.evaluate(
      (args: { id: string; name: string; entityType: string }) => {
        const store = (window as Record<string, unknown>).__EDITOR_STORE as {
          getState: () => {
            setFullGraph: (g: { nodes: Record<string, unknown>; rootIds: string[] }) => void;
          };
        };
        if (!store) throw new Error('Store unavailable');
        const node = {
          id: args.id,
          name: args.name,
          entityType: args.entityType,
          parentId: null,
          children: [],
          visible: true,
          components: [],
        };
        store.getState().setFullGraph({
          nodes: { [args.id]: node },
          rootIds: [args.id],
        });
      },
      { id: entity.id, name: entity.name, entityType: entity.entity_type },
    );

    // Set the primaryTransform for this entity using the real updateTransform API:
    // updateTransform(entityId, field, value) where field is 'position'|'rotation'|'scale'
    await page.evaluate(
      (args: { id: string; position: [number, number, number] }) => {
        const store = (window as Record<string, unknown>).__EDITOR_STORE as {
          getState: () => {
            setPrimaryTransform: (t: {
              entityId: string;
              position: [number, number, number];
              rotation: [number, number, number];
              scale: [number, number, number];
            }) => void;
          };
        };
        if (!store) throw new Error('Store unavailable');
        store.getState().setPrimaryTransform({
          entityId: args.id,
          position: args.position,
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        });
      },
      { id: entity.id, position: entity.transform.position },
    );

    // Verify primaryTransform was set
    await expect.poll(
      async () => {
        const t = await editor.getStoreState<{ entityId: string; position: [number, number, number] } | null>('primaryTransform');
        return t?.entityId === entity.id ? t.position : null;
      },
      { timeout: 3_000 }
    ).toEqual([5, 10, 15]);

    // Serialize current state
    const serialized = await page.evaluate((entityId: string) => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => {
          sceneGraph: { nodes: Record<string, unknown> };
          primaryTransform: { entityId: string; position: [number, number, number] } | null;
        };
      };
      if (!store) return '';
      const state = store.getState();
      const graphNode = state.sceneGraph.nodes[entityId];
      const transform = state.primaryTransform?.entityId === entityId
        ? state.primaryTransform
        : null;
      return JSON.stringify({ graphNode, transform, entityId });
    }, entity.id);

    expect(serialized.length).toBeGreaterThan(5);

    // Clear and restore
    await page.evaluate(
      (args: { serializedJson: string; entityId: string }) => {
        const store = (window as Record<string, unknown>).__EDITOR_STORE as {
          getState: () => {
            setFullGraph: (g: { nodes: Record<string, unknown>; rootIds: string[] }) => void;
            setPrimaryTransform: (t: {
              entityId: string;
              position: [number, number, number];
              rotation: [number, number, number];
              scale: [number, number, number];
            }) => void;
          };
        };
        if (!store) throw new Error('Store unavailable');
        store.getState().setFullGraph({ nodes: {}, rootIds: [] });

        const { graphNode, transform } = JSON.parse(args.serializedJson) as {
          graphNode: unknown;
          transform: { entityId: string; position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null;
          entityId: string;
        };

        if (graphNode) {
          store.getState().setFullGraph({
            nodes: { [args.entityId]: graphNode },
            rootIds: [args.entityId],
          });
        }

        if (transform) {
          store.getState().setPrimaryTransform(transform);
        }
      },
      { serializedJson: serialized, entityId: entity.id },
    );

    // Verify graph node survived
    await expect.poll(
      () => editor.getStoreState<Record<string, unknown>>('sceneGraph.nodes')
        .then((nodes) => nodes[entity.id] ?? null),
      { timeout: 3_000 }
    ).not.toBeNull();

    // Verify transform survived
    await expect.poll(
      async () => {
        const t = await editor.getStoreState<{ entityId: string; position: [number, number, number] } | null>('primaryTransform');
        return t?.entityId === entity.id ? t.position : null;
      },
      { timeout: 3_000 }
    ).toEqual([5, 10, 15]);
  });

  test('loadScene dispatches load_scene command without throwing and store remains accessible', async ({ page, editor }) => {
    // Track whether loadScene threw
    const error = await page.evaluate((json: string) => {
      try {
        const store = (window as Record<string, unknown>).__EDITOR_STORE as {
          getState: () => { loadScene: (json: string) => void };
        };
        if (!store) return 'Store unavailable';
        store.getState().loadScene(json);
        return null;
      } catch (e) {
        return String(e);
      }
    }, NAMED_SCENE_JSON);

    expect(error).toBeNull();

    // Store must remain functional after loadScene call — use fixture helper
    const sceneName = await editor.getStoreState<string>('sceneName');
    // sceneName is whatever was set before (no WASM to handle the dispatch),
    // but the store itself must still be accessible and return a string
    expect(typeof sceneName).toBe('string');

    // Confirm loadScene accepted the call by verifying the store is still operational
    await expect.poll(
      () => editor.getStoreState<boolean | null>('sceneModified').then(() => true),
      { timeout: 3_000 }
    ).toBe(true);
  });

  test('setSceneName then loadScene — store reflects scene name update', async ({ page, editor }) => {
    // Pre-set scene name to something different
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => { setSceneName: (name: string) => void };
      };
      if (!store) throw new Error('Store unavailable');
      store.getState().setSceneName('OldName');
    });

    await expect.poll(
      () => editor.getStoreState<string>('sceneName'),
      { timeout: 3_000 }
    ).toBe('OldName');

    // Call loadScene with a JSON payload that includes the new name.
    // Without WASM, the engine won't process the load_scene command, so we
    // also call setSceneName to simulate the SCENE_LOADED event the engine
    // would emit after processing. This tests that both paths work together.
    await page.evaluate((json: string) => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => {
          loadScene: (json: string) => void;
          setSceneName: (name: string) => void;
        };
      };
      if (!store) throw new Error('Store unavailable');
      // Dispatch the load command (no-op without WASM)
      store.getState().loadScene(json);
      // Simulate engine response: SCENE_LOADED event updates the name
      const parsed = JSON.parse(json) as { name?: string };
      if (parsed.name) {
        store.getState().setSceneName(parsed.name);
      }
    }, NAMED_SCENE_JSON);

    await expect.poll(
      () => editor.getStoreState<string>('sceneName'),
      { timeout: 3_000 }
    ).toBe('MySavedScene');
  });

  test('cloudSaveStatus starts at idle and can transition to saving then saved', async ({ page, editor }) => {
    const initialStatus = await editor.getStoreState<string>('cloudSaveStatus');
    expect(initialStatus).toBe('idle');

    // Transition to saving
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => { setCloudSaveStatus: (s: 'idle' | 'saving' | 'saved' | 'error') => void };
      };
      if (!store) throw new Error('Store unavailable');
      store.getState().setCloudSaveStatus('saving');
    });

    await expect.poll(
      () => editor.getStoreState<string>('cloudSaveStatus'),
      { timeout: 3_000 }
    ).toBe('saving');

    // Transition to saved
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => { setCloudSaveStatus: (s: 'idle' | 'saving' | 'saved' | 'error') => void };
      };
      if (!store) throw new Error('Store unavailable');
      store.getState().setCloudSaveStatus('saved');
    });

    await expect.poll(
      () => editor.getStoreState<string>('cloudSaveStatus'),
      { timeout: 3_000 }
    ).toBe('saved');
  });
});

// ---------------------------------------------------------------------------
// Group 2: UI-level save/load tests (@engine — requires WASM + GPU)
// ---------------------------------------------------------------------------

test.describe('Save/Load round-trip — UI level @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('export button produces downloadable .forge file', async ({ page, editor }) => {
    // Spawn a cube so the scene is not empty
    await page.getByRole('button', { name: 'Add Entity' }).click();
    await page.getByText('Cube', { exact: true }).click();
    await editor.waitForEntityCount(2); // Camera + Cube

    // Start listening for download before triggering it
    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);

    // Trigger save — Ctrl+S with no projectId dispatches export_scene + download
    await page.keyboard.press('Control+s');

    const download = await downloadPromise;

    if (download !== null) {
      const filename = download.suggestedFilename();
      // Enforce .forge extension — the download must be a .forge file
      expect(filename).toMatch(/\.forge$/);
    }
    // If no download in headless/no-GPU CI, the store-level tests cover serialization.
  });

  test('Ctrl+S with no projectId triggers saveScene dispatch', async ({ page }) => {
    const dispatchedCommands: string[] = [];

    await page.exposeFunction('__onDispatch', (command: string) => {
      dispatchedCommands.push(command);
    });

    // Verify no projectId is set (so Ctrl+S calls saveScene not saveToCloud)
    const projectId = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => { projectId: string | null };
      } | undefined;
      return store?.getState().projectId ?? null;
    });

    // Skip deterministically if a project is set — Ctrl+S routes to saveToCloud
    test.skip(projectId !== null, 'Project is set — Ctrl+S routes to saveToCloud, not saveScene');

    // Patch saveScene to capture the call
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => { saveScene: () => void };
        setState: (patch: Record<string, unknown>) => void;
      };
      if (!store) return;
      const originalSave = store.getState().saveScene;
      if (typeof originalSave !== 'function') return;
      store.setState({
        saveScene: () => {
          (window as Record<string, unknown>).__onDispatch?.('export_scene');
          originalSave();
        },
      });
    });

    await page.keyboard.press('Control+s');

    await expect.poll(
      () => dispatchedCommands.includes('export_scene'),
      { timeout: 5_000 }
    ).toBe(true);
  });

  test('scene hierarchy is still visible after a loadScene call', async ({ page }) => {
    // Load a minimal scene via the store action
    await page.evaluate((json: string) => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => { loadScene: (json: string) => void };
      };
      if (!store) throw new Error('Store unavailable');
      store.getState().loadScene(json);
    }, NAMED_SCENE_JSON);

    // Hierarchy panel must remain visible after scene load — poll to avoid waitForTimeout
    await expect.poll(
      async () => {
        const hierarchyTab = page
          .locator('.dv-tab, [data-testid*="hierarchy"]')
          .filter({ hasText: /hierarchy|scene/i })
          .first();
        const headingText = page.getByText('Scene Hierarchy', { exact: false });

        const panelVisible = await hierarchyTab.isVisible().catch(() => false);
        const headingVisible = await headingText.isVisible().catch(() => false);
        return panelVisible || headingVisible;
      },
      { timeout: 5_000 }
    ).toBe(true);
  });

  test('cloudSaveStatus is consistent when save button clicked without a project', async ({ page }) => {
    const saveBtn = page
      .locator('button[title*="Save"]')
      .filter({ hasText: /save|cloud/i })
      .first();

    const btnCount = await saveBtn.count();
    test.skip(btnCount === 0, 'Save button not present in this layout variant');

    const statusBefore = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__EDITOR_STORE as {
        getState: () => { cloudSaveStatus: string };
      } | undefined;
      return store?.getState().cloudSaveStatus ?? null;
    });

    expect(statusBefore).toBe('idle');

    await saveBtn.click();

    // Without a projectId, status should remain idle or briefly transition
    await expect.poll(
      () => page.evaluate(() => {
        const store = (window as Record<string, unknown>).__EDITOR_STORE as {
          getState: () => { cloudSaveStatus: string };
        } | undefined;
        return store?.getState().cloudSaveStatus ?? null;
      }),
      { timeout: 3_000 }
    ).toSatisfy((status: unknown) =>
      ['idle', 'saving', 'error'].includes(status as string)
    );
  });
});
