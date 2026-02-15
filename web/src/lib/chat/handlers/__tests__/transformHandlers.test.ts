import { describe, it, expect } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { transformHandlers } from '../transformHandlers';

describe('transformHandlers', () => {
  it('spawn_entity calls spawnEntity', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'spawn_entity', {
      entityType: 'cube',
      name: 'MyCube',
    });
    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'MyCube');
  });

  it('despawn_entity calls setSelection and deleteSelectedEntities with entityIds array', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'despawn_entity', {
      entityIds: ['1', '2', '3'],
    });
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['1', '2', '3'], '1', null);
    expect(store.deleteSelectedEntities).toHaveBeenCalled();
  });

  it('despawn_entity calls setSelection and deleteSelectedEntities with single entityId fallback', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'despawn_entity', {
      entityId: 'solo',
    });
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['solo'], 'solo', null);
    expect(store.deleteSelectedEntities).toHaveBeenCalled();
  });

  it('delete_entities calls setSelection and deleteSelectedEntities with entityIds array', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'delete_entities', {
      entityIds: ['a', 'b'],
    });
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['a', 'b'], 'a', null);
    expect(store.deleteSelectedEntities).toHaveBeenCalled();
  });

  it('delete_entities calls setSelection and deleteSelectedEntities with single entityId fallback', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'delete_entities', {
      entityId: 'single',
    });
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['single'], 'single', null);
    expect(store.deleteSelectedEntities).toHaveBeenCalled();
  });

  it('duplicate_entity calls selectEntity and duplicateSelectedEntity', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'duplicate_entity', {
      entityId: 'ent1',
    });
    expect(result.success).toBe(true);
    expect(store.selectEntity).toHaveBeenCalledWith('ent1', 'replace');
    expect(store.duplicateSelectedEntity).toHaveBeenCalled();
  });

  it('update_transform calls updateTransform with position only', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'update_transform', {
      entityId: 'ent2',
      position: { x: 1, y: 2, z: 3 },
    });
    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledWith('ent2', 'position', { x: 1, y: 2, z: 3 });
    expect(store.updateTransform).toHaveBeenCalledTimes(1);
  });

  it('update_transform calls updateTransform with rotation only', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'update_transform', {
      entityId: 'ent3',
      rotation: { x: 0, y: 90, z: 0 },
    });
    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledWith('ent3', 'rotation', { x: 0, y: 90, z: 0 });
    expect(store.updateTransform).toHaveBeenCalledTimes(1);
  });

  it('update_transform calls updateTransform with all three axes', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'update_transform', {
      entityId: 'ent4',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    });
    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledWith('ent4', 'position', { x: 1, y: 2, z: 3 });
    expect(store.updateTransform).toHaveBeenCalledWith('ent4', 'rotation', { x: 0, y: 90, z: 0 });
    expect(store.updateTransform).toHaveBeenCalledWith('ent4', 'scale', { x: 2, y: 2, z: 2 });
    expect(store.updateTransform).toHaveBeenCalledTimes(3);
  });

  it('rename_entity calls renameEntity', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'rename_entity', {
      entityId: 'ent5',
      name: 'NewName',
    });
    expect(result.success).toBe(true);
    expect(store.renameEntity).toHaveBeenCalledWith('ent5', 'NewName');
  });

  it('reparent_entity calls reparentEntity with insertIndex', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'reparent_entity', {
      entityId: 'child',
      newParentId: 'parent',
      insertIndex: 2,
    });
    expect(result.success).toBe(true);
    expect(store.reparentEntity).toHaveBeenCalledWith('child', 'parent', 2);
  });

  it('reparent_entity calls reparentEntity without insertIndex', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'reparent_entity', {
      entityId: 'child2',
      newParentId: 'parent2',
    });
    expect(result.success).toBe(true);
    expect(store.reparentEntity).toHaveBeenCalledWith('child2', 'parent2', undefined);
  });

  it('set_visibility calls toggleVisibility', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'set_visibility', {
      entityId: 'ent6',
    });
    expect(result.success).toBe(true);
    expect(store.toggleVisibility).toHaveBeenCalledWith('ent6');
  });

  it('select_entity calls selectEntity with mode', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'select_entity', {
      entityId: 'ent7',
      mode: 'add',
    });
    expect(result.success).toBe(true);
    expect(store.selectEntity).toHaveBeenCalledWith('ent7', 'add');
  });

  it('select_entity calls selectEntity with default mode', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'select_entity', {
      entityId: 'ent8',
    });
    expect(result.success).toBe(true);
    expect(store.selectEntity).toHaveBeenCalledWith('ent8', 'replace');
  });

  it('select_entities calls setSelection', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'select_entities', {
      entityIds: ['e1', 'e2', 'e3'],
    });
    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['e1', 'e2', 'e3'], 'e1', null);
  });

  it('clear_selection calls clearSelection', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'clear_selection');
    expect(result.success).toBe(true);
    expect(store.clearSelection).toHaveBeenCalled();
  });

  it('set_gizmo_mode calls setGizmoMode', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'set_gizmo_mode', {
      mode: 'rotate',
    });
    expect(result.success).toBe(true);
    expect(store.setGizmoMode).toHaveBeenCalledWith('rotate');
  });

  it('set_coordinate_mode toggles when mode is different', async () => {
    const { result, store } = await invokeHandler(
      transformHandlers,
      'set_coordinate_mode',
      { mode: 'local' },
      { coordinateMode: 'world' }
    );
    expect(result.success).toBe(true);
    expect(store.toggleCoordinateMode).toHaveBeenCalled();
  });

  it('set_coordinate_mode does not toggle when mode matches current', async () => {
    const { result, store } = await invokeHandler(
      transformHandlers,
      'set_coordinate_mode',
      { mode: 'world' },
      { coordinateMode: 'world' }
    );
    expect(result.success).toBe(true);
    expect(store.toggleCoordinateMode).not.toHaveBeenCalled();
  });

  it('toggle_grid calls toggleGrid', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'toggle_grid');
    expect(result.success).toBe(true);
    expect(store.toggleGrid).toHaveBeenCalled();
  });

  it('set_snap_settings calls setSnapSettings', async () => {
    const args = { positionSnap: 0.5, rotationSnap: 15, scaleSnap: 0.1 };
    const { result, store } = await invokeHandler(transformHandlers, 'set_snap_settings', args);
    expect(result.success).toBe(true);
    expect(store.setSnapSettings).toHaveBeenCalledWith(args);
  });

  it('set_camera_preset calls setCameraPreset', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'set_camera_preset', {
      preset: 'top',
    });
    expect(result.success).toBe(true);
    expect(store.setCameraPreset).toHaveBeenCalledWith('top');
  });

  it('focus_camera calls selectEntity with replace mode', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'focus_camera', {
      entityId: 'ent9',
    });
    expect(result.success).toBe(true);
    expect(store.selectEntity).toHaveBeenCalledWith('ent9', 'replace');
  });

  it('undo calls undo', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'undo');
    expect(result.success).toBe(true);
    expect(store.undo).toHaveBeenCalled();
  });

  it('redo calls redo', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'redo');
    expect(result.success).toBe(true);
    expect(store.redo).toHaveBeenCalled();
  });
});
