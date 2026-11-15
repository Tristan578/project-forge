/**
 * Performance and LOD handlers — quality presets, LOD configuration,
 * performance budget, scene-wide mesh optimization, and the manifest-pinned
 * performance report (capture / query / baseline / compare / cancel).
 */

import { z } from 'zod';
import type { ExecutionResult, ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';
import { usePerformanceStore } from '@/stores/performanceStore';
import {
  cancelPerformanceCapture,
  comparePerformanceReports,
  getPerformanceReport,
  setPerformanceBaseline,
  startPerformanceCapture,
} from '@/lib/perf/editorCapture';

/**
 * Adapt an `editorCapture` result to a tool result. The error text is passed
 * through verbatim: the profiler's manual control shows the same string for the
 * same input, which is the parity #9904 asks for (performance.FR-3.OP-01).
 */
function fromCapture<T extends { ok: true }>(
  result: T | { ok: false; error: string },
  shape: (data: T) => Record<string, unknown>,
): ExecutionResult {
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, result: shape(result) };
}

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

  // --- Manifest-pinned performance report (performance.FR-3.OP-01, #9904 / #10013) ---
  // Each handler delegates to the lib/perf/editorCapture function the
  // profiler's manual control calls, with the same argument schema.

  capture_performance_report: async (args) =>
    fromCapture(startPerformanceCapture(args), ({ captureId, profileKey, protocol, expectedDurationMs, message }) => ({
      status: 'pending',
      captureId,
      profileKey,
      protocol,
      expectedDurationMs,
      message,
    })),

  get_performance_report: async (args) =>
    fromCapture(getPerformanceReport(args), ({ capture, report, baselineReportId }) => ({ capture, report, baselineReportId })),

  compare_performance_reports: async (args) =>
    fromCapture(comparePerformanceReports(args), ({ comparison }) => ({ comparison })),

  set_performance_baseline: async (args) =>
    fromCapture(setPerformanceBaseline(args), ({ baselineReportId, message }) => ({ baselineReportId, message })),

  cancel_performance_capture: async (args) =>
    fromCapture(cancelPerformanceCapture(args), ({ message }) => ({ message })),
};
