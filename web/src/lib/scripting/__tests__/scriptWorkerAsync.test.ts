import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPostMessage = vi.fn();
const globalScope = globalThis as Record<string, unknown>;

type MessageHandler = (e: { data: Record<string, unknown> }) => void | Promise<void>;

async function setupWorker(): Promise<MessageHandler> {
  // @ts-expect-error scriptWorker is a web worker with no module exports
  await import('../scriptWorker');
  return (globalScope.self as Record<string, unknown>).onmessage as MessageHandler;
}

function initMsg(
  scripts: { entityId: string; enabled: boolean; source: string }[],
  extras?: Record<string, unknown>,
) {
  return {
    data: {
      type: 'init',
      scripts,
      entities: {},
      entityInfos: {},
      ...extras,
    },
  };
}

describe('scriptWorker async protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    globalScope.self = {
      postMessage: mockPostMessage,
    };
  });

  afterEach(() => {
    delete globalScope.self;
    vi.useRealTimers();
    vi.resetModules();
  });

  // ─── forge.__asyncRequest sends correct message ───────────────

  it('forge.__asyncRequest sends async_request message', async () => {
    const handler = await setupWorker();

    // Init with a script that calls __asyncRequest
    const source = `
      function onStart() {
        const result = forge.__asyncRequest('physics', 'raycast', { origin: [0,0,0] });
        forge.log('request sent');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    // Find the async_request message
    const asyncMsg = mockPostMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === 'async_request',
    );

    expect(asyncMsg).toBeDefined();
    const msg = asyncMsg![0] as Record<string, unknown>;
    expect(msg.type).toBe('async_request');
    expect(msg.channel).toBe('physics');
    expect(msg.method).toBe('raycast');
    expect(msg.args).toEqual({ origin: [0, 0, 0] });
    expect(typeof msg.requestId).toBe('string');
    expect((msg.requestId as string).startsWith('req_')).toBe(true);
  });

  it('requestId counter increments', async () => {
    const handler = await setupWorker();

    const source = `
      function onStart() {
        forge.__asyncRequest('physics', 'raycast', {});
        forge.__asyncRequest('physics', 'raycast', {});
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const asyncMsgs = mockPostMessage.mock.calls
      .filter((call: unknown[]) => (call[0] as Record<string, unknown>).type === 'async_request')
      .map((call: unknown[]) => (call[0] as Record<string, unknown>).requestId);

    expect(asyncMsgs).toHaveLength(2);
    expect(asyncMsgs[0]).toBe('req_1');
    expect(asyncMsgs[1]).toBe('req_2');
  });

  // ─── Async response handling ──────────────────────────────────

  it('async_response with ok resolves promise', async () => {
    const handler = await setupWorker();

    // Script that waits for async result and logs it
    const source = `
      async function onStart() {
        const result = await forge.__asyncRequest('physics', 'raycast', { origin: [0,0,0] });
        forge.log('got: ' + JSON.stringify(result));
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    // Find the requestId from the async_request
    const asyncMsg = mockPostMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === 'async_request',
    );
    const requestId = (asyncMsg![0] as Record<string, unknown>).requestId as string;

    // Simulate tick with async response
    await handler({
      data: {
        type: 'tick',
        dt: 0.016,
        elapsed: 0.016,
        entities: {},
        asyncResponses: [
          { requestId, status: 'ok', data: { hit: true, distance: 5.0 } },
        ],
      },
    });

    // Allow microtasks to flush
    await vi.advanceTimersByTimeAsync(0);

    const logMsg = mockPostMessage.mock.calls.find(
      (call: unknown[]) => {
        const msg = call[0] as Record<string, unknown>;
        return msg.type === 'log' && (msg.message as string)?.includes('got:');
      },
    );
    expect(logMsg).toBeDefined();
    expect((logMsg![0] as Record<string, unknown>).message).toContain('"hit":true');
  });

  it('async_response with error rejects promise', async () => {
    const handler = await setupWorker();

    const source = `
      async function onStart() {
        try {
          await forge.__asyncRequest('physics', 'raycast', {});
        } catch (e) {
          forge.log('error: ' + e.message);
        }
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const asyncMsg = mockPostMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === 'async_request',
    );
    const requestId = (asyncMsg![0] as Record<string, unknown>).requestId as string;

    await handler({
      data: {
        type: 'tick',
        dt: 0.016,
        elapsed: 0.016,
        entities: {},
        asyncResponses: [
          { requestId, status: 'error', error: 'Engine not ready' },
        ],
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    const logMsg = mockPostMessage.mock.calls.find(
      (call: unknown[]) => {
        const msg = call[0] as Record<string, unknown>;
        return msg.type === 'log' && (msg.message as string)?.includes('error:');
      },
    );
    expect(logMsg).toBeDefined();
    expect((logMsg![0] as Record<string, unknown>).message).toContain('Engine not ready');
  });

  // ─── Progress ─────────────────────────────────────────────────

  it('async_response with progress calls onProgress callback', async () => {
    const handler = await setupWorker();

    const source = `
      async function onStart() {
        const result = await forge.__asyncRequest('ai', 'generateTexture', { prompt: 'stone' }, (p) => {
          forge.log('progress: ' + p.percent);
        });
        forge.log('done: ' + JSON.stringify(result));
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const asyncMsg = mockPostMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === 'async_request',
    );
    const requestId = (asyncMsg![0] as Record<string, unknown>).requestId as string;

    // Send progress
    await handler({
      data: {
        type: 'tick',
        dt: 0.016,
        elapsed: 0.016,
        entities: {},
        asyncResponses: [
          { requestId, status: 'progress', progress: { percent: 50, message: 'Half done' } },
        ],
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    // Send ok
    await handler({
      data: {
        type: 'tick',
        dt: 0.016,
        elapsed: 0.032,
        entities: {},
        asyncResponses: [
          { requestId, status: 'ok', data: { url: 'https://example.com/texture.png' } },
        ],
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    const progressLog = mockPostMessage.mock.calls.find(
      (call: unknown[]) => {
        const msg = call[0] as Record<string, unknown>;
        return msg.type === 'log' && (msg.message as string)?.includes('progress: 50');
      },
    );
    expect(progressLog).toBeDefined();

    const doneLog = mockPostMessage.mock.calls.find(
      (call: unknown[]) => {
        const msg = call[0] as Record<string, unknown>;
        return msg.type === 'log' && (msg.message as string)?.includes('done:');
      },
    );
    expect(doneLog).toBeDefined();
  });

  // ─── Stop cleans up pending ───────────────────────────────────

  it('stop rejects all pending async requests', async () => {
    const handler = await setupWorker();

    // Use .then/.catch pattern rather than async/await to ensure rejection is caught
    const source = `
      function onStart() {
        forge.__asyncRequest('physics', 'raycast', {}).catch(function(e) {
          forge.log('rejected: ' + e.message);
        });
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    // Stop without resolving
    await handler({ data: { type: 'stop' } });

    await vi.advanceTimersByTimeAsync(0);

    const rejectLog = mockPostMessage.mock.calls.find(
      (call: unknown[]) => {
        const msg = call[0] as Record<string, unknown>;
        return msg.type === 'log' && (msg.message as string)?.includes('rejected:');
      },
    );
    expect(rejectLog).toBeDefined();
    expect((rejectLog![0] as Record<string, unknown>).message).toContain('Script execution stopped');
  });

  // ─── Init resets counter ──────────────────────────────────────

  it('init resets requestId counter', async () => {
    const handler = await setupWorker();

    // Script catches rejection to avoid unhandled promise rejection on re-init
    const source = `function onStart() { forge.__asyncRequest('physics', 'raycast', {}).catch(function() {}); }`;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    // First init gives req_1
    const firstReqs = mockPostMessage.mock.calls
      .filter((call: unknown[]) => (call[0] as Record<string, unknown>).type === 'async_request');
    expect((firstReqs[0][0] as Record<string, unknown>).requestId).toBe('req_1');

    mockPostMessage.mockClear();

    // Second init should reset counter
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    await vi.advanceTimersByTimeAsync(0);

    const secondReqs = mockPostMessage.mock.calls
      .filter((call: unknown[]) => (call[0] as Record<string, unknown>).type === 'async_request');
    expect((secondReqs[0][0] as Record<string, unknown>).requestId).toBe('req_1');
  });

  // ─── Late response silently dropped ───────────────────────────

  it('late response after stop is silently dropped', async () => {
    const handler = await setupWorker();

    // Script catches the rejection to avoid unhandled promise rejection
    const source = `function onStart() { forge.__asyncRequest('physics', 'raycast', {}).catch(() => {}); }`;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const asyncMsg = mockPostMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).type === 'async_request',
    );
    const requestId = (asyncMsg![0] as Record<string, unknown>).requestId as string;

    await handler({ data: { type: 'stop' } });
    await vi.advanceTimersByTimeAsync(0);

    // Re-init so tick handler exists
    await handler(initMsg([{ entityId: 'e2', enabled: true, source: '' }]));

    // Send response with old requestId — should not crash (request map was cleared)
    expect(() => {
      handler({
        data: {
          type: 'tick',
          dt: 0.016,
          elapsed: 0.016,
          entities: {},
          asyncResponses: [
            { requestId, status: 'ok', data: { hit: false } },
          ],
        },
      });
    }).not.toThrow();
  });
});
