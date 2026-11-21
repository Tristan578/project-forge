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

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: {
    getState: vi.fn(() => ({
      updateStats: mockUpdateStats,
      setLodLevel: mockSetLodLevel,
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
});
