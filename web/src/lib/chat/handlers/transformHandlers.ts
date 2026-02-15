/**
 * Transform, selection, and scene manipulation handlers.
 */

import type { ToolHandler, EntityType } from './types';

export const transformHandlers: Record<string, ToolHandler> = {
  spawn_entity: async (args, { store }) => {
    store.spawnEntity(
      args.entityType as EntityType,
      args.name as string | undefined
    );
    return { success: true, result: { message: `Spawned ${args.entityType}` } };
  },

  despawn_entity: async (args, { store }) => {
    const ids = args.entityIds as string[] | undefined ?? (args.entityId ? [args.entityId as string] : []);
    if (ids.length > 0) {
      store.setSelection(ids, ids[0], null);
      store.deleteSelectedEntities();
    }
    return { success: true, result: { deleted: ids.length } };
  },

  delete_entities: async (args, { store }) => {
    const ids = args.entityIds as string[] | undefined ?? (args.entityId ? [args.entityId as string] : []);
    if (ids.length > 0) {
      store.setSelection(ids, ids[0], null);
      store.deleteSelectedEntities();
    }
    return { success: true, result: { deleted: ids.length } };
  },

  duplicate_entity: async (args, { store }) => {
    store.selectEntity(args.entityId as string, 'replace');
    store.duplicateSelectedEntity();
    return { success: true, result: { message: `Duplicated entity` } };
  },

  update_transform: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (args.position) store.updateTransform(entityId, 'position', args.position as [number, number, number]);
    if (args.rotation) store.updateTransform(entityId, 'rotation', args.rotation as [number, number, number]);
    if (args.scale) store.updateTransform(entityId, 'scale', args.scale as [number, number, number]);
    return { success: true };
  },

  rename_entity: async (args, { store }) => {
    store.renameEntity(args.entityId as string, args.name as string);
    return { success: true };
  },

  reparent_entity: async (args, { store }) => {
    store.reparentEntity(args.entityId as string, args.newParentId as string | null, args.insertIndex as number | undefined);
    return { success: true };
  },

  set_visibility: async (args, { store }) => {
    store.toggleVisibility(args.entityId as string);
    return { success: true };
  },

  select_entity: async (args, { store }) => {
    store.selectEntity(args.entityId as string, (args.mode as 'replace' | 'add' | 'toggle') ?? 'replace');
    return { success: true };
  },

  select_entities: async (args, { store }) => {
    const ids = args.entityIds as string[];
    if (ids.length > 0) store.setSelection(ids, ids[0], null);
    return { success: true };
  },

  clear_selection: async (args, { store }) => {
    store.clearSelection();
    return { success: true };
  },

  set_gizmo_mode: async (args, { store }) => {
    store.setGizmoMode(args.mode as 'translate' | 'rotate' | 'scale');
    return { success: true };
  },

  set_coordinate_mode: async (args, { store }) => {
    if (store.coordinateMode !== args.mode) store.toggleCoordinateMode();
    return { success: true };
  },

  toggle_grid: async (args, { store }) => {
    store.toggleGrid();
    return { success: true };
  },

  set_snap_settings: async (args, { store }) => {
    store.setSnapSettings(args as Record<string, unknown>);
    return { success: true };
  },

  set_camera_preset: async (args, { store }) => {
    store.setCameraPreset(args.preset as 'top' | 'front' | 'right' | 'perspective');
    return { success: true };
  },

  focus_camera: async (args, { store }) => {
    // focusCamera is not on the store — select the entity so the user can press F
    store.selectEntity(args.entityId as string, 'replace');
    return { success: true, result: { message: 'Entity selected. User can press F to focus camera.' } };
  },

  undo: async (args, { store }) => {
    store.undo();
    return { success: true };
  },

  redo: async (args, { store }) => {
    store.redo();
    return { success: true };
  },
};
