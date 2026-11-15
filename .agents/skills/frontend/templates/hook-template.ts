// Standard React hook scaffold for SpawnForge.
//
// Instructions:
//   1. Replace "useMyHook" with your camelCase hook name.
//   2. Replace "MyData" with the return type.
//   3. Add domain-specific logic in the sections marked TODO.
//   4. Wrap every returned handler in useCallback with exhaustive deps.
//   5. Co-locate a __tests__/useMyHook.test.ts file.

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseMyHookOptions {
  /** Example option — document what it does. */
  initialValue?: string;
}

interface UseMyHookReturn {
  value: string;
  isLoading: boolean;
  error: string | null;
  /** Stable handler — safe to pass as a prop without useMemo on the caller. */
  handleChange: (next: string) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useMyHook — one-line description of purpose.
 *
 * @example
 *   const { value, handleChange } = useMyHook({ initialValue: 'hello' });
 */
export function useMyHook({
  initialValue = '',
}: UseMyHookOptions = {}): UseMyHookReturn {
  // --- State ---
  const [value, setValue] = useState(initialValue);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Refs (for values that should NOT trigger re-renders) ---
  // Use refs only for mutable non-reactive values (e.g. timers, subscriptions).
  // Never read ref.current during render — it causes lint errors.
  const abortRef = useRef<AbortController | null>(null);

  // --- Effects ---
  useEffect(() => {
    // TODO: subscribe to external source, set up listener, etc.
    // Always clean up to prevent memory leaks.
    const controller = new AbortController();
    abortRef.current = controller;

    // Example async fetch:
    // setIsLoading(true);
    // fetchData(signal: controller.signal)
    //   .then(data => setValue(data))
    //   .catch(err => { if (!controller.signal.aborted) setError(err.message); })
    //   .finally(() => setIsLoading(false));

    return () => {
      controller.abort();
    };
  }, [initialValue]); // <-- list ALL deps used inside the effect

  // --- Stable handlers ---
  // Wrap every returned function in useCallback so callers don't need to
  // defensively memoize when they include it in their own dep arrays.

  const handleChange = useCallback((next: string) => {
    setValue(next);
    setError(null);
    // TODO: dispatch engine command or call API
  }, []); // <-- add deps: [dispatchCommand, entityId, ...]

  const reset = useCallback(() => {
    setValue(initialValue);
    setError(null);
    setIsLoading(false);
  }, [initialValue]);

  // --- Return ---
  return {
    value,
    isLoading,
    error,
    handleChange,
    reset,
  };
}
