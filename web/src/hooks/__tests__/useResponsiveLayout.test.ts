import { describe, it, expect, afterEach } from 'vitest';
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

  it('returns compact at exact breakpoint 1023', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1023, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.mode).toBe('compact' as LayoutMode);
  });

  it('returns condensed at exact breakpoint 1024', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.mode).toBe('condensed' as LayoutMode);
  });

  it('returns condensed at exact breakpoint 1439', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1439, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.mode).toBe('condensed' as LayoutMode);
  });

  it('returns full at exact breakpoint 1440', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.mode).toBe('full' as LayoutMode);
  });

  it('full layout includes right panel and bottom panel', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.showRightPanel).toBe(true);
    expect(result.current.showBottomPanel).toBe(true);
    expect(result.current.bottomPanelHeight).toBe(160);
  });

  it('condensed layout includes panels with smaller sizes', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.showRightPanel).toBe(true);
    expect(result.current.showBottomPanel).toBe(true);
    expect(result.current.bottomPanelHeight).toBe(120);
  });

  it('compact layout hides all panels', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.showRightPanel).toBe(false);
    expect(result.current.showBottomPanel).toBe(false);
    expect(result.current.bottomPanelHeight).toBe(0);
  });

  it('updates layout on resize from compact to full', () => {
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.mode).toBe('compact' as LayoutMode);

    // Resize to full
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.mode).toBe('full' as LayoutMode);
  });
});
