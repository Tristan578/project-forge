import { describe, it, expect, vi } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { transformHandlers } from '../transformHandlers';
import { create } from 'zustand';
import { createSceneGraphSlice, type SceneGraphSlice } from '@/stores/slices/sceneGraphSlice';

describe('transformHandlers', () => {
  it('spawn_entity calls spawnEntity and surfaces the returned id', async () => {
    const { result, store } = await invokeHandler(
      transformHandlers,
      'spawn_entity',
      { entityType: 'cube', name: 'MyCube' },
      { spawnEntity: vi.fn(() => 'cube-1') },
    );
    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'MyCube', undefined);
    expect((result.result as { entityId?: string }).entityId).toBe('cube-1');
  });

  it('spawn_entity passes a valid position through to the store (PF-1112)', async () => {
    // `position` has been documented on spawn_entity in the manifest all along and
    // the engine honors it, but the handler parsed only entityType/name — so the
    // AI could ask for a cube at 5,0,3, get a success, and find it at the origin.
    const { result, store } = await invokeHandler(
      transformHandlers,
      'spawn_entity',
      { entityType: 'cube', name: 'MyCube', position: [5, 0, 3] },
      { spawnEntity: vi.fn(() => 'cube-1') },
    );
    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledWith('cube', 'MyCube', [5, 0, 3]);
  });

  it.each([
    ['wrong arity', [1, 2]],
    ['too many elements', [1, 2, 3, 4]],
    ['a non-number element', [1, 'two', 3]],
    ['a non-finite element', [1, Number.NaN, 3]],
    ['not an array', { x: 1, y: 2, z: 3 }],
  ])('spawn_entity rejects a position with %s rather than dropping it', async (_label, position) => {
    // Silently ignoring a malformed position is the same defect as never reading
    // it: the caller is told the entity landed where it asked. Fail loudly instead.
    const spawnEntity = vi.fn(() => 'cube-1');
    const { result } = await invokeHandler(
      transformHandlers,
      'spawn_entity',
      { entityType: 'cube', position },
      { spawnEntity },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('position');
    expect(spawnEntity).not.toHaveBeenCalled();
  });

  it('spawn_entity returns the id from spawnEntity (not the stale primaryId)', async () => {
    // #8748: the handler must surface the synchronously-returned id so the
    // caller can target the new entity. With primaryId left at its default
    // (null on a fresh scene), the only correct source is spawnEntity's return.
    const { result } = await invokeHandler(
      transformHandlers,
      'spawn_entity',
      { entityType: 'cube', name: 'MyCube' },
      { spawnEntity: vi.fn(() => 'spawned-uuid'), primaryId: null },
    );
    expect(result.success).toBe(true);
    expect((result.result as { entityId?: string }).entityId).toBe('spawned-uuid');
  });

  it('spawn_entity rejects a non-spawnable type instead of reporting a phantom success (#8748)', async () => {
    // icosphere/empty/gltf_model are JS-only union members the engine never spawns via
    // spawn_entity. The schema (derived from SPAWNABLE_ENTITY_TYPES) must reject them
    // rather than return success with an undefined entityId that follow-up commands
    // would target in vain.
    const { result } = await invokeHandler(
      transformHandlers,
      'spawn_entity',
      { entityType: 'icosphere', name: 'Nope' },
      { spawnEntity: vi.fn(() => undefined) },
    );
    expect(result.success).toBe(false);
  });

  it('spawn_entity fails (not a phantom success) when the engine returns no id', async () => {
    // A spawnable type whose dispatch produced no entity (engine not loaded yet) must
    // not report success with an undefined entityId.
    const { result } = await invokeHandler(
      transformHandlers,
      'spawn_entity',
      { entityType: 'cube', name: 'MyCube' },
      { spawnEntity: vi.fn(() => undefined) },
    );
    expect(result.success).toBe(false);
    expect((result.result as { entityId?: string } | undefined)?.entityId).toBeUndefined();
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

  it('set_visibility calls toggleVisibility when state differs', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'set_visibility', {
      entityId: 'ent6',
      visible: false,
    });
    expect(result.success).toBe(true);
    expect(store.toggleVisibility).toHaveBeenCalledWith('ent6');
  });

  it('set_visibility is idempotent when already in requested state', async () => {
    const { result, store } = await invokeHandler(transformHandlers, 'set_visibility', {
      entityId: 'ent6',
      visible: true,
    });
    expect(result.success).toBe(true);
    // default visible is true (no sceneGraph node) — no toggle needed
    expect(store.toggleVisibility).not.toHaveBeenCalled();
  });

  it('ignores inherited visibility but honors an own constructor entity node', async () => {
    const inherited = await invokeHandler(transformHandlers, 'set_visibility', {
      entityId: 'constructor', visible: true,
    }, {
      sceneGraph: { nodes: Object.create({ constructor: { visible: false } }), rootIds: [] },
    });
    expect(inherited.result.success).toBe(true);
    expect(inherited.store.toggleVisibility).not.toHaveBeenCalled();
    expect(inherited.dispatchCommand).not.toHaveBeenCalled();

    const own = await invokeHandler(transformHandlers, 'set_visibility', {
      entityId: 'constructor', visible: true,
    }, {
      sceneGraph: { nodes: { constructor: { visible: false } }, rootIds: [] },
    });
    expect(own.result.success).toBe(true);
    expect(own.store.toggleVisibility).toHaveBeenCalledWith('constructor');
  });

  it('set_visibility rejects missing visible param', async () => {
    const { result } = await invokeHandler(transformHandlers, 'set_visibility', {
      entityId: 'ent6',
    });
    expect(result.success).toBe(false);
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

// ---------------------------------------------------------------------------
// undo/redo `scope` (idea.FR-1.OP-04, #9998)
// ---------------------------------------------------------------------------

/**
 * The REAL completion-mode history, so "nothing to undo" is the slice's own
 * answer rather than a stubbed `false`. The engine's undo/redo stay mocks: the
 * assertion there is that the scoped call never reaches them.
 */
function createCompletionModeStore() {
  type State = SceneGraphSlice & {
    selectedIds: Set<string>;
    primaryId: string | null;
    primaryName: string | null;
    primaryTransform: unknown | null;
    spawnTerrain: () => string | undefined;
    sceneModified: boolean;
  };
  const real = create<State>()((set, get, api) => ({
    ...createSceneGraphSlice(set, get, api),
    selectedIds: new Set<string>(),
    primaryId: null,
    primaryName: null,
    primaryTransform: null,
    spawnTerrain: () => undefined,
    sceneModified: false,
  }));
  const overrides = {
    undo: vi.fn(),
    redo: vi.fn(),
    undoCompletionMode: vi.fn(real.getState().undoCompletionMode),
    redoCompletionMode: vi.fn(real.getState().redoCompletionMode),
  };
  return { real, overrides };
}

describe('undo/redo scope', () => {
  it('undo with scope completion_mode steps the mode back, not the engine', async () => {
    const { real, overrides } = createCompletionModeStore();
    real.getState().setCompletionMode('sandbox');
    real.getState().setCompletionMode('narrative');

    const { result } = await invokeHandler(transformHandlers, 'undo', { scope: 'completion_mode' }, overrides);

    expect(result).toEqual({ success: true, result: { scope: 'completion_mode' } });
    expect(overrides.undoCompletionMode).toHaveBeenCalledTimes(1);
    expect(overrides.undo).not.toHaveBeenCalled();
    expect(overrides.redoCompletionMode).not.toHaveBeenCalled();
    expect(real.getState().sceneGraph.completionMode).toBe('sandbox');
  });

  it('redo with scope completion_mode re-applies the undone mode, not the engine', async () => {
    const { real, overrides } = createCompletionModeStore();
    real.getState().setCompletionMode('endless');
    real.getState().undoCompletionMode();

    const { result } = await invokeHandler(transformHandlers, 'redo', { scope: 'completion_mode' }, overrides);

    expect(result).toEqual({ success: true, result: { scope: 'completion_mode' } });
    expect(overrides.redoCompletionMode).toHaveBeenCalledTimes(1);
    expect(overrides.redo).not.toHaveBeenCalled();
    expect(overrides.undoCompletionMode).not.toHaveBeenCalled();
    expect(real.getState().sceneGraph.completionMode).toBe('endless');
  });

  it('undo with scope completion_mode and no history fails instead of claiming success', async () => {
    const { real, overrides } = createCompletionModeStore();

    const { result } = await invokeHandler(transformHandlers, 'undo', { scope: 'completion_mode' }, overrides);

    expect(result).toEqual({ success: false, error: 'No completion-mode change to undo.' });
    expect(overrides.undoCompletionMode).toHaveBeenCalledTimes(1);
    expect(overrides.undo).not.toHaveBeenCalled();
    expect(real.getState().sceneGraph.completionMode).toBeUndefined();
  });

  it('redo with scope completion_mode and nothing undone fails instead of claiming success', async () => {
    const { real, overrides } = createCompletionModeStore();
    real.getState().setCompletionMode('win');

    const { result } = await invokeHandler(transformHandlers, 'redo', { scope: 'completion_mode' }, overrides);

    expect(result).toEqual({ success: false, error: 'No completion-mode change to redo.' });
    expect(overrides.redoCompletionMode).toHaveBeenCalledTimes(1);
    expect(overrides.redo).not.toHaveBeenCalled();
    expect(real.getState().sceneGraph.completionMode).toBe('win');
  });

  it.each(['undo', 'redo'] as const)('%s rejects an unknown scope and touches neither history', async (name) => {
    const { overrides } = createCompletionModeStore();

    const { result } = await invokeHandler(transformHandlers, name, { scope: 'everything' }, overrides);

    expect(result).toEqual({
      success: false,
      error: 'Invalid arguments: scope: Invalid option: expected one of "engine"|"completion_mode"',
    });
    expect(overrides.undo).not.toHaveBeenCalled();
    expect(overrides.redo).not.toHaveBeenCalled();
    expect(overrides.undoCompletionMode).not.toHaveBeenCalled();
    expect(overrides.redoCompletionMode).not.toHaveBeenCalled();
  });

  it.each([
    ['undo', {}],
    ['undo', { scope: 'engine' }],
    ['redo', {}],
    ['redo', { scope: 'engine' }],
  ] as const)('%s with args %j drives the engine history only', async (name, args) => {
    const { real, overrides } = createCompletionModeStore();
    real.getState().setCompletionMode('sandbox');
    real.getState().undoCompletionMode();
    real.getState().redoCompletionMode();
    if (name === 'redo') real.getState().undoCompletionMode();
    const modeBefore = real.getState().sceneGraph.completionMode;

    const { result } = await invokeHandler(transformHandlers, name, { ...args }, overrides);

    expect(result).toEqual({ success: true });
    expect(overrides[name]).toHaveBeenCalledTimes(1);
    expect(overrides[name === 'undo' ? 'redo' : 'undo']).not.toHaveBeenCalled();
    expect(overrides.undoCompletionMode).not.toHaveBeenCalled();
    expect(overrides.redoCompletionMode).not.toHaveBeenCalled();
    // A completion-mode step was available and was NOT taken.
    expect(real.getState().sceneGraph.completionMode).toBe(modeBefore);
  });
});
