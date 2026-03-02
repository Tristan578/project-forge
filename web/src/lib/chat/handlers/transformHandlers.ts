/**
 * Transform, selection, and scene manipulation handlers.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, zXYZ, zSelectionMode, zGizmoMode, zCameraPreset, parseArgs } from './types';

const ENTITY_TYPES = [
  'cube', 'sphere', 'cylinder', 'capsule', 'torus', 'plane', 'cone', 'icosphere',
  'point_light', 'directional_light', 'spot_light', 'gltf_model', 'empty',
] as const;

export const transformHandlers: Record<string, ToolHandler> = {
  spawn_entity: async (args, { store }) => {
    const p = parseArgs(z.object({ entityType: z.enum(ENTITY_TYPES), name: z.string().optional() }), args);
    if (p.error) return p.error;
    store.spawnEntity(p.data.entityType, p.data.name);
    return { success: true, result: { message: `Spawned ${p.data.entityType}` } };
  },

  despawn_entity: async (args, { store }) => {
    const p = parseArgs(z.object({ entityIds: z.array(zEntityId).optional(), entityId: zEntityId.optional() }), args);
    if (p.error) return p.error;
    const ids = p.data.entityIds ?? (p.data.entityId ? [p.data.entityId] : []);
    if (ids.length > 0) {
      store.setSelection(ids, ids[0], null);
      store.deleteSelectedEntities();
    }
    return { success: true, result: { deleted: ids.length } };
  },

  delete_entities: async (args, { store }) => {
    const p = parseArgs(z.object({ entityIds: z.array(zEntityId).optional(), entityId: zEntityId.optional() }), args);
    if (p.error) return p.error;
    const ids = p.data.entityIds ?? (p.data.entityId ? [p.data.entityId] : []);
    if (ids.length > 0) {
      store.setSelection(ids, ids[0], null);
      store.deleteSelectedEntities();
    }
    return { success: true, result: { deleted: ids.length } };
  },

  duplicate_entity: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.selectEntity(p.data.entityId, 'replace');
    store.duplicateSelectedEntity();
    return { success: true, result: { message: `Duplicated entity` } };
  },

  update_transform: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId, position: zXYZ.optional(), rotation: zXYZ.optional(), scale: zXYZ.optional() }), args);
    if (p.error) return p.error;
    if (p.data.position) store.updateTransform(p.data.entityId, 'position', p.data.position);
    if (p.data.rotation) store.updateTransform(p.data.entityId, 'rotation', p.data.rotation);
    if (p.data.scale) store.updateTransform(p.data.entityId, 'scale', p.data.scale);
    return { success: true };
  },

  rename_entity: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId, name: z.string().min(1) }), args);
    if (p.error) return p.error;
    store.renameEntity(p.data.entityId, p.data.name);
    return { success: true };
  },

  reparent_entity: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId, newParentId: z.string().nullable(), insertIndex: z.number().int().nonnegative().optional() }), args);
    if (p.error) return p.error;
    store.reparentEntity(p.data.entityId, p.data.newParentId, p.data.insertIndex);
    return { success: true };
  },

  set_visibility: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.toggleVisibility(p.data.entityId);
    return { success: true };
  },

  select_entity: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId, mode: zSelectionMode.optional() }), args);
    if (p.error) return p.error;
    store.selectEntity(p.data.entityId, p.data.mode ?? 'replace');
    return { success: true };
  },

  select_entities: async (args, { store }) => {
    const p = parseArgs(z.object({ entityIds: z.array(zEntityId).min(1) }), args);
    if (p.error) return p.error;
    store.setSelection(p.data.entityIds, p.data.entityIds[0], null);
    return { success: true };
  },

  clear_selection: async (_args, { store }) => {
    store.clearSelection();
    return { success: true };
  },

  set_gizmo_mode: async (args, { store }) => {
    const p = parseArgs(z.object({ mode: zGizmoMode }), args);
    if (p.error) return p.error;
    store.setGizmoMode(p.data.mode);
    return { success: true };
  },

  set_coordinate_mode: async (args, { store }) => {
    const p = parseArgs(z.object({ mode: z.enum(['local', 'world']) }), args);
    if (p.error) return p.error;
    if (store.coordinateMode !== p.data.mode) store.toggleCoordinateMode();
    return { success: true };
  },

  toggle_grid: async (_args, { store }) => {
    store.toggleGrid();
    return { success: true };
  },

  set_snap_settings: async (args, { store }) => {
    store.setSnapSettings(args);
    return { success: true };
  },

  set_camera_preset: async (args, { store }) => {
    const p = parseArgs(z.object({ preset: zCameraPreset }), args);
    if (p.error) return p.error;
    store.setCameraPreset(p.data.preset);
    return { success: true };
  },

  focus_camera: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.selectEntity(p.data.entityId, 'replace');
    return { success: true, result: { message: 'Entity selected. User can press F to focus camera.' } };
  },

  undo: async (_args, { store }) => {
    store.undo();
    return { success: true };
  },

  redo: async (_args, { store }) => {
    store.redo();
    return { success: true };
  },
};
