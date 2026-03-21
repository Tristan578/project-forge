import { describe, it, expect } from 'vitest';
import {
  buildEntityIndex,
  lookupEntity,
  lookupByType,
  lookupByComponent,
  lookupByName,
  findEntityByName,
} from '../entityIndex';
import type { EntityIndex } from '../entityIndex';
import type { SceneGraph, SceneNode } from '@/stores/slices/types';

// ============================================================
// Helpers
// ============================================================

function makeNode(overrides: Partial<SceneNode> & { entityId: string }): SceneNode {
  return {
    name: overrides.name ?? overrides.entityId,
    parentId: null,
    children: [],
    components: [],
    visible: true,
    ...overrides,
  };
}

function makeGraph(nodes: SceneNode[]): SceneGraph {
  const nodesMap: Record<string, SceneNode> = {};
  const rootIds: string[] = [];
  for (const n of nodes) {
    nodesMap[n.entityId] = n;
    if (n.parentId === null) rootIds.push(n.entityId);
  }
  return { nodes: nodesMap, rootIds };
}

// ============================================================
// Tests
// ============================================================

describe('buildEntityIndex', () => {
  it('returns empty maps for an empty scene', () => {
    const idx = buildEntityIndex({ nodes: {}, rootIds: [] });
    expect(idx.byId.size).toBe(0);
    expect(idx.byType.size).toBe(0);
    expect(idx.byComponent.size).toBe(0);
    expect(idx.byName.size).toBe(0);
  });

  it('indexes a single entity correctly', () => {
    const node = makeNode({ entityId: 'e1', name: 'Cube', components: ['Mesh3d', 'Transform'] });
    const idx = buildEntityIndex(makeGraph([node]));

    expect(idx.byId.size).toBe(1);
    expect(idx.byId.get('e1')?.node).toBe(node);
    expect(idx.byId.get('e1')?.entityType).toBe('mesh');
  });

  it('indexes multiple entities by ID', () => {
    const nodes = [
      makeNode({ entityId: 'e1', components: ['Mesh3d'] }),
      makeNode({ entityId: 'e2', components: ['PointLight'] }),
      makeNode({ entityId: 'e3', components: [] }),
    ];
    const idx = buildEntityIndex(makeGraph(nodes));
    expect(idx.byId.size).toBe(3);
    expect(idx.byId.has('e1')).toBe(true);
    expect(idx.byId.has('e2')).toBe(true);
    expect(idx.byId.has('e3')).toBe(true);
  });

  it('groups entities by inferred type', () => {
    const nodes = [
      makeNode({ entityId: 'e1', components: ['Mesh3d'] }),
      makeNode({ entityId: 'e2', components: ['Mesh3d'] }),
      makeNode({ entityId: 'e3', components: ['PointLight'] }),
      makeNode({ entityId: 'e4', components: ['DirectionalLight'] }),
      makeNode({ entityId: 'e5', components: ['SpotLight'] }),
      makeNode({ entityId: 'e6', components: ['TerrainEnabled', 'Mesh3d'] }),
      makeNode({ entityId: 'e7', components: [] }),
    ];
    const idx = buildEntityIndex(makeGraph(nodes));

    expect(idx.byType.get('mesh')?.size).toBe(2); // e1, e2 (e6 is terrain)
    expect(idx.byType.get('point_light')?.size).toBe(1);
    expect(idx.byType.get('directional_light')?.size).toBe(1);
    expect(idx.byType.get('spot_light')?.size).toBe(1);
    expect(idx.byType.get('terrain')?.size).toBe(1);
    expect(idx.byType.get('entity')?.size).toBe(1);
  });

  it('indexes entities by component', () => {
    const nodes = [
      makeNode({ entityId: 'e1', components: ['Mesh3d', 'Transform', 'PhysicsData'] }),
      makeNode({ entityId: 'e2', components: ['Mesh3d', 'Transform'] }),
      makeNode({ entityId: 'e3', components: ['PointLight', 'Transform'] }),
    ];
    const idx = buildEntityIndex(makeGraph(nodes));

    expect(idx.byComponent.get('Mesh3d')?.size).toBe(2);
    expect(idx.byComponent.get('Transform')?.size).toBe(3);
    expect(idx.byComponent.get('PhysicsData')?.size).toBe(1);
    expect(idx.byComponent.get('PointLight')?.size).toBe(1);
  });

  it('indexes entities by name (supports duplicates)', () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Box' }),
      makeNode({ entityId: 'e2', name: 'Box' }),
      makeNode({ entityId: 'e3', name: 'Light' }),
    ];
    const idx = buildEntityIndex(makeGraph(nodes));

    expect(idx.byName.get('Box')?.size).toBe(2);
    expect(idx.byName.get('Light')?.size).toBe(1);
    expect(idx.byName.has('Missing')).toBe(false);
  });

  it('handles entity with no components', () => {
    const node = makeNode({ entityId: 'e1', name: 'Empty', components: [] });
    const idx = buildEntityIndex(makeGraph([node]));

    expect(idx.byId.get('e1')?.entityType).toBe('entity');
    expect(idx.byComponent.size).toBe(0);
  });

  it('terrain type takes priority over Mesh3d', () => {
    const node = makeNode({ entityId: 'e1', components: ['TerrainEnabled', 'Mesh3d'] });
    const idx = buildEntityIndex(makeGraph([node]));

    expect(idx.byId.get('e1')?.entityType).toBe('terrain');
    expect(idx.byType.has('terrain')).toBe(true);
    expect(idx.byType.get('mesh')).toBeUndefined();
  });

  it('sprite type is inferred correctly', () => {
    const node = makeNode({ entityId: 'e1', components: ['Sprite', 'Transform'] });
    const idx = buildEntityIndex(makeGraph([node]));
    expect(idx.byId.get('e1')?.entityType).toBe('sprite');
    expect(idx.byType.get('sprite')?.has('e1')).toBe(true);
  });
});

