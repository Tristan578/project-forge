import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet } from './eventTestUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

const mockUpdateStats = vi.fn();
const mockSetLodLevel = vi.fn();
const mockPushSystemTimingFrame = vi.fn();

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: {
    getState: vi.fn(() => ({
      updateStats: mockUpdateStats,
      setLodLevel: mockSetLodLevel,
      pushSystemTimingFrame: mockPushSystemTimingFrame,
    })),
  },
}));

import { handlePerformanceEvent } from '../performanceEvents';

describe('handlePerformanceEvent', () => {
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    mockSetGet = createMockSetGet();
    mockUpdateStats.mockClear();
    mockSetLodLevel.mockClear();
    mockPushSystemTimingFrame.mockClear();
  });

  it('returns false for unknown event types', () => {
    expect(handlePerformanceEvent('UNKNOWN', {}, mockSetGet.set, mockSetGet.get)).toBe(false);
  });

  it('PERFORMANCE_STATS: updates performance store with mapped fields', () => {
    const payload = {
      fps: 59.5,
      frameTimeMs: 16.8,
      entityCount: 42,
      triangleCount: 125000,
      drawCallEstimate: 85,
      wasmHeapBytes: 67108864,
      meshMemoryBytes: 10485760,
    };

    const result = handlePerformanceEvent('PERFORMANCE_STATS', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(mockUpdateStats).toHaveBeenCalledWith({
      fps: 59.5,
      frameTime: 16.8,
      entityCount: 42,
      triangleCount: 125000,
      drawCalls: 85,
      wasmHeapSize: 67108864,
      memoryUsage: 10, // 10485760 / (1024*1024) = 10
    });
  });

  it('LOD_CHANGED: updates LOD level for entity', () => {
    const payload = {
      entityId: 'entity-1',
      currentLod: 2,
      distances: [20, 50, 100],
    };

    const result = handlePerformanceEvent('LOD_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(mockSetLodLevel).toHaveBeenCalledWith('entity-1', 2);
  });

  it('PERFORMANCE_STATS: handles zero values correctly', () => {
    const payload = {
      fps: 0,
      frameTimeMs: 0,
      entityCount: 0,
      triangleCount: 0,
      drawCallEstimate: 0,
      wasmHeapBytes: 0,
      meshMemoryBytes: 0,
    };

    const result = handlePerformanceEvent('PERFORMANCE_STATS', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(mockUpdateStats).toHaveBeenCalledWith({
      fps: 0,
      frameTime: 0,
      entityCount: 0,
      triangleCount: 0,
      drawCalls: 0,
      wasmHeapSize: 0,
      memoryUsage: 0,
    });
  });

  it('SYSTEM_TIMINGS: forwards a per-frame system-group snapshot to the store', () => {
    const payload = {
      frameIndex: 7,
      perGroupMs: { scripting: 1.5, bridge: 0.5, physics: 2.25 },
    };

    const result = handlePerformanceEvent('SYSTEM_TIMINGS', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(mockPushSystemTimingFrame).toHaveBeenCalledWith({
      frameIndex: 7,
      perGroupMs: { scripting: 1.5, bridge: 0.5, physics: 2.25 },
    });
  });

  it('SYSTEM_TIMINGS: preserves an absent group as a gap, never coerced to 0', () => {
    // Rendering omitted -> unavailable this slice (OP-02). The handler must
    // forward the object as-is so the store can surface it as "unknown".
    const payload = { frameIndex: 3, perGroupMs: { physics: 4 } };

    handlePerformanceEvent('SYSTEM_TIMINGS', payload as never, mockSetGet.set, mockSetGet.get);

    const forwarded = mockPushSystemTimingFrame.mock.calls[0][0];
    expect(forwarded.perGroupMs).toEqual({ physics: 4 });
    expect(forwarded.perGroupMs).not.toHaveProperty('rendering');
    expect('rendering' in forwarded.perGroupMs).toBe(false);
  });

  it('SYSTEM_TIMINGS: tolerates a missing perGroupMs payload', () => {
    const payload = { frameIndex: 1 };
    const result = handlePerformanceEvent('SYSTEM_TIMINGS', payload as never, mockSetGet.set, mockSetGet.get);
    expect(result).toBe(true);
    expect(mockPushSystemTimingFrame).toHaveBeenCalledWith({ frameIndex: 1, perGroupMs: {} });
  });

});
