import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useResponsiveLayout, type LayoutMode } from '../useResponsiveLayout';

describe('useResponsiveLayout', () => {
  afterEach(() => cleanup());

  it('returns full layout for wide viewports (1920+)', () => {
    // Default jsdom window width is typically 1024, so we mock it
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    // Force re-calculation by triggering a resize
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.mode).toBe('full' as LayoutMode);
    expect(result.current.showSidebar).toBe(true);
    expect(result.current.showHierarchy).toBe(true);
    expect(result.current.hierarchyWidth).toBe(240);
  });

  it('returns condensed layout for medium viewports (1024-1440)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.mode).toBe('condensed' as LayoutMode);
    expect(result.current.showSidebar).toBe(true);
    expect(result.current.hierarchyWidth).toBe(180);
  });

  it('returns compact layout for narrow viewports (<1024)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.mode).toBe('compact' as LayoutMode);
    expect(result.current.showSidebar).toBe(false);
    expect(result.current.showHierarchy).toBe(false);
    expect(result.current.hierarchyWidth).toBe(0);
  });

  it('responds to orientation change events', () => {
    Object.defineProperty(window, 'innerWidth', { value: 600, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => {
      window.dispatchEvent(new Event('orientationchange'));
    });
    expect(result.current.mode).toBe('compact' as LayoutMode);
  });
});
