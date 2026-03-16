import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  withTimeout,
  probeWebGPU,
  useLoadingState,
  resetEngine,
  GPU_INIT_TIMEOUT_MS,
  WASM_FETCH_TIMEOUT_MS,
} from '../useEngine';

vi.mock('@/lib/initLog', () => ({
  logInitEvent: vi.fn(),
}));

vi.mock('../useEngineStatus', () => ({
  emitStatusEvent: vi.fn(),
}));

vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
}));

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('resolves when the promise completes before timeout', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, 5000, 'test');
    expect(result).toBe('success');
  });

  it('rejects with timeout error when promise takes too long', async () => {
    const neverResolves = new Promise<string>(() => {});
    const timeoutPromise = withTimeout(neverResolves, 100, 'test operation');

    vi.advanceTimersByTime(101);

    await expect(timeoutPromise).rejects.toThrow('test operation timed out after 100ms');
  });

  it('forwards the original rejection when promise fails before timeout', async () => {
    const failingPromise = Promise.reject(new Error('original error'));
    await expect(withTimeout(failingPromise, 5000, 'test')).rejects.toThrow('original error');
  });

  it('clears the timer when promise resolves', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const promise = Promise.resolve('done');
    await withTimeout(promise, 5000, 'test');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('probeWebGPU', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns false when navigator.gpu is not available', async () => {
    // In test environment, navigator.gpu is not defined
    const result = await probeWebGPU();
    expect(result).toBe(false);
  });

  it('returns false when requestAdapter returns null', async () => {
    const mockGpu = {
      requestAdapter: vi.fn().mockResolvedValue(null),
    };
    Object.defineProperty(navigator, 'gpu', {
      value: mockGpu,
      configurable: true,
      writable: true,
    });

    const result = await probeWebGPU();
    expect(result).toBe(false);

    // Clean up
    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it('returns true when adapter and device are available', async () => {
    const mockDevice = { destroy: vi.fn() };
    const mockAdapter = {
      requestDevice: vi.fn().mockResolvedValue(mockDevice),
    };
    const mockGpu = {
      requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
    };
    Object.defineProperty(navigator, 'gpu', {
      value: mockGpu,
      configurable: true,
      writable: true,
    });

    const result = await probeWebGPU();
    expect(result).toBe(true);
    expect(mockDevice.destroy).toHaveBeenCalled();

    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it('returns false when requestAdapter throws', async () => {
    const mockGpu = {
      requestAdapter: vi.fn().mockRejectedValue(new Error('GPU error')),
    };
    Object.defineProperty(navigator, 'gpu', {
      value: mockGpu,
      configurable: true,
      writable: true,
    });

    const result = await probeWebGPU();
    expect(result).toBe(false);

    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });
});

describe('useLoadingState', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetEngine();
  });

  it('starts with idle state', () => {
    const { result } = renderHook(() => useLoadingState());
    expect(result.current.phase).toBe('idle');
  });

  it('resets to idle after resetEngine()', () => {
    const { result } = renderHook(() => useLoadingState());
    // resetEngine should set phase to idle
    act(() => {
      resetEngine();
    });
    expect(result.current.phase).toBe('idle');
  });
});

describe('timeout constants', () => {
  it('GPU_INIT_TIMEOUT_MS is 30 seconds', () => {
    expect(GPU_INIT_TIMEOUT_MS).toBe(30_000);
  });

  it('WASM_FETCH_TIMEOUT_MS is 60 seconds', () => {
    expect(WASM_FETCH_TIMEOUT_MS).toBe(60_000);
  });
});
