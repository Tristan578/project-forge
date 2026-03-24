/**
 * Unit tests for usePointerLock hook — FPS camera mouse look.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEditorStore } from '@/stores/editorStore';

// Mock the WASM module
const mockHandleCommand = vi.fn();
vi.mock('../useEngine', () => ({
  getWasmModule: () => ({ handle_command: mockHandleCommand }),
}));

// Must import AFTER mocking
import { usePointerLock } from '../usePointerLock';

describe('usePointerLock', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a canvas element in the DOM
    canvas = document.createElement('canvas');
    canvas.id = 'test-canvas';
    document.body.appendChild(canvas);

    // Mock requestPointerLock and exitPointerLock
    canvas.requestPointerLock = vi.fn();
    document.exitPointerLock = vi.fn();

    // Default store state: not playing
    useEditorStore.setState({
      engineMode: 'edit',
      activeGameCameraId: null,
      allGameCameras: {},
    });
  });

  afterEach(() => {
    document.body.removeChild(canvas);
    // Reset pointerLockElement
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      writable: true,
      configurable: true,
    });
    // Always restore real timers to prevent timer state from leaking between tests.
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('activation conditions', () => {
    it('does nothing when not in play mode', () => {
      useEditorStore.setState({
        engineMode: 'edit',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      renderHook(() => usePointerLock('test-canvas'));

      expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    });

    it('does nothing when no active camera', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: null,
        allGameCameras: {},
      });

      renderHook(() => usePointerLock('test-canvas'));

      expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    });

    it('does nothing when camera is not firstPerson', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'thirdPersonFollow' as const, targetEntity: null } },
      });

      renderHook(() => usePointerLock('test-canvas'));

      expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    });

    it('requests pointer lock when playing with firstPerson camera', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      renderHook(() => usePointerLock('test-canvas'));

      expect(canvas.requestPointerLock).toHaveBeenCalled();
    });

    it('does nothing when canvas element does not exist', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      // Should not throw when canvas ID doesn't match
      expect(() => {
        renderHook(() => usePointerLock('nonexistent-canvas'));
      }).not.toThrow();
    });
  });

  describe('mouse movement handling', () => {
    it('sends mouse_delta command when pointer is locked and mouse moves', async () => {
      vi.useFakeTimers();
      vi.clearAllTimers();
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      // Simulate pointer locked to our canvas
      Object.defineProperty(document, 'pointerLockElement', {
        value: canvas,
        writable: true,
        configurable: true,
      });

      const { unmount } = renderHook(() => usePointerLock('test-canvas'));

      // Simulate mouse movement
      const moveEvent = new MouseEvent('mousemove', {
        bubbles: true,
      });
      Object.defineProperty(moveEvent, 'movementX', { value: 10 });
      Object.defineProperty(moveEvent, 'movementY', { value: -5 });
      document.dispatchEvent(moveEvent);

      // Dispatch is deferred via requestAnimationFrame — flush it
      await vi.advanceTimersByTimeAsync(16);

      expect(mockHandleCommand).toHaveBeenCalledWith('mouse_delta', {
        dx: 10,
        dy: -5,
      });

      unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('accumulates deltas from multiple mousemove events into one dispatch per RAF (PF-874)', async () => {
      // Isolate this test by unmounting any residual hooks, resetting timers,
      // and creating a fresh canvas to avoid listener leaks from previous tests.
      vi.useRealTimers(); // Start fresh — ensure no pending fake timers
      vi.useFakeTimers({ now: 1000 }); // Start fake time at a known epoch

      const freshCanvas = document.createElement('canvas');
      freshCanvas.id = 'fresh-canvas-874';
      freshCanvas.requestPointerLock = vi.fn();
      document.body.appendChild(freshCanvas);

      Object.defineProperty(document, 'pointerLockElement', {
        value: freshCanvas,
        writable: true,
        configurable: true,
      });

      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      const { unmount } = renderHook(() => usePointerLock('fresh-canvas-874'));

      // Fire three movement events rapidly (simulating 240 Hz mouse)
      const fire = (dx: number, dy: number) => {
        const e = new MouseEvent('mousemove', { bubbles: true });
        Object.defineProperty(e, 'movementX', { value: dx });
        Object.defineProperty(e, 'movementY', { value: dy });
        document.dispatchEvent(e);
      };

      fire(3, 1);
      fire(3, 1);
      fire(3, 1);

      // Advance past the throttle interval — all three should be batched into ONE call.
      await vi.advanceTimersByTimeAsync(20);

      expect(mockHandleCommand).toHaveBeenCalledTimes(1);
      expect(mockHandleCommand).toHaveBeenCalledWith('mouse_delta', {
        dx: 9,
        dy: 3,
      });

      unmount();
      document.body.removeChild(freshCanvas);
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('throttles WASM dispatches: second event within 16ms is deferred (PF-874)', async () => {
      vi.useRealTimers();
      vi.useFakeTimers({ now: 1000 }); // Start at known epoch (1000ms)

      const freshCanvas = document.createElement('canvas');
      freshCanvas.id = 'fresh-canvas-874b';
      freshCanvas.requestPointerLock = vi.fn();
      document.body.appendChild(freshCanvas);

      Object.defineProperty(document, 'pointerLockElement', {
        value: freshCanvas,
        writable: true,
        configurable: true,
      });

      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      const { unmount } = renderHook(() => usePointerLock('fresh-canvas-874b'));

      const fire = (dx: number, dy: number) => {
        const e = new MouseEvent('mousemove', { bubbles: true });
        Object.defineProperty(e, 'movementX', { value: dx });
        Object.defineProperty(e, 'movementY', { value: dy });
        document.dispatchEvent(e);
      };

      // First dispatch: fire and advance well past throttle interval.
      fire(5, 5);
      await vi.advanceTimersByTimeAsync(20); // fake time: 1020ms
      expect(mockHandleCommand).toHaveBeenCalledTimes(1);
      // lastDispatchTime ≈ 1020ms (fake time when RAF fired)

      // Second event: fired immediately after — fake time is still ~1020ms.
      // Advancing only 10ms puts us at ~1030ms: diff = 10ms < 16ms → throttled.
      fire(5, 5);
      await vi.advanceTimersByTimeAsync(10); // fake time: 1030ms — still within throttle
      expect(mockHandleCommand).toHaveBeenCalledTimes(1); // not dispatched yet

      // Advance past the throttle interval from last dispatch (total >= 16ms).
      await vi.advanceTimersByTimeAsync(20); // fake time: 1050ms — diff ≥ 16ms → dispatch
      expect(mockHandleCommand).toHaveBeenCalledTimes(2);

      unmount();
      document.body.removeChild(freshCanvas);
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('does not send command when pointer is not locked', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      // pointerLockElement is null (not locked)
      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        writable: true,
        configurable: true,
      });

      renderHook(() => usePointerLock('test-canvas'));

      const moveEvent = new MouseEvent('mousemove', { bubbles: true });
      document.dispatchEvent(moveEvent);

      expect(mockHandleCommand).not.toHaveBeenCalled();
    });

    it('silently ignores WASM command errors during mouse movement', () => {
      mockHandleCommand.mockImplementation(() => {
        throw new Error('WASM error');
      });

      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      Object.defineProperty(document, 'pointerLockElement', {
        value: canvas,
        writable: true,
        configurable: true,
      });

      renderHook(() => usePointerLock('test-canvas'));

      const moveEvent = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(moveEvent, 'movementX', { value: 1 });
      Object.defineProperty(moveEvent, 'movementY', { value: 1 });

      // Should not throw
      expect(() => document.dispatchEvent(moveEvent)).not.toThrow();
    });
  });

  describe('click-to-lock behavior', () => {
    it('requests pointer lock on canvas click', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      // Not yet locked
      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        writable: true,
        configurable: true,
      });

      renderHook(() => usePointerLock('test-canvas'));

      canvas.click();

      expect(canvas.requestPointerLock).toHaveBeenCalled();
    });

    it('does not re-request when already locked', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      // Already locked to this canvas
      Object.defineProperty(document, 'pointerLockElement', {
        value: canvas,
        writable: true,
        configurable: true,
      });

      renderHook(() => usePointerLock('test-canvas'));

      // Reset call count from auto-request
      (canvas.requestPointerLock as ReturnType<typeof vi.fn>).mockClear();

      canvas.click();

      expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('removes event listeners on unmount', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      const removeCanvasSpy = vi.spyOn(canvas, 'removeEventListener');
      const removeDocSpy = vi.spyOn(document, 'removeEventListener');

      const { unmount } = renderHook(() => usePointerLock('test-canvas'));
      unmount();

      // Cleanup should remove click listener from canvas and mousemove from document
      expect(removeCanvasSpy).toHaveBeenCalledWith('click', expect.any(Function));
      expect(removeDocSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));

      removeCanvasSpy.mockRestore();
      removeDocSpy.mockRestore();
    });

    it('exits pointer lock on unmount when locked', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      Object.defineProperty(document, 'pointerLockElement', {
        value: canvas,
        writable: true,
        configurable: true,
      });

      const { unmount } = renderHook(() => usePointerLock('test-canvas'));
      unmount();

      expect(document.exitPointerLock).toHaveBeenCalled();
    });

    it('does not call exitPointerLock on unmount when not locked', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'firstPerson', targetEntity: null } },
      });

      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        writable: true,
        configurable: true,
      });

      const { unmount } = renderHook(() => usePointerLock('test-canvas'));
      unmount();

      expect(document.exitPointerLock).not.toHaveBeenCalled();
    });
  });

  describe('camera mode changes', () => {
    it('handles camera with no mode property', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam1',
        allGameCameras: { cam1: { mode: 'fixed' as const, targetEntity: null } },
      });

      renderHook(() => usePointerLock('test-canvas'));

      // Without mode, isFirstPerson is false → no pointer lock
      expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    });

    it('handles missing camera in allGameCameras', () => {
      useEditorStore.setState({
        engineMode: 'play',
        activeGameCameraId: 'cam-missing',
        allGameCameras: {},
      });

      renderHook(() => usePointerLock('test-canvas'));

      expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    });
  });
});
