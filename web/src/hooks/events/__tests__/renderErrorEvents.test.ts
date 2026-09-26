import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/monitoring/sentry-client', () => ({ captureException: vi.fn() }));
vi.mock('@/hooks/useEngine', () => ({ getActiveEngineBackend: vi.fn(() => 'webgpu') }));

import { captureException } from '@/lib/monitoring/sentry-client';
import { useRenderErrorStore } from '@/stores/renderErrorStore';
import { handleRenderErrorEvent } from '../renderErrorEvents';
import type { SetFn, GetFn } from '../types';

const set = vi.fn() as unknown as SetFn;
const get = vi.fn() as unknown as GetFn;

describe('handleRenderErrorEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRenderErrorStore.getState().reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('ignores every other event', () => {
    expect(handleRenderErrorEvent('SCENE_LOADED', { name: 'x' }, set, get)).toBe(false);
    expect(useRenderErrorStore.getState().notice).toBeNull();
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    ['validation', 'continued'],
    ['internal', 'continued'],
    ['validation', 'stopped'],
    ['internal', 'stopped'],
    ['outOfMemory', 'stopped'],
    ['deviceLost', 'stopped'],
  ] as const)('shows a %s/%s report and sends the raw detail to Sentry', (errorClass, outcome) => {
    const payload = { errorClass, outcome, detail: 'wgpu said no', occurrence: 1 };

    expect(handleRenderErrorEvent('RENDER_ERROR', payload, set, get)).toBe(true);

    expect(useRenderErrorStore.getState().notice).toEqual(payload);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureException).mock.calls[0][1]).toEqual({
      source: 'render_error_handler',
      errorClass,
      outcome,
      occurrence: 1,
      detail: 'wgpu said no',
      engineBackend: 'webgpu',
    });
  });

  it('claims an unreadable payload, shows nothing, and reports it', () => {
    expect(handleRenderErrorEvent('RENDER_ERROR', { errorClass: 'nope' }, set, get)).toBe(true);
    expect(useRenderErrorStore.getState().notice).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('RENDER_ERROR payload was unreadable'),
      { errorClass: 'nope' },
    );
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});

describe('useRenderErrorStore', () => {
  beforeEach(() => useRenderErrorStore.getState().reset());

  const continued = { errorClass: 'validation', outcome: 'continued', detail: '', occurrence: 1 } as const;
  const stopped = { errorClass: 'deviceLost', outcome: 'stopped', detail: '', occurrence: 2 } as const;

  it('counts skipped errors so a recurring glitch reads as one notice', () => {
    const store = useRenderErrorStore.getState();
    store.report(continued);
    store.report({ ...continued, occurrence: 2 });
    expect(useRenderErrorStore.getState().skippedCount).toBe(2);
    expect(useRenderErrorStore.getState().notice?.occurrence).toBe(2);
  });

  it('lets a skipped-error notice be dismissed, and shows the next one again', () => {
    const store = useRenderErrorStore.getState();
    store.report(continued);
    store.dismiss();
    expect(useRenderErrorStore.getState().notice).toBeNull();
    store.report({ ...continued, occurrence: 2 });
    expect(useRenderErrorStore.getState().notice?.occurrence).toBe(2);
  });

  it('keeps a stopped notice: it cannot be dismissed or replaced by a skipped one', () => {
    const store = useRenderErrorStore.getState();
    store.report(stopped);
    store.dismiss();
    store.report({ ...continued, occurrence: 3 });
    expect(useRenderErrorStore.getState().notice).toEqual(stopped);
  });

  it('lets a later stopped report replace an earlier one', () => {
    const store = useRenderErrorStore.getState();
    store.report({ ...stopped, errorClass: 'outOfMemory', occurrence: 1 });
    store.report(stopped);
    expect(useRenderErrorStore.getState().notice).toEqual(stopped);
  });
});
