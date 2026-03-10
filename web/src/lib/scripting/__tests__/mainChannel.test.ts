import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainThreadChannel, createScriptChannel } from '../mainChannel';
import { createChannelMessage, isChannelMessage } from '../channelProtocol';
import type { ResultPayload, CallbackPayload, ErrorPayload } from '../channelProtocol';

// ─── Mock infrastructure ──────────────────────────────────────────────────────

/**
 * Minimal MessagePort mock that captures postMessage calls and exposes
 * a helper to simulate incoming messages.
 */
function makeMockPort() {
  const sent: unknown[] = [];
  let onmessage: ((e: { data: unknown }) => void) | null = null;

  const port = {
    get onmessage() { return onmessage; },
    set onmessage(handler: ((e: { data: unknown }) => void) | null) {
      onmessage = handler;
    },
    postMessage(data: unknown) { sent.push(data); },
    close: vi.fn(),
    // Helper: deliver a message as if it came from the worker
    receive(data: unknown) { onmessage?.({ data }); },
    get sent() { return sent; },
  };

  return port;
}

type MockPort = ReturnType<typeof makeMockPort>;

/**
 * Build a MainThreadChannel with fully mocked internals.
 * Returns the channel and the port mock for inspection / message injection.
 */
function makeChannel(options?: Parameters<typeof MainThreadChannel>[1]) {
  const workerPort = makeMockPort(); // This port goes to the worker
  const mainPort = makeMockPort();   // This port stays on main thread

  // Capture what the worker receives (the transferred port2)
  const workerPostMessageSpy = vi.fn();

  // Mock MessageChannel global — must be a constructor (class)
  class MockMessageChannel {
    readonly port1 = mainPort as unknown as MessagePort;
    readonly port2 = workerPort as unknown as MessagePort;
  }
  vi.stubGlobal('MessageChannel', MockMessageChannel);

  const mockWorker = {
    postMessage: workerPostMessageSpy,
  } as unknown as Worker;

  const channel = new MainThreadChannel(mockWorker, options);

  return { channel, mainPort, workerPort, workerPostMessageSpy };
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('MainThreadChannel constructor', () => {
  it('sends a channel_port_init message to the worker with port2 as transfer', () => {
    const { workerPostMessageSpy } = makeChannel();
    expect(workerPostMessageSpy).toHaveBeenCalledOnce();
    const [data, transfer] = workerPostMessageSpy.mock.calls[0];
    expect(data).toEqual({ type: 'channel_port_init' });
    expect(Array.isArray(transfer)).toBe(true);
    expect(transfer).toHaveLength(1);
  });
});

// ─── sendCommand ─────────────────────────────────────────────────────────────

describe('sendCommand', () => {
  it('posts a command message over the main port', () => {
    const { channel, mainPort } = makeChannel();
    void channel.sendCommand('spawn_entity', { type: 'Cube' });

    expect(mainPort.sent).toHaveLength(1);
    const msg = mainPort.sent[0];
    expect(isChannelMessage(msg)).toBe(true);
    if (isChannelMessage(msg)) {
      expect(msg.type).toBe('command');
      expect((msg.payload as { command: string }).command).toBe('spawn_entity');
    }
  });

  it('resolves with the result when a matching result message arrives', async () => {
    const { channel, mainPort } = makeChannel();
    const promise = channel.sendCommand<{ id: string }>('spawn_entity', {});

    // Extract the message id that was posted
    const msg = mainPort.sent[0];
    if (!isChannelMessage(msg)) throw new Error('expected channel message');
    const requestId = msg.id;

    // Simulate worker sending back the result
    const result = createChannelMessage<ResultPayload>('result', { requestId, result: { id: 'ent_1' } });
    mainPort.receive(result);

    const value = await promise;
    expect(value).toEqual({ id: 'ent_1' });
  });

  it('rejects after timeoutMs if no response arrives', async () => {
    const { channel } = makeChannel({ timeoutMs: 1000 });
    const promise = channel.sendCommand('slow_cmd', {});

    vi.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow(/timed out/i);
  });

  it('rejects immediately when destroyed', async () => {
    const { channel } = makeChannel();
    channel.destroy();
    await expect(channel.sendCommand('noop', {})).rejects.toThrow(/destroyed/i);
  });

  it('rejects with backpressure error when queue is full', async () => {
    const { channel } = makeChannel({ maxQueueSize: 2, enableBackpressure: true });
    // Fill queue without resolving
    void channel.sendCommand('cmd1', {});
    void channel.sendCommand('cmd2', {});
    // Third exceeds limit
    await expect(channel.sendCommand('cmd3', {})).rejects.toThrow(/backpressure/i);
  });

  it('decrements queueSize when a result is received', async () => {
    const { channel, mainPort } = makeChannel({ maxQueueSize: 1, enableBackpressure: true });
    const p = channel.sendCommand('cmd1', {});

    const msg = mainPort.sent[0];
    if (!isChannelMessage(msg)) throw new Error('expected channel message');
    const result = createChannelMessage<ResultPayload>('result', { requestId: msg.id, result: 'ok' });
    mainPort.receive(result);
    await p;

    // Now queue has space again
    const p2 = channel.sendCommand('cmd2', {});
    const msg2 = mainPort.sent[1];
    if (!isChannelMessage(msg2)) throw new Error('expected channel message');
    const result2 = createChannelMessage<ResultPayload>('result', { requestId: msg2.id, result: 'ok2' });
    mainPort.receive(result2);
    await expect(p2).resolves.toBe('ok2');
  });
});

// ─── sendEvent ────────────────────────────────────────────────────────────────

describe('sendEvent', () => {
  it('posts an event message (fire-and-forget)', () => {
    const { channel, mainPort } = makeChannel();
    channel.sendEvent('collision', { entityA: '1', entityB: '2' });

    expect(mainPort.sent).toHaveLength(1);
    const msg = mainPort.sent[0];
    if (!isChannelMessage(msg)) throw new Error('expected channel message');
    expect(msg.type).toBe('event');
    expect((msg.payload as { eventType: string }).eventType).toBe('collision');
  });

  it('is a no-op after destroy', () => {
    const { channel, mainPort } = makeChannel();
    channel.destroy();
    channel.sendEvent('collision', {});
    expect(mainPort.sent).toHaveLength(0);
  });
});

// ─── onCallback ───────────────────────────────────────────────────────────────

describe('onCallback', () => {
  it('invokes the handler when a matching callback message arrives', () => {
    const { channel, mainPort } = makeChannel();
    const handler = vi.fn();
    channel.onCallback('collisionEnter', handler);

    const msg = createChannelMessage<CallbackPayload>('callback', {
      type: 'collisionEnter',
      data: { entityId: 'ent_1' },
    });
    mainPort.receive(msg);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ entityId: 'ent_1' });
  });

  it('does not invoke handlers registered for a different type', () => {
    const { channel, mainPort } = makeChannel();
    const handler = vi.fn();
    channel.onCallback('collisionExit', handler);

    const msg = createChannelMessage<CallbackPayload>('callback', {
      type: 'collisionEnter',
      data: {},
    });
    mainPort.receive(msg);

    expect(handler).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function that stops future invocations', () => {
    const { channel, mainPort } = makeChannel();
    const handler = vi.fn();
    const unsub = channel.onCallback('score', handler);

    unsub();

    const msg = createChannelMessage<CallbackPayload>('callback', { type: 'score', data: 10 });
    mainPort.receive(msg);

    expect(handler).not.toHaveBeenCalled();
  });

  it('supports multiple handlers for the same callback type', () => {
    const { channel, mainPort } = makeChannel();
    const h1 = vi.fn();
    const h2 = vi.fn();
    channel.onCallback('event', h1);
    channel.onCallback('event', h2);

    const msg = createChannelMessage<CallbackPayload>('callback', { type: 'event', data: null });
    mainPort.receive(msg);

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });
});

