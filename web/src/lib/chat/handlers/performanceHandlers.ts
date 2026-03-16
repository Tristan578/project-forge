import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';
import { usePerformanceStore } from '@/stores/performanceStore';

export const performanceHandlers: Record<string, ToolHandler> = {
  set_entity_lod: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      lodDistances: z.array(z.number()).optional(),
      autoGenerate: z.boolean().optional(),
      lodRatios: z.array(z.number()).optional(),
    }), args);
    if (p.error) return p.error;
    ctx.dispatchCommand('set_lod', {
      entityId: p.data.entityId,
      lodDistances: p.data.lodDistances ?? [20, 50, 100],
      autoGenerate: p.data.autoGenerate ?? false,
      lodRatios: p.data.lodRatios ?? [0.5, 0.25, 0.1],
    });
    return {
      success: true,
      result: { message: `LOD configured for entity ${p.data.entityId}` },
    };
  },

  generate_lods: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.dispatchCommand('generate_lods', { entityId: p.data.entityId });
    return {
      success: true,
      result: { message: `LOD generation triggered for entity ${p.data.entityId}` },
    };
  },

  set_performance_budget: async (args, ctx) => {
    const p = parseArgs(z.object({
      maxTriangles: z.number().optional(),
      maxDrawCalls: z.number().optional(),
      targetFps: z.number().optional(),
      warningThreshold: z.number().optional(),
    }), args);
    if (p.error) return p.error;

    const budget = {
      maxTriangles: p.data.maxTriangles ?? 500_000,
      maxDrawCalls: p.data.maxDrawCalls ?? 200,
      targetFps: p.data.targetFps ?? 60,
      warningThreshold: p.data.warningThreshold ?? 0.8,
    };

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

  get_performance_stats: async (_args, ctx) => {
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

  optimize_scene: async (_args, ctx) => {
    ctx.dispatchCommand('optimize_scene', {});
    return {
      success: true,
      result: { message: 'Scene optimization applied — LOD configuration added to all entities' },
    };
  },

  set_lod_distances: async (args, ctx) => {
    const p = parseArgs(z.object({
      distances: z.array(z.number()).optional(),
    }), args);
    if (p.error) return p.error;
    ctx.dispatchCommand('set_lod_distances', {
      distances: p.data.distances ?? [20, 50, 100],
    });
    return {
      success: true,
      result: { message: 'Global LOD distances updated' },
    };
  },


  set_simplification_backend: async (args, ctx) => {
    const p = parseArgs(z.object({
      backend: z.enum(['qem', 'fast']),
    }), args);
    if (p.error) return p.error;
    ctx.dispatchCommand('set_simplification_backend', {
      backend: p.data.backend,
    });
    return {
      success: true,
      result: { message: 'Simplification backend set to ' + p.data.backend },
    };
  },
};
