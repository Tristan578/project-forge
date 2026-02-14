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
}

function getLayoutConfig(width: number): LayoutConfig {
  if (width < 1024) {
    return {
      mode: 'compact',
      showSidebar: false,
      showHierarchy: false,
      showRightPanel: false,
      showBottomPanel: false,
      hierarchyWidth: 0,
      bottomPanelHeight: 0,
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
  };
}

/**
 * Hook that derives a responsive layout config from window width.
 * Returns layout mode and panel visibility/sizing.
 */
export function useResponsiveLayout(): LayoutConfig {
  const [config, setConfig] = useState<LayoutConfig>(() => {
    if (typeof window === 'undefined') return getLayoutConfig(1920);
    return getLayoutConfig(window.innerWidth);
  });

  useEffect(() => {
    const handleResize = () => {
      setConfig(getLayoutConfig(window.innerWidth));
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return config;
}
