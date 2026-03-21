/**
 * Event handler for ENGINE_PANIC events from the Rust panic hook.
 *
 * Routes crash events to the engine crash-state module so the recovery
 * overlay can appear. Panic events must never be throttled or batched.
 */

import { setEngineCrashedFromEvent } from '@/hooks/useEngine';
import type { SetFn, GetFn } from './types';

export function handlePanicEvent(type: string, data: unknown, _set: SetFn, _get: GetFn): boolean {
  if (type !== 'ENGINE_PANIC') return false;

  const payload = data as Record<string, unknown>;
  const message = typeof payload.message === 'string' ? payload.message : 'Unknown panic';
  setEngineCrashedFromEvent(message);
  return true;
}
