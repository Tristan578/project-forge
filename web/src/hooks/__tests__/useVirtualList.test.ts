import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useVirtualList } from '../useVirtualList';

describe('useVirtualList', () => {
  afterEach(() => cleanup());

  it('returns correct initial state with default overscan', () => {
    const { result } = renderHook(() =>
      useVirtualList({ itemCount: 100, itemHeight: 30 })
    );

    expect(result.current.startIndex).toBe(0);
    expect(result.current.totalHeight).toBe(3000); // 100 * 30
    expect(result.current.offsetY).toBe(0);
    expect(result.current.containerRef).toBeDefined();
    expect(typeof result.current.onScroll).toBe('function');
  });

  it('calculates total height correctly', () => {
    const { result } = renderHook(() =>
      useVirtualList({ itemCount: 50, itemHeight: 40 })
    );
    expect(result.current.totalHeight).toBe(2000); // 50 * 40
  });

  it('returns zero-based start index initially', () => {
    const { result } = renderHook(() =>
      useVirtualList({ itemCount: 200, itemHeight: 24, overscan: 3 })
    );
    expect(result.current.startIndex).toBe(0);
    expect(result.current.offsetY).toBe(0);
  });

  it('endIndex does not exceed item count', () => {
    const { result } = renderHook(() =>
      useVirtualList({ itemCount: 10, itemHeight: 30, overscan: 20 })
    );
    // With overscan of 20 and only 10 items, endIndex should be capped at 10
    expect(result.current.endIndex).toBeLessThanOrEqual(10);
  });
});
