import { describe, it, expect } from 'vitest';
import {
  isChannelMessage,
  createChannelMessage,
  type ChannelMessage,
  type ChannelMessageType,
} from '../channelProtocol';

// ─── isChannelMessage ─────────────────────────────────────────────────────────

describe('isChannelMessage', () => {
  const valid: ChannelMessage = {
    id: 'abc-123',
    type: 'command',
    payload: { command: 'spawn', args: {} },
    timestamp: Date.now(),
  };

  it('returns true for a valid message', () => {
    expect(isChannelMessage(valid)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isChannelMessage(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isChannelMessage('hello')).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(isChannelMessage({})).toBe(false);
  });

  it('returns false when id is missing', () => {
    const { id: _id, ...noId } = valid;
    expect(isChannelMessage(noId)).toBe(false);
  });

  it('returns false when type is missing', () => {
    const { type: _type, ...noType } = valid;
    expect(isChannelMessage(noType)).toBe(false);
  });

  it('returns false when type is not a valid ChannelMessageType', () => {
    expect(isChannelMessage({ ...valid, type: 'unknown_type' })).toBe(false);
  });

  it('returns false when timestamp is missing', () => {
    const { timestamp: _ts, ...noTs } = valid;
    expect(isChannelMessage(noTs)).toBe(false);
  });

  it('returns false when timestamp is not a number', () => {
    expect(isChannelMessage({ ...valid, timestamp: '2024-01-01' })).toBe(false);
  });

  it('returns true when payload is null (payload key present)', () => {
    expect(isChannelMessage({ ...valid, payload: null })).toBe(true);
  });

  it.each<ChannelMessageType>([
    'command', 'result', 'event', 'callback', 'error', 'ping', 'pong', 'backpressure',
  ])('accepts valid type %s', (type) => {
    expect(isChannelMessage({ ...valid, type })).toBe(true);
  });
});

// ─── createChannelMessage ─────────────────────────────────────────────────────

describe('createChannelMessage', () => {
  it('sets the given type and payload', () => {
    const msg = createChannelMessage('event', { eventType: 'collision', data: {} });
    expect(msg.type).toBe('event');
    expect(msg.payload).toEqual({ eventType: 'collision', data: {} });
  });

  it('generates a unique id when none is provided', () => {
    const a = createChannelMessage('ping', {});
    const b = createChannelMessage('ping', {});
    expect(typeof a.id).toBe('string');
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.id).not.toBe(b.id);
  });

  it('uses the provided id when given', () => {
    const msg = createChannelMessage('pong', {}, 'fixed-id-123');
    expect(msg.id).toBe('fixed-id-123');
  });

  it('sets timestamp as a positive number', () => {
    const before = Date.now();
    const msg = createChannelMessage('command', { command: 'noop', args: null });
    const after = Date.now();
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.timestamp).toBeLessThanOrEqual(after);
  });

  it('produces a message that passes isChannelMessage validation', () => {
    const msg = createChannelMessage('result', { requestId: 'r1', result: 42 });
    expect(isChannelMessage(msg)).toBe(true);
  });
});
