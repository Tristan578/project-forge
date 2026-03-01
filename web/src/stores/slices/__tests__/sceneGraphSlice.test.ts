import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { create } from 'zustand';
import { createMockDispatch } from './sliceTestTemplate';
import { createSceneGraphSlice, setSceneGraphDispatcher, type SceneGraphSlice } from '../sceneGraphSlice';
import type { SceneGraph } from '../types';

// SceneGraphSlice depends on external state (selectedIds, primaryId, etc.)
// so we compose a test store with the required extra fields.
type TestState = SceneGraphSlice & {
  selectedIds: Set<string>;
  primaryId: string | null;
  primaryName: string | null;
  primaryTransform: unknown | null;
  spawnTerrain: () => void;
};

const mockGraph: SceneGraph = {
  nodes: {
    'cam-1': { entityId: 'cam-1', name: 'Camera', parentId: null, children: [], components: ['Camera3d'], visible: true },
    'cube-1': { entityId: 'cube-1', name: 'Cube', parentId: null, children: ['sphere-1'], components: ['Mesh'], visible: true },
    'sphere-1': { entityId: 'sphere-1', name: 'Sphere', parentId: 'cube-1', children: [], components: ['Mesh'], visible: true },
  },
  rootIds: ['cam-1', 'cube-1'],
};

function createTestStore() {
  const spawnTerrainMock = vi.fn();
  return {
    store: create<TestState>()((set, get, api) => ({
      ...createSceneGraphSlice(set, get, api),
      selectedIds: new Set<string>(),
      primaryId: null,
      primaryName: null,
      primaryTransform: null,
      spawnTerrain: spawnTerrainMock,
    })),
    spawnTerrainMock,
  };
}

