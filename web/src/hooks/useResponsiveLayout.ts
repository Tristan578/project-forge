import { useState, useEffect } from 'react';

export type LayoutMode = 'compact' | 'condensed' | 'full';

export interface LayoutConfig {
  mode: LayoutMode;
  showSidebar: boolean;
  showHierarchy: boolean;
  showRightPanel: boolean;
  showBottomPanel: boolean;
  hierarchyWidth: number;
  bottomPanelHeight: number;
  /** True when a virtual keyboard is likely visible (viewport height < 60% of screen). */
  isKeyboardVisible: boolean;
}

/** Threshold: if visualViewport height drops below this fraction of screen height, keyboard is open. */
export const KEYBOARD_THRESHOLD = 0.6;

export function getLayoutConfig(width: number, isKeyboardVisible: boolean = false): LayoutConfig {
  // When virtual keyboard is open on mobile, force compact to avoid canvas clipping
  if (isKeyboardVisible && width < 1024) {
    return {
      mode: 'compact',
      showSidebar: false,
      showHierarchy: false,
      showRightPanel: false,
      showBottomPanel: false,
      hierarchyWidth: 0,
      bottomPanelHeight: 0,
      isKeyboardVisible: true,
    };
  }

  if (width < 1024) {
    return {
      mode: 'compact',
      showSidebar: false,
      showHierarchy: false,
      showRightPanel: false,
      showBottomPanel: false,
      hierarchyWidth: 0,
      bottomPanelHeight: 0,
      isKeyboardVisible,
    };
  }
  if (width < 1440) {
    return {
      mode: 'condensed',
      showSidebar: true,
      showHierarchy: true,
      showRightPanel: true,
      showBottomPanel: true,
      hierarchyWidth: 180,
      bottomPanelHeight: 120,
      isKeyboardVisible,
    };
  }
  return {
    mode: 'full',
    showSidebar: true,
    showHierarchy: true,
    showRightPanel: true,
    showBottomPanel: true,
    hierarchyWidth: 240,
    bottomPanelHeight: 160,
    isKeyboardVisible,
  };
}

/** Get the effective viewport height, preferring visualViewport for mobile accuracy. */
function getViewportHeight(): number {
  if (typeof window === 'undefined') return 0;
  return window.visualViewport?.height ?? window.innerHeight;
}

/** Detect whether the virtual keyboard is likely visible. */
export function detectKeyboard(): boolean {
  if (typeof window === 'undefined' || typeof screen === 'undefined') return false;
  const viewportHeight = getViewportHeight();
  const screenHeight = screen.height;
  if (screenHeight === 0) return false;
  return (viewportHeight / screenHeight) < KEYBOARD_THRESHOLD;
}

/**
 * Hook that derives a responsive layout config from window width and viewport height.
 * Uses the visualViewport API to detect virtual keyboard presence on mobile.
 */
export function useResponsiveLayout(): LayoutConfig {
  const [config, setConfig] = useState<LayoutConfig>(() => {
    if (typeof window === 'undefined') return getLayoutConfig(1920, false);
    return getLayoutConfig(window.innerWidth, detectKeyboard());
  });

  useEffect(() => {
    const handleResize = () => {
      setConfig(getLayoutConfig(window.innerWidth, detectKeyboard()));
    };

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });

    // Listen to visualViewport resize for virtual keyboard changes
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', handleResize, { passive: true });
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (vv) {
        vv.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  return config;
}

// Also exported as aliases for backward compat in tests
export { getLayoutConfig as _getLayoutConfig, detectKeyboard as _detectKeyboard };
