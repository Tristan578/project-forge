import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onEngineCrash, isEngineCrashed, getEngineCrashMessage, resetEngine } from '../useEngine';

vi.mock('@/lib/initLog', () => ({ logInitEvent: vi.fn() }));
vi.mock('../useEngineStatus', () => ({ emitStatusEvent: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-client', () => ({ captureException: vi.fn(), setTag: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showError: vi.fn() }));

describe('engine crash state', () => {
  beforeEach(() => { vi.clearAllMocks(); resetEngine(); });

  it('isEngineCrashed returns false initially', () => { expect(isEngineCrashed()).toBe(false); });
  it('getEngineCrashMessage returns null initially', () => { expect(getEngineCrashMessage()).toBeNull(); });
  it('onEngineCrash returns unsubscribe function', () => {
    const unsub = onEngineCrash(vi.fn());
    expect(typeof unsub).toBe('function');
    unsub();
  });
  it('resetEngine clears crash state', () => {
    resetEngine();
    expect(isEngineCrashed()).toBe(false);
    expect(getEngineCrashMessage()).toBeNull();
  });
  it('listener not called before crash', () => {
    const l = vi.fn();
    onEngineCrash(l);
    expect(l).not.toHaveBeenCalled();
  });
  it('unsubscribed listener is removed', () => {
    const l = vi.fn();
    onEngineCrash(l)();
    expect(l).not.toHaveBeenCalled();
  });
});
