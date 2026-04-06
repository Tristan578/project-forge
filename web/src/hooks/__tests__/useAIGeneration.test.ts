import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAIGeneration } from '../useAIGeneration';

describe('useAIGeneration', () => {
  it('starts with isLoading=false and error=null', () => {
    const { result } = renderHook(() => useAIGeneration());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets isLoading=true during execution', async () => {
    const { result } = renderHook(() => useAIGeneration());

    let resolve!: (value: string) => void;
    const promise = new Promise<string>((r) => { resolve = r; });

    let execPromise: Promise<unknown>;
    act(() => {
      execPromise = result.current.execute(() => promise);
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolve('done');
      await execPromise;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('returns the result of the generation function', async () => {
    const { result } = renderHook(() => useAIGeneration<string>());

    let value: string | undefined;
    await act(async () => {
      value = await result.current.execute(async () => 'hello');
    });

    expect(value).toBe('hello');
  });

  it('sets error on failure', async () => {
    const { result } = renderHook(() => useAIGeneration());

    await act(async () => {
      await result.current.execute(async () => {
        throw new Error('AI service error');
      });
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('AI service error');
  });

  it('clearError resets error state', async () => {
    const { result } = renderHook(() => useAIGeneration());

    await act(async () => {
      await result.current.execute(async () => { throw new Error('fail'); });
    });
    expect(result.current.error).toBe('fail');

    act(() => { result.current.clearError(); });
    expect(result.current.error).toBeNull();
  });

  it('prevents double-submission while loading', async () => {
    const { result } = renderHook(() => useAIGeneration<string>());

    let resolve!: (value: string) => void;
    const promise = new Promise<string>((r) => { resolve = r; });

    let firstExec: Promise<unknown>;
    act(() => {
      firstExec = result.current.execute(() => promise);
    });

    // Second call should be a no-op
    let secondResult: string | undefined;
    await act(async () => {
      secondResult = await result.current.execute(async () => 'second');
    });

    expect(secondResult).toBeUndefined();

    await act(async () => {
      resolve('first');
      await firstExec;
    });
  });

  it('passes AbortSignal to the generation function', async () => {
    const { result } = renderHook(() => useAIGeneration());

    let receivedSignal: AbortSignal | undefined;
    await act(async () => {
      await result.current.execute(async (signal) => {
        receivedSignal = signal;
      });
    });

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it('cancel() aborts in-flight request and resets state', async () => {
    const onCancel = vi.fn();
    const { result } = renderHook(() => useAIGeneration({ onCancel }));

    let reject!: (err: Error) => void;
    const promise = new Promise<void>((_resolve, r) => { reject = r; });

    act(() => {
      result.current.execute(() => promise);
    });

    expect(result.current.isLoading).toBe(true);

    act(() => {
      result.current.cancel();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Cleanup — reject the dangling promise so it doesn't leak
    reject(new DOMException('Aborted', 'AbortError'));
    // Flush microtasks
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('calls onError callback on failure', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAIGeneration({ onError }));

    await act(async () => {
      await result.current.execute(async () => {
        throw new Error('Network error');
      });
    });

    expect(onError).toHaveBeenCalledWith('Network error');
    expect(result.current.error).toBe('Network error');
  });

  it('suppresses AbortError after cancel', async () => {
    const { result } = renderHook(() => useAIGeneration());

    act(() => {
      result.current.execute(async (signal) => {
        // Simulate fetch that throws on abort
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });
    });

    await act(async () => {
      result.current.cancel();
      // Flush microtasks
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
  });

  it('aborts on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;

    const { result, unmount } = renderHook(() => useAIGeneration());

    act(() => {
      result.current.execute(async (signal) => {
        capturedSignal = signal;
        return new Promise(() => {}); // Never resolves
      });
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    unmount();

    expect(capturedSignal!.aborted).toBe(true);
  });
});
