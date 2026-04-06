import { describe, it, expect } from 'vitest';
import { buildSceneContext, type SceneContextStore } from '../sceneContext';
import type { SceneGraph } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(nodes: SceneGraph['nodes'] = {}): SceneGraph {
  return { rootIds: Object.keys(nodes), nodes };
}

function makeNode(
  entityId: string,
  name: string,
  components: string[],
  visible = true,
  parentId: string | null = null,
): SceneGraph['nodes'][string] {
  return { entityId, name, components, visible, parentId, children: [] };
}

function makeStore(overrides: Partial<SceneContextStore> = {}): SceneContextStore {
  return {
    sceneGraph: makeGraph(),
    selectedIds: new Set<string>(),
    ambientLight: { color: [1, 1, 1], brightness: 0.5 },
    environment: {
      clearColor: [0.1, 0.1, 0.2],
      fogEnabled: false,
      skyboxPreset: null,
    },
    engineMode: 'edit',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSceneContext
// ---------------------------------------------------------------------------

describe('buildSceneContext', () => {
  it('returns an empty entities array for an empty scene graph', () => {
    const ctx = buildSceneContext(makeStore());
    expect(ctx.entities).toEqual([]);
  });

  it('maps each scene node to an EntitySummary', () => {
    const store = makeStore({
      sceneGraph: makeGraph({
        e1: makeNode('e1', 'Cube', ['Mesh3d']),
      }),
    });
    const ctx = buildSceneContext(store);
    expect(ctx.entities).toHaveLength(1);
    const entity = ctx.entities[0];
    expect(entity.id).toBe('e1');
    expect(entity.name).toBe('Cube');
    expect(entity.type).toBe('mesh');
    expect(entity.components).toEqual(['Mesh3d']);
    expect(entity.visible).toBe(true);
    expect(entity.parentId).toBeNull();
  });

  it('preserves parentId for child nodes', () => {
    const store = makeStore({
      sceneGraph: makeGraph({
        parent: makeNode('parent', 'Parent', []),
        child: makeNode('child', 'Child', [], false, 'parent'),
      }),
    });
    const ctx = buildSceneContext(store);
    const child = ctx.entities.find((e) => e.id === 'child');
    expect(child?.parentId).toBe('parent');
    expect(child?.visible).toBe(false);
  });

  // ---- Entity type inference ----

  describe('entity type inference', () => {
    const typeTestCases: Array<[string, string]> = [
      ['TerrainEnabled', 'terrain'],
      ['PointLight', 'point_light'],
      ['DirectionalLight', 'directional_light'],
      ['SpotLight', 'spot_light'],
      ['SpriteData', 'sprite'],
      ['Mesh3d', 'mesh'],
    ];

    for (const [component, expectedType] of typeTestCases) {
      it(`infers type "${expectedType}" from component "${component}"`, () => {
        const store = makeStore({
          sceneGraph: makeGraph({
            e1: makeNode('e1', 'Entity', [component]),
          }),
        });
        const ctx = buildSceneContext(store);
        expect(ctx.entities[0].type).toBe(expectedType);
      });
    }

    it('falls back to "entity" for unknown components', () => {
      const store = makeStore({
        sceneGraph: makeGraph({
          e1: makeNode('e1', 'Unknown', ['SomeUnknownComponent']),
        }),
      });
      const ctx = buildSceneContext(store);
      expect(ctx.entities[0].type).toBe('entity');
    });

    it('falls back to "entity" for nodes with no components', () => {
      const store = makeStore({
        sceneGraph: makeGraph({
          e1: makeNode('e1', 'Empty', []),
        }),
      });
      const ctx = buildSceneContext(store);
      expect(ctx.entities[0].type).toBe('entity');
    });

    it('uses first matching rule when node has multiple components', () => {
      // TerrainEnabled wins over Mesh3d because it is checked first in inferEntityType
      const store = makeStore({
        sceneGraph: makeGraph({
          e1: makeNode('e1', 'Multi', ['Mesh3d', 'TerrainEnabled']),
        }),
      });
      const ctx = buildSceneContext(store);
      expect(ctx.entities[0].type).toBe('terrain');
    });
  });

  // ---- selectedIds ----

  it('converts the Set<string> selectedIds to a string array', () => {
    const store = makeStore({
      selectedIds: new Set(['e1', 'e3']),
    });
    const ctx = buildSceneContext(store);
    expect(ctx.selectedIds).toContain('e1');
    expect(ctx.selectedIds).toContain('e3');
    expect(ctx.selectedIds).toHaveLength(2);
  });

  it('returns an empty array for selectedIds when nothing is selected', () => {
    const ctx = buildSceneContext(makeStore());
    expect(ctx.selectedIds).toEqual([]);
  });

  // ---- sceneSettings ----

  it('includes ambientLight in sceneSettings', () => {
    const store = makeStore({
      ambientLight: { color: [0.5, 0.5, 0.5], brightness: 0.8 },
    });
    const ctx = buildSceneContext(store);
    expect(ctx.sceneSettings.ambientLight.color).toEqual([0.5, 0.5, 0.5]);
    expect(ctx.sceneSettings.ambientLight.brightness).toBe(0.8);
  });

  it('includes environment settings in sceneSettings', () => {
    const store = makeStore({
      environment: {
        clearColor: [0.2, 0.3, 0.4],
        fogEnabled: true,
        skyboxPreset: 'sunset',
      },
    });
    const ctx = buildSceneContext(store);
    expect(ctx.sceneSettings.environment.clearColor).toEqual([0.2, 0.3, 0.4]);
    expect(ctx.sceneSettings.environment.fogEnabled).toBe(true);
    expect(ctx.sceneSettings.environment.skyboxPreset).toBe('sunset');
  });

  it('includes engineMode in sceneSettings', () => {
    const store = makeStore({ engineMode: 'play' });
    const ctx = buildSceneContext(store);
    expect(ctx.sceneSettings.engineMode).toBe('play');
  });

  it('handles null skyboxPreset', () => {
    const store = makeStore({
      environment: {
        clearColor: [0, 0, 0],
        fogEnabled: false,
        skyboxPreset: null,
      },
    });
    const ctx = buildSceneContext(store);
    expect(ctx.sceneSettings.environment.skyboxPreset).toBeNull();
  });

  // ---- multi-entity scene ----

  it('processes all entities in a multi-entity scene', () => {
    const store = makeStore({
      sceneGraph: makeGraph({
        a: makeNode('a', 'A', ['PointLight']),
        b: makeNode('b', 'B', ['SpriteData']),
        c: makeNode('c', 'C', [], false, 'a'),
      }),
    });
    const ctx = buildSceneContext(store);
    expect(ctx.entities).toHaveLength(3);
    const types = ctx.entities.map((e) => e.type);
    expect(types).toContain('point_light');
    expect(types).toContain('sprite');
    expect(types).toContain('entity');
  });
});