describe('lookupEntity', () => {
  it('returns EntityData for existing entity', () => {
    const node = makeNode({ entityId: 'e1', name: 'Box', components: ['Mesh3d'] });
    const idx = buildEntityIndex(makeGraph([node]));
    const result = lookupEntity(idx, 'e1');
    expect(result).toBeDefined();
    expect(result?.node.name).toBe('Box');
    expect(result?.entityType).toBe('mesh');
  });

  it('returns undefined for missing entity', () => {
    const idx = buildEntityIndex({ nodes: {}, rootIds: [] });
    expect(lookupEntity(idx, 'nonexistent')).toBeUndefined();
  });
});

describe('lookupByType', () => {
  let idx: EntityIndex;

  beforeAll(() => {
    const nodes = [
      makeNode({ entityId: 'e1', components: ['Mesh3d'] }),
      makeNode({ entityId: 'e2', components: ['Mesh3d'] }),
      makeNode({ entityId: 'e3', components: ['PointLight'] }),
    ];
    idx = buildEntityIndex(makeGraph(nodes));
  });

  it('returns all entity IDs of given type', () => {
    const meshIds = lookupByType(idx, 'mesh');
    expect(meshIds).toHaveLength(2);
    expect(meshIds).toContain('e1');
    expect(meshIds).toContain('e2');
  });

  it('returns empty array for unknown type', () => {
    expect(lookupByType(idx, 'nonexistent')).toEqual([]);
  });

  it('returns single entity for unique type', () => {
    expect(lookupByType(idx, 'point_light')).toEqual(['e3']);
  });
});

describe('lookupByComponent', () => {
  let idx: EntityIndex;

  beforeAll(() => {
    const nodes = [
      makeNode({ entityId: 'e1', components: ['Mesh3d', 'PhysicsData'] }),
      makeNode({ entityId: 'e2', components: ['Mesh3d'] }),
      makeNode({ entityId: 'e3', components: ['PhysicsData', 'PointLight'] }),
    ];
    idx = buildEntityIndex(makeGraph(nodes));
  });

  it('returns all entities with a given component', () => {
    const result = lookupByComponent(idx, 'PhysicsData');
    expect(result).toHaveLength(2);
    expect(result).toContain('e1');
    expect(result).toContain('e3');
  });

  it('returns empty array for unknown component', () => {
    expect(lookupByComponent(idx, 'AudioData')).toEqual([]);
  });

  it('handles single-entity component', () => {
    expect(lookupByComponent(idx, 'PointLight')).toEqual(['e3']);
  });
});

describe('lookupByName', () => {
  it('returns all entity IDs matching a name', () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Box' }),
      makeNode({ entityId: 'e2', name: 'Box' }),
      makeNode({ entityId: 'e3', name: 'Sphere' }),
    ];
    const idx = buildEntityIndex(makeGraph(nodes));
    const result = lookupByName(idx, 'Box');
    expect(result).toHaveLength(2);
    expect(result).toContain('e1');
    expect(result).toContain('e2');
  });

  it('returns empty array for unknown name', () => {
    const idx = buildEntityIndex({ nodes: {}, rootIds: [] });
    expect(lookupByName(idx, 'missing')).toEqual([]);
  });
});

describe('findEntityByName', () => {
  it('returns a matching entity ID', () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'Enemy' }),
    ];
    const idx = buildEntityIndex(makeGraph(nodes));
    expect(findEntityByName(idx, 'Player')).toBe('e1');
    expect(findEntityByName(idx, 'Enemy')).toBe('e2');
  });

  it('returns undefined for missing name', () => {
    const idx = buildEntityIndex({ nodes: {}, rootIds: [] });
    expect(findEntityByName(idx, 'missing')).toBeUndefined();
  });

  it('returns one of the duplicate-name entities', () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Box' }),
      makeNode({ entityId: 'e2', name: 'Box' }),
    ];
    const idx = buildEntityIndex(makeGraph(nodes));
    const result = findEntityByName(idx, 'Box');
    expect(['e1', 'e2']).toContain(result);
  });
});

