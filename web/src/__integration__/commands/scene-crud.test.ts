/**
 * Scene CRUD integration tests.
 *
 * These tests exercise the full command → store update cycle without the WASM
 * engine binary. They verify that:
 *   1. Actions on the store dispatch the correct commands to the engine.
 *   2. Simulated engine events (spawned/deleted) correctly mutate the store.
 *   3. Store state after commands is consistent and queryable.
 *
 * Pattern: action → assert dispatch + assert store state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestHarness } from '../harness';
import type { TestHarness } from '../harness';
import type { SceneNode } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SceneNode for test fixtures. */
function makeNode(
  entityId: string,
  name: string,
  parentId: string | null = null,
): SceneNode {
  return {
    entityId,
    name,
    parentId,
    children: [],
    components: ['Mesh'],
    visible: true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scene CRUD integration', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  // -------------------------------------------------------------------------
  // Spawn entity
  // -------------------------------------------------------------------------

  describe('spawn entity', () => {
    it('dispatches spawn_entity with entityType and name', () => {
      h.getState().spawnEntity('cube', 'MyCube');

      expect(h.dispatch).toHaveBeenCalledWith('spawn_entity', {
        entityType: 'cube',
        name: 'MyCube',
      });
    });

    it('dispatches spawn_entity without a name when omitted', () => {
      h.getState().spawnEntity('sphere');

      expect(h.dispatch).toHaveBeenCalledWith('spawn_entity', {
        entityType: 'sphere',
        name: undefined,
      });
    });

    it('after engine confirms spawn, node appears in sceneGraph', () => {
      h.getState().spawnEntity('cube', 'TestCube');

      // Engine would fire a SceneGraph update event; simulate it:
      h.simulateEntitySpawned(makeNode('entity-1', 'TestCube'));

      const state = h.getState();
      expect(state.sceneGraph.nodes['entity-1']).not.toBeUndefined();
      expect(state.sceneGraph.nodes['entity-1'].name).toBe('TestCube');
      expect(state.sceneGraph.rootIds).toContain('entity-1');
    });

    it('spawning multiple entities adds each to rootIds', () => {
      h.simulateEntitySpawned(makeNode('e1', 'Cube1'));
      h.simulateEntitySpawned(makeNode('e2', 'Sphere1'));

      const state = h.getState();
      expect(state.sceneGraph.rootIds).toContain('e1');
      expect(state.sceneGraph.rootIds).toContain('e2');
      expect(Object.keys(state.sceneGraph.nodes)).toHaveLength(2);
    });

    it('spawning a child entity attaches it to the parent children list', () => {
      h.simulateEntitySpawned(makeNode('parent-1', 'Parent'));
      h.simulateEntitySpawned(makeNode('child-1', 'Child', 'parent-1'));

      const state = h.getState();
      expect(state.sceneGraph.nodes['parent-1'].children).toContain('child-1');
      expect(state.sceneGraph.rootIds).not.toContain('child-1');
    });

    it('dispatches spawn_entity for each supported entity type', () => {
      const types = ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'empty'] as const;
      for (const type of types) {
        h.getState().spawnEntity(type);
      }
      expect(h.dispatch).toHaveBeenCalledTimes(types.length);
      for (const type of types) {
        expect(h.dispatch).toHaveBeenCalledWith('spawn_entity', expect.objectContaining({ entityType: type }));
      }
    });
  });

  // -------------------------------------------------------------------------
  // Delete entity
  // -------------------------------------------------------------------------

  describe('delete entity', () => {
    it('dispatches delete_entities with the selected entity ID', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'Cube'));
      h.getState().selectEntity('entity-1', 'replace');
      h.dispatch.mockClear(); // ignore the select_entity dispatch

      h.getState().deleteSelectedEntities();

      expect(h.dispatch).toHaveBeenCalledWith('delete_entities', {
        entityIds: ['entity-1'],
      });
    });

    it('clears selection state immediately on delete (optimistic)', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'Cube'));
      h.getState().selectEntity('entity-1', 'replace');
      h.getState().deleteSelectedEntities();

      const state = h.getState();
      expect(state.selectedIds.size).toBe(0);
      expect(state.primaryId).toBeNull();
      expect(state.primaryName).toBeNull();
    });

    it('after engine confirms deletion, node is removed from sceneGraph', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'Cube'));
      expect(h.getState().sceneGraph.nodes['entity-1']).not.toBeUndefined();

      // Engine fires delete event:
      h.simulateEntityDeleted('entity-1');

      expect(h.getState().sceneGraph.nodes['entity-1']).toBeUndefined();
      expect(h.getState().sceneGraph.rootIds).not.toContain('entity-1');
    });

    it('deleting multiple selected entities dispatches all IDs at once', () => {
      h.simulateEntitySpawned(makeNode('e1', 'Cube1'));
      h.simulateEntitySpawned(makeNode('e2', 'Cube2'));

      h.getState().setSelection(['e1', 'e2'], 'e1', null);
      h.dispatch.mockClear();

      h.getState().deleteSelectedEntities();

      expect(h.dispatch).toHaveBeenCalledWith('delete_entities', {
        entityIds: expect.arrayContaining(['e1', 'e2']),
      });
    });

    it('no-op when nothing is selected', () => {
      h.getState().deleteSelectedEntities();
      expect(h.dispatch).not.toHaveBeenCalledWith('delete_entities', expect.anything());
    });

    it('deleting a child removes it from parent children list', () => {
      h.simulateEntitySpawned(makeNode('parent-1', 'Parent'));
      h.simulateEntitySpawned(makeNode('child-1', 'Child', 'parent-1'));

      h.simulateEntityDeleted('child-1');

      const parent = h.getState().sceneGraph.nodes['parent-1'];
      expect(parent.children).not.toContain('child-1');
    });
  });

  // -------------------------------------------------------------------------
  // Rename entity
  // -------------------------------------------------------------------------

  describe('rename entity', () => {
    it('dispatches rename_entity with entityId and new name', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'OldName'));
      h.dispatch.mockClear();

      h.getState().renameEntity('entity-1', 'NewName');

      expect(h.dispatch).toHaveBeenCalledWith('rename_entity', {
        entityId: 'entity-1',
        name: 'NewName',
      });
    });

    it('updates the node name in sceneGraph immediately (optimistic)', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'OldName'));

      h.getState().renameEntity('entity-1', 'NewName');

      expect(h.getState().sceneGraph.nodes['entity-1'].name).toBe('NewName');
    });

    it('updates primaryName when renaming the selected entity', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'OldName'));
      h.getState().selectEntity('entity-1', 'replace');
      h.dispatch.mockClear();

      h.getState().renameEntity('entity-1', 'NewName');

      expect(h.getState().primaryName).toBe('NewName');
    });

    it('does not affect primaryName when renaming a non-selected entity', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'Alpha'));
      h.simulateEntitySpawned(makeNode('entity-2', 'Beta'));
      h.getState().selectEntity('entity-1', 'replace');
      h.dispatch.mockClear();

      h.getState().renameEntity('entity-2', 'BetaRenamed');

      expect(h.getState().primaryName).toBe('Alpha');
      expect(h.getState().sceneGraph.nodes['entity-2'].name).toBe('BetaRenamed');
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate entity
  // -------------------------------------------------------------------------

  describe('duplicate entity', () => {
    it('dispatches duplicate_entity for the selected entity', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'Original'));
      h.getState().selectEntity('entity-1', 'replace');
      h.dispatch.mockClear();

      h.getState().duplicateSelectedEntity();

      expect(h.dispatch).toHaveBeenCalledWith('duplicate_entity', {
        entityId: 'entity-1',
      });
    });

    it('no-op when no entity is selected', () => {
      h.getState().duplicateSelectedEntity();
      expect(h.dispatch).not.toHaveBeenCalledWith('duplicate_entity', expect.anything());
    });

    it('after engine confirms duplication, copy appears in sceneGraph', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'Original'));
      h.getState().selectEntity('entity-1', 'replace');
      h.getState().duplicateSelectedEntity();

      // Engine fires spawn event for the copy:
      h.simulateEntitySpawned(makeNode('entity-2', 'Original (Copy)'));

      const state = h.getState();
      expect(state.sceneGraph.nodes['entity-2']).not.toBeUndefined();
      expect(state.sceneGraph.nodes['entity-2'].name).toBe('Original (Copy)');
      expect(Object.keys(state.sceneGraph.nodes)).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Selection state consistency
  // -------------------------------------------------------------------------

  describe('selection consistency', () => {
    it('selecting an entity updates selectedIds and primaryId', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'Cube'));

      h.getState().selectEntity('entity-1', 'replace');

      const state = h.getState();
      expect(state.selectedIds.has('entity-1')).toBe(true);
      expect(state.primaryId).toBe('entity-1');
      expect(state.primaryName).toBe('Cube');
    });

    it('replacing selection clears previous selection', () => {
      h.simulateEntitySpawned(makeNode('e1', 'Cube'));
      h.simulateEntitySpawned(makeNode('e2', 'Sphere'));
      h.getState().selectEntity('e1', 'replace');

      h.getState().selectEntity('e2', 'replace');

      const state = h.getState();
      expect(state.selectedIds.has('e1')).toBe(false);
      expect(state.selectedIds.has('e2')).toBe(true);
      expect(state.primaryId).toBe('e2');
    });

    it('adding to selection preserves existing selection', () => {
      h.simulateEntitySpawned(makeNode('e1', 'Cube'));
      h.simulateEntitySpawned(makeNode('e2', 'Sphere'));
      h.getState().selectEntity('e1', 'replace');

      h.getState().selectEntity('e2', 'add');

      const state = h.getState();
      expect(state.selectedIds.has('e1')).toBe(true);
      expect(state.selectedIds.has('e2')).toBe(true);
    });

    it('clearing selection resets all selection state', () => {
      h.simulateEntitySpawned(makeNode('entity-1', 'Cube'));
      h.getState().selectEntity('entity-1', 'replace');

      h.getState().clearSelection();

      const state = h.getState();
      expect(state.selectedIds.size).toBe(0);
      expect(state.primaryId).toBeNull();
      expect(state.primaryName).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Scene load
  // -------------------------------------------------------------------------

  describe('scene load', () => {
    it('simulateSceneLoaded populates full sceneGraph', () => {
      // The engine sends nodes with children arrays already populated
      const cubeNode: SceneNode = { ...makeNode('cube-1', 'Cube'), children: ['sphere-1'] };
      const sphereNode: SceneNode = { ...makeNode('sphere-1', 'Sphere', 'cube-1'), children: [] };
      h.simulateSceneLoaded([
        makeNode('cam-1', 'Camera'),
        cubeNode,
        sphereNode,
      ]);

      const state = h.getState();
      expect(Object.keys(state.sceneGraph.nodes)).toHaveLength(3);
      expect(state.sceneGraph.rootIds).toEqual(expect.arrayContaining(['cam-1', 'cube-1']));
      expect(state.sceneGraph.rootIds).not.toContain('sphere-1');
      expect(state.sceneGraph.nodes['cube-1'].children).toContain('sphere-1');
    });

    it('simulateSceneLoaded replaces a previously loaded scene', () => {
      h.simulateSceneLoaded([makeNode('old-1', 'OldEntity')]);

      h.simulateSceneLoaded([makeNode('new-1', 'NewEntity')]);

      const state = h.getState();
      expect(state.sceneGraph.nodes['old-1']).toBeUndefined();
      expect(state.sceneGraph.nodes['new-1']).not.toBeUndefined();
    });

    it('empty scene load results in empty graph', () => {
      h.simulateSceneLoaded([makeNode('entity-1', 'Cube')]);

      h.simulateSceneLoaded([]);

      const state = h.getState();
      expect(Object.keys(state.sceneGraph.nodes)).toHaveLength(0);
      expect(state.sceneGraph.rootIds).toHaveLength(0);
    });
  });
});
