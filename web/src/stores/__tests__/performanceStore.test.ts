/**
 * Unit tests for the performanceStore Zustand store.
 *
 * Tests cover stats tracking, profiler state, performance budget,
 * warning generation, and history tracking.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePerformanceStore } from '../performanceStore';

describe('performanceStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    usePerformanceStore.setState({
      stats: {
        fps: 60,
        frameTime: 16.67,
        triangleCount: 0,
        drawCalls: 0,
        entityCount: 0,
        memoryUsage: 0,
        wasmHeapSize: 0,
        gpuMemory: 0,
      },
      isProfilerOpen: false,
      history: [],
      budget: {
        maxTriangles: 500_000,
        maxDrawCalls: 200,
        targetFps: 60,
        warningThreshold: 0.8,
      },
      warnings: [],
    });
  });

  describe('Initial State', () => {
    it('should initialize with default stats', () => {
      const state = usePerformanceStore.getState();
      expect(state.stats).toEqual({
        fps: 60,
        frameTime: 16.67,
        triangleCount: 0,
        drawCalls: 0,
        entityCount: 0,
        memoryUsage: 0,
        wasmHeapSize: 0,
        gpuMemory: 0,
      });
    });

    it('should initialize with profiler closed', () => {
      const state = usePerformanceStore.getState();
      expect(state.isProfilerOpen).toBe(false);
    });

    it('should initialize with empty history', () => {
      const state = usePerformanceStore.getState();
      expect(state.history).toEqual([]);
    });

    it('should initialize with default budget', () => {
      const state = usePerformanceStore.getState();
      expect(state.budget).toEqual({
        maxTriangles: 500_000,
        maxDrawCalls: 200,
        targetFps: 60,
        warningThreshold: 0.8,
      });
    });

    it('should initialize with no warnings', () => {
      const state = usePerformanceStore.getState();
      expect(state.warnings).toEqual([]);
    });
  });

  describe('updateStats', () => {
    it('should update stats with partial values', () => {
      const { updateStats } = usePerformanceStore.getState();

      updateStats({ fps: 30, triangleCount: 1000 });

      const state = usePerformanceStore.getState();
      expect(state.stats.fps).toBe(30);
      expect(state.stats.triangleCount).toBe(1000);
      expect(state.stats.frameTime).toBe(16.67); // unchanged
    });

    it('should add updated stats to history', () => {
      const { updateStats } = usePerformanceStore.getState();

      updateStats({ fps: 55 });

      const state = usePerformanceStore.getState();
      expect(state.history).toHaveLength(1);
      expect(state.history[0].fps).toBe(55);
    });

    it('should limit history to 60 entries', () => {
      const { updateStats } = usePerformanceStore.getState();

      // Add 65 stats updates
      for (let i = 0; i < 65; i++) {
        updateStats({ fps: 60 - i });
      }

      const state = usePerformanceStore.getState();
      expect(state.history).toHaveLength(60);
      // First entry should be from update 5 (0-indexed), which is fps: 55
      expect(state.history[0].fps).toBe(55);
      // Last entry should be from update 64, which is fps: -4
      expect(state.history[59].fps).toBe(-4);
    });

    it('should generate warning when triangles approach budget', () => {
      const { updateStats } = usePerformanceStore.getState();

      // 80% of 500,000 = 400,000
      updateStats({ triangleCount: 410_000 });

      const state = usePerformanceStore.getState();
      expect(state.warnings).toContain('Triangle count approaching budget limit');
    });

    it('should generate warning when draw calls approach budget', () => {
      const { updateStats } = usePerformanceStore.getState();

      // 80% of 200 = 160
      updateStats({ drawCalls: 170 });

      const state = usePerformanceStore.getState();
      expect(state.warnings).toContain('Draw calls approaching budget limit');
    });

    it('should generate warning when FPS drops below target', () => {
      const { updateStats } = usePerformanceStore.getState();

      // 90% of 60 = 54
      updateStats({ fps: 50 });

      const state = usePerformanceStore.getState();
      expect(state.warnings).toContain('FPS below target');
    });

    it('should generate multiple warnings when multiple thresholds exceeded', () => {
      const { updateStats } = usePerformanceStore.getState();

      updateStats({
        triangleCount: 450_000,
        drawCalls: 180,
        fps: 45,
      });

      const state = usePerformanceStore.getState();
      expect(state.warnings).toHaveLength(3);
      expect(state.warnings).toContain('Triangle count approaching budget limit');
      expect(state.warnings).toContain('Draw calls approaching budget limit');
      expect(state.warnings).toContain('FPS below target');
    });

    it('should not clear warnings if new warnings are empty', () => {
      const { updateStats, addWarning } = usePerformanceStore.getState();

      // Add a manual warning
      addWarning('Custom warning');

      // Update stats without triggering any budget warnings
      updateStats({ fps: 60, triangleCount: 100 });

      const state = usePerformanceStore.getState();
      expect(state.warnings).toContain('Custom warning');
    });
  });

  describe('setProfilerOpen', () => {
    it('should open profiler', () => {
      const { setProfilerOpen } = usePerformanceStore.getState();

      setProfilerOpen(true);

      const state = usePerformanceStore.getState();
      expect(state.isProfilerOpen).toBe(true);
    });

    it('should close profiler', () => {
      const { setProfilerOpen } = usePerformanceStore.getState();

      setProfilerOpen(true);
      setProfilerOpen(false);

      const state = usePerformanceStore.getState();
      expect(state.isProfilerOpen).toBe(false);
    });
  });

  describe('setBudget', () => {
    it('should update budget with partial values', () => {
      const { setBudget } = usePerformanceStore.getState();

      setBudget({ maxTriangles: 1_000_000 });

      const state = usePerformanceStore.getState();
      expect(state.budget.maxTriangles).toBe(1_000_000);
      expect(state.budget.maxDrawCalls).toBe(200); // unchanged
    });

    it('should update warning threshold', () => {
      const { setBudget } = usePerformanceStore.getState();

      setBudget({ warningThreshold: 0.9 });

      const state = usePerformanceStore.getState();
      expect(state.budget.warningThreshold).toBe(0.9);
    });

    it('should allow multiple budget fields to be updated', () => {
      const { setBudget } = usePerformanceStore.getState();

      setBudget({
        maxTriangles: 750_000,
        maxDrawCalls: 150,
        targetFps: 120,
      });

      const state = usePerformanceStore.getState();
      expect(state.budget).toEqual({
        maxTriangles: 750_000,
        maxDrawCalls: 150,
        targetFps: 120,
        warningThreshold: 0.8, // unchanged
      });
    });
  });

  describe('addWarning', () => {
    it('should add a warning', () => {
      const { addWarning } = usePerformanceStore.getState();

      addWarning('Test warning');

      const state = usePerformanceStore.getState();
      expect(state.warnings).toEqual(['Test warning']);
    });

    it('should append warnings without removing existing ones', () => {
      const { addWarning } = usePerformanceStore.getState();

      addWarning('Warning 1');
      addWarning('Warning 2');

      const state = usePerformanceStore.getState();
      expect(state.warnings).toEqual(['Warning 1', 'Warning 2']);
    });
  });

  describe('clearWarnings', () => {
    it('should remove all warnings', () => {
      const { addWarning, clearWarnings } = usePerformanceStore.getState();

      addWarning('Warning 1');
      addWarning('Warning 2');
      clearWarnings();

      const state = usePerformanceStore.getState();
      expect(state.warnings).toEqual([]);
    });

    it('should work when no warnings exist', () => {
      const { clearWarnings } = usePerformanceStore.getState();

      clearWarnings();

      const state = usePerformanceStore.getState();
      expect(state.warnings).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero stats correctly', () => {
      const { updateStats } = usePerformanceStore.getState();

      updateStats({
        fps: 0,
        triangleCount: 0,
        drawCalls: 0,
      });

      const state = usePerformanceStore.getState();
      expect(state.stats.fps).toBe(0);
      // FPS warning should trigger (0 < 54)
      expect(state.warnings).toContain('FPS below target');
    });

    it('should handle negative FPS', () => {
      const { updateStats } = usePerformanceStore.getState();

      updateStats({ fps: -10 });

      const state = usePerformanceStore.getState();
      expect(state.stats.fps).toBe(-10);
    });

    it('should handle extremely high triangle counts', () => {
      const { updateStats } = usePerformanceStore.getState();

      updateStats({ triangleCount: 10_000_000 });

      const state = usePerformanceStore.getState();
      expect(state.stats.triangleCount).toBe(10_000_000);
      expect(state.warnings).toContain('Triangle count approaching budget limit');
    });

    it('should handle budget warning threshold of 0', () => {
      const { setBudget, updateStats } = usePerformanceStore.getState();

      setBudget({ warningThreshold: 0 });
      updateStats({ triangleCount: 1 });

      const state = usePerformanceStore.getState();
      // 1 > (500,000 * 0) = 1 > 0
      expect(state.warnings).toContain('Triangle count approaching budget limit');
    });

    it('should handle budget warning threshold of 1', () => {
      const { setBudget, updateStats } = usePerformanceStore.getState();

      setBudget({ warningThreshold: 1 });
      updateStats({ triangleCount: 500_001 });

      const state = usePerformanceStore.getState();
      // 500,001 > (500,000 * 1)
      expect(state.warnings).toContain('Triangle count approaching budget limit');
    });
  });
});