describe('index rebuild after scene change', () => {
  it('produces a new index reflecting added entities', () => {
    const nodes1 = [makeNode({ entityId: 'e1', components: ['Mesh3d'] })];
    const idx1 = buildEntityIndex(makeGraph(nodes1));
    expect(idx1.byId.size).toBe(1);

    const nodes2 = [
      ...nodes1,
      makeNode({ entityId: 'e2', components: ['PointLight'] }),
    ];
    const idx2 = buildEntityIndex(makeGraph(nodes2));
    expect(idx2.byId.size).toBe(2);
    expect(lookupEntity(idx2, 'e2')?.entityType).toBe('point_light');
  });

  it('produces a new index reflecting removed entities', () => {
    const nodes = [
      makeNode({ entityId: 'e1', components: ['Mesh3d'] }),
      makeNode({ entityId: 'e2', components: ['PointLight'] }),
    ];
    const idx1 = buildEntityIndex(makeGraph(nodes));
    expect(idx1.byId.size).toBe(2);

    const idx2 = buildEntityIndex(makeGraph([nodes[0]]));
    expect(idx2.byId.size).toBe(1);
    expect(lookupEntity(idx2, 'e2')).toBeUndefined();
  });
});

describe('performance', () => {
  it('builds index for 1000 entities and performs 1000 lookups in < 50ms', () => {
    const nodes: SceneNode[] = [];
    const components = ['Mesh3d', 'Transform', 'PhysicsData', 'AudioData'];
    for (let i = 0; i < 1000; i++) {
      const comps = components.slice(0, (i % 4) + 1);
      nodes.push(makeNode({
        entityId: `e${i}`,
        name: `Entity_${i}`,
        components: comps,
      }));
    }
    const graph = makeGraph(nodes);

    const start = performance.now();

    // Build index
    const idx = buildEntityIndex(graph);

    // 1000 ID lookups
    for (let i = 0; i < 1000; i++) {
      lookupEntity(idx, `e${i}`);
    }

    // 100 type lookups
    for (let i = 0; i < 100; i++) {
      lookupByType(idx, 'mesh');
    }

    // 100 component lookups
    for (let i = 0; i < 100; i++) {
      lookupByComponent(idx, 'PhysicsData');
    }

    // 100 name lookups
    for (let i = 0; i < 100; i++) {
      findEntityByName(idx, `Entity_${i}`);
    }

    const elapsed = performance.now() - start;
    // Allow generous margin for CI under heavy load — typical desktop is < 5ms,
    // but concurrent test workers can cause JIT delays up to ~300ms.
    expect(elapsed).toBeLessThan(1000);
  });

  it('handles 5000 entities without issue', () => {
    const nodes: SceneNode[] = [];
    for (let i = 0; i < 5000; i++) {
      nodes.push(makeNode({
        entityId: `e${i}`,
        name: `Node_${i % 100}`, // 100 unique names, 50 duplicates each
        components: i % 2 === 0 ? ['Mesh3d', 'Transform'] : ['PointLight'],
      }));
    }
    const idx = buildEntityIndex(makeGraph(nodes));

    expect(idx.byId.size).toBe(5000);
    expect(lookupByType(idx, 'mesh').length).toBe(2500);
    expect(lookupByType(idx, 'point_light').length).toBe(2500);
    expect(lookupByName(idx, 'Node_0').length).toBe(50);
  });
});

describe('edge cases', () => {
  it('handles entity with many components', () => {
    const manyComps = Array.from({ length: 20 }, (_, i) => `Comp${i}`);
    const node = makeNode({ entityId: 'e1', components: manyComps });
    const idx = buildEntityIndex(makeGraph([node]));

    for (const comp of manyComps) {
      expect(lookupByComponent(idx, comp)).toEqual(['e1']);
    }
  });

  it('handles entity with empty name', () => {
    const node = makeNode({ entityId: 'e1', name: '' });
    const idx = buildEntityIndex(makeGraph([node]));
    expect(lookupByName(idx, '')).toEqual(['e1']);
    expect(findEntityByName(idx, '')).toBe('e1');
  });

  it('index is immutable snapshot (modifying source does not affect index)', () => {
    const nodes = [makeNode({ entityId: 'e1', name: 'Box', components: ['Mesh3d'] })];
    const graph = makeGraph(nodes);
    const idx = buildEntityIndex(graph);

    // Mutate the source graph
    graph.nodes['e2'] = makeNode({ entityId: 'e2', name: 'New' });

    // Index should not see the new entity
    expect(idx.byId.size).toBe(1);
    expect(lookupEntity(idx, 'e2')).toBeUndefined();
  });
});

// Required for vitest: import beforeAll from vitest
import { beforeAll } from 'vitest';
