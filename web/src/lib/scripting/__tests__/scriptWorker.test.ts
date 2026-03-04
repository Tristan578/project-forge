import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// We don't import scriptWorker directly because it's a web worker file that executes immediately on import.
// Instead, we test the sandboxing logic by simulating the worker environment with dynamic imports.

// Mock self for the worker environment
const mockPostMessage = vi.fn();
const globalScope = globalThis as Record<string, unknown>;

describe('scriptWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalScope.self = {
      postMessage: mockPostMessage,
    };
  });

  afterEach(() => {
    delete globalScope.self;
    vi.resetModules();
  });

  it('registers message listener on initialization', async () => {
    // @ts-expect-error scriptWorker is a web worker with no module exports
    await import('../scriptWorker');
    expect((globalScope.self as Record<string, unknown>).onmessage).toBeInstanceOf(Function);
  });

  it('ignores unknown message types without crashing', async () => {
    // @ts-expect-error scriptWorker is a web worker with no module exports
    await import('../scriptWorker');
    const messageHandler = (globalScope.self as Record<string, unknown>).onmessage as (e: { data: Record<string, unknown> }) => void;

    // It doesn't explicitly throw an error or send an error back for unknown types, it just falls through
    expect(() => messageHandler({ data: { type: 'unknown_action' } })).not.toThrow();
  });

  it('compiles and initializes scripts successfully via init', async () => {
    // @ts-expect-error scriptWorker is a web worker with no module exports
    await import('../scriptWorker');
    const messageHandler = (globalScope.self as Record<string, unknown>).onmessage as (e: { data: Record<string, unknown> }) => void | Promise<void>;

    const validCode = 'function onStart() { forge.log("Started"); }';

    await messageHandler({
      data: {
        type: 'init',
        scripts: [{ entityId: 'entity_1', enabled: true, source: validCode }]
      }
    });

    // Check if the log command was pushed
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'log',
      level: 'info',
      entityId: 'entity_1',
      message: 'Started'
    });
  });

  it('reports compilation errors for syntax issues during init', async () => {
    // @ts-expect-error scriptWorker is a web worker with no module exports
    await import('../scriptWorker');
    const messageHandler = (globalScope.self as Record<string, unknown>).onmessage as (e: { data: Record<string, unknown> }) => void | Promise<void>;

    const invalidCode = 'function onStart() { return { x: 1 ; }'; // Missing closing brace/invalid syntax

    await messageHandler({
      data: {
        type: 'init',
        scripts: [{ entityId: 'entity_invalid', enabled: true, source: invalidCode }]
      }
    });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        entityId: 'entity_invalid',
        message: expect.stringContaining('Compilation error:'),
      })
    );
  });

  it('executes scripts in a sandbox preventing global access', async () => {
    // @ts-expect-error scriptWorker is a web worker with no module exports
    await import('../scriptWorker');
    const messageHandler = (globalScope.self as Record<string, unknown>).onmessage as (e: { data: Record<string, unknown> }) => void | Promise<void>;

    // Attempt to access shadowed globals (should be undefined)
    const maliciousCode = 'function onUpdate(dt) { forge.log(typeof fetch); forge.log(typeof navigator); }';

    await messageHandler({
      data: {
        type: 'init',
        scripts: [{ entityId: 'entity_malicious', enabled: true, source: maliciousCode }]
      }
    });

    await messageHandler({
      data: {
        type: 'tick',
        dt: 0.16
      }
    });

    // It should log 'undefined' twice
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'log',
      message: 'undefined'
    }));
  });
});