// ─── ping / pong ─────────────────────────────────────────────────────────────

describe('ping', () => {
  it('resolves with a non-negative latency number', async () => {
    const { channel, mainPort } = makeChannel();
    const pingPromise = channel.ping();

    // Get the ping message id
    const msg = mainPort.sent[0];
    if (!isChannelMessage(msg)) throw new Error('expected channel message');
    expect(msg.type).toBe('ping');

    // Simulate pong arriving with the same id
    const pong = createChannelMessage('pong', {}, msg.id);
    mainPort.receive(pong);

    const latency = await pingPromise;
    expect(typeof latency).toBe('number');
    expect(latency).toBeGreaterThanOrEqual(0);
  });

  it('rejects after timeoutMs if no pong arrives', async () => {
    const { channel } = makeChannel({ timeoutMs: 500 });
    const promise = channel.ping();
    vi.advanceTimersByTime(501);
    await expect(promise).rejects.toThrow(/timed out/i);
  });

  it('rejects immediately when destroyed', async () => {
    const { channel } = makeChannel();
    channel.destroy();
    await expect(channel.ping()).rejects.toThrow(/destroyed/i);
  });
});

// ─── error messages ───────────────────────────────────────────────────────────

describe('error messages from worker', () => {
  it('rejects the matching pending command with the error message', async () => {
    const { channel, mainPort } = makeChannel();
    const promise = channel.sendCommand('bad_cmd', {});

    const msg = mainPort.sent[0];
    if (!isChannelMessage(msg)) throw new Error('expected channel message');

    const errorMsg = createChannelMessage<ErrorPayload>('error', {
      requestId: msg.id,
      message: 'Something went wrong',
    });
    mainPort.receive(errorMsg);

    await expect(promise).rejects.toThrow('Something went wrong');
  });

  it('ignores error messages with unknown requestId', () => {
    const { channel: _channel, mainPort } = makeChannel();
    // No pending request; should not throw
    const errorMsg = createChannelMessage<ErrorPayload>('error', {
      requestId: 'nonexistent-id',
      message: 'Stale error',
    });
    expect(() => mainPort.receive(errorMsg)).not.toThrow();
  });
});

