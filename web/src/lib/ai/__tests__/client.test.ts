import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fetch globally before importing the module under test
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers to create fake SSE streams
// ---------------------------------------------------------------------------

function makeSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(encoder.encode(evt));
      }
      controller.close();
    },
  });
}

function makeOkResponse(events: string[], headers?: Record<string, string>): Response {
  const body = makeSSEStream(events);
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

function makeErrorResponse(status: number, errorJson?: Record<string, unknown>): Response {
  return new Response(
    errorJson ? JSON.stringify(errorJson) : null,
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

// ---------------------------------------------------------------------------
// fetchAI tests
// ---------------------------------------------------------------------------

describe('fetchAI', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns complete text from a successful stream', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse([
        'data: {"type":"text_delta","text":"Hello "}\n',
        'data: {"type":"text_delta","text":"world"}\n',
        'data: {"type":"done"}\n',
      ]),
    );

    const { fetchAI } = await import('../client');
    const result = await fetchAI('say hello');
    expect(result).toBe('Hello world');
  });

  it('sends correct request body to /api/chat', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse(['data: {"type":"text_delta","text":"ok"}\n', 'data: {"type":"done"}\n']),
    );

    const { fetchAI } = await import('../client');
    await fetchAI('test prompt', {
      model: 'claude-opus-4-5',
      systemOverride: 'You are a test assistant',
      sceneContext: '{}',
      thinking: true,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.messages).toEqual([{ role: 'user', content: 'test prompt' }]);
    expect(body.model).toBe('claude-opus-4-5');
    expect(body.systemOverride).toBe('You are a test assistant');
    expect(body.sceneContext).toBe('{}');
    expect(body.thinking).toBe(true);
  });

  it('throws a user-friendly message on 429', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(429, { error: 'Rate limit exceeded' }));

    const { fetchAI } = await import('../client');
    await expect(fetchAI('prompt')).rejects.toThrow(/rate limit/i);
  });

  it('throws a user-friendly message on 401', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(401, { error: 'Unauthorized' }));

    const { fetchAI } = await import('../client');
    await expect(fetchAI('prompt')).rejects.toThrow(/authentication/i);
  });

  it('throws a user-friendly message on 500', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500, { error: 'Internal server error' }));

    const { fetchAI } = await import('../client');
    await expect(fetchAI('prompt')).rejects.toThrow(/service error/i);
  });

  it('throws on stream error event', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse(['data: {"type":"error","message":"context window exceeded"}\n']),
    );

    const { fetchAI } = await import('../client');
    await expect(fetchAI('prompt')).rejects.toThrow('context window exceeded');
  });

  it('uses default model when not specified', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse(['data: {"type":"done"}\n']),
    );

    const { fetchAI } = await import('../client');
    await fetchAI('prompt');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(typeof body.model).toBe('string');
    expect((body.model as string).length).toBeGreaterThan(0);
  });

  it('does not include systemOverride when not specified', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse(['data: {"type":"done"}\n']),
    );

    const { fetchAI } = await import('../client');
    await fetchAI('prompt');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, 'systemOverride')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// streamAI tests
// ---------------------------------------------------------------------------

describe('streamAI', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires onText callbacks and returns full text', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse([
        'data: {"type":"text_delta","text":"chunk1 "}\n',
        'data: {"type":"text_delta","text":"chunk2"}\n',
        'data: {"type":"done"}\n',
      ]),
    );

    const chunks: string[] = [];
    const { streamAI } = await import('../client');
    const result = await streamAI('prompt', undefined, { onText: (c) => chunks.push(c) });

    expect(result).toBe('chunk1 chunk2');
    expect(chunks).toEqual(['chunk1 ', 'chunk2']);
  });

  it('fires onProgress callbacks', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse([
        'data: {"type":"progress","percent":50}\n',
        'data: {"type":"text_delta","text":"done"}\n',
        'data: {"type":"done"}\n',
      ]),
    );

    const progress: number[] = [];
    const { streamAI } = await import('../client');
    await streamAI('prompt', undefined, { onProgress: (p) => progress.push(p) });

    expect(progress).toEqual([50]);
  });

  it('maps HTTP 402 to insufficient credits message', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(402, { error: 'insufficient credits' }));

    const { streamAI } = await import('../client');
    await expect(streamAI('prompt')).rejects.toThrow(/credits/i);
  });

  it('returns empty string on abort without throwing', async () => {
    // Simulate an AbortError from fetch
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    const { streamAI } = await import('../client');
    const result = await streamAI('prompt');
    expect(result).toBe('');
  });

  it('passes model and options through to chat API', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse(['data: {"type":"done"}\n']),
    );

    const { streamAI } = await import('../client');
    await streamAI('my prompt', { model: 'claude-haiku-4-5', thinking: false });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.messages).toEqual([{ role: 'user', content: 'my prompt' }]);
  });
});

// ---------------------------------------------------------------------------
// Error mapping tests
// ---------------------------------------------------------------------------

describe('fetchAI error mapping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('maps 503 to service unavailable', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(503, { error: 'Service unavailable' }));
    const { fetchAI } = await import('../client');
    await expect(fetchAI('prompt')).rejects.toThrow(/unavailable/i);
  });

  it('preserves unknown errors as-is', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(404, { error: 'Not found' }));
    const { fetchAI } = await import('../client');
    await expect(fetchAI('prompt')).rejects.toThrow('Not found');
  });
});
