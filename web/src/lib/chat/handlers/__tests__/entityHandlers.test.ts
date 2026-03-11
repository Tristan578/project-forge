/**
 * Tests for entityHandlers — spawn, delete, transform, selection,
 * editor controls, history, query, and runtime mode commands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { entityHandlers } from '../entityHandlers';

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// spawn_entity
// ===========================================================================

describe('spawn_entity', () => {
  it('returns error when entityType is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'spawn_entity', {});
    expect(result.success).toBe(false);
  });

  it('returns error for unknown entityType', async () => {
    const { result } = await invokeHandler(entityHandlers, 'spawn_entity', {
      entityType: 'alien_ship',
    });
    expect(result.success).toBe(false);
  });

  it('spawns cube and calls store.spawnEntity', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'spawn_entity', {
      entityType: 'cube',
    });
    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledWith('cube', undefined);
  });

  it('passes name to spawnEntity when provided', async () => {
    const { store } = await invokeHandler(entityHandlers, 'spawn_entity', {
      entityType: 'sphere',
      name: 'MyBall',
    });
    expect(store.spawnEntity).toHaveBeenCalledWith('sphere', 'MyBall');
  });

  it('accepts all valid entity types', async () => {
    const types = [
      'cube', 'sphere', 'cylinder', 'capsule', 'torus', 'plane', 'cone', 'icosphere',
      'point_light', 'directional_light', 'spot_light', 'gltf_model', 'empty',
    ];
    for (const entityType of types) {
      const { result } = await invokeHandler(entityHandlers, 'spawn_entity', { entityType });
      expect(result.success).toBe(true);
    }
  });

  it('result message includes entityType', async () => {
    const { result } = await invokeHandler(entityHandlers, 'spawn_entity', {
      entityType: 'torus',
    });
    const data = result.result as { message: string };
    expect(data.message).toContain('torus');
  });
});

// ===========================================================================
// despawn_entity
// ===========================================================================

describe('despawn_entity', () => {
  it('deletes single entity via entityId', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'despawn_entity', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['ent-1'], 'ent-1', null);
    expect(store.deleteSelectedEntities).toHaveBeenCalledTimes(1);
    const data = result.result as { deleted: number };
    expect(data.deleted).toBe(1);
  });

  it('deletes multiple entities via entityIds', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'despawn_entity', {
      entityIds: ['ent-1', 'ent-2', 'ent-3'],
    });
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['ent-1', 'ent-2', 'ent-3'], 'ent-1', null);
    const data = result.result as { deleted: number };
    expect(data.deleted).toBe(3);
  });

  it('does not call setSelection or delete when no ids given', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'despawn_entity', {});
    expect(result.success).toBe(true);
    expect(store.setSelection).not.toHaveBeenCalled();
    expect(store.deleteSelectedEntities).not.toHaveBeenCalled();
    const data = result.result as { deleted: number };
    expect(data.deleted).toBe(0);
  });
});

// ===========================================================================
// delete_entities
// ===========================================================================

describe('delete_entities', () => {
  it('deletes entity via entityId', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'delete_entities', {
      entityId: 'ent-5',
    });
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['ent-5'], 'ent-5', null);
    expect(store.deleteSelectedEntities).toHaveBeenCalledTimes(1);
  });

  it('deletes multiple entities via entityIds', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'delete_entities', {
      entityIds: ['ent-1', 'ent-2'],
    });
    expect(result.success).toBe(true);
    const data = result.result as { deleted: number };
    expect(data.deleted).toBe(2);
    expect(store.deleteSelectedEntities).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// duplicate_entity
// ===========================================================================

describe('duplicate_entity', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'duplicate_entity', {});
    expect(result.success).toBe(false);
  });

  it('selects entity and calls duplicateSelectedEntity', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'duplicate_entity', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    expect(store.selectEntity).toHaveBeenCalledWith('ent-1', 'replace');
    expect(store.duplicateSelectedEntity).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// update_transform
// ===========================================================================

describe('update_transform', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'update_transform', {
      position: [0, 0, 0],
    });
    expect(result.success).toBe(false);
  });

  it('updates position when provided', async () => {
    const pos = { x: 1, y: 2, z: 3 };
    const { result, store } = await invokeHandler(entityHandlers, 'update_transform', {
      entityId: 'ent-1',
      position: pos,
    });
    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledWith('ent-1', 'position', pos);
  });

  it('updates rotation when provided', async () => {
    const rot = { x: 0, y: 90, z: 0 };
    const { store } = await invokeHandler(entityHandlers, 'update_transform', {
      entityId: 'ent-1',
      rotation: rot,
    });
    expect(store.updateTransform).toHaveBeenCalledWith('ent-1', 'rotation', rot);
  });

  it('updates scale when provided', async () => {
    const scale = { x: 2, y: 2, z: 2 };
    const { store } = await invokeHandler(entityHandlers, 'update_transform', {
      entityId: 'ent-1',
      scale,
    });
    expect(store.updateTransform).toHaveBeenCalledWith('ent-1', 'scale', scale);
  });

  it('updates all three properties when all provided', async () => {
    const { store } = await invokeHandler(entityHandlers, 'update_transform', {
      entityId: 'ent-1',
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(store.updateTransform).toHaveBeenCalledTimes(3);
  });

  it('does not call updateTransform when no position/rotation/scale given', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'update_transform', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    expect(store.updateTransform).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// rename_entity
// ===========================================================================

describe('rename_entity', () => {
  it('returns error when name is empty', async () => {
    const { result } = await invokeHandler(entityHandlers, 'rename_entity', {
      entityId: 'ent-1',
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('calls store.renameEntity with correct args', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'rename_entity', {
      entityId: 'ent-1',
      name: 'NewName',
    });
    expect(result.success).toBe(true);
    expect(store.renameEntity).toHaveBeenCalledWith('ent-1', 'NewName');
  });
});

// ===========================================================================
// reparent_entity
// ===========================================================================

describe('reparent_entity', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'reparent_entity', {
      newParentId: 'parent-1',
    });
    expect(result.success).toBe(false);
  });

  it('calls store.reparentEntity with newParentId and insertIndex', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'reparent_entity', {
      entityId: 'ent-1',
      newParentId: 'parent-1',
      insertIndex: 2,
    });
    expect(result.success).toBe(true);
    expect(store.reparentEntity).toHaveBeenCalledWith('ent-1', 'parent-1', 2);
  });

  it('accepts null newParentId to detach entity', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'reparent_entity', {
      entityId: 'ent-1',
      newParentId: null,
    });
    expect(result.success).toBe(true);
    expect(store.reparentEntity).toHaveBeenCalledWith('ent-1', null, undefined);
  });
});

// ===========================================================================
// set_visibility
// ===========================================================================

describe('set_visibility', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'set_visibility', {});
    expect(result.success).toBe(false);
  });

  it('calls store.toggleVisibility', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'set_visibility', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    expect(store.toggleVisibility).toHaveBeenCalledWith('ent-1');
  });
});

// ===========================================================================
// select_entity
// ===========================================================================

describe('select_entity', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'select_entity', {});
    expect(result.success).toBe(false);
  });

  it('selects with replace mode by default', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'select_entity', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    expect(store.selectEntity).toHaveBeenCalledWith('ent-1', 'replace');
  });

  it('passes mode when provided', async () => {
    const { store } = await invokeHandler(entityHandlers, 'select_entity', {
      entityId: 'ent-1',
      mode: 'add',
    });
    expect(store.selectEntity).toHaveBeenCalledWith('ent-1', 'add');
  });
});

// ===========================================================================
// select_entities
// ===========================================================================

describe('select_entities', () => {
  it('returns error when entityIds is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'select_entities', {});
    expect(result.success).toBe(false);
  });

  it('calls setSelection with all provided ids', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'select_entities', {
      entityIds: ['ent-1', 'ent-2'],
    });
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['ent-1', 'ent-2'], 'ent-1', null);
  });

  it('does not call setSelection when entityIds is empty', async () => {
    const { store } = await invokeHandler(entityHandlers, 'select_entities', {
      entityIds: [],
    });
    expect(store.setSelection).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// clear_selection
// ===========================================================================

describe('clear_selection', () => {
  it('calls store.clearSelection', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'clear_selection', {});
    expect(result.success).toBe(true);
    expect(store.clearSelection).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// set_gizmo_mode
// ===========================================================================

describe('set_gizmo_mode', () => {
  it('returns error when mode is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'set_gizmo_mode', {});
    expect(result.success).toBe(false);
  });

  it('calls store.setGizmoMode', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'set_gizmo_mode', {
      mode: 'translate',
    });
    expect(result.success).toBe(true);
    expect(store.setGizmoMode).toHaveBeenCalledWith('translate');
  });
});

// ===========================================================================
// set_coordinate_mode
// ===========================================================================

describe('set_coordinate_mode', () => {
  it('returns error for invalid mode', async () => {
    const { result } = await invokeHandler(entityHandlers, 'set_coordinate_mode', {
      mode: 'universal',
    });
    expect(result.success).toBe(false);
  });

  it('calls toggleCoordinateMode when mode differs from current', async () => {
    const { result, store } = await invokeHandler(
      entityHandlers,
      'set_coordinate_mode',
      { mode: 'local' },
      { coordinateMode: 'world' },
    );
    expect(result.success).toBe(true);
    expect(store.toggleCoordinateMode).toHaveBeenCalledTimes(1);
  });

  it('does not toggle when mode already matches', async () => {
    const { result, store } = await invokeHandler(
      entityHandlers,
      'set_coordinate_mode',
      { mode: 'world' },
      { coordinateMode: 'world' },
    );
    expect(result.success).toBe(true);
    expect(store.toggleCoordinateMode).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// toggle_grid
// ===========================================================================

describe('toggle_grid', () => {
  it('calls store.toggleGrid', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'toggle_grid', {});
    expect(result.success).toBe(true);
    expect(store.toggleGrid).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// set_snap_settings
// ===========================================================================

describe('set_snap_settings', () => {
  it('calls store.setSnapSettings with args', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'set_snap_settings', {
      translateSnap: 0.5,
      rotateSnap: 15,
    });
    expect(result.success).toBe(true);
    expect(store.setSnapSettings).toHaveBeenCalledWith({ translateSnap: 0.5, rotateSnap: 15 });
  });
});

// ===========================================================================
// set_camera_preset
// ===========================================================================

describe('set_camera_preset', () => {
  it('returns error for invalid preset', async () => {
    const { result } = await invokeHandler(entityHandlers, 'set_camera_preset', {
      preset: 'sideways',
    });
    expect(result.success).toBe(false);
  });

  it('calls store.setCameraPreset', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'set_camera_preset', {
      preset: 'top',
    });
    expect(result.success).toBe(true);
    expect(store.setCameraPreset).toHaveBeenCalledWith('top');
  });
});

// ===========================================================================
// focus_camera
// ===========================================================================

describe('focus_camera', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'focus_camera', {});
    expect(result.success).toBe(false);
  });

  it('selects entity and returns instruction message', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'focus_camera', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    expect(store.selectEntity).toHaveBeenCalledWith('ent-1', 'replace');
    const data = result.result as { message: string };
    expect(data.message).toContain('F');
  });
});

// ===========================================================================
// undo / redo
// ===========================================================================

describe('undo', () => {
  it('calls store.undo and returns success', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'undo', {});
    expect(result.success).toBe(true);
    expect(store.undo).toHaveBeenCalledTimes(1);
  });
});

describe('redo', () => {
  it('calls store.redo and returns success', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'redo', {});
    expect(result.success).toBe(true);
    expect(store.redo).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// get_scene_graph
// ===========================================================================

describe('get_scene_graph', () => {
  it('returns empty entities list when scene is empty', async () => {
    const { result } = await invokeHandler(entityHandlers, 'get_scene_graph', {});
    expect(result.success).toBe(true);
    const data = result.result as { entities: unknown[]; count: number };
    expect(data.entities).toHaveLength(0);
    expect(data.count).toBe(0);
  });

  it('returns entity summaries from scene graph', async () => {
    const { result } = await invokeHandler(entityHandlers, 'get_scene_graph', {}, {
      sceneGraph: {
        nodes: {
          'e1': { entityId: 'e1', name: 'Player', parentId: null, children: [], visible: true, components: [] },
          'e2': { entityId: 'e2', name: 'Enemy', parentId: null, children: [], visible: false, components: [] },
        },
        rootIds: ['e1', 'e2'],
      },
    });
    const data = result.result as { entities: Array<{ id: string; name: string }>; count: number };
    expect(data.entities).toHaveLength(2);
    expect(data.count).toBe(2);
    const names = data.entities.map((e) => e.name);
    expect(names).toContain('Player');
    expect(names).toContain('Enemy');
  });
});

// ===========================================================================
// get_entity_details
// ===========================================================================

describe('get_entity_details', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(entityHandlers, 'get_entity_details', {});
    expect(result.success).toBe(false);
  });

  it('returns error when entity is not found', async () => {
    const { result } = await invokeHandler(entityHandlers, 'get_entity_details', {
      entityId: 'missing',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Entity not found');
  });

  it('returns entity details when found', async () => {
    const node = {
      entityId: 'e1',
      name: 'Player',
      components: ['CharacterController', 'Health'],
      visible: true,
      children: ['e2'],
      parentId: null,
    };
    const { result } = await invokeHandler(entityHandlers, 'get_entity_details', {
      entityId: 'e1',
    }, {
      sceneGraph: { nodes: { 'e1': node }, rootIds: ['e1'] },
    });
    expect(result.success).toBe(true);
    const data = result.result as { name: string; components: string[]; visible: boolean };
    expect(data.name).toBe('Player');
    expect(data.components).toContain('Health');
    expect(data.visible).toBe(true);
  });
});

// ===========================================================================
// get_selection
// ===========================================================================

describe('get_selection', () => {
  it('returns current selection from store', async () => {
    const { result } = await invokeHandler(entityHandlers, 'get_selection', {}, {
      selectedIds: new Set(['e1', 'e2']),
      primaryId: 'e1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { selectedIds: string[]; primaryId: string };
    expect(data.selectedIds).toContain('e1');
    expect(data.selectedIds).toContain('e2');
    expect(data.primaryId).toBe('e1');
  });
});

// ===========================================================================
// get_camera_state
// ===========================================================================

describe('get_camera_state', () => {
  it('returns current camera preset', async () => {
    const { result } = await invokeHandler(entityHandlers, 'get_camera_state', {}, {
      currentCameraPreset: 'perspective',
    });
    expect(result.success).toBe(true);
    const data = result.result as { preset: string };
    expect(data.preset).toBe('perspective');
  });
});

// ===========================================================================
// play / stop / pause / resume / get_mode
// ===========================================================================

describe('play', () => {
  it('returns error when not in edit mode', async () => {
    const { result } = await invokeHandler(entityHandlers, 'play', {}, {
      engineMode: 'play',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('play mode');
  });

  it('calls store.play when in edit mode', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'play', {}, {
      engineMode: 'edit',
    });
    expect(result.success).toBe(true);
    expect(store.play).toHaveBeenCalledTimes(1);
  });
});

describe('stop', () => {
  it('returns error when already in edit mode', async () => {
    const { result } = await invokeHandler(entityHandlers, 'stop', {}, {
      engineMode: 'edit',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('edit mode');
  });

  it('calls store.stop when in play mode', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'stop', {}, {
      engineMode: 'play',
    });
    expect(result.success).toBe(true);
    expect(store.stop).toHaveBeenCalledTimes(1);
  });
});

describe('pause', () => {
  it('returns error when not in play mode', async () => {
    const { result } = await invokeHandler(entityHandlers, 'pause', {}, {
      engineMode: 'edit',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not in play mode');
  });

  it('calls store.pause when in play mode', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'pause', {}, {
      engineMode: 'play',
    });
    expect(result.success).toBe(true);
    expect(store.pause).toHaveBeenCalledTimes(1);
  });
});

describe('resume', () => {
  it('returns error when not in paused mode', async () => {
    const { result } = await invokeHandler(entityHandlers, 'resume', {}, {
      engineMode: 'play',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not paused');
  });

  it('calls store.resume when paused', async () => {
    const { result, store } = await invokeHandler(entityHandlers, 'resume', {}, {
      engineMode: 'paused',
    });
    expect(result.success).toBe(true);
    expect(store.resume).toHaveBeenCalledTimes(1);
  });
});

describe('get_mode', () => {
  it('returns current engineMode', async () => {
    const { result } = await invokeHandler(entityHandlers, 'get_mode', {}, {
      engineMode: 'paused',
    });
    expect(result.success).toBe(true);
    const data = result.result as { mode: string };
    expect(data.mode).toBe('paused');
  });
});
