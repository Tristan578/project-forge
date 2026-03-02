import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must import after stubbing globals
let logInitEvent: typeof import('../initLog').logInitEvent;
let getInitEvents: typeof import('../initLog').getInitEvents;
let clearInitEvents: typeof import('../initLog').clearInitEvents;
let exportInitLog: typeof import('../initLog').exportInitLog;

describe('initLog', () => {
  beforeEach(async () => {
    // Stub sessionStorage and performance before importing
    const store: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      getItem(key: string) { return store[key] ?? null; },
      setItem(key: string, val: string) { store[key] = val; },
      removeItem(key: string) { delete store[key]; },
    });
    vi.stubGlobal('performance', { now: () => 1000 });
    vi.stubGlobal('navigator', { userAgent: 'test-agent' });

    // Reset module state between tests
    vi.resetModules();
    const mod = await import('../initLog');
    logInitEvent = mod.logInitEvent;
    getInitEvents = mod.getInitEvents;
    clearInitEvents = mod.clearInitEvents;
    exportInitLog = mod.exportInitLog;
  });

  it('should log an event and return it', () => {
    const event = logInitEvent('wasm_loading', 'Loading WASM');
    expect(event.phase).toBe('wasm_loading');
    expect(event.message).toBe('Loading WASM');
    expect(typeof event.timestamp).toBe('number');
  });

  it('should log error events', () => {
    const event = logInitEvent('error', undefined, 'Something failed');
    expect(event.phase).toBe('error');
    expect(event.error).toBe('Something failed');
  });

  it('should accumulate events', () => {
    logInitEvent('wasm_loading');
    logInitEvent('wasm_loaded');
    logInitEvent('ready');

    const events = getInitEvents();
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.phase)).toEqual(['wasm_loading', 'wasm_loaded', 'ready']);
  });

  it('should return a copy of events', () => {
    logInitEvent('ready');
    const events = getInitEvents();
    events.push({ phase: 'error', timestamp: 0 });
    expect(getInitEvents()).toHaveLength(1); // original unmodified
  });

  it('should clear events', () => {
    logInitEvent('wasm_loading');
    logInitEvent('ready');
    expect(getInitEvents()).toHaveLength(2);

    clearInitEvents();
    expect(getInitEvents()).toHaveLength(0);
  });

  it('should export formatted log', () => {
    logInitEvent('wasm_loading', 'Starting');
    logInitEvent('ready');

    const output = exportInitLog();

    expect(output).toContain('=== Forge Engine Initialization Log ===');
    expect(output).toContain('Session ID:');
    expect(output).toContain('User Agent: test-agent');
    expect(output).toContain('wasm_loading');
    expect(output).toContain('Starting');
    expect(output).toContain('ready');
    expect(output).toContain('--- Raw JSON ---');
  });

  it('should include error in export', () => {
    logInitEvent('error', undefined, 'GPU not supported');
    const output = exportInitLog();
    expect(output).toContain('ERROR: GPU not supported');
  });
});
