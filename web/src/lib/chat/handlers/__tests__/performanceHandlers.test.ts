/**
 * Tests for performanceHandlers — LOD, performance budget, scene optimization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { performanceHandlers } from '../performanceHandlers';

// ---------------------------------------------------------------------------
// Mock performanceStore
// ---------------------------------------------------------------------------

const mockSetBudget = vi.fn();
const mockStats = { triangles: 50000, drawCalls: 80, fps: 60 };

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: {
    getState: () => ({
      setBudget: mockSetBudget,
      stats: mockStats,
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('performanceHandlers', () => {
  // ---------------------------------------------------------------------------
  // set_entity_lod
  // ---------------------------------------------------------------------------

  describe('set_entity_lod', () => {
    it('dispatches set_lod with default distances and ratios', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_entity_lod', {
        entityId: 'e1',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ message: 'LOD configured for entity e1' });
    });

    it('dispatches set_lod with custom distances', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_entity_lod', {
        entityId: 'e1',
        lodDistances: [10, 30, 60],
        autoGenerate: true,
        lodRatios: [0.75, 0.5, 0.25],
      });

      expect(result.success).toBe(true);
    });

    it('rejects missing entityId', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_entity_lod', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });

  // ---------------------------------------------------------------------------
  // generate_lods
  // ---------------------------------------------------------------------------

  describe('generate_lods', () => {
    it('dispatches generate_lods command', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'generate_lods', {
        entityId: 'e2',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ message: 'LOD generation triggered for entity e2' });
    });

    it('rejects empty entityId', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'generate_lods', {
        entityId: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });

  // ---------------------------------------------------------------------------
  // set_performance_budget
  // ---------------------------------------------------------------------------

  describe('set_performance_budget', () => {
    it('sets budget with defaults', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_performance_budget', {});

      expect(result.success).toBe(true);
      expect(mockSetBudget).toHaveBeenCalledWith({
        maxTriangles: 500_000,
        maxDrawCalls: 200,
        targetFps: 60,
        warningThreshold: 0.8,
      });
      const budget = (result.result as { budget: Record<string, number> }).budget;
      expect(budget.maxTriangles).toBe(500_000);
    });

    it('sets budget with custom values', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_performance_budget', {
        maxTriangles: 100_000,
        maxDrawCalls: 50,
        targetFps: 30,
        warningThreshold: 0.9,
      });

      expect(result.success).toBe(true);
      expect(mockSetBudget).toHaveBeenCalledWith({
        maxTriangles: 100_000,
        maxDrawCalls: 50,
        targetFps: 30,
        warningThreshold: 0.9,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // get_performance_stats
  // ---------------------------------------------------------------------------

  describe('get_performance_stats', () => {
    it('returns current performance stats', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'get_performance_stats', {});

      expect(result.success).toBe(true);
      const stats = (result.result as { stats: typeof mockStats }).stats;
      expect(stats.triangles).toBe(50000);
      expect(stats.drawCalls).toBe(80);
      expect(stats.fps).toBe(60);
    });
  });

  // ---------------------------------------------------------------------------
  // optimize_scene
  // ---------------------------------------------------------------------------

  describe('optimize_scene', () => {
    it('dispatches optimize_scene command', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'optimize_scene', {});

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        message: 'Scene optimization applied — LOD configuration added to all entities',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // set_lod_distances
  // ---------------------------------------------------------------------------

  describe('set_lod_distances', () => {
    it('sets global LOD distances with defaults', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_lod_distances', {});

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ message: 'Global LOD distances updated' });
    });

    it('sets custom LOD distances', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_lod_distances', {
        distances: [5, 15, 30],
      });

      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // set_simplification_backend
  // ---------------------------------------------------------------------------

  describe('set_simplification_backend', () => {
    it('sets qem backend', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_simplification_backend', {
        backend: 'qem',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ message: 'Simplification backend set to qem' });
    });

    it('sets fast backend', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_simplification_backend', {
        backend: 'fast',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ message: 'Simplification backend set to fast' });
    });

    it('rejects invalid backend', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_simplification_backend', {
        backend: 'slow',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('rejects missing backend', async () => {
      const { result } = await invokeHandler(performanceHandlers, 'set_simplification_backend', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });
});
