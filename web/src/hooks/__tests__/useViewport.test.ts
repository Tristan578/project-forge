/**
 * Tests for useViewport.
 *
 * useEngine is mocked out entirely (it drives WASM loading, well out of
 * scope here); these tests exercise useViewport's own logic: the initial
 * dimensions derived from the DOM, the debounced resize/orientationchange
 * handling (with cleanup), the one-time "send initial dimensions once the
 * engine is ready" effect, and the canvas element dimension sync.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useViewport } from '../useViewport';

type OnReady = () => void;

let mockIsReady = false;
let mockError: Error | null = null;
const mockSendCommand = vi.fn();
let capturedOnReady: OnReady | undefined;

vi.mock('../useEngine', () => ({
  useEngine: (_canvasId: string, options?: { onReady?: OnReady }) => {
    capturedOnReady = options?.onReady;
    return { isReady: mockIsReady, sendCommand: mockSendCommand, error: mockError };
  },
}));

const CANVAS_ID = 'game-canvas';

/**
 * getCanvasDimensions() reads `canvas.parentElement.clientWidth/Height`
 * first, falling back to window.innerWidth/Height only when that is
 * nullish. jsdom does no layout, so a plain element's clientWidth/Height is
 * always 0 (not undefined) — meaning body.clientWidth, not
 * window.innerWidth, is what actually drives the computed dimensions in
 * this environment. Stub the property the source really reads.
 */
function setBodyClientSize(width: number, height: number) {
  Object.defineProperty(document.body, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(document.body, 'clientHeight', { value: height, configurable: true });
}

describe('useViewport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsReady = false;
    mockError = null;
    capturedOnReady = undefined;
    document.body.innerHTML = `<canvas id="${CANVAS_ID}"></canvas>`;
    // The body element itself persists across tests within this file, so a
    // clientWidth/Height stub from a prior test would otherwise leak in.
    setBodyClientSize(0, 0);
  });

  afterEach(() => {
    // Without this, a hook instance from an earlier test stays mounted (its
    // window resize/orientationchange listeners keep firing) because this
    // project's vitest setup does not auto-cleanup between tests.
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clamps a zero-sized parent up to the minimum viewport bounds', () => {
    const { result } = renderHook(() => useViewport(CANVAS_ID));

    // jsdom reports clientWidth/Height as 0 for an unlaid-out parent, so the
    // clamp floor (MIN_WIDTH/MIN_HEIGHT) is what should come out here.
    expect(result.current.dimensions.width).toBe(375);
    expect(result.current.dimensions.height).toBe(667);
    expect(result.current.dimensions.breakpoint).toBe('mobile');
    expect(result.current.dimensions.dpr).toBeGreaterThan(0);
    expect(result.current.isReady).toBe(false);
  });

  it('sends the initial resize to the engine exactly once when it becomes ready', () => {
    const { result, rerender } = renderHook(() => useViewport(CANVAS_ID));

    expect(mockSendCommand).not.toHaveBeenCalled();

    mockIsReady = true;
    rerender();

    expect(mockSendCommand).toHaveBeenCalledTimes(1);
    expect(mockSendCommand).toHaveBeenCalledWith('resize', {
      width: result.current.dimensions.width,
      height: result.current.dimensions.height,
      dpr: result.current.dimensions.dpr,
    });

    // A further re-render with the engine still ready must not resend.
    rerender();
    expect(mockSendCommand).toHaveBeenCalledTimes(1);
  });

  it('surfaces isReady=true once the engine invokes its onReady callback', () => {
    const { result } = renderHook(() => useViewport(CANVAS_ID));

    expect(result.current.isReady).toBe(false);
    act(() => {
      capturedOnReady?.();
    });
    expect(result.current.isReady).toBe(true);
  });

  it('surfaces an error from useEngine', () => {
    mockError = new Error('engine boom');
    const { result } = renderHook(() => useViewport(CANVAS_ID));

    expect(result.current.error).toBe(mockError);
  });

  it('debounces a burst of resize events into a single dimension update, and resends to a ready engine', () => {
    vi.useFakeTimers();
    mockIsReady = true;
    const { result } = renderHook(() => useViewport(CANVAS_ID));
    mockSendCommand.mockClear();

    setBodyClientSize(900, 700);

    act(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.dimensions.width).toBe(900);
    expect(result.current.dimensions.height).toBe(700);
    // Only one debounced dimension update should have reached the engine,
    // despite three resize events firing.
    expect(mockSendCommand).toHaveBeenCalledTimes(1);
    expect(mockSendCommand).toHaveBeenCalledWith('resize', {
      width: 900,
      height: 700,
      dpr: result.current.dimensions.dpr,
    });
  });

  it('recomputes dimensions on orientationchange without resending when the engine is not ready', () => {
    vi.useFakeTimers();
    mockIsReady = false;
    const { result } = renderHook(() => useViewport(CANVAS_ID));

    setBodyClientSize(400, 800);

    act(() => {
      window.dispatchEvent(new Event('orientationchange'));
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.dimensions.width).toBe(400);
    expect(result.current.dimensions.height).toBe(800);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it('clamps dimensions to the configured min/max bounds', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useViewport(CANVAS_ID));

    setBodyClientSize(100, 5000);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.dimensions.width).toBe(375); // MIN_WIDTH
    expect(result.current.dimensions.height).toBe(2160); // MAX_HEIGHT
  });

  it('syncs the canvas element style and buffer size to the current dimensions', () => {
    renderHook(() => useViewport(CANVAS_ID));

    const canvas = document.getElementById(CANVAS_ID) as HTMLCanvasElement;
    // Zero-sized parent clamps to the minimum bounds (see the first test).
    expect(canvas.style.width).toBe('375px');
    expect(canvas.style.height).toBe('667px');
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it('removes its resize/orientationchange listeners and clears a pending debounce on unmount', () => {
    vi.useFakeTimers();
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const { unmount } = renderHook(() => useViewport(CANVAS_ID));

    // Start a debounce timer so unmount has something pending to clear.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('orientationchange', expect.any(Function));
    expect(clearSpy).toHaveBeenCalled();
  });
});
