/**
 * Hook for tracking engine initialization status with timeout detection and retry logic.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  type InitPhase,
  type InitEvent,
  logInitEvent,
  clearInitEvents,
} from '@/lib/initLog';

// Timeout thresholds in milliseconds
const PHASE_TIMEOUTS: Partial<Record<InitPhase, number>> = {
  wasm_loading: 10_000,
  renderer_init: 15_000,
};
const GLOBAL_TIMEOUT = 30_000;
const MAX_RETRIES = 3;

export interface PhaseStatus {
  phase: InitPhase;
  duration: number;
  status: 'done' | 'active' | 'pending';
  message?: string;
  error?: string;
}

export interface EngineStatus {
  currentPhase: InitPhase | null;
  phases: PhaseStatus[];
  totalElapsed: number;
  error: string | null;
  isTimedOut: boolean;
  timeoutPhase: InitPhase | null;
  retryCount: number;
  canRetry: boolean;
  isReady: boolean;
}

// Event emitter for cross-hook communication
type StatusListener = (event: InitEvent) => void;
const listeners: Set<StatusListener> = new Set();

export function emitStatusEvent(event: InitEvent): void {
  listeners.forEach((listener) => listener(event));
}

// Ordered phases for display
const PHASE_ORDER: InitPhase[] = [
  'wasm_loading',
  'wasm_loaded',
  'engine_starting',
  'bevy_plugins',
  'renderer_init',
  'scene_setup',
  'ready',
];

const PHASE_LABELS: Record<InitPhase, string> = {
  wasm_loading: 'Loading WASM module',
  wasm_loaded: 'WASM module loaded',
  engine_starting: 'Starting engine',
  bevy_plugins: 'Registering plugins',
  renderer_init: 'Initializing renderer',
  scene_setup: 'Setting up scene',
  ready: 'Ready',
  error: 'Error',
};

export function useEngineStatus(): EngineStatus & {
  retry: () => void;
  logEvent: (phase: InitPhase, message?: string, error?: string) => void;
} {
  const [events, setEvents] = useState<InitEvent[]>([]);
  const [retryCount, setRetryCount] = useState(0);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [timeoutPhase, setTimeoutPhase] = useState<InitPhase | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get current phase from events
  const currentPhase = events.length > 0 ? events[events.length - 1].phase : null;
  const isReady = currentPhase === 'ready';
  const hasError = events.some((e) => e.phase === 'error');
  const error = events.find((e) => e.error)?.error ?? null;

  // Clear timeouts
  const clearTimeouts = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (phaseTimeoutRef.current) {
      clearTimeout(phaseTimeoutRef.current);
      phaseTimeoutRef.current = null;
    }
  }, []);

  // Log an event
  const logEvent = useCallback(
    (phase: InitPhase, message?: string, eventError?: string) => {
      const event = logInitEvent(phase, message, eventError);
      setEvents((prev) => [...prev, event]);
      emitStatusEvent(event);
    },
    []
  );

  // Handle incoming events
  useEffect(() => {
    const handleEvent = (event: InitEvent) => {
      setEvents((prev) => {
        // Avoid duplicates
        if (prev.some((e) => e.phase === event.phase && e.timestamp === event.timestamp)) {
          return prev;
        }
        return [...prev, event];
      });
    };

    listeners.add(handleEvent);
    return () => {
      listeners.delete(handleEvent);
    };
  }, []);

  // Set up timeouts when phase changes
  useEffect(() => {
    if (isReady || hasError || isTimedOut) {
      clearTimeouts();
      return;
    }

    // Phase-specific timeout
    if (currentPhase && PHASE_TIMEOUTS[currentPhase]) {
      phaseTimeoutRef.current = setTimeout(() => {
        setIsTimedOut(true);
        setTimeoutPhase(currentPhase);
        logEvent('error', `Phase "${currentPhase}" timed out`);
      }, PHASE_TIMEOUTS[currentPhase]);
    }

    // Global timeout based on latest event
    const lastEventTime = events.length > 0 ? events[events.length - 1].timestamp : 0;
    const remaining = GLOBAL_TIMEOUT - lastEventTime;
    if (remaining > 0) {
      timeoutRef.current = setTimeout(() => {
        setIsTimedOut(true);
        setTimeoutPhase(currentPhase);
        logEvent('error', 'Initialization timed out');
      }, remaining);
    }

    return clearTimeouts;
  }, [currentPhase, isReady, hasError, isTimedOut, clearTimeouts, logEvent]);

  // Build phase status list
  const phases: PhaseStatus[] = PHASE_ORDER.map((phase) => {
    const phaseEvents = events.filter((e) => e.phase === phase);
    const lastEvent = phaseEvents[phaseEvents.length - 1];

    let status: 'done' | 'active' | 'pending' = 'pending';
    if (lastEvent) {
      status = 'done';
    } else if (phase === currentPhase) {
      status = 'active';
    } else {
      // Check if we've passed this phase
      const currentIndex = currentPhase ? PHASE_ORDER.indexOf(currentPhase) : -1;
      const phaseIndex = PHASE_ORDER.indexOf(phase);
      if (phaseIndex < currentIndex) {
        status = 'done';
      }
    }

    return {
      phase,
      duration: lastEvent?.timestamp ?? 0,
      status,
      message: lastEvent?.message ?? PHASE_LABELS[phase],
      error: lastEvent?.error,
    };
  });

  // Calculate total elapsed from last event timestamp
  const totalElapsed = events.length > 0
    ? events[events.length - 1].timestamp
    : 0;

  // Retry function
  const retry = useCallback(() => {
    if (retryCount >= MAX_RETRIES) return;

    clearTimeouts();
    clearInitEvents();
    setEvents([]);
    setIsTimedOut(false);
    setTimeoutPhase(null);
    setRetryCount((prev) => prev + 1);

    // Reload the page to retry
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, [retryCount, clearTimeouts]);

  return {
    currentPhase,
    phases,
    totalElapsed,
    error,
    isTimedOut,
    timeoutPhase,
    retryCount,
    canRetry: retryCount < MAX_RETRIES && !isReady,
    isReady,
    retry,
    logEvent,
  };
}

// Export for external use
export { PHASE_LABELS };
