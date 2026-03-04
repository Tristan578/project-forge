import { vi } from 'vitest';

/**
 * Polls a condition function until it returns true or times out.
 * Useful for waiting for state changes in Zustand stores or DOM updates.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  { interval = 10, timeout = 1000, message = 'Condition not met in time' } = {}
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(message);
}

/**
 * Waits for a specific number of milliseconds.
 * Prefer waitFor() whenever possible to avoid flaky tests.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Utility to wait for next tick in the event loop.
 */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Mock version of sleep that uses Vitest's fake timers.
 */
export async function advanceTimersByTime(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await nextTick();
}
