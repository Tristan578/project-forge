vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performanceHandlers } from '../performanceHandlers';
import type { ToolCallContext } from '../types';

const mockSetBudget = vi.fn();
const mockStats = { fps: 60, triangleCount: 10000, drawCalls: 50 };

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: {
    getState: () => ({
      setBudget: mockSetBudget,
      stats: mockStats,
    }),
  },
}));

function invoke(name: string, args: Record<string, unknown> = {}) {
  const dispatchCommand = vi.fn();
  const ctx = { store: {} as never, dispatchCommand } as unknown as ToolCallContext;
  const resultPromise = performanceHandlers[name](args, ctx);
  return { resultPromise, dispatchCommand };
}

describe('performanceHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('set_entity_lod', () => {
    it('dispatches set_lod with provided values', async () => {
      const { resultPromise, dispatchCommand } = invoke('set_entity_lod', {
        entityId: 'e1',
        lodDistances: [10, 30, 80],
        autoGenerate: true,
        lodRatios: [0.8, 0.4, 0.2],
      });
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('set_lod', {
        entityId: 'e1',
        lodDistances: [10, 30, 80],
        autoGenerate: true,
        lodRatios: [0.8, 0.4, 0.2],
      });
    });

    it('uses default LOD distances and ratios when not provided', async () => {
      const { resultPromise, dispatchCommand } = invoke('set_entity_lod', {
        entityId: 'e2',
      });
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('set_lod', {
        entityId: 'e2',
        lodDistances: [20, 50, 100],
        autoGenerate: false,
        lodRatios: [0.5, 0.25, 0.1],
      });
    });

    it('returns validation error for missing entityId', async () => {
      const { resultPromise } = invoke('set_entity_lod', {});
      const result = await resultPromise;
      expect(result.success).toBe(false);
    });
  });

  describe('generate_lods', () => {
    it('dispatches generate_lods for entity', async () => {
      const { resultPromise, dispatchCommand } = invoke('generate_lods', {
        entityId: 'e3',
      });
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('generate_lods', { entityId: 'e3' });
    });
  });

  describe('set_performance_budget', () => {
    it('sets budget with provided values', async () => {
      const { resultPromise, dispatchCommand } = invoke('set_performance_budget', {
        maxTriangles: 1_000_000,
        maxDrawCalls: 500,
        targetFps: 30,
        warningThreshold: 0.9,
      });
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(mockSetBudget).toHaveBeenCalledWith({
        maxTriangles: 1_000_000,
        maxDrawCalls: 500,
        targetFps: 30,
        warningThreshold: 0.9,
      });
      expect(dispatchCommand).toHaveBeenCalledWith('set_performance_budget', {
        maxTriangles: 1_000_000,
        maxDrawCalls: 500,
        targetFps: 30,
        warningThreshold: 0.9,
      });
    });

    it('uses defaults when no values provided', async () => {
      const { resultPromise } = invoke('set_performance_budget', {});
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(mockSetBudget).toHaveBeenCalledWith({
        maxTriangles: 500_000,
        maxDrawCalls: 200,
        targetFps: 60,
        warningThreshold: 0.8,
      });
      const data = result.result as Record<string, unknown>;
      expect(data.budget).toEqual({
        maxTriangles: 500_000,
        maxDrawCalls: 200,
        targetFps: 60,
        warningThreshold: 0.8,
      });
    });
  });

  describe('get_performance_stats', () => {
    it('returns current stats from store', async () => {
      const { resultPromise, dispatchCommand } = invoke('get_performance_stats');
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('get_performance_stats', {});
      const data = result.result as Record<string, unknown>;
      expect(data.stats).toEqual(mockStats);
    });
  });

  describe('optimize_scene', () => {
    it('dispatches optimize_scene command', async () => {
      const { resultPromise, dispatchCommand } = invoke('optimize_scene');
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('optimize_scene', {});
    });
  });

  describe('set_lod_distances', () => {
    it('dispatches with custom distances', async () => {
      const { resultPromise, dispatchCommand } = invoke('set_lod_distances', {
        distances: [15, 40, 90],
      });
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('set_lod_distances', {
        distances: [15, 40, 90],
      });
    });

    it('uses default distances when not provided', async () => {
      const { resultPromise, dispatchCommand } = invoke('set_lod_distances', {});
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('set_lod_distances', {
        distances: [20, 50, 100],
      });
    });
  });

  describe('set_simplification_backend', () => {
    it('sets qem backend', async () => {
      const { resultPromise, dispatchCommand } = invoke('set_simplification_backend', {
        backend: 'qem',
      });
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('set_simplification_backend', {
        backend: 'qem',
      });
    });

    it('sets fast backend', async () => {
      const { resultPromise } = invoke('set_simplification_backend', {
        backend: 'fast',
      });
      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('rejects invalid backend value', async () => {
      const { resultPromise } = invoke('set_simplification_backend', {
        backend: 'invalid',
      });
      const result = await resultPromise;
      expect(result.success).toBe(false);
    });
  });
});