describe('sceneGraphSlice', () => {
  let store: ReturnType<typeof createTestStore>['store'];
  let spawnTerrainMock: ReturnType<typeof createMockDispatch>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setSceneGraphDispatcher(mockDispatch);
    const created = createTestStore();
    store = created.store;
    spawnTerrainMock = created.spawnTerrainMock;
  });

  afterEach(() => {
    setSceneGraphDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should start with empty scene graph', () => {
      expect(store.getState().sceneGraph).toEqual({ nodes: {}, rootIds: [] });
    });
  });

  describe('updateSceneGraph', () => {
    it('should replace scene graph', () => {
      store.getState().updateSceneGraph(mockGraph);
      expect(store.getState().sceneGraph.rootIds).toEqual(['cam-1', 'cube-1']);
      expect(Object.keys(store.getState().sceneGraph.nodes)).toHaveLength(3);
    });
  });

  describe('toggleVisibility', () => {
    it('should toggle entity visibility off', () => {
      store.getState().updateSceneGraph(mockGraph);
      store.getState().toggleVisibility('cube-1');

      expect(store.getState().sceneGraph.nodes['cube-1'].visible).toBe(false);
    });

    it('should toggle entity visibility back on', () => {
      store.getState().updateSceneGraph(mockGraph);
      store.getState().toggleVisibility('cube-1');
      store.getState().toggleVisibility('cube-1');

      expect(store.getState().sceneGraph.nodes['cube-1'].visible).toBe(true);
    });

    it('should dispatch set_visibility', () => {
      store.getState().updateSceneGraph(mockGraph);
      store.getState().toggleVisibility('cam-1');

      expect(mockDispatch).toHaveBeenCalledWith('set_visibility', { entityId: 'cam-1', visible: false });
    });

    it('should no-op for unknown entity', () => {
      store.getState().updateSceneGraph(mockGraph);
      store.getState().toggleVisibility('unknown-1');

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('renameEntity', () => {
    it('should rename entity in scene graph', () => {
      store.getState().updateSceneGraph(mockGraph);
      store.getState().renameEntity('cube-1', 'MyCube');

      expect(store.getState().sceneGraph.nodes['cube-1'].name).toBe('MyCube');
    });

    it('should dispatch rename_entity', () => {
      store.getState().updateSceneGraph(mockGraph);
      store.getState().renameEntity('cube-1', 'MyCube');

      expect(mockDispatch).toHaveBeenCalledWith('rename_entity', { entityId: 'cube-1', name: 'MyCube' });
    });

    it('should update primaryName when renaming primary entity', () => {
      store.getState().updateSceneGraph(mockGraph);
      store.setState({ primaryId: 'cube-1', primaryName: 'Cube' });
      store.getState().renameEntity('cube-1', 'NewCube');

      expect(store.getState().primaryName).toBe('NewCube');
    });

    it('should not update primaryName when renaming non-primary entity', () => {
      store.getState().updateSceneGraph(mockGraph);
      store.setState({ primaryId: 'cam-1', primaryName: 'Camera' });
      store.getState().renameEntity('cube-1', 'NewCube');

      expect(store.getState().primaryName).toBe('Camera');
    });

    it('should no-op for unknown entity', () => {
      store.getState().updateSceneGraph(mockGraph);
      store.getState().renameEntity('unknown-1', 'X');

      // Should still dispatch even for unknown (let Rust handle)
      expect(mockDispatch).toHaveBeenCalledWith('rename_entity', { entityId: 'unknown-1', name: 'X' });
    });
  });

  describe('spawnEntity', () => {
    it('should dispatch spawn_entity for non-terrain types', () => {
      store.getState().spawnEntity('cube', 'MyCube');
      expect(mockDispatch).toHaveBeenCalledWith('spawn_entity', { entityType: 'cube', name: 'MyCube' });
    });

    it('should call spawnTerrain for terrain type', () => {
      store.getState().spawnEntity('terrain');
      expect(spawnTerrainMock).toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalledWith('spawn_entity', expect.anything());
    });
  });

  describe('deleteSelectedEntities', () => {
    it('should dispatch delete_entities with selected IDs', () => {
      store.setState({ selectedIds: new Set(['cube-1', 'cam-1']) });
      store.getState().deleteSelectedEntities();

      expect(mockDispatch).toHaveBeenCalledWith('delete_entities', {
        entityIds: expect.arrayContaining(['cube-1', 'cam-1']),
      });
    });

    it('should clear selection state after delete', () => {
      store.setState({
        selectedIds: new Set(['cube-1']),
        primaryId: 'cube-1',
        primaryName: 'Cube',
        primaryTransform: { position: [0, 0, 0] },
      });
      store.getState().deleteSelectedEntities();

      expect(store.getState().selectedIds.size).toBe(0);
      expect(store.getState().primaryId).toBeNull();
      expect(store.getState().primaryName).toBeNull();
      expect(store.getState().primaryTransform).toBeNull();
    });

    it('should not dispatch when nothing is selected', () => {
      store.getState().deleteSelectedEntities();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('duplicateSelectedEntity', () => {
    it('should dispatch duplicate_entity for primary entity', () => {
      store.setState({ primaryId: 'cube-1' });
      store.getState().duplicateSelectedEntity();

      expect(mockDispatch).toHaveBeenCalledWith('duplicate_entity', { entityId: 'cube-1' });
    });

    it('should not dispatch when no primary entity', () => {
      store.getState().duplicateSelectedEntity();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('reparentEntity', () => {
    it('should dispatch reparent_entity', () => {
      store.getState().reparentEntity('sphere-1', 'cam-1', 0);

      expect(mockDispatch).toHaveBeenCalledWith('reparent_entity', {
        entityId: 'sphere-1',
        newParentId: 'cam-1',
        insertIndex: 0,
      });
    });

    it('should dispatch reparent to root with null parent', () => {
      store.getState().reparentEntity('sphere-1', null);

      expect(mockDispatch).toHaveBeenCalledWith('reparent_entity', {
        entityId: 'sphere-1',
        newParentId: null,
        insertIndex: undefined,
      });
    });
  });
});
