/**
 * Query handlers - read-only operations that return scene/state data.
 * Only contains handlers NOT already provided by domain-specific handler files.
 * Domain handlers (physicsJointHandlers, audioLegacyHandlers, handlers2d, etc.)
 * take precedence in the registry spread order.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';

export const queryHandlers: Record<string, ToolHandler> = {
  get_scene_graph: async (_args, { store }) => {
    const { sceneGraph } = store;
    const summary = Object.values(sceneGraph.nodes).map((n) => ({
      id: n.entityId,
      name: n.name,
      parent: n.parentId,
      children: n.children,
      visible: n.visible,
    }));
    return { success: true, result: { entities: summary, count: summary.length } };
  },

  get_entity_details: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const node = store.sceneGraph.nodes[p.data.entityId];
    if (!node) return { success: false, error: `Entity not found: ${p.data.entityId}` };
    return { success: true, result: { name: node.name, components: node.components, visible: node.visible, children: node.children } };
  },

  get_selection: async (_args, { store }) => {
    return { success: true, result: { selectedIds: [...store.selectedIds], primaryId: store.primaryId } };
  },

  get_camera_state: async (_args, { store }) => {
    return { success: true, result: { preset: store.currentCameraPreset } };
  },

  get_mode: async (_args, { store }) => {
    return { success: true, result: { mode: store.engineMode } };
  },

  query_play_state: async (_args, { store }) => {
    if (store.engineMode !== 'play' && store.engineMode !== 'paused') {
      return {
        success: false,
        error: `query_play_state is only available in Play or Paused mode. Current mode: ${store.engineMode}`,
      };
    }
    const entities = Object.values(store.sceneGraph.nodes).map((n) => ({
      id: n.entityId,
      name: n.name,
      visible: n.visible,
    }));
    return {
      success: true,
      result: {
        entities,
        entityCount: entities.length,
        engineMode: store.engineMode,
        // Note: transforms reflect the last engine→Zustand sync tick, not real-time
        // ECS values. Full real-time transforms require the async channel protocol
        // wired to chat handlers (future work: PF-392).
        dataSource: 'store_last_sync' as const,
        syncTimestamp: Date.now(),
      },
    };
  },

  get_sprite_generation_status: async (args, _ctx) => {
    const p = parseArgs(z.object({ jobId: z.string().min(1) }), args);
    if (p.error) return p.error;

    const { useGenerationStore } = await import('@/stores/generationStore');
    const jobs = useGenerationStore.getState().jobs;
    const job = Object.values(jobs).find((j) => j.jobId === p.data.jobId);

    if (!job) {
      return { success: false, error: `No generation job found with ID: ${p.data.jobId}` };
    }

    return {
      success: true,
      result: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        resultUrl: job.resultUrl,
        error: job.error,
      },
    };
  },
};
