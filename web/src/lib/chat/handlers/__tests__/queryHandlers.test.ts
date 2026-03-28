import { describe, it, expect } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { queryHandlers } from '../queryHandlers';

// ---------------------------------------------------------------------------
// get_scene_graph
// ---------------------------------------------------------------------------

describe('get_scene_graph', () => {
  it('returns empty entities when scene graph has no nodes', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_scene_graph');
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; count: number };
    expect(data.entities).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('returns mapped entity summaries with correct shape', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_scene_graph',
      {},
      {
        sceneGraph: {
          nodes: {
            ent1: {
              entityId: 'ent1',
              name: 'Cube',
              parentId: null,
              children: ['ent2'],
              components: ['Transform', 'Mesh'],
              visible: true,
            },
            ent2: {
              entityId: 'ent2',
              name: 'Child',
              parentId: 'ent1',
              children: [],
              components: ['Transform'],
              visible: false,
            },
          },
          rootIds: ['ent1'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; count: number };
    expect(data.count).toBe(2);
    expect(data.entities).toEqual(
      expect.arrayContaining([
        { id: 'ent1', name: 'Cube', parent: null, children: ['ent2'], visible: true },
        { id: 'ent2', name: 'Child', parent: 'ent1', children: [], visible: false },
      ])
    );
  });

  it('count matches entities array length', async () => {
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      nodes[`e${i}`] = { entityId: `e${i}`, name: `Entity${i}`, parentId: null, children: [], components: [], visible: true };
    }
    const { result } = await invokeHandler(queryHandlers, 'get_scene_graph', {}, { sceneGraph: { nodes, rootIds: [] } });
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; count: number };
    expect(data.count).toBe(5);
    expect(data.entities).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// get_entity_details
// ---------------------------------------------------------------------------

describe('get_entity_details', () => {
  it('returns error when entity is not found', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_entity_details', { entityId: 'missing' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing');
  });

  it('returns entity data including components and visibility', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_entity_details',
      { entityId: 'ent1' },
      {
        sceneGraph: {
          nodes: {
            ent1: {
              entityId: 'ent1',
              name: 'MyMesh',
              parentId: null,
              children: ['ent2', 'ent3'],
              components: ['Transform', 'Mesh', 'Physics'],
              visible: true,
            },
          },
          rootIds: ['ent1'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { name: string; components: string[]; visible: boolean; children: string[] };
    expect(data.name).toBe('MyMesh');
    expect(data.components).toEqual(['Transform', 'Mesh', 'Physics']);
    expect(data.visible).toBe(true);
    expect(data.children).toEqual(['ent2', 'ent3']);
  });

  it('returns invisible entity details correctly', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'get_entity_details',
      { entityId: 'hidden' },
      {
        sceneGraph: {
          nodes: {
            hidden: {
              entityId: 'hidden',
              name: 'HiddenObj',
              parentId: 'parent1',
              children: [],
              components: ['Transform'],
              visible: false,
            },
          },
          rootIds: [],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { visible: boolean };
    expect(data.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// get_selection
// ---------------------------------------------------------------------------

describe('get_selection', () => {
  it('returns empty selection when nothing is selected', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_selection', {}, {
      selectedIds: new Set<string>(),
      primaryId: null,
    });
    expect(result.success).toBe(true);
    const data = result.result as { selectedIds: string[]; primaryId: string | null };
    expect(data.selectedIds).toEqual([]);
    expect(data.primaryId).toBeNull();
  });

  it('returns correct selection state with a single entity', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_selection', {}, {
      selectedIds: new Set(['ent1']),
      primaryId: 'ent1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { selectedIds: string[]; primaryId: string | null };
    expect(data.selectedIds).toEqual(['ent1']);
    expect(data.primaryId).toBe('ent1');
  });

  it('returns all ids in multi-selection', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_selection', {}, {
      selectedIds: new Set(['a', 'b', 'c']),
      primaryId: 'a',
    });
    expect(result.success).toBe(true);
    const data = result.result as { selectedIds: string[]; primaryId: string | null };
    expect(data.selectedIds).toHaveLength(3);
    expect(data.selectedIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(data.primaryId).toBe('a');
  });

  it('returns a plain array (not a Set) for selectedIds', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_selection', {}, {
      selectedIds: new Set(['x']),
      primaryId: 'x',
    });
    const data = result.result as { selectedIds: unknown };
    expect(Array.isArray(data.selectedIds)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_camera_state
// ---------------------------------------------------------------------------

describe('get_camera_state', () => {
  it('returns current camera preset', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_camera_state', {}, { currentCameraPreset: 'top' });
    expect(result.success).toBe(true);
    const data = result.result as { preset: string };
    expect(data.preset).toBe('top');
  });

  it('returns perspective preset from default store', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_camera_state');
    expect(result.success).toBe(true);
    const data = result.result as { preset: string };
    expect(data.preset).toBe('perspective');
  });
});

// ---------------------------------------------------------------------------
// get_mode
// ---------------------------------------------------------------------------

describe('get_mode', () => {
  it('returns edit mode from default store', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_mode');
    expect(result.success).toBe(true);
    const data = result.result as { mode: string };
    expect(data.mode).toBe('edit');
  });

  it('returns play mode when engine is in play', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_mode', {}, { engineMode: 'play' });
    expect(result.success).toBe(true);
    const data = result.result as { mode: string };
    expect(data.mode).toBe('play');
  });

  it('returns paused mode when engine is paused', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_mode', {}, { engineMode: 'paused' });
    expect(result.success).toBe(true);
    const data = result.result as { mode: string };
    expect(data.mode).toBe('paused');
  });
});

