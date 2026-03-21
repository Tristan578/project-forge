import { describe, it, expect } from 'vitest';
import {
  createSSEResponse,
  chatEventToSSE,
  encodeRawSSE,
  parseSSELine,
  type SSEEvent,
} from '../streaming';

// ---------------------------------------------------------------------------
// createSSEResponse
// ---------------------------------------------------------------------------

async function collectEvents(response: Response): Promise<SSEEvent[]> {
  const text = await response.text();
  const events: SSEEvent[] = [];
  for (const line of text.split('\n')) {
    const parsed = parseSSELine(line);
    if (parsed) events.push(parsed);
  }
  return events;
}

describe('createSSEResponse', () => {
  it('returns a Response with text/event-stream content type', () => {
    const { response, close } = createSSEResponse();
    close();
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('includes Cache-Control: no-cache header', () => {
    const { response, close } = createSSEResponse();
    close();
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('includes X-Accel-Buffering: no header (prevents nginx buffering)', () => {
    const { response, close } = createSSEResponse();
    close();
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  it('returns 200 status', () => {
    const { response, close } = createSSEResponse();
    close();
    expect(response.status).toBe(200);
  });

  it('sends a data event that can be parsed from the stream', async () => {
    const { send, close, response } = createSSEResponse();
    send({ type: 'data', text: 'hello' });
    send({ type: 'done' });
    close();
    const events = await collectEvents(response);
    expect(events).toContainEqual({ type: 'data', text: 'hello' });
    expect(events).toContainEqual({ type: 'done' });
  });

  it('sends multiple events in order', async () => {
    const { send, close, response } = createSSEResponse();
    send({ type: 'progress', message: 'Starting', percent: 0 });
    send({ type: 'progress', message: 'Halfway', percent: 50 });
    send({ type: 'done' });
    close();
    const events = await collectEvents(response);
    expect(events[0]).toEqual({ type: 'progress', message: 'Starting', percent: 0 });
    expect(events[1]).toEqual({ type: 'progress', message: 'Halfway', percent: 50 });
    expect(events[2]).toEqual({ type: 'done' });
  });

  it('sends an error event', async () => {
    const { send, close, response } = createSSEResponse();
    send({ type: 'error', message: 'Something went wrong', code: 'E001' });
    close();
    const events = await collectEvents(response);
    expect(events[0]).toEqual({ type: 'error', message: 'Something went wrong', code: 'E001' });
  });

  it('close() is idempotent — calling twice does not throw', () => {
    const { close } = createSSEResponse();
    expect(() => {
      close();
      close();
    }).not.toThrow();
  });

  it('send() after close() is a no-op — does not throw', async () => {
    const { send, close, response } = createSSEResponse();
    send({ type: 'data', text: 'before' });
    close();
    // Calling send after close should silently do nothing
    expect(() => {
      send({ type: 'data', text: 'after' });
    }).not.toThrow();
    const events = await collectEvents(response);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'data', text: 'before' });
  });
});

// ---------------------------------------------------------------------------
// chatEventToSSE
// ---------------------------------------------------------------------------

describe('chatEventToSSE', () => {
  it('maps error events to SSEErrorEvent', () => {
    const result = chatEventToSSE({ type: 'error', message: 'API failure' });
    expect(result).toEqual({ type: 'error', message: 'API failure' });
  });

  it('maps error events with non-string message gracefully', () => {
    const result = chatEventToSSE({ type: 'error', message: null });
    expect(result).toEqual({ type: 'error', message: 'Unknown error' });
  });

  it('maps turn_complete to done event preserving stop_reason', () => {
    const result = chatEventToSSE({ type: 'turn_complete', stop_reason: 'end_turn' });
    expect(result).toEqual({ type: 'done', stop_reason: 'end_turn' });
  });

  it('maps text_delta to data event', () => {
    const result = chatEventToSSE({ type: 'text_delta', text: 'Hello' });
    // type is remapped to 'data'; the original event type is dropped
    expect(result.type).toBe('data');
    expect((result as Record<string, unknown>).text).toBe('Hello');
    // Original type field must NOT appear as a separate key
    expect(Object.keys(result)).not.toContain('type_inner');
  });

  it('maps tool_start to data event', () => {
    const result = chatEventToSSE({ type: 'tool_start', id: 't1', name: 'spawn_entity', input: {} });
    expect(result.type).toBe('data');
    expect((result as Record<string, unknown>).name).toBe('spawn_entity');
  });

  it('maps usage event to data event', () => {
    const result = chatEventToSSE({ type: 'usage', inputTokens: 100, outputTokens: 50 });
    expect(result.type).toBe('data');
    expect((result as Record<string, unknown>).inputTokens).toBe(100);
  });

  it('maps thinking_delta to data event', () => {
    const result = chatEventToSSE({ type: 'thinking_delta', text: 'thinking...' });
    expect(result.type).toBe('data');
  });
});

// ---------------------------------------------------------------------------
// encodeRawSSE
// ---------------------------------------------------------------------------

describe('encodeRawSSE', () => {
  it('encodes an object as data: <json> line', () => {
    const encoded = encodeRawSSE({ type: 'text_delta', text: 'hi' });
    const decoded = new TextDecoder().decode(encoded);
    expect(decoded).toBe('data: {"type":"text_delta","text":"hi"}\n\n');
  });

  it('handles null value', () => {
    const encoded = encodeRawSSE(null);
    const decoded = new TextDecoder().decode(encoded);
    expect(decoded).toBe('data: null\n\n');
  });

  it('handles string value', () => {
    const encoded = encodeRawSSE('test');
    const decoded = new TextDecoder().decode(encoded);
    expect(decoded).toBe('data: "test"\n\n');
  });
});

// ---------------------------------------------------------------------------
// parseSSELine
// ---------------------------------------------------------------------------

describe('parseSSELine', () => {
  it('parses a valid data: line into an SSEEvent', () => {
    const event = parseSSELine('data: {"type":"data","text":"hello"}');
    expect(event).toEqual({ type: 'data', text: 'hello' });
  });

  it('returns null for empty string', () => {
    expect(parseSSELine('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseSSELine('   ')).toBeNull();
  });

  it('returns null for [DONE] marker', () => {
    expect(parseSSELine('data: [DONE]')).toBeNull();
  });

  it('returns null for lines not starting with "data: "', () => {
    expect(parseSSELine('event: message')).toBeNull();
    expect(parseSSELine('id: 42')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSSELine('data: {invalid json}')).toBeNull();
  });

  it('returns null when parsed value lacks a type field', () => {
    expect(parseSSELine('data: {"message":"no type field"}')).toBeNull();
  });

  it('handles extra whitespace around the line', () => {
    const event = parseSSELine('  data: {"type":"done"}  ');
    expect(event).toEqual({ type: 'done' });
  });

  it('parses error events', () => {
    const event = parseSSELine('data: {"type":"error","message":"oops"}');
    expect(event).toEqual({ type: 'error', message: 'oops' });
  });

  it('parses progress events with percent', () => {
    const event = parseSSELine('data: {"type":"progress","message":"Generating","percent":42}');
    expect(event).toEqual({ type: 'progress', message: 'Generating', percent: 42 });
  });
});
