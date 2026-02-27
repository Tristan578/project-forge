/**
 * Entity and transform handlers — spawn, delete, transform, selection,
 * editor controls, history, query, and runtime mode commands.
 */

import type { ToolHandler, ExecutionResult, EntityType } from './types';

export const entityHandlers: Record<string, ToolHandler> = {
  spawn_entity: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.spawnEntity(
      args.entityType as EntityType,
      args.name as string | undefined
    );
    return { success: true, result: { message: `Spawned ${args.entityType}` } };
  },

  despawn_entity: async (args, ctx): Promise<ExecutionResult> => {
    const ids =
      (args.entityIds as string[] | undefined) ??
      (args.entityId ? [args.entityId as string] : []);
    if (ids.length > 0) {
      ctx.store.setSelection(ids, ids[0], null);
      ctx.store.deleteSelectedEntities();
    }
    return { success: true, result: { deleted: ids.length } };
  },

  delete_entities: async (args, ctx): Promise<ExecutionResult> => {
    const ids =
      (args.entityIds as string[] | undefined) ??
      (args.entityId ? [args.entityId as string] : []);
    if (ids.length > 0) {
      ctx.store.setSelection(ids, ids[0], null);
      ctx.store.deleteSelectedEntities();
    }
    return { success: true, result: { deleted: ids.length } };
  },

  duplicate_entity: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.selectEntity(args.entityId as string, 'replace');
    ctx.store.duplicateSelectedEntity();
    return { success: true, result: { message: `Duplicated entity` } };
  },

  update_transform: async (args, ctx): Promise<ExecutionResult> => {
    const entityId = args.entityId as string;
    if (args.position) ctx.store.updateTransform(entityId, 'position', args.position as [number, number, number]);
    if (args.rotation) ctx.store.updateTransform(entityId, 'rotation', args.rotation as [number, number, number]);
    if (args.scale) ctx.store.updateTransform(entityId, 'scale', args.scale as [number, number, number]);
    return { success: true };
  },

  rename_entity: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.renameEntity(args.entityId as string, args.name as string);
    return { success: true };
  },

  reparent_entity: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.reparentEntity(
      args.entityId as string,
      args.newParentId as string | null,
      args.insertIndex as number | undefined
    );
    return { success: true };
  },

  set_visibility: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.toggleVisibility(args.entityId as string);
    return { success: true };
  },

  select_entity: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.selectEntity(
      args.entityId as string,
      (args.mode as 'replace' | 'add' | 'toggle') ?? 'replace'
    );
    return { success: true };
  },

  select_entities: async (args, ctx): Promise<ExecutionResult> => {
    const ids = args.entityIds as string[];
    if (ids.length > 0) ctx.store.setSelection(ids, ids[0], null);
    return { success: true };
  },

  clear_selection: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.clearSelection();
    return { success: true };
  },

  set_gizmo_mode: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.setGizmoMode(args.mode as 'translate' | 'rotate' | 'scale');
    return { success: true };
  },

  set_coordinate_mode: async (args, ctx): Promise<ExecutionResult> => {
    if (ctx.store.coordinateMode !== args.mode) ctx.store.toggleCoordinateMode();
    return { success: true };
  },

  toggle_grid: async (_args, ctx): Promise<ExecutionResult> => {
    ctx.store.toggleGrid();
    return { success: true };
  },

  set_snap_settings: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.setSnapSettings(args as Record<string, unknown>);
    return { success: true };
  },

  set_camera_preset: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.setCameraPreset(args.preset as 'top' | 'front' | 'right' | 'perspective');
    return { success: true };
  },

  focus_camera: async (args, ctx): Promise<ExecutionResult> => {
    // focusCamera is not on the store — select the entity so the user can press F
    ctx.store.selectEntity(args.entityId as string, 'replace');
    return { success: true, result: { message: 'Entity selected. User can press F to focus camera.' } };
  },

  undo: async (_args, ctx): Promise<ExecutionResult> => {
    ctx.store.undo();
    return { success: true };
  },

  redo: async (_args, ctx): Promise<ExecutionResult> => {
    ctx.store.redo();
    return { success: true };
  },

  get_scene_graph: async (_args, ctx): Promise<ExecutionResult> => {
    const { sceneGraph } = ctx.store;
    const summary = Object.values(sceneGraph.nodes).map((n) => ({
      id: n.entityId,
      name: n.name,
      parent: n.parentId,
      children: n.children,
      visible: n.visible,
    }));
    return { success: true, result: { entities: summary, count: summary.length } };
  },

  get_entity_details: async (args, ctx): Promise<ExecutionResult> => {
    const node = ctx.store.sceneGraph.nodes[args.entityId as string];
    if (!node) return { success: false, error: `Entity not found: ${args.entityId}` };
    return {
      success: true,
      result: {
        name: node.name,
        components: node.components,
        visible: node.visible,
        children: node.children,
      },
    };
  },

  get_selection: async (_args, ctx): Promise<ExecutionResult> => {
    return {
      success: true,
      result: { selectedIds: [...ctx.store.selectedIds], primaryId: ctx.store.primaryId },
    };
  },

  get_camera_state: async (_args, ctx): Promise<ExecutionResult> => {
    return { success: true, result: { preset: ctx.store.currentCameraPreset } };
  },

  play: async (_args, ctx): Promise<ExecutionResult> => {
    if (ctx.store.engineMode !== 'edit') return { success: false, error: 'Already in play mode' };
    ctx.store.play();
    return { success: true, result: { message: 'Entered play mode' } };
  },

  stop: async (_args, ctx): Promise<ExecutionResult> => {
    if (ctx.store.engineMode === 'edit') return { success: false, error: 'Already in edit mode' };
    ctx.store.stop();
    return { success: true, result: { message: 'Stopped play mode' } };
  },

  pause: async (_args, ctx): Promise<ExecutionResult> => {
    if (ctx.store.engineMode !== 'play') return { success: false, error: 'Not in play mode' };
    ctx.store.pause();
    return { success: true, result: { message: 'Paused' } };
  },

  resume: async (_args, ctx): Promise<ExecutionResult> => {
    if (ctx.store.engineMode !== 'paused') return { success: false, error: 'Not paused' };
    ctx.store.resume();
    return { success: true, result: { message: 'Resumed' } };
  },

  get_mode: async (_args, ctx): Promise<ExecutionResult> => {
    return { success: true, result: { mode: ctx.store.engineMode } };
  },
};
