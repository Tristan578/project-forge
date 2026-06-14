/**
 * Entity query and runtime mode handlers — scene graph queries, selection queries,
 * camera state, and play/pause/stop/resume commands.
 *
 * Transform mutation handlers (despawn, delete, duplicate, update_transform, etc.)
 * are in transformHandlers.ts to avoid double-registration.
 */

import type { ToolHandler, ExecutionResult } from './types';
import { validateWinnability, formatWinnabilityMessage } from '@/lib/playMode/winnabilityValidator';

export const entityHandlers: Record<string, ToolHandler> = {
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
    const entityId = args['entityId'];
    if (typeof entityId !== 'string' || !entityId) {
      return { success: false, error: 'Missing required parameter: entityId' };
    }
    const node = ctx.store.sceneGraph.nodes[entityId];
    if (!node) return { success: false, error: `Entity not found: ${entityId}` };
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
    // AI path: validate here so an unwinnable scene comes back as a tool RESULT
    // (the AI's actionable channel) instead of silently entering Play. We do NOT
    // surface it to chat on this path — that would duplicate the message into the
    // model. store.play() re-runs the same pure check for the human Play-button
    // path; both call the same function on the same snapshot, so they can't diverge.
    const report = validateWinnability(ctx.store.sceneGraph, ctx.store.allGameComponents);
    if (!report.winnable) {
      return { success: false, error: formatWinnabilityMessage(report) };
    }
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
