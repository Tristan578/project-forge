import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  useResponsiveLayout,
  getLayoutConfig,
  detectKeyboard,
  KEYBOARD_THRESHOLD,
  type LayoutMode,
} from '../useResponsiveLayout';

describe('useResponsiveLayout', () => {
  afterEach(() => cleanup());

  it('returns full layout for wide viewports (1920+)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
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

  it('includes isKeyboardVisible field defaulting to false', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
    const { result } = renderHook(() => useResponsiveLayout());
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current.isKeyboardVisible).toBe(false);
  });
});

describe('getLayoutConfig', () => {
  it('returns isKeyboardVisible=false by default', () => {
    const config = getLayoutConfig(1920);
    expect(config.isKeyboardVisible).toBe(false);
  });

  it('returns isKeyboardVisible=true when passed true', () => {
    const config = getLayoutConfig(1920, true);
    expect(config.isKeyboardVisible).toBe(true);
    // Desktop with keyboard should still be full mode
    expect(config.mode).toBe('full');
  });

  it('forces compact mode when keyboard visible on mobile width', () => {
    const config = getLayoutConfig(800, true);
    expect(config.mode).toBe('compact');
    expect(config.isKeyboardVisible).toBe(true);
    expect(config.showSidebar).toBe(false);
    expect(config.showBottomPanel).toBe(false);
  });

  it('does not force compact on desktop width even with keyboard', () => {
    const config = getLayoutConfig(1440, true);
    expect(config.mode).toBe('full');
    expect(config.isKeyboardVisible).toBe(true);
  });
});

describe('detectKeyboard', () => {
  let originalVisualViewport: VisualViewport | null;

  beforeEach(() => {
    originalVisualViewport = window.visualViewport;
  });

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      value: originalVisualViewport,
      configurable: true,
      writable: true,
    });
  });

  it('returns false when screen height is 0', () => {
    Object.defineProperty(screen, 'height', { value: 0, configurable: true });
    expect(detectKeyboard()).toBe(false);
    Object.defineProperty(screen, 'height', { value: 768, configurable: true });
  });

  it('returns false when viewport is large relative to screen', () => {
    // Default test environment: window.innerHeight ~ screen.height
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
    Object.defineProperty(screen, 'height', { value: 800, configurable: true });
    // 700/800 = 0.875 > 0.6 threshold
    Object.defineProperty(window, 'visualViewport', { value: null, configurable: true, writable: true });
    expect(detectKeyboard()).toBe(false);
  });

  it('returns true when visualViewport height is small (keyboard open)', () => {
    Object.defineProperty(screen, 'height', { value: 800, configurable: true });
    const mockVV = { height: 300 }; // 300/800 = 0.375 < 0.6
    Object.defineProperty(window, 'visualViewport', {
      value: mockVV,
      configurable: true,
      writable: true,
    });
    expect(detectKeyboard()).toBe(true);
    Object.defineProperty(screen, 'height', { value: 768, configurable: true });
  });

  it('uses window.innerHeight when visualViewport is null', () => {
    Object.defineProperty(window, 'visualViewport', { value: null, configurable: true, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    Object.defineProperty(screen, 'height', { value: 800, configurable: true });
    // 300/800 = 0.375 < 0.6
    expect(detectKeyboard()).toBe(true);
    Object.defineProperty(screen, 'height', { value: 768, configurable: true });
  });
});

describe('KEYBOARD_THRESHOLD', () => {
  it('is 0.6 (60% of screen height)', () => {
    expect(KEYBOARD_THRESHOLD).toBe(0.6);
  });
});

describe('visualViewport listener', () => {
  afterEach(() => cleanup());

  it('responds to visualViewport resize events', () => {
    // Create a mock visualViewport with event listener support
    const listeners: Record<string, (() => void)[]> = {};
    const mockVV = {
      height: 800,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, 'visualViewport', {
      value: mockVV,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
    Object.defineProperty(screen, 'height', { value: 800, configurable: true });

    const { result } = renderHook(() => useResponsiveLayout());

    // Verify visualViewport listener was added
    expect(mockVV.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

    // Simulate keyboard open via visualViewport resize
    mockVV.height = 300; // 300/800 = 0.375 < 0.6
    act(() => {
      listeners['resize']?.forEach(h => h());
    });

    expect(result.current.isKeyboardVisible).toBe(true);
    expect(result.current.mode).toBe('compact');

    // Restore
    Object.defineProperty(window, 'visualViewport', {
      value: null,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(screen, 'height', { value: 768, configurable: true });
  });
});
