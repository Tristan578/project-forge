import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEngine, resetEngine } from '../useEngine';
import * as initLog from '@/lib/initLog';

vi.mock('@/lib/initLog', () => ({
  logInitEvent: vi.fn(),
}));

vi.mock('../useEngineStatus', () => ({
  emitStatusEvent: vi.fn(),
}));

// We need to mock the dynamic import in loadWasm, which is hard.
// Instead we'll test the hook behavior by creating a mock canvas and controlling SSR state.
describe('useEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEngine();

    // Setup a mock canvas in the document
    const canvas = document.createElement('canvas');
    canvas.id = 'forge-canvas';
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    resetEngine();
  });

  it('bails out if canvas element is not found (similar to SSR)', () => {
    const { result } = renderHook(() => useEngine('non-existent-canvas'));
    expect(result.current.isReady).toBe(false);
    expect(initLog.logInitEvent).toHaveBeenCalledWith('error', 'Canvas element not found', 'No element with id="non-existent-canvas"');
  });

  it('emits error if canvas element is not found', () => {
    const { result } = renderHook(() => useEngine('missing-canvas'));

    expect(result.current.isReady).toBe(false);
    expect(initLog.logInitEvent).toHaveBeenCalledWith('error', 'Canvas element not found', 'No element with id="missing-canvas"');
  });

  it('throws error if __SKIP_ENGINE is set (for CI)', async () => {
    (window as Window & { __SKIP_ENGINE?: boolean }).__SKIP_ENGINE = true;

    const onError = vi.fn();
    const { result } = renderHook(() => useEngine('forge-canvas', { onError }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    expect(result.current.error?.message).toContain('Engine loading skipped');
    delete (window as Window & { __SKIP_ENGINE?: boolean }).__SKIP_ENGINE;
  });

  it('sendCommand returns undefined when engine not initialized', () => {
    const { result } = renderHook(() => useEngine('forge-canvas'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(result.current.sendCommand('cmd', {})).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith('Engine not initialized');

    consoleSpy.mockRestore();
  });
});
