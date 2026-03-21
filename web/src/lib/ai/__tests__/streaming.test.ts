import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseSSELine,
  readSSEStream,
  streamChat,
  type SSEEnvelopeEvent,
  type StreamCallbacks,
} from '../streaming';

// ---------------------------------------------------------------------------
// parseSSELine
// ---------------------------------------------------------------------------

describe('parseSSELine', () => {
  it('returns null for lines without "data: " prefix', () => {
    expect(parseSSELine('')).toBeNull();
    expect(parseSSELine('event: message')).toBeNull();
    expect(parseSSELine(': heartbeat')).toBeNull();
  });

  it('returns done event for "[DONE]" sentinel', () => {
    expect(parseSSELine('data: [DONE]')).toEqual({ type: 'done' });
  });

  it('returns null for empty data payload', () => {
    expect(parseSSELine('data: ')).toBeNull();
  });

  it('returns null for unparseable JSON', () => {
    expect(parseSSELine('data: {broken json')).toBeNull();
  });

  it('returns null for JSON without a type field', () => {
    expect(parseSSELine('data: {"text":"hi"}')).toBeNull();
  });

  it('parses a text_delta event', () => {
    const result = parseSSELine('data: {"type":"text_delta","text":"hello"}');
    expect(result).toEqual({ type: 'text_delta', text: 'hello' });
  });

  it('returns null for text_delta without a text string', () => {
    expect(parseSSELine('data: {"type":"text_delta","text":42}')).toBeNull();
  });

  it('parses a progress event and clamps to 0–100', () => {
    expect(parseSSELine('data: {"type":"progress","percent":50}')).toEqual({
      type: 'progress',
      percent: 50,
    });
    expect(parseSSELine('data: {"type":"progress","percent":-5}')).toEqual({
      type: 'progress',
      percent: 0,
    });
    expect(parseSSELine('data: {"type":"progress","percent":150}')).toEqual({
      type: 'progress',
      percent: 100,
    });
  });

  it('returns null for progress event without a numeric percent', () => {
    expect(parseSSELine('data: {"type":"progress","percent":"50"}')).toBeNull();
  });

  it('parses an error event', () => {
    const result = parseSSELine('data: {"type":"error","message":"rate limit"}');
    expect(result).toEqual({ type: 'error', message: 'rate limit' });
  });

  it('returns null for error event without a string message', () => {
    expect(parseSSELine('data: {"type":"error","message":null}')).toBeNull();
  });

  it('parses a done event object', () => {
    expect(parseSSELine('data: {"type":"done"}')).toEqual({ type: 'done' });
  });

  it('returns null for unknown event types', () => {
    expect(parseSSELine('data: {"type":"unknown","value":1}')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helper: build a ReadableStream from a sequence of SSE lines
// ---------------------------------------------------------------------------

function makeStream(lines: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  // Join with newlines; each chunk is one line
  const text = lines.join('\n') + '\n';
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return stream.getReader();
}

// ---------------------------------------------------------------------------
// readSSEStream
// ---------------------------------------------------------------------------

describe('readSSEStream', () => {
  it('accumulates text_delta chunks into a single string', async () => {
    const reader = makeStream([
      'data: {"type":"text_delta","text":"Hello"}',
      'data: {"type":"text_delta","text":", world"}',
      'data: [DONE]',
    ]);
    const result = await readSSEStream(reader);
    expect(result).toBe('Hello, world');
  });

  it('calls onText callback for each chunk', async () => {
    const chunks: string[] = [];
    const callbacks: StreamCallbacks = { onText: (c) => chunks.push(c) };
    const reader = makeStream([
      'data: {"type":"text_delta","text":"a"}',
      'data: {"type":"text_delta","text":"b"}',
    ]);
    await readSSEStream(reader, callbacks);
    expect(chunks).toEqual(['a', 'b']);
  });

  it('calls onProgress callback for progress events', async () => {
    const percents: number[] = [];
    const callbacks: StreamCallbacks = { onProgress: (p) => percents.push(p) };
    const reader = makeStream([
      'data: {"type":"progress","percent":25}',
      'data: {"type":"progress","percent":75}',
    ]);
    await readSSEStream(reader, callbacks);
    expect(percents).toEqual([25, 75]);
  });

  it('throws and calls onError when an error event is received', async () => {
    const errors: string[] = [];
    const callbacks: StreamCallbacks = { onError: (m) => errors.push(m) };
    const reader = makeStream([
      'data: {"type":"text_delta","text":"partial"}',
      'data: {"type":"error","message":"upstream failed"}',
    ]);
    await expect(readSSEStream(reader, callbacks)).rejects.toThrow('upstream failed');
    expect(errors).toEqual(['upstream failed']);
  });

  it('skips non-data lines and unparseable lines gracefully', async () => {
    const reader = makeStream([
      ': heartbeat',
      'event: message',
      'data: {broken',
      'data: {"type":"text_delta","text":"ok"}',
    ]);
    const result = await readSSEStream(reader);
    expect(result).toBe('ok');
  });

  it('handles an empty stream', async () => {
    const reader = makeStream([]);
    const result = await readSSEStream(reader);
    expect(result).toBe('');
  });

  it('handles multi-chunk delivery (buffer split across reads)', async () => {
    const encoder = new TextEncoder();
    const fullText =
      'data: {"type":"text_delta","text":"split"}\ndata: {"type":"text_delta","text":"chunk"}\n';
    // Deliver in 2 pieces to test buffer accumulation
    const half = Math.floor(fullText.length / 2);
    const part1 = encoder.encode(fullText.slice(0, half));
    const part2 = encoder.encode(fullText.slice(half));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(part1);
        controller.enqueue(part2);
        controller.close();
      },
    });
    const result = await readSSEStream(stream.getReader());
    expect(result).toBe('splitchunk');
  });
});

// ---------------------------------------------------------------------------
// streamChat
// ---------------------------------------------------------------------------

describe('streamChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchSSE(lines: string[], status = 200) {
    const encoder = new TextEncoder();
    const text = lines.join('\n') + '\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        body: stream,
        json: async () => ({ error: 'server error' }),
      }),
    );
  }

  it('sends correct request body to /api/chat', async () => {
    mockFetchSSE(['data: {"type":"text_delta","text":"hi"}']);
    await streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'claude-sonnet-4-5-20250929',
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.model).toBe('claude-sonnet-4-5-20250929');
    expect(body.sceneContext).toBe('');
    expect(body.thinking).toBe(false);
  });

  it('includes optional systemOverride and sceneContext when provided', async () => {
    mockFetchSSE(['data: {"type":"done"}']);
    await streamChat({
      messages: [{ role: 'user', content: 'x' }],
      model: 'test-model',
      sceneContext: 'my scene',
      thinking: true,
      systemOverride: 'custom system',
    });

    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.sceneContext).toBe('my scene');
    expect(body.thinking).toBe(true);
    expect(body.systemOverride).toBe('custom system');
  });

  it('returns accumulated text content', async () => {
    mockFetchSSE([
      'data: {"type":"text_delta","text":"The"}',
      'data: {"type":"text_delta","text":" answer"}',
      'data: [DONE]',
    ]);
    const result = await streamChat({
      messages: [{ role: 'user', content: 'q' }],
      model: 'test-model',
    });
    expect(result).toBe('The answer');
  });

  it('throws when response is not ok', async () => {
    mockFetchSSE([], 500);
    await expect(
      streamChat({ messages: [{ role: 'user', content: 'q' }], model: 'test-model' }),
    ).rejects.toThrow('server error');
  });

  it('throws when response body is null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, body: null }),
    );
    await expect(
      streamChat({ messages: [{ role: 'user', content: 'q' }], model: 'test-model' }),
    ).rejects.toThrow('No response body');
  });

  it('fires callbacks during streaming', async () => {
    mockFetchSSE([
      'data: {"type":"text_delta","text":"hi"}',
      'data: {"type":"progress","percent":50}',
    ]);
    const texts: string[] = [];
    const progresses: number[] = [];
    await streamChat({
      messages: [{ role: 'user', content: 'q' }],
      model: 'test-model',
      callbacks: {
        onText: (t) => texts.push(t),
        onProgress: (p) => progresses.push(p),
      },
    });
    expect(texts).toEqual(['hi']);
    expect(progresses).toEqual([50]);
  });

  it('propagates stream errors as thrown exceptions', async () => {
    mockFetchSSE([
      'data: {"type":"text_delta","text":"partial"}',
      'data: {"type":"error","message":"rate limited"}',
    ]);
    await expect(
      streamChat({ messages: [{ role: 'user', content: 'q' }], model: 'test-model' }),
    ).rejects.toThrow('rate limited');
  });
});

// ---------------------------------------------------------------------------
// Type-safety: ensure SSEEnvelopeEvent union is exhaustive
// ---------------------------------------------------------------------------

describe('SSEEnvelopeEvent type coverage', () => {
  it('covers all four event type values', () => {
    const events: SSEEnvelopeEvent[] = [
      { type: 'text_delta', text: 'hi' },
      { type: 'progress', percent: 50 },
      { type: 'error', message: 'oops' },
      { type: 'done' },
    ];
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'progress', 'error', 'done']);
  });
});
