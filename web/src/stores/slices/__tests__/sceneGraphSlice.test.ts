import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { create } from 'zustand';
import { createMockDispatch } from './sliceTestTemplate';
import { createSceneGraphSlice, setSceneGraphDispatcher, type SceneGraphSlice } from '../sceneGraphSlice';
import type { SceneGraph, SceneNode } from '../types';

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

  // ---------------------------------------------------------------------------
  // Incremental operations
  // ---------------------------------------------------------------------------

  describe('setFullGraph', () => {
    it('should replace the full scene graph', () => {
      store.getState().setFullGraph(mockGraph);
      expect(store.getState().sceneGraph.rootIds).toEqual(['cam-1', 'cube-1']);
      expect(Object.keys(store.getState().sceneGraph.nodes)).toHaveLength(3);
    });

    it('should overwrite an existing graph', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().setFullGraph({ nodes: {}, rootIds: [] });
      expect(store.getState().sceneGraph).toEqual({ nodes: {}, rootIds: [] });
    });
  });

  describe('addNode', () => {
    const newRootNode: SceneNode = {
      entityId: 'light-1',
      name: 'PointLight',
      parentId: null,
      children: [],
      components: ['PointLight'],
      visible: true,
    };
    const newChildNode: SceneNode = {
      entityId: 'child-1',
      name: 'Child',
      parentId: 'cube-1',
      children: [],
      components: [],
      visible: true,
    };

    it('should insert a new root node', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().addNode(newRootNode);

      const { sceneGraph } = store.getState();
      expect(sceneGraph.nodes['light-1']).toEqual(newRootNode);
      expect(sceneGraph.rootIds).toContain('light-1');
    });

    it('should not duplicate rootIds when adding root node twice', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().addNode(newRootNode);
      store.getState().addNode(newRootNode);

      expect(store.getState().sceneGraph.rootIds.filter((id) => id === 'light-1')).toHaveLength(1);
    });

    it('should attach child node to parent children list', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().addNode(newChildNode);

      const { sceneGraph } = store.getState();
      expect(sceneGraph.nodes['child-1']).toEqual(newChildNode);
      expect(sceneGraph.nodes['cube-1'].children).toContain('child-1');
    });

    it('should not add child to rootIds', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().addNode(newChildNode);

      expect(store.getState().sceneGraph.rootIds).not.toContain('child-1');
    });

    it('should add node even when parent does not exist yet', () => {
      store.getState().setFullGraph({ nodes: {}, rootIds: [] });
      store.getState().addNode(newChildNode);

      expect(store.getState().sceneGraph.nodes['child-1']).toEqual(newChildNode);
    });
  });

  describe('removeNode', () => {
    it('should remove a root node and update rootIds', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().removeNode('cam-1');

      const { sceneGraph } = store.getState();
      expect(sceneGraph.nodes['cam-1']).toBeUndefined();
      expect(sceneGraph.rootIds).not.toContain('cam-1');
    });

    it('should remove a child node and detach from parent', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().removeNode('sphere-1');

      const { sceneGraph } = store.getState();
      expect(sceneGraph.nodes['sphere-1']).toBeUndefined();
      expect(sceneGraph.nodes['cube-1'].children).not.toContain('sphere-1');
    });

    it('should be a no-op for unknown entity', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().removeNode('no-such-entity');

      expect(Object.keys(store.getState().sceneGraph.nodes)).toHaveLength(3);
    });
  });

  describe('updateNode', () => {
    it('should patch name only', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().updateNode('cube-1', { name: 'PatchedCube' });

      const node = store.getState().sceneGraph.nodes['cube-1'];
      expect(node.name).toBe('PatchedCube');
      expect(node.visible).toBe(true); // unchanged
    });

    it('should patch visible only', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().updateNode('cube-1', { visible: false });

      expect(store.getState().sceneGraph.nodes['cube-1'].visible).toBe(false);
    });

    it('should move node from parent to root when parentId set to null', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().updateNode('sphere-1', { parentId: null });

      const { sceneGraph } = store.getState();
      expect(sceneGraph.nodes['sphere-1'].parentId).toBeNull();
      expect(sceneGraph.rootIds).toContain('sphere-1');
      // Detached from old parent
      expect(sceneGraph.nodes['cube-1'].children).not.toContain('sphere-1');
    });

    it('should reparent node from root to a new parent', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().updateNode('cam-1', { parentId: 'cube-1' });

      const { sceneGraph } = store.getState();
      expect(sceneGraph.nodes['cam-1'].parentId).toBe('cube-1');
      expect(sceneGraph.rootIds).not.toContain('cam-1');
      expect(sceneGraph.nodes['cube-1'].children).toContain('cam-1');
    });

    it('should be a no-op for unknown entity', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().updateNode('ghost-entity', { name: 'Ghost' });

      // Graph unchanged
      expect(Object.keys(store.getState().sceneGraph.nodes)).toHaveLength(3);
    });

    it('should patch multiple fields at once', () => {
      store.getState().setFullGraph(mockGraph);
      store.getState().updateNode('cube-1', { name: 'Multi', visible: false });

      const node = store.getState().sceneGraph.nodes['cube-1'];
      expect(node.name).toBe('Multi');
      expect(node.visible).toBe(false);
    });
  });
});
