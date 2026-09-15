/**
 * Unit tests for the performanceStore Zustand store.
 *
 * Tests cover stats tracking, profiler state, performance budget,
 * warning generation, and history tracking.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  usePerformanceStore,
  computeSystemCosts,
  MAX_SYSTEM_TIMING_FRAMES,
} from '../performanceStore';

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
      lodLevels: {},
      manifest: null,
      capturedReport: null,
    });
  });

  const sampleManifest = {
    schemaVersion: 1,
    buildSha: 'abc12345',
    fixtureChecksum: 'deadbeef',
    os: 'macOS',
    browserVersion: 'Chrome 140',
    gpuDriver: 'unknown' as const,
    backend: 'webgpu' as const,
    viewport: { width: 1920, height: 1080, devicePixelRatio: 2 },
    deviceMemory: 8,
    cacheState: 'cold' as const,
    sampleCount: 5,
  };

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

  describe('setLodLevel', () => {
    it('should set LOD level for an entity', () => {
      const { setLodLevel } = usePerformanceStore.getState();

      setLodLevel('entity-1', 2);

      const state = usePerformanceStore.getState();
      expect(state.lodLevels['entity-1']).toBe(2);
    });

    it('should track multiple entities independently', () => {
      const { setLodLevel } = usePerformanceStore.getState();

      setLodLevel('entity-1', 1);
      setLodLevel('entity-2', 3);

      const state = usePerformanceStore.getState();
      expect(state.lodLevels['entity-1']).toBe(1);
      expect(state.lodLevels['entity-2']).toBe(3);
    });

    it('should update existing entity LOD level', () => {
      const { setLodLevel } = usePerformanceStore.getState();

      setLodLevel('entity-1', 1);
      setLodLevel('entity-1', 3);

      const state = usePerformanceStore.getState();
      expect(state.lodLevels['entity-1']).toBe(3);
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

  // Measurement manifest — operation performance.FR-3.OP-01 (#9904)
  describe('setManifest (performance.FR-3.OP-01)', () => {
    it('should initialize with a null manifest and no captured report', () => {
      const state = usePerformanceStore.getState();
      expect(state.manifest).toBeNull();
      expect(state.capturedReport).toBeNull();
    });

    it('should set the manifest wholesale', () => {
      usePerformanceStore.getState().setManifest(sampleManifest);
      expect(usePerformanceStore.getState().manifest).toEqual(sampleManifest);
    });
  });

  describe('updateManifest (performance.FR-3.OP-01)', () => {
    it('should merge fields into an existing manifest without mutating unrelated state', () => {
      const { setManifest, updateManifest } = usePerformanceStore.getState();
      setManifest(sampleManifest);

      const statsBefore = usePerformanceStore.getState().stats;
      const budgetBefore = usePerformanceStore.getState().budget;

      updateManifest({ cacheState: 'warm', sampleCount: 12 });

      const state = usePerformanceStore.getState();
      expect(state.manifest?.cacheState).toBe('warm');
      expect(state.manifest?.sampleCount).toBe(12);
      // Unrelated manifest fields untouched
      expect(state.manifest?.backend).toBe('webgpu');
      expect(state.manifest?.buildSha).toBe('abc12345');
      // Unrelated store state untouched (same references)
      expect(state.stats).toBe(statsBefore);
      expect(state.budget).toBe(budgetBefore);
    });

    it('should not mutate the previous manifest object (immutability)', () => {
      const { setManifest, updateManifest } = usePerformanceStore.getState();
      setManifest(sampleManifest);
      const first = usePerformanceStore.getState().manifest;

      updateManifest({ sampleCount: 99 });
      const second = usePerformanceStore.getState().manifest;

      expect(second).not.toBe(first);
      expect(first?.sampleCount).toBe(5); // original snapshot unchanged
      expect(second?.sampleCount).toBe(99);
    });

    it('should create a complete versioned manifest when updated before capture', () => {
      usePerformanceStore.getState().updateManifest({ backend: 'webgl2', sampleCount: 3 });
      const state = usePerformanceStore.getState();
      expect(state.manifest?.backend).toBe('webgl2');
      expect(state.manifest?.sampleCount).toBe(3);
      expect(state.manifest?.schemaVersion).toBe(1);
      expect(state.manifest?.fixtureChecksum).toBe('unknown');
      expect(state.manifest?.gpuDriver).toBe('unknown');
      expect(state.manifest?.cacheState).toBe('unknown');
      expect(Object.keys(state.manifest ?? {}).sort()).toEqual([
        'backend', 'browserVersion', 'buildSha', 'cacheState', 'deviceMemory',
        'fixtureChecksum', 'gpuDriver', 'os', 'sampleCount', 'schemaVersion', 'viewport',
      ]);
    });
  });

  describe('captureReport (performance.FR-3.OP-01)', () => {
    it('should store the captured report and adopt its manifest', () => {
      const report = {
        stats: {
          fps: 58,
          frameTime: 17.2,
          triangleCount: 12_000,
          drawCalls: 40,
          entityCount: 30,
          memoryUsage: 128.5,
          wasmHeapSize: 0,
          gpuMemory: 0,
        },
        manifest: sampleManifest,
        capturedAt: 1_700_000_000_000,
      };

      usePerformanceStore.getState().captureReport(report);

      const state = usePerformanceStore.getState();
      expect(state.capturedReport).toEqual(report);
      expect(state.manifest).toEqual(sampleManifest);
    });

    it('should preserve unknown manifest fields as unknown, never as zero', () => {
      const unknownManifest = {
        ...sampleManifest,
        deviceMemory: 'unknown' as const,
        gpuDriver: 'unknown' as const,
        backend: 'unknown' as const,
      };
      usePerformanceStore.getState().captureReport({
        stats: usePerformanceStore.getState().stats,
        manifest: unknownManifest,
        capturedAt: 1,
      });

      const state = usePerformanceStore.getState();
      expect(state.manifest?.deviceMemory).toBe('unknown');
      expect(state.manifest?.deviceMemory).not.toBe(0);
      expect(state.manifest?.backend).toBe('unknown');
    });
  });

  describe('system timing capture (performance.FR-1.OP-01 / OP-04)', () => {
    beforeEach(() => {
      usePerformanceStore.setState({
        captureActive: false,
        systemTimingHistory: [],
        systemCosts: computeSystemCosts([]),
      });
    });

    it('starts with every group unavailable (unknown), never zero', () => {
      const costs = computeSystemCosts([]);
      expect(costs).toHaveLength(4);
      for (const c of costs) {
        expect(c.totalMs).toBe('unknown');
        expect(c.totalMs).not.toBe(0);
      }
    });

    it('startSystemCapture arms the session and clears prior frames', () => {
      usePerformanceStore.setState({
        captureActive: false,
        systemTimingHistory: [{ frameIndex: 9, perGroupMs: { physics: 5 } }],
      });
      usePerformanceStore.getState().startSystemCapture();
      const state = usePerformanceStore.getState();
      expect(state.captureActive).toBe(true);
      expect(state.systemTimingHistory).toEqual([]);
      expect(state.systemCosts.every((c) => c.totalMs === 'unknown')).toBe(true);
    });

    it('ignores frames pushed while no session is active', () => {
      usePerformanceStore.getState().pushSystemTimingFrame({ frameIndex: 0, perGroupMs: { physics: 3 } });
      expect(usePerformanceStore.getState().systemTimingHistory).toEqual([]);
    });

    it('aggregates measured groups and keeps unmeasured groups unknown', () => {
      const store = usePerformanceStore.getState();
      store.startSystemCapture();
      store.pushSystemTimingFrame({ frameIndex: 0, perGroupMs: { physics: 2, bridge: 1, scripting: 0 } });
      store.pushSystemTimingFrame({ frameIndex: 1, perGroupMs: { physics: 3 } });

      const byGroup = Object.fromEntries(
        usePerformanceStore.getState().systemCosts.map((c) => [c.group, c.totalMs]),
      );
      expect(byGroup.physics).toBe(5);
      expect(byGroup.bridge).toBe(1);
      // A measured 0 is a real value, distinct from unavailable.
      expect(byGroup.scripting).toBe(0);
      // Rendering was never measured this slice -> unavailable, NOT 0.
      expect(byGroup.rendering).toBe('unknown');
      expect(byGroup.rendering).not.toBe(0);
    });

    it('ranks the costliest measured group first and unknown groups last', () => {
      const store = usePerformanceStore.getState();
      store.startSystemCapture();
      store.pushSystemTimingFrame({ frameIndex: 0, perGroupMs: { scripting: 1, physics: 8, bridge: 4 } });
      const costs = usePerformanceStore.getState().systemCosts;
      expect(costs[0].group).toBe('physics');
      expect(costs[1].group).toBe('bridge');
      expect(costs[2].group).toBe('scripting');
      expect(costs[3].group).toBe('rendering');
      expect(costs[3].totalMs).toBe('unknown');
    });

    it('bounds the rolling buffer to MAX_SYSTEM_TIMING_FRAMES', () => {
      const store = usePerformanceStore.getState();
      store.startSystemCapture();
      for (let i = 0; i < MAX_SYSTEM_TIMING_FRAMES + 25; i++) {
        store.pushSystemTimingFrame({ frameIndex: i, perGroupMs: { physics: 1 } });
      }
      const history = usePerformanceStore.getState().systemTimingHistory;
      expect(history).toHaveLength(MAX_SYSTEM_TIMING_FRAMES);
      // Oldest frames evicted; newest retained.
      expect(history[history.length - 1].frameIndex).toBe(MAX_SYSTEM_TIMING_FRAMES + 24);
    });

    it('stopSystemCapture retains frames but halts further recording', () => {
      const store = usePerformanceStore.getState();
      store.startSystemCapture();
      store.pushSystemTimingFrame({ frameIndex: 0, perGroupMs: { physics: 2 } });
      store.stopSystemCapture();
      expect(usePerformanceStore.getState().captureActive).toBe(false);
      expect(usePerformanceStore.getState().systemTimingHistory).toHaveLength(1);
      store.pushSystemTimingFrame({ frameIndex: 1, perGroupMs: { physics: 9 } });
      expect(usePerformanceStore.getState().systemTimingHistory).toHaveLength(1);
    });
  });

});