// ─── destroy ─────────────────────────────────────────────────────────────────

describe('destroy', () => {
  it('rejects all pending promises', async () => {
    const { channel, mainPort } = makeChannel({ timeoutMs: 10_000 });
    const p1 = channel.sendCommand('cmd1', {});
    const p2 = channel.sendCommand('cmd2', {});

    channel.destroy();

    await expect(p1).rejects.toThrow(/destroyed/i);
    await expect(p2).rejects.toThrow(/destroyed/i);

    // Suppress unhandled rejections in test output
    void p1.catch(() => undefined);
    void p2.catch(() => undefined);

    // Verify port was closed
    expect((mainPort as unknown as MockPort).close).toHaveBeenCalledOnce();
  });

  it('is idempotent (second destroy is a no-op)', () => {
    const { channel, mainPort } = makeChannel();
    channel.destroy();
    expect(() => channel.destroy()).not.toThrow();
    expect((mainPort as unknown as MockPort).close).toHaveBeenCalledOnce();
  });
});

// ─── createScriptChannel factory ─────────────────────────────────────────────

describe('createScriptChannel', () => {
  it('returns a MainThreadChannel instance', () => {
    const p1 = makeMockPort();
    const p2 = makeMockPort();
    class MockMessageChannel {
      readonly port1 = p1 as unknown as MessagePort;
      readonly port2 = p2 as unknown as MessagePort;
    }
    vi.stubGlobal('MessageChannel', MockMessageChannel);

    const mockWorker = { postMessage: vi.fn() } as unknown as Worker;
    const channel = createScriptChannel(mockWorker, { timeoutMs: 3000 });
    expect(channel).toBeInstanceOf(MainThreadChannel);
    channel.destroy();
  });
});
