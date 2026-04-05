import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseSSELine,
  parseAiSdkSSELine,
  readSSEStream,
  readAiSdkStream,
  isAiSdkStream,
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
    // Include a Headers object so isAiSdkStream() can check response headers.
    // No x-vercel-ai-ui-message-stream header = legacy format path.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        body: stream,
        headers: new Headers(),
        json: async () => ({ error: 'server error' }),
      }),
    );
  }

  it('sends correct request body to /api/chat', async () => {
    mockFetchSSE(['data: {"type":"text_delta","text":"hi"}']);
    await streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'claude-sonnet-4-6',
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.model).toBe('claude-sonnet-4-6');
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

// ---------------------------------------------------------------------------
// parseAiSdkSSELine — AI SDK UI message stream format
// ---------------------------------------------------------------------------

describe('parseAiSdkSSELine', () => {
  it('returns null for lines without "data: " prefix', () => {
    expect(parseAiSdkSSELine('')).toBeNull();
    expect(parseAiSdkSSELine('event: message')).toBeNull();
    expect(parseAiSdkSSELine(': heartbeat')).toBeNull();
  });

  it('returns done for [DONE] sentinel', () => {
    expect(parseAiSdkSSELine('data: [DONE]')).toEqual({ type: 'done' });
  });

  it('returns null for empty data payload', () => {
    expect(parseAiSdkSSELine('data: ')).toBeNull();
  });

  it('parses a text-delta event (AI SDK hyphenated format with delta field)', () => {
    const result = parseAiSdkSSELine('data: {"type":"text-delta","id":"msg-1","delta":"Hello"}');
    expect(result).toEqual({ type: 'text_delta', text: 'Hello' });
  });

  it('returns null for text-delta without a string delta field', () => {
    expect(parseAiSdkSSELine('data: {"type":"text-delta","id":"x","delta":42}')).toBeNull();
  });

  it('parses an error event with errorText field', () => {
    const result = parseAiSdkSSELine('data: {"type":"error","errorText":"upstream failed"}');
    expect(result).toEqual({ type: 'error', message: 'upstream failed' });
  });

  it('parses an error event with message field as fallback', () => {
    const result = parseAiSdkSSELine('data: {"type":"error","message":"rate limit"}');
    expect(result).toEqual({ type: 'error', message: 'rate limit' });
  });

  it('returns a generic error message when neither errorText nor message are present', () => {
    const result = parseAiSdkSSELine('data: {"type":"error"}');
    expect(result).toEqual({ type: 'error', message: 'AI stream error' });
  });

  it('returns done for finish event', () => {
    expect(parseAiSdkSSELine('data: {"type":"finish","finishReason":"stop"}')).toEqual({
      type: 'done',
    });
  });

  it('returns done for finish-step event', () => {
    expect(parseAiSdkSSELine('data: {"type":"finish-step"}')).toEqual({ type: 'done' });
  });

  it('returns null for non-text AI SDK event types (silently skipped)', () => {
    expect(parseAiSdkSSELine('data: {"type":"text-start","id":"x"}')).toBeNull();
    expect(parseAiSdkSSELine('data: {"type":"text-end","id":"x"}')).toBeNull();
    expect(parseAiSdkSSELine('data: {"type":"tool-input-start","id":"x"}')).toBeNull();
    expect(parseAiSdkSSELine('data: {"type":"reasoning-delta","delta":"think"}')).toBeNull();
    expect(parseAiSdkSSELine('data: {"type":"start","id":"x"}')).toBeNull();
    expect(parseAiSdkSSELine('data: {"type":"start-step","id":"x"}')).toBeNull();
    expect(parseAiSdkSSELine('data: {"type":"abort"}')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readAiSdkStream
// ---------------------------------------------------------------------------

function makeAiSdkStream(lines: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const text = lines.join('\n') + '\n';
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return stream.getReader();
}

describe('readAiSdkStream', () => {
  it('accumulates text-delta chunks into a single string', async () => {
    const reader = makeAiSdkStream([
      'data: {"type":"text-delta","id":"m1","delta":"Hello"}',
      'data: {"type":"text-delta","id":"m1","delta":", world"}',
      'data: {"type":"finish","finishReason":"stop"}',
    ]);
    const result = await readAiSdkStream(reader);
    expect(result).toBe('Hello, world');
  });

  it('calls onText callback for each text-delta chunk', async () => {
    const chunks: string[] = [];
    const reader = makeAiSdkStream([
      'data: {"type":"text-delta","id":"m1","delta":"a"}',
      'data: {"type":"text-delta","id":"m1","delta":"b"}',
    ]);
    await readAiSdkStream(reader, { onText: (c) => chunks.push(c) });
    expect(chunks).toEqual(['a', 'b']);
  });

  it('silently skips non-text events (tool calls, reasoning, start/finish markers)', async () => {
    const reader = makeAiSdkStream([
      'data: {"type":"start","id":"m1"}',
      'data: {"type":"start-step","id":"m1"}',
      'data: {"type":"text-start","id":"t1"}',
      'data: {"type":"text-delta","id":"t1","delta":"ok"}',
      'data: {"type":"text-end","id":"t1"}',
      'data: {"type":"tool-input-start","id":"tc1","toolName":"spawn_entity"}',
      'data: {"type":"finish-step"}',
      'data: {"type":"finish","finishReason":"stop"}',
    ]);
    const result = await readAiSdkStream(reader);
    expect(result).toBe('ok');
  });

  it('throws and calls onError when an error event is received', async () => {
    const errors: string[] = [];
    const reader = makeAiSdkStream([
      'data: {"type":"text-delta","id":"m1","delta":"partial"}',
      'data: {"type":"error","errorText":"upstream failed"}',
    ]);
    await expect(readAiSdkStream(reader, { onError: (m) => errors.push(m) })).rejects.toThrow(
      'upstream failed',
    );
    expect(errors).toEqual(['upstream failed']);
  });

  it('handles an empty stream', async () => {
    const reader = makeAiSdkStream([]);
    const result = await readAiSdkStream(reader);
    expect(result).toBe('');
  });

  it('handles [DONE] sentinel correctly', async () => {
    const reader = makeAiSdkStream([
      'data: {"type":"text-delta","id":"m1","delta":"final"}',
      'data: [DONE]',
    ]);
    const result = await readAiSdkStream(reader);
    expect(result).toBe('final');
  });
});

// ---------------------------------------------------------------------------
// isAiSdkStream
// ---------------------------------------------------------------------------

describe('isAiSdkStream', () => {
  function makeResponse(headers: Record<string, string>): Response {
    return new Response(null, { headers });
  }

  it('returns true when x-vercel-ai-ui-message-stream header is v1', () => {
    expect(isAiSdkStream(makeResponse({ 'x-vercel-ai-ui-message-stream': 'v1' }))).toBe(true);
  });

  it('returns false when the header is absent', () => {
    expect(isAiSdkStream(makeResponse({}))).toBe(false);
  });

  it('returns false when the header has a different value', () => {
    expect(isAiSdkStream(makeResponse({ 'x-vercel-ai-ui-message-stream': 'v2' }))).toBe(false);
    expect(isAiSdkStream(makeResponse({ 'x-vercel-ai-ui-message-stream': '' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// streamChat — format detection routing
// ---------------------------------------------------------------------------

describe('streamChat format detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchWithHeader(
    lines: string[],
    headers: Record<string, string> = {},
    status = 200,
  ) {
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
        headers: new Headers(headers),
        json: async () => ({ error: 'server error' }),
      }),
    );
  }

  it('uses legacy reader when x-vercel-ai-ui-message-stream header is absent', async () => {
    mockFetchWithHeader(['data: {"type":"text_delta","text":"legacy"}']);
    const result = await streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
    });
    expect(result).toBe('legacy');
  });

  it('uses AI SDK reader when x-vercel-ai-ui-message-stream: v1 header is present', async () => {
    mockFetchWithHeader(
      ['data: {"type":"text-delta","id":"m1","delta":"sdk-text"}'],
      { 'x-vercel-ai-ui-message-stream': 'v1' },
    );
    const result = await streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
    });
    expect(result).toBe('sdk-text');
  });

  it('AI SDK reader handles finish event correctly', async () => {
    mockFetchWithHeader(
      [
        'data: {"type":"text-delta","id":"m1","delta":"done"}',
        'data: {"type":"finish","finishReason":"stop"}',
      ],
      { 'x-vercel-ai-ui-message-stream': 'v1' },
    );
    const result = await streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
    });
    expect(result).toBe('done');
  });

  it('AI SDK reader propagates error events', async () => {
    mockFetchWithHeader(
      ['data: {"type":"error","errorText":"quota exceeded"}'],
      { 'x-vercel-ai-ui-message-stream': 'v1' },
    );
    await expect(
      streamChat({ messages: [{ role: 'user', content: 'hello' }], model: 'test-model' }),
    ).rejects.toThrow('quota exceeded');
  });
});
