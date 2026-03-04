/**
 * Tests for useEngineStatus hook — initialization phase tracking,
 * timeout detection, retry logic, and event-driven status updates.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock initLog before importing the hook
vi.mock('@/lib/initLog', () => {
  let events: Array<{ phase: string; timestamp: number; message?: string; error?: string }> = [];
  return {
    logInitEvent: vi.fn((phase: string, message?: string, error?: string) => {
      const event = { phase, timestamp: Date.now(), message, error };
      events.push(event);
      return event;
    }),
    clearInitEvents: vi.fn(() => { events = []; }),
    getInitEvents: vi.fn(() => [...events]),
  };
});

import { useEngineStatus, emitStatusEvent } from '../useEngineStatus';
import type { InitEvent } from '@/lib/initLog';

describe('useEngineStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------
  it('returns correct initial state', () => {
    const { result } = renderHook(() => useEngineStatus());

    expect(result.current.currentPhase).toBeNull();
    expect(result.current.phases).toHaveLength(7); // PHASE_ORDER has 7 phases
    expect(result.current.totalElapsed).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.isTimedOut).toBe(false);
    expect(result.current.timeoutPhase).toBeNull();
    expect(result.current.retryCount).toBe(0);
    expect(result.current.isReady).toBe(false);
    expect(result.current.canRetry).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Phase logging
  // ---------------------------------------------------------------------------
  it('updates currentPhase when logEvent is called', () => {
    const { result } = renderHook(() => useEngineStatus());

    act(() => {
      result.current.logEvent('wasm_loading', 'Fetching WASM');
    });

    expect(result.current.currentPhase).toBe('wasm_loading');
  });

  it('progresses through phases in order', () => {
    const { result } = renderHook(() => useEngineStatus());

    act(() => {
      result.current.logEvent('wasm_loading');
    });
    expect(result.current.currentPhase).toBe('wasm_loading');

    act(() => {
      result.current.logEvent('wasm_loaded');
    });
    expect(result.current.currentPhase).toBe('wasm_loaded');

    act(() => {
      result.current.logEvent('engine_starting');
    });
    expect(result.current.currentPhase).toBe('engine_starting');
  });

  it('marks phases as done when later phases are reached', () => {
    const { result } = renderHook(() => useEngineStatus());

    act(() => {
      result.current.logEvent('wasm_loading');
      result.current.logEvent('wasm_loaded');
      result.current.logEvent('engine_starting');
    });

    const wasmLoading = result.current.phases.find(p => p.phase === 'wasm_loading');
    expect(wasmLoading?.status).toBe('done');
  });

  // ---------------------------------------------------------------------------
  // Ready state
  // ---------------------------------------------------------------------------
  it('sets isReady when ready phase is logged', () => {
    const { result } = renderHook(() => useEngineStatus());

    act(() => {
      result.current.logEvent('wasm_loading');
      result.current.logEvent('ready');
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.canRetry).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Error tracking
  // ---------------------------------------------------------------------------
  it('captures error from events', () => {
    const { result } = renderHook(() => useEngineStatus());

    act(() => {
      result.current.logEvent('wasm_loading');
      result.current.logEvent('error', undefined, 'WASM load failed');
    });

    expect(result.current.error).toBe('WASM load failed');
  });

  // ---------------------------------------------------------------------------
  // Cross-hook event emission
  // ---------------------------------------------------------------------------
  it('receives events emitted via emitStatusEvent', () => {
    const { result } = renderHook(() => useEngineStatus());

    const event: InitEvent = {
      phase: 'renderer_init',
      timestamp: 500,
      message: 'Starting renderer',
    };

    act(() => {
      emitStatusEvent(event);
    });

    expect(result.current.currentPhase).toBe('renderer_init');
  });

  it('deduplicates events with same phase and timestamp', () => {
    const { result } = renderHook(() => useEngineStatus());

    const event: InitEvent = {
      phase: 'wasm_loading',
      timestamp: 100,
    };

    act(() => {
      emitStatusEvent(event);
      emitStatusEvent(event); // duplicate
    });

    // Should only have one event, not two
    const wasmPhases = result.current.phases.filter(p => p.phase === 'wasm_loading');
    expect(wasmPhases).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Timeout detection
  // ---------------------------------------------------------------------------
  it('detects phase-specific timeout for wasm_loading', () => {
    const { result } = renderHook(() => useEngineStatus());

    act(() => {
      result.current.logEvent('wasm_loading');
    });

    // Advance past the WASM loading timeout (10 seconds)
    act(() => {
      vi.advanceTimersByTime(10_001);
    });

    expect(result.current.isTimedOut).toBe(true);
    expect(result.current.timeoutPhase).toBe('wasm_loading');
  });

  it('does not timeout if phase completes in time', () => {
    const { result } = renderHook(() => useEngineStatus());

    act(() => {
      result.current.logEvent('wasm_loading');
    });

    // Complete the phase before timeout
    act(() => {
      vi.advanceTimersByTime(5000);
      result.current.logEvent('wasm_loaded');
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.isTimedOut).toBe(false);
  });

  it('clears timeouts when ready', () => {
    const { result } = renderHook(() => useEngineStatus());

    act(() => {
      result.current.logEvent('wasm_loading');
    });

    act(() => {
      vi.advanceTimersByTime(2000);
      result.current.logEvent('ready');
    });

    // Even advancing past original timeout, should not trigger
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(result.current.isTimedOut).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Retry logic
  // ---------------------------------------------------------------------------
  it('retry increments retryCount and resets state', () => {
    const { result } = renderHook(() => useEngineStatus());

    // Simulate an error state
    act(() => {
      result.current.logEvent('error', undefined, 'Something broke');
    });

    // Mock window.location.reload
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    act(() => {
      result.current.retry();
    });

    expect(result.current.retryCount).toBe(1);
    expect(result.current.isTimedOut).toBe(false);
    expect(result.current.timeoutPhase).toBeNull();
    expect(reloadMock).toHaveBeenCalled();
  });

  it('cannot retry more than MAX_RETRIES (3) times', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useEngineStatus());

    // Retry 3 times
    act(() => { result.current.retry(); });
    act(() => { result.current.retry(); });
    act(() => { result.current.retry(); });

    expect(result.current.retryCount).toBe(3);
    expect(result.current.canRetry).toBe(false);

    // 4th retry should be a no-op
    act(() => { result.current.retry(); });
    expect(result.current.retryCount).toBe(3);
    expect(reloadMock).toHaveBeenCalledTimes(3);
  });

  // ---------------------------------------------------------------------------
  // Phase status building
  // ---------------------------------------------------------------------------
  it('builds phases array with correct labels', () => {
    const { result } = renderHook(() => useEngineStatus());

    const phaseNames = result.current.phases.map(p => p.phase);
    expect(phaseNames).toContain('wasm_loading');
    expect(phaseNames).toContain('ready');
    expect(phaseNames).toContain('renderer_init');
  });

  it('pending phases show default messages from PHASE_LABELS', () => {
    const { result } = renderHook(() => useEngineStatus());

    const pending = result.current.phases.find(p => p.phase === 'wasm_loading');
    expect(pending?.status).toBe('pending');
    expect(pending?.message).toBe('Loading WASM module');
  });

  // ---------------------------------------------------------------------------
  // totalElapsed
  // ---------------------------------------------------------------------------
  it('totalElapsed tracks last event timestamp', () => {
    const { result } = renderHook(() => useEngineStatus());

    act(() => {
      result.current.logEvent('wasm_loading');
    });

    expect(result.current.totalElapsed).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  it('cleans up listener on unmount', () => {
    const { unmount } = renderHook(() => useEngineStatus());

    // Should not throw on unmount
    unmount();

    // Emitting events after unmount should not cause errors
    const event: InitEvent = { phase: 'ready', timestamp: 1000 };
    expect(() => emitStatusEvent(event)).not.toThrow();
  });
});
