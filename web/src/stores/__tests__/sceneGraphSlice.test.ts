/**
 * Unit tests for the sceneGraphSlice — scene hierarchy, visibility, and entity CRUD.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSceneGraphSlice,
  setSceneGraphDispatcher,
  type SceneGraphSlice,
} from '../slices/sceneGraphSlice';
import type { SceneGraph } from '../slices/types';

// Minimal extra state that createSceneGraphSlice depends on via get()
interface ExtraState {
  selectedIds: Set<string>;
  primaryId: string | null;
  primaryName: string | null;
  primaryTransform: unknown | null;
  spawnTerrain: () => void;
}

type FullState = SceneGraphSlice & ExtraState;

function createTestStore(extraOverrides: Partial<ExtraState> = {}) {
  const extra: ExtraState = {
    selectedIds: new Set<string>(),
    primaryId: null,
    primaryName: null,
    primaryTransform: null,
    spawnTerrain: vi.fn(),
    ...extraOverrides,
  };

  const store = { state: null as unknown as FullState };

  const set = (partial: Partial<FullState> | ((s: FullState) => Partial<FullState>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };

  const get = () => store.state;

  const slice = createSceneGraphSlice(set as never, get as never, {} as never);
  store.state = { ...extra, ...slice };

  return { getState: () => store.state };
}

describe('sceneGraphSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setSceneGraphDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  // -------------------------------------------------------------------------
  // 1. Initial state
  // -------------------------------------------------------------------------
  describe('Initial state', () => {
    it('should have an empty nodes map', () => {
      expect(store.getState().sceneGraph.nodes).toEqual({});
    });

    it('should have an empty rootIds array', () => {
      expect(store.getState().sceneGraph.rootIds).toEqual([]);
    });

    it('should expose the full SceneGraph shape', () => {
      const graph: SceneGraph = store.getState().sceneGraph;
      expect(graph).toHaveProperty('nodes');
      expect(graph).toHaveProperty('rootIds');
    });
  });

  // -------------------------------------------------------------------------
  // 2. updateSceneGraph
  // -------------------------------------------------------------------------
  describe('updateSceneGraph', () => {
    it('replaces the entire graph', () => {
      const newGraph: SceneGraph = {
        nodes: {
          'ent-1': {
            entityId: 'ent-1',
            name: 'Cube',
            parentId: null,
            children: [],
            components: ['mesh'],
            visible: true,
          },
        },
        rootIds: ['ent-1'],
      };

      store.getState().updateSceneGraph(newGraph);

      expect(store.getState().sceneGraph).toEqual(newGraph);
    });

    it('replaces a previously set graph with a new one', () => {
      const first: SceneGraph = {
        nodes: {
          'ent-a': {
            entityId: 'ent-a',
            name: 'A',
            parentId: null,
            children: [],
            components: [],
            visible: true,
          },
        },
        rootIds: ['ent-a'],
      };

      const second: SceneGraph = {
        nodes: {
          'ent-b': {
            entityId: 'ent-b',
            name: 'B',
            parentId: null,
            children: [],
            components: [],
            visible: false,
          },
        },
        rootIds: ['ent-b'],
      };

      store.getState().updateSceneGraph(first);
      store.getState().updateSceneGraph(second);

      expect(store.getState().sceneGraph).toEqual(second);
      expect(store.getState().sceneGraph.nodes['ent-a']).toBeUndefined();
    });

    it('does not dispatch any engine command', () => {
      store.getState().updateSceneGraph({ nodes: {}, rootIds: [] });
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. toggleVisibility
  // -------------------------------------------------------------------------
  describe('toggleVisibility', () => {
    const graph: SceneGraph = {
      nodes: {
        'ent-1': {
          entityId: 'ent-1',
          name: 'Sphere',
          parentId: null,
          children: [],
          components: [],
          visible: true,
        },
      },
      rootIds: ['ent-1'],
    };

    beforeEach(() => {
      store.getState().updateSceneGraph(graph);
      mockDispatch.mockClear();
    });

    it('dispatches set_visibility with visible=false when entity is currently visible', () => {
      store.getState().toggleVisibility('ent-1');

      expect(mockDispatch).toHaveBeenCalledOnce();
      expect(mockDispatch).toHaveBeenCalledWith('set_visibility', {
        entityId: 'ent-1',
        visible: false,
      });
    });

    it('optimistically updates the node to visible=false', () => {
      store.getState().toggleVisibility('ent-1');

      expect(store.getState().sceneGraph.nodes['ent-1'].visible).toBe(false);
    });

    it('dispatches set_visibility with visible=true when entity is currently hidden', () => {
      // First toggle: true -> false
      store.getState().toggleVisibility('ent-1');
      mockDispatch.mockClear();

      // Second toggle: false -> true
      store.getState().toggleVisibility('ent-1');

      expect(mockDispatch).toHaveBeenCalledWith('set_visibility', {
        entityId: 'ent-1',
        visible: true,
      });
    });

    it('does nothing when the entity does not exist', () => {
      store.getState().toggleVisibility('nonexistent-id');

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4. renameEntity
  // -------------------------------------------------------------------------
  describe('renameEntity', () => {
    const graph: SceneGraph = {
      nodes: {
        'ent-1': {
          entityId: 'ent-1',
          name: 'OldName',
          parentId: null,
          children: [],
          components: [],
          visible: true,
        },
      },
      rootIds: ['ent-1'],
    };

    beforeEach(() => {
      store.getState().updateSceneGraph(graph);
      mockDispatch.mockClear();
    });

    it('dispatches rename_entity with the new name', () => {
      store.getState().renameEntity('ent-1', 'NewName');

      expect(mockDispatch).toHaveBeenCalledOnce();
      expect(mockDispatch).toHaveBeenCalledWith('rename_entity', {
        entityId: 'ent-1',
        name: 'NewName',
      });
    });

    it('optimistically updates the node name', () => {
      store.getState().renameEntity('ent-1', 'NewName');

      expect(store.getState().sceneGraph.nodes['ent-1'].name).toBe('NewName');
    });

    it('updates primaryName when the renamed entity is the primary selection', () => {
      store = createTestStore({ primaryId: 'ent-1', primaryName: 'OldName' });
      store.getState().updateSceneGraph(graph);
      mockDispatch.mockClear();

      store.getState().renameEntity('ent-1', 'UpdatedName');

      expect(store.getState().primaryName).toBe('UpdatedName');
    });

    it('does not update primaryName when renamed entity is not selected', () => {
      store = createTestStore({ primaryId: 'ent-2', primaryName: 'Other' });
      store.getState().updateSceneGraph(graph);
      mockDispatch.mockClear();

      store.getState().renameEntity('ent-1', 'NewName');

      expect(store.getState().primaryName).toBe('Other');
    });
  });

  // -------------------------------------------------------------------------
  // 5. reparentEntity
  // -------------------------------------------------------------------------
  describe('reparentEntity', () => {
    it('dispatches reparent_entity with entityId and newParentId', () => {
      store.getState().reparentEntity('ent-child', 'ent-parent');

      expect(mockDispatch).toHaveBeenCalledOnce();
      expect(mockDispatch).toHaveBeenCalledWith('reparent_entity', {
        entityId: 'ent-child',
        newParentId: 'ent-parent',
        insertIndex: undefined,
      });
    });

    it('dispatches reparent_entity with null newParentId to detach from parent', () => {
      store.getState().reparentEntity('ent-child', null);

      expect(mockDispatch).toHaveBeenCalledWith('reparent_entity', {
        entityId: 'ent-child',
        newParentId: null,
        insertIndex: undefined,
      });
    });

    it('dispatches reparent_entity with an insertIndex when provided', () => {
      store.getState().reparentEntity('ent-child', 'ent-parent', 2);

      expect(mockDispatch).toHaveBeenCalledWith('reparent_entity', {
        entityId: 'ent-child',
        newParentId: 'ent-parent',
        insertIndex: 2,
      });
    });
  });

  // -------------------------------------------------------------------------
  // 6. deleteSelectedEntities
  // -------------------------------------------------------------------------
  describe('deleteSelectedEntities', () => {
    it('dispatches delete_entities with the current selected IDs', () => {
      store = createTestStore({ selectedIds: new Set(['ent-1', 'ent-2']) });

      store.getState().deleteSelectedEntities();

      expect(mockDispatch).toHaveBeenCalledOnce();
      const [command, payload] = mockDispatch.mock.calls[0] as [string, { entityIds: string[] }];
      expect(command).toBe('delete_entities');
      expect(payload.entityIds).toHaveLength(2);
      expect(payload.entityIds).toContain('ent-1');
      expect(payload.entityIds).toContain('ent-2');
    });

    it('optimistically clears the selection', () => {
      store = createTestStore({
        selectedIds: new Set(['ent-1']),
        primaryId: 'ent-1',
        primaryName: 'Cube',
      });

      store.getState().deleteSelectedEntities();

      expect(store.getState().selectedIds.size).toBe(0);
      expect(store.getState().primaryId).toBeNull();
      expect(store.getState().primaryName).toBeNull();
      expect(store.getState().primaryTransform).toBeNull();
    });

    it('does nothing when there are no selected entities', () => {
      store = createTestStore({ selectedIds: new Set() });

      store.getState().deleteSelectedEntities();

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 7. duplicateSelectedEntity
  // -------------------------------------------------------------------------
  describe('duplicateSelectedEntity', () => {
    it('dispatches duplicate_entity with the primary entity ID', () => {
      store = createTestStore({ primaryId: 'ent-42' });

      store.getState().duplicateSelectedEntity();

      expect(mockDispatch).toHaveBeenCalledOnce();
      expect(mockDispatch).toHaveBeenCalledWith('duplicate_entity', { entityId: 'ent-42' });
    });

    it('does nothing when no entity is selected (primaryId is null)', () => {
      store = createTestStore({ primaryId: null });

      store.getState().duplicateSelectedEntity();

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
