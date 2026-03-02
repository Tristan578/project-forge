/**
 * Entity and transform handlers — spawn, delete, transform, selection,
 * editor controls, history, query, and runtime mode commands.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { zEntityId, zXYZ, zSelectionMode, zGizmoMode, zCameraPreset, parseArgs } from './types';

const ENTITY_TYPES = [
  'cube', 'sphere', 'cylinder', 'capsule', 'torus', 'plane', 'cone', 'icosphere',
  'point_light', 'directional_light', 'spot_light', 'gltf_model', 'empty',
] as const;

export const entityHandlers: Record<string, ToolHandler> = {
  spawn_entity: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityType: z.enum(ENTITY_TYPES), name: z.string().optional() }), args);
    if (p.error) return p.error;
    ctx.store.spawnEntity(p.data.entityType, p.data.name);
    return { success: true, result: { message: `Spawned ${p.data.entityType}` } };
  },

  despawn_entity: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityIds: z.array(zEntityId).optional(), entityId: zEntityId.optional() }), args);
    if (p.error) return p.error;
    const ids = p.data.entityIds ?? (p.data.entityId ? [p.data.entityId] : []);
    if (ids.length > 0) {
      ctx.store.setSelection(ids, ids[0], null);
      ctx.store.deleteSelectedEntities();
    }
    return { success: true, result: { deleted: ids.length } };
  },

  delete_entities: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityIds: z.array(zEntityId).optional(), entityId: zEntityId.optional() }), args);
    if (p.error) return p.error;
    const ids = p.data.entityIds ?? (p.data.entityId ? [p.data.entityId] : []);
    if (ids.length > 0) {
      ctx.store.setSelection(ids, ids[0], null);
      ctx.store.deleteSelectedEntities();
    }
    return { success: true, result: { deleted: ids.length } };
  },

  duplicate_entity: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.selectEntity(p.data.entityId, 'replace');
    ctx.store.duplicateSelectedEntity();
    return { success: true, result: { message: `Duplicated entity` } };
  },

  update_transform: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityId: zEntityId, position: zXYZ.optional(), rotation: zXYZ.optional(), scale: zXYZ.optional() }), args);
    if (p.error) return p.error;
    if (p.data.position) ctx.store.updateTransform(p.data.entityId, 'position', p.data.position);
    if (p.data.rotation) ctx.store.updateTransform(p.data.entityId, 'rotation', p.data.rotation);
    if (p.data.scale) ctx.store.updateTransform(p.data.entityId, 'scale', p.data.scale);
    return { success: true };
  },

  rename_entity: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityId: zEntityId, name: z.string().min(1) }), args);
    if (p.error) return p.error;
    ctx.store.renameEntity(p.data.entityId, p.data.name);
    return { success: true };
  },

  reparent_entity: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityId: zEntityId, newParentId: z.string().nullable(), insertIndex: z.number().int().nonnegative().optional() }), args);
    if (p.error) return p.error;
    ctx.store.reparentEntity(p.data.entityId, p.data.newParentId, p.data.insertIndex);
    return { success: true };
  },

  set_visibility: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.toggleVisibility(p.data.entityId);
    return { success: true };
  },

  select_entity: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityId: zEntityId, mode: zSelectionMode.optional() }), args);
    if (p.error) return p.error;
    ctx.store.selectEntity(p.data.entityId, p.data.mode ?? 'replace');
    return { success: true };
  },

  select_entities: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityIds: z.array(zEntityId) }), args);
    if (p.error) return p.error;
    if (p.data.entityIds.length > 0) {
      ctx.store.setSelection(p.data.entityIds, p.data.entityIds[0], null);
    }
    return { success: true };
  },

  clear_selection: async (_args, ctx): Promise<ExecutionResult> => {
    ctx.store.clearSelection();
    return { success: true };
  },

  set_gizmo_mode: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ mode: zGizmoMode }), args);
    if (p.error) return p.error;
    ctx.store.setGizmoMode(p.data.mode);
    return { success: true };
  },

  set_coordinate_mode: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ mode: z.enum(['local', 'world']) }), args);
    if (p.error) return p.error;
    if (ctx.store.coordinateMode !== p.data.mode) ctx.store.toggleCoordinateMode();
    return { success: true };
  },

  toggle_grid: async (_args, ctx): Promise<ExecutionResult> => {
    ctx.store.toggleGrid();
    return { success: true };
  },

  set_snap_settings: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.setSnapSettings(args);
    return { success: true };
  },

  set_camera_preset: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ preset: zCameraPreset }), args);
    if (p.error) return p.error;
    ctx.store.setCameraPreset(p.data.preset);
    return { success: true };
  },

  focus_camera: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.selectEntity(p.data.entityId, 'replace');
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
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const node = ctx.store.sceneGraph.nodes[p.data.entityId];
    if (!node) return { success: false, error: `Entity not found: ${p.data.entityId}` };
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
