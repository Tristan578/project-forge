/**
 * useAIGeneration — manages loading state, abort, and cleanup for AI operations.
 *
 * Wraps any async generation function with:
 * - AbortController that cancels in-flight requests on unmount or manual cancel
 * - Loading/error state
 * - Double-submission prevention (execute is a no-op while loading)
 *
 * Works with both fetchAI/streamAI (which accept AbortSignal) and raw fetch
 * calls to /api/generate/* endpoints.
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseAIGenerationOptions {
  /** Called when a request is cancelled (either manually or on unmount). */
  onCancel?: () => void;
  /** Called when a non-abort error occurs. Useful for toast notifications. */
  onError?: (message: string) => void;
}

export interface UseAIGenerationReturn<T> {
  /** Execute the generation function. No-op if already loading. */
  execute: (fn: (signal: AbortSignal) => Promise<T>) => Promise<T | undefined>;
  /** Cancel the in-flight request. */
  cancel: () => void;
  /** Whether a request is currently in-flight. */
  isLoading: boolean;
  /** The last error message, or null. */
  error: string | null;
  /** Clear the error state. */
  clearError: () => void;
}

export function useAIGeneration<T = unknown>(
  options?: UseAIGenerationOptions,
): UseAIGenerationReturn<T> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount — abort any in-flight request
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (mountedRef.current) {
      setIsLoading(false);
      setError(null);
    }
    options?.onCancel?.();
  }, [options]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const execute = useCallback(
    async (fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
      // Prevent double-submission
      if (abortRef.current) return undefined;

      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      setError(null);

      try {
        const result = await fn(controller.signal);
        if (mountedRef.current) {
          setIsLoading(false);
        }
        abortRef.current = null;
        return result;
      } catch (err) {
        abortRef.current = null;
        if (!mountedRef.current) return undefined;

        // Don't show abort errors — they're intentional cancellations
        if (err instanceof DOMException && err.name === 'AbortError') {
          setIsLoading(false);
          return undefined;
        }

        const message = err instanceof Error ? err.message : 'Generation failed';
        setError(message);
        setIsLoading(false);
        options?.onError?.(message);
        return undefined;
      }
    },
    [],
  );

  return { execute, cancel, isLoading, error, clearError };
}
