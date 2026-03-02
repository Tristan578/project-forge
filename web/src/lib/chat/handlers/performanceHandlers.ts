import type { ToolHandler } from './types';
import { usePerformanceStore } from '@/stores/performanceStore';

export const performanceHandlers: Record<string, ToolHandler> = {
  set_entity_lod: async (params, ctx) => {
    const { entityId, lodDistances, autoGenerate, lodRatios } = params;
    ctx.dispatchCommand('set_lod', {
      entityId,
      lodDistances: lodDistances ?? [20, 50, 100],
      autoGenerate: autoGenerate ?? false,
      lodRatios: lodRatios ?? [0.5, 0.25, 0.1],
    });
    return {
      success: true,
      result: { message: `LOD configured for entity ${entityId}` },
    };
  },

  generate_lods: async (params, ctx) => {
    const { entityId } = params;
    ctx.dispatchCommand('generate_lods', { entityId });
    return {
      success: true,
      result: { message: `LOD generation triggered for entity ${entityId}` },
    };
  },

  set_performance_budget: async (params, ctx) => {
    const { maxTriangles, maxDrawCalls, targetFps, warningThreshold } = params;

    const budget = {
      maxTriangles: (maxTriangles as number | undefined) ?? 500_000,
      maxDrawCalls: (maxDrawCalls as number | undefined) ?? 200,
      targetFps: (targetFps as number | undefined) ?? 60,
      warningThreshold: (warningThreshold as number | undefined) ?? 0.8,
    };

    // Update local performance store and dispatch to engine
    usePerformanceStore.getState().setBudget(budget);
    ctx.dispatchCommand('set_performance_budget', budget);

    return {
      success: true,
      result: {
        message: 'Performance budget updated',
        budget,
      },
    };
  },

  get_performance_stats: async (_params, ctx) => {
    ctx.dispatchCommand('get_performance_stats', {});
    const stats = usePerformanceStore.getState().stats;

    return {
      success: true,
      result: {
        message: 'Performance stats retrieved',
        stats,
      },
    };
  },

  optimize_scene: async (_params, ctx) => {
    ctx.dispatchCommand('optimize_scene', {});
    return {
      success: true,
      result: { message: 'Scene optimization applied — LOD configuration added to all entities' },
    };
  },

  set_lod_distances: async (params, ctx) => {
    const { distances } = params;
    ctx.dispatchCommand('set_lod_distances', {
      distances: distances ?? [20, 50, 100],
    });
    return {
      success: true,
      result: { message: 'Global LOD distances updated' },
    };
  },
};
