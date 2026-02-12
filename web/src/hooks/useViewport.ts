import { useEffect, useState, useCallback, useRef } from 'react';
import { useEngine } from './useEngine';

// Viewport constraints from spec
const MIN_WIDTH = 375;
const MIN_HEIGHT = 667;
const MAX_WIDTH = 3840;
const MAX_HEIGHT = 2160;
const DEBOUNCE_MS = 100;

export type ViewportBreakpoint =
  | 'mobile'
  | 'tablet'
  | 'laptop'
  | 'desktop'
  | 'large'
  | 'ultrawide';

export interface ViewportDimensions {
  width: number;
  height: number;
  dpr: number;
  breakpoint: ViewportBreakpoint;
}

/**
 * Determine the breakpoint based on width.
 */
function getBreakpoint(width: number): ViewportBreakpoint {
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  if (width < 1440) return 'laptop';
  if (width < 1920) return 'desktop';
  if (width < 2560) return 'large';
  return 'ultrawide';
}

/**
 * Clamp a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** SSR-safe default dimensions */
const DEFAULT_DIMENSIONS: ViewportDimensions = {
  width: 1280,
  height: 720,
  dpr: 1,
  breakpoint: 'laptop',
};

/**
 * Get current viewport dimensions from a canvas element.
 * Returns default dimensions during SSR.
 */
function getCanvasDimensions(canvasId: string): ViewportDimensions {
  // SSR guard: return defaults if document is not available
  if (typeof document === 'undefined') {
    return DEFAULT_DIMENSIONS;
  }

  const canvas = document.getElementById(canvasId);
  const parent = canvas?.parentElement;

  // Use parent dimensions if available, otherwise window
  const rawWidth = parent?.clientWidth ?? window.innerWidth;
  const rawHeight = parent?.clientHeight ?? window.innerHeight;

  const width = clamp(rawWidth, MIN_WIDTH, MAX_WIDTH);
  const height = clamp(rawHeight, MIN_HEIGHT, MAX_HEIGHT);
  const dpr = window.devicePixelRatio || 1;

  return {
    width,
    height,
    dpr,
    breakpoint: getBreakpoint(width),
  };
}

/**
 * Hook for managing viewport dimensions and syncing with the engine.
 *
 * - Listens to window resize events
 * - Debounces resize events (100ms)
 * - Clamps dimensions to constraints
 * - Sends resize command to engine
 */
export function useViewport(canvasId: string) {
  const [dimensions, setDimensions] = useState<ViewportDimensions>(() =>
    getCanvasDimensions(canvasId)
  );
  const [isReady, setIsReady] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSentInitialRef = useRef(false);

  // Send resize command to engine
  const sendResizeToEngine = useCallback(
    (dims: ViewportDimensions, sendCommand: (cmd: string, payload: unknown) => unknown) => {
      const payload = {
        width: dims.width,
        height: dims.height,
        dpr: dims.dpr,
      };
      sendCommand('resize', payload);
    },
    []
  );

  // Callback when engine is ready - send initial dimensions
  const handleEngineReady = useCallback(() => {
    setIsReady(true);
  }, []);

  const { isReady: engineReady, sendCommand, error } = useEngine(canvasId, {
    onReady: handleEngineReady,
  });

  // Send initial dimensions when engine is ready
  useEffect(() => {
    if (engineReady && !hasSentInitialRef.current) {
      hasSentInitialRef.current = true;
      // Use current dimensions (already initialized in useState)
      sendResizeToEngine(dimensions, sendCommand);
    }
  }, [engineReady, dimensions, sendCommand, sendResizeToEngine]);

  // Handle resize events with debouncing
  useEffect(() => {
    // SSR guard
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      // Clear existing debounce timer
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Set new debounce timer
      debounceRef.current = setTimeout(() => {
        const dims = getCanvasDimensions(canvasId);
        setDimensions(dims);

        // Only send to engine if ready
        if (engineReady) {
          sendResizeToEngine(dims, sendCommand);
        }
      }, DEBOUNCE_MS);
    };

    window.addEventListener('resize', handleResize);

    // Also handle orientation change on mobile
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [canvasId, engineReady, sendCommand, sendResizeToEngine]);

  // Update canvas element dimensions when viewport changes
  useEffect(() => {
    // SSR guard
    if (typeof document === 'undefined') return;

    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (canvas) {
      // Set CSS dimensions (logical pixels)
      canvas.style.width = `${dimensions.width}px`;
      canvas.style.height = `${dimensions.height}px`;

      // Set actual canvas buffer size (physical pixels)
      canvas.width = dimensions.width * dimensions.dpr;
      canvas.height = dimensions.height * dimensions.dpr;
    }
  }, [canvasId, dimensions]);

  return {
    dimensions,
    isReady,
    error,
    sendCommand,
  };
}
