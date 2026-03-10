import { describe, it, expect, vi, afterEach } from 'vitest';
import { WorkerChannel } from '../workerChannel';
import { createChannelMessage, isChannelMessage } from '../channelProtocol';
import type { CommandPayload, EventPayload } from '../channelProtocol';

// ─── Mock port ────────────────────────────────────────────────────────────────

function makeMockPort() {
  const sent: unknown[] = [];
  let onmessage: ((e: { data: unknown }) => void) | null = null;

  return {
    get onmessage() { return onmessage; },
    set onmessage(fn: ((e: { data: unknown }) => void) | null) {
      onmessage = fn;
    },
    postMessage(data: unknown) { sent.push(data); },
    // Deliver an inbound message as if the main thread sent it
    receive(data: unknown) { onmessage?.({ data }); },
    get sent() { return sent; },
  };
}

type MockPort = ReturnType<typeof makeMockPort>;

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── initialize ───────────────────────────────────────────────────────────────

describe('WorkerChannel.initialize', () => {
  it('binds the onmessage handler to the port', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);
    expect(port.onmessage).not.toBeNull();
  });

  it('throws if initialize is called a second time', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);
    expect(() => channel.initialize(port as unknown as MessagePort)).toThrow(/already initialised/i);
  });
});

// ─── sendResult ───────────────────────────────────────────────────────────────

describe('WorkerChannel.sendResult', () => {
  it('posts a result message with the given requestId and result', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    channel.sendResult('req_1', { score: 42 });

    expect(port.sent).toHaveLength(1);
    const msg = port.sent[0];
    expect(isChannelMessage(msg)).toBe(true);
    if (isChannelMessage(msg)) {
      expect(msg.type).toBe('result');
      expect((msg.payload as { requestId: string; result: unknown }).requestId).toBe('req_1');
      expect((msg.payload as { requestId: string; result: unknown }).result).toEqual({ score: 42 });
    }
  });

  it('throws when called before initialize', () => {
    const channel = new WorkerChannel();
    expect(() => channel.sendResult('req_1', {})).toThrow(/not yet initialised/i);
  });
});

// ─── sendCallback ─────────────────────────────────────────────────────────────

describe('WorkerChannel.sendCallback', () => {
  it('posts a callback message with the correct type and data', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    channel.sendCallback('collisionEnter', { entityId: 'ent_42' });

    expect(port.sent).toHaveLength(1);
    const msg = port.sent[0];
    if (!isChannelMessage(msg)) throw new Error('expected ChannelMessage');
    expect(msg.type).toBe('callback');
    expect((msg.payload as { type: string }).type).toBe('collisionEnter');
    expect((msg.payload as { data: unknown }).data).toEqual({ entityId: 'ent_42' });
  });

  it('throws when called before initialize', () => {
    const channel = new WorkerChannel();
    expect(() => channel.sendCallback('event', {})).toThrow(/not yet initialised/i);
  });
});

// ─── sendError ────────────────────────────────────────────────────────────────

describe('WorkerChannel.sendError', () => {
  it('posts an error message correlating to the requestId', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    channel.sendError('req_99', new Error('Boom'));

    expect(port.sent).toHaveLength(1);
    const msg = port.sent[0];
    if (!isChannelMessage(msg)) throw new Error('expected ChannelMessage');
    expect(msg.type).toBe('error');
    expect((msg.payload as { requestId: string }).requestId).toBe('req_99');
    expect((msg.payload as { message: string }).message).toBe('Boom');
  });

  it('throws when called before initialize', () => {
    const channel = new WorkerChannel();
    expect(() => channel.sendError('req_1', new Error('fail'))).toThrow(/not yet initialised/i);
  });
});

// ─── onCommand ────────────────────────────────────────────────────────────────

describe('WorkerChannel.onCommand', () => {
  it('invokes the handler with command, args, and requestId when a command message arrives', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    const handler = vi.fn();
    channel.onCommand(handler);

    const msg = createChannelMessage<CommandPayload>(
      'command',
      { command: 'spawn_entity', args: { type: 'Cube' } },
      'req_cmd_1',
    );
    port.receive(msg);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('spawn_entity', { type: 'Cube' }, 'req_cmd_1');
  });

  it('does not invoke handler for non-command messages', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    const handler = vi.fn();
    channel.onCommand(handler);

    const msg = createChannelMessage<EventPayload>('event', { eventType: 'tick', data: {} });
    port.receive(msg);

    expect(handler).not.toHaveBeenCalled();
  });

  it('replaces a previously registered handler', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    const first = vi.fn();
    const second = vi.fn();
    channel.onCommand(first);
    channel.onCommand(second);

    const msg = createChannelMessage<CommandPayload>('command', { command: 'noop', args: null });
    port.receive(msg);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('ignores messages that fail isChannelMessage validation', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    const handler = vi.fn();
    channel.onCommand(handler);

    port.receive({ type: 'command', payload: {} }); // missing id and timestamp

    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── onEvent ─────────────────────────────────────────────────────────────────

describe('WorkerChannel.onEvent', () => {
  it('invokes the handler with eventType and data when an event message arrives', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    const handler = vi.fn();
    channel.onEvent(handler);

    const msg = createChannelMessage<EventPayload>('event', {
      eventType: 'physicsUpdate',
      data: { velocity: [1, 0, 0] },
    });
    port.receive(msg);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('physicsUpdate', { velocity: [1, 0, 0] });
  });

  it('does not invoke event handler for command messages', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    const handler = vi.fn();
    channel.onEvent(handler);

    const msg = createChannelMessage<CommandPayload>('command', { command: 'noop', args: {} });
    port.receive(msg);

    expect(handler).not.toHaveBeenCalled();
  });

  it('replaces a previously registered event handler', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    const first = vi.fn();
    const second = vi.fn();
    channel.onEvent(first);
    channel.onEvent(second);

    const msg = createChannelMessage<EventPayload>('event', { eventType: 'tick', data: null });
    port.receive(msg);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});

// ─── ping / pong round-trip ───────────────────────────────────────────────────

describe('WorkerChannel ping/pong', () => {
  it('responds to a ping with a pong carrying the same id', () => {
    const port = makeMockPort();
    const channel = new WorkerChannel();
    channel.initialize(port as unknown as MessagePort);

    const pingMsg = createChannelMessage('ping', {}, 'ping-id-xyz');
    port.receive(pingMsg);

    expect(port.sent).toHaveLength(1);
    const pong = port.sent[0];
    if (!isChannelMessage(pong)) throw new Error('expected ChannelMessage');
    expect(pong.type).toBe('pong');
    expect(pong.id).toBe('ping-id-xyz');
  });
});

// ─── Mock port type cast (used in destroy test above) ─────────────────────────

// Verify MockPort type is compatible with test helpers
it('MockPort satisfies duck-type for MessagePort onmessage', () => {
  const port = makeMockPort() as unknown as MockPort;
  expect(typeof port.postMessage).toBe('function');
  expect(typeof port.receive).toBe('function');
});
