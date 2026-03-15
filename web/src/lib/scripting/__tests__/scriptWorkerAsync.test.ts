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

// ─── forge.* async wiring tests ───────────────────────────────────────────────

describe('scriptWorker forge.* async method wiring', () => {
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

  // Helper: collect all async_request messages of a specific channel/method
  function getAsyncRequests(channel: string, method: string) {
    return mockPostMessage.mock.calls
      .filter((call: unknown[]) => {
        const msg = call[0] as Record<string, unknown>;
        return msg.type === 'async_request' && msg.channel === channel && msg.method === method;
      })
      .map((call: unknown[]) => call[0] as Record<string, unknown>);
  }

  // ─── forge.physics2d ──────────────────────────────────────────

  it('forge.physics2d.raycast sends async_request to physics/raycast2d', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.physics2d.raycast(1, 2, 0, -1, 50);
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('physics', 'raycast2d');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ originX: 1, originY: 2, dirX: 0, dirY: -1, maxDistance: 50 });
  });

  it('forge.physics2d.raycast uses default maxDistance of 100 when omitted', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.physics2d.raycast(0, 0, 1, 0);
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('physics', 'raycast2d');
    expect(reqs).toHaveLength(1);
    expect((reqs[0].args as Record<string, unknown>).maxDistance).toBe(100);
  });

  it('forge.physics2d.isGrounded sends async_request to physics/isGrounded', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.physics2d.isGrounded('entity-abc', 0.2);
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('physics', 'isGrounded');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ entityId: 'entity-abc', distance: 0.2 });
  });

  it('forge.physics2d.isGrounded uses default distance of 0.1 when omitted', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.physics2d.isGrounded('entity-xyz');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('physics', 'isGrounded');
    expect(reqs).toHaveLength(1);
    expect((reqs[0].args as Record<string, unknown>).distance).toBe(0.1);
  });

  // ─── forge.audio ─────────────────────────────────────────────

  it('forge.audio.detectLoopPoints sends async_request to audio/detectLoopPoints', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.audio.detectLoopPoints('asset-123');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('audio', 'detectLoopPoints');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ assetId: 'asset-123' });
  });

  it('forge.audio.getWaveform sends async_request to audio/getWaveform', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.audio.getWaveform('asset-456');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('audio', 'getWaveform');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ assetId: 'asset-456' });
  });

  it('forge.audio synchronous methods (play, stop, setVolume) still use fire-and-forget', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.audio.play('e1');
        forge.audio.setVolume('e1', 0.5);
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    // Should have commands message with audio commands, not async_request
    const commandMsgs = mockPostMessage.mock.calls
      .filter((call: unknown[]) => (call[0] as Record<string, unknown>).type === 'commands');
    expect(commandMsgs.length).toBeGreaterThan(0);

    // No async_request for audio channel play/setVolume
    const asyncAudio = getAsyncRequests('audio', 'play');
    expect(asyncAudio).toHaveLength(0);
  });

  // ─── forge.animation ────────────────────────────────────────

  it('forge.animation.listClips sends async_request to animation/listClips', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.animation.listClips('entity-anim');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('animation', 'listClips');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ entityId: 'entity-anim' });
  });

  it('forge.animation.getClipDuration sends async_request to animation/getClipDuration', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.animation.getClipDuration('entity-anim', 'run');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('animation', 'getClipDuration');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ entityId: 'entity-anim', clipName: 'run' });
  });

  it('forge.animation synchronous methods (play, stop) still use fire-and-forget', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.animation.play('e1', 'idle');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const asyncReqs = getAsyncRequests('animation', 'play');
    expect(asyncReqs).toHaveLength(0);

    const commandMsgs = mockPostMessage.mock.calls
      .filter((call: unknown[]) => (call[0] as Record<string, unknown>).type === 'commands');
    expect(commandMsgs.length).toBeGreaterThan(0);
  });

  // ─── forge.ai ───────────────────────────────────────────────

  it('forge.ai.generateTexture sends async_request to ai/generateTexture', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.ai.generateTexture('stone wall');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('ai', 'generateTexture');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ prompt: 'stone wall' });
  });

  it('forge.ai.generateModel sends async_request to ai/generateModel', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.ai.generateModel('a tree');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('ai', 'generateModel');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ prompt: 'a tree' });
  });

  it('forge.ai.generateSound sends async_request to ai/generateSound', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.ai.generateSound('explosion');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('ai', 'generateSound');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ prompt: 'explosion' });
  });

  it('forge.ai.generateVoice sends async_request to ai/generateVoice with prompt key', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.ai.generateVoice('Hello world');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('ai', 'generateVoice');
    expect(reqs).toHaveLength(1);
    // generateVoice maps text param to prompt key
    expect(reqs[0].args).toEqual({ prompt: 'Hello world' });
  });

  it('forge.ai.generateMusic sends async_request to ai/generateMusic', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.ai.generateMusic('epic battle');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('ai', 'generateMusic');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ prompt: 'epic battle' });
  });

  // ─── forge.asset ─────────────────────────────────────────────

  it('forge.asset.loadImage sends async_request to asset/loadImage', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.asset.loadImage('https://example.com/sprite.png');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('asset', 'loadImage');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ url: 'https://example.com/sprite.png' });
  });

  it('forge.asset.loadModel sends async_request to asset/loadModel', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.asset.loadModel('https://example.com/model.glb');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const reqs = getAsyncRequests('asset', 'loadModel');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].args).toEqual({ url: 'https://example.com/model.glb' });
  });

  // ─── request IDs are unique across namespaces ────────────────

  it('each forge.* async call gets a unique requestId', async () => {
    const handler = await setupWorker();
    const source = `
      function onStart() {
        forge.physics2d.raycast(0, 0, 1, 0);
        forge.physics2d.isGrounded('e1');
        forge.audio.detectLoopPoints('a1');
        forge.audio.getWaveform('a1');
        forge.animation.listClips('e2');
      }
    `;
    await handler(initMsg([{ entityId: 'e1', enabled: true, source }]));

    const allReqs = mockPostMessage.mock.calls
      .filter((call: unknown[]) => (call[0] as Record<string, unknown>).type === 'async_request')
      .map((call: unknown[]) => (call[0] as Record<string, unknown>).requestId as string);

    // All IDs should be unique
    const uniqueIds = new Set(allReqs);
    expect(uniqueIds.size).toBe(allReqs.length);
    expect(allReqs.length).toBe(5);
  });
});