// ---------------------------------------------------------------------------
// query_play_state
// ---------------------------------------------------------------------------

describe('query_play_state', () => {
  it('returns error when engine is in edit mode', async () => {
    const { result } = await invokeHandler(queryHandlers, 'query_play_state', {}, { engineMode: 'edit' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Play or Paused');
    expect(result.error).toContain('edit');
  });

  it('returns error when engine mode is not set (defaults to edit)', async () => {
    const { result } = await invokeHandler(queryHandlers, 'query_play_state');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Play or Paused');
  });

  it('returns entity list and engineMode when in play mode', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      {
        engineMode: 'play',
        sceneGraph: {
          nodes: {
            ent1: { entityId: 'ent1', name: 'Player', parentId: null, children: [], components: [], visible: true },
            ent2: { entityId: 'ent2', name: 'Enemy', parentId: null, children: [], components: [], visible: false },
          },
          rootIds: ['ent1', 'ent2'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; entityCount: number; engineMode: string };
    expect(data.engineMode).toBe('play');
    expect(data.entityCount).toBe(2);
    expect(data.entities).toHaveLength(2);
  });

  it('returns entity list when in paused mode', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      {
        engineMode: 'paused',
        sceneGraph: {
          nodes: {
            cube1: { entityId: 'cube1', name: 'Cube', parentId: null, children: [], components: [], visible: true },
          },
          rootIds: ['cube1'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { engineMode: string; entityCount: number };
    expect(data.engineMode).toBe('paused');
    expect(data.entityCount).toBe(1);
  });

  it('entity entries contain id, name, and visible fields', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      {
        engineMode: 'play',
        sceneGraph: {
          nodes: {
            p1: { entityId: 'p1', name: 'Hero', parentId: null, children: [], components: [], visible: true },
          },
          rootIds: ['p1'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { entities: { id: string; name: string; visible: boolean }[] };
    expect(data.entities[0]).toMatchObject({ id: 'p1', name: 'Hero', visible: true });
  });

  it('returns empty entity list when scene has no entities in play mode', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      {
        engineMode: 'play',
        sceneGraph: { nodes: {}, rootIds: [] },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; entityCount: number };
    expect(data.entities).toEqual([]);
    expect(data.entityCount).toBe(0);
  });

  it('entityCount matches entities array length', async () => {
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i < 4; i++) {
      nodes[`e${i}`] = { entityId: `e${i}`, name: `Obj${i}`, parentId: null, children: [], components: [], visible: true };
    }
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      { engineMode: 'play', sceneGraph: { nodes, rootIds: [] } }
    );
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; entityCount: number };
    expect(data.entityCount).toBe(data.entities.length);
  });

  it('result includes dataSource field set to store_last_sync', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      { engineMode: 'play', sceneGraph: { nodes: {}, rootIds: [] } }
    );
    expect(result.success).toBe(true);
    const data = result.result as { dataSource: string };
    expect(data.dataSource).toBe('store_last_sync');
  });

  it('result includes numeric syncTimestamp', async () => {
    const before = Date.now();
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      { engineMode: 'play', sceneGraph: { nodes: {}, rootIds: [] } }
    );
    const after = Date.now();
    expect(result.success).toBe(true);
    const data = result.result as { syncTimestamp: number };
    expect(typeof data.syncTimestamp).toBe('number');
    expect(data.syncTimestamp).toBeGreaterThanOrEqual(before);
    expect(data.syncTimestamp).toBeLessThanOrEqual(after);
  });

  it('result includes all required fields in play mode', async () => {
    const { result } = await invokeHandler(
      queryHandlers,
      'query_play_state',
      {},
      {
        engineMode: 'play',
        sceneGraph: {
          nodes: {
            hero: { entityId: 'hero', name: 'Hero', parentId: null, children: [], components: [], visible: true },
          },
          rootIds: ['hero'],
        },
      }
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data).toHaveProperty('entities');
    expect(data).toHaveProperty('entityCount');
    expect(data).toHaveProperty('engineMode');
    expect(data).toHaveProperty('dataSource');
    expect(data).toHaveProperty('syncTimestamp');
  });
});

// ---------------------------------------------------------------------------
// get_sprite_generation_status
// ---------------------------------------------------------------------------

describe('get_sprite_generation_status', () => {
  it('returns error when jobId is missing', async () => {
    const { result } = await invokeHandler(queryHandlers, 'get_sprite_generation_status', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('jobId');
  });
});
