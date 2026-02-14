import { useState, useEffect, useCallback, useRef } from 'react';

interface VirtualListConfig {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
}

interface VirtualListResult {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  offsetY: number;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Lightweight virtual scrolling hook.
 * Only renders items in the visible window + overscan buffer.
 */
export function useVirtualList({
  itemCount,
  itemHeight,
  overscan = 5,
}: VirtualListConfig): VirtualListResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    setContainerHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = itemCount * itemHeight;

  const rawStart = Math.floor(scrollTop / itemHeight);
  const rawEnd = Math.ceil((scrollTop + containerHeight) / itemHeight);

  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(itemCount, rawEnd + overscan);
  const offsetY = startIndex * itemHeight;

  return {
    startIndex,
    endIndex,
    totalHeight,
    offsetY,
    onScroll,
    containerRef,
  };
}
