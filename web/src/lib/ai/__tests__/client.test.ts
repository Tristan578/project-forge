import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIResponseCache } from '../promptCache';

// ---------------------------------------------------------------------------
// Mock fetch globally before importing the module under test
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Mock promptCache so tests can control the AIResponseCache instance.
// We use a getter that always returns the current _testCache so we can swap
// it to a fresh instance in beforeEach, preventing cache cross-contamination.
//
// A real AIResponseCache is used (not a passthrough) so that caching and
// in-flight dedup tests exercise the actual behaviour.
// ---------------------------------------------------------------------------

let _testCache = new AIResponseCache();
vi.mock('@/lib/ai/promptCache', async (importOriginal) => {
  const original = await importOriginal<typeof import('../promptCache')>();
  return {
    ...original,
    get aiResponseCache(): AIResponseCache {
      return _testCache;
    },
  };
});

// Reset to a fresh cache instance before every test so cached responses from
// one test cannot bleed into the next (same prompt → cache hit → no fetch call).
beforeEach(() => {
  _testCache = new AIResponseCache();
});

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
      model: 'claude-opus-4-6',
      systemOverride: 'You are a test assistant',
      sceneContext: '{}',
      thinking: true,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.messages).toEqual([{ role: 'user', content: 'test prompt' }]);
    expect(body.model).toBe('claude-opus-4-6');
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

// ---------------------------------------------------------------------------
// fetchAI — response cache integration
// ---------------------------------------------------------------------------

describe('fetchAI response caching', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cached result without calling fetch a second time for identical prompt', async () => {
    // Return a fresh Response each call — ReadableStream can only be read once.
    // mockResolvedValue would return the SAME Response object, causing
    // "ReadableStream is locked" when the second call tries to read it.
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeOkResponse([
          'data: {"type":"text_delta","text":"cached answer"}\n',
          'data: {"type":"done"}\n',
        ]),
      ),
    );

    // Import a fresh module instance so the cache starts empty
    vi.resetModules();
    const { fetchAI } = await import('../client');

    const first = await fetchAI('what is 2+2', { model: 'claude-sonnet-4-6' });
    expect(first).toBe('cached answer');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call with identical args — should hit cache, not call fetch again
    const second = await fetchAI('what is 2+2', { model: 'claude-sonnet-4-6' });
    expect(second).toBe('cached answer');
    expect(mockFetch).toHaveBeenCalledTimes(1); // still 1 — no second network call
  });

  it('calls fetch for a different prompt even if first is cached', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeOkResponse([
          'data: {"type":"text_delta","text":"answer A"}\n',
          'data: {"type":"done"}\n',
        ]),
      )
      .mockResolvedValueOnce(
        makeOkResponse([
          'data: {"type":"text_delta","text":"answer B"}\n',
          'data: {"type":"done"}\n',
        ]),
      );

    vi.resetModules();
    const { fetchAI } = await import('../client');

    const a = await fetchAI('prompt A', { model: 'claude-sonnet-4-6' });
    const b = await fetchAI('prompt B', { model: 'claude-sonnet-4-6' });

    expect(a).toBe('answer A');
    expect(b).toBe('answer B');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('bypasses cache and calls fetch when AbortSignal is provided', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeOkResponse([
          'data: {"type":"text_delta","text":"first"}\n',
          'data: {"type":"done"}\n',
        ]),
      )
      .mockResolvedValueOnce(
        makeOkResponse([
          'data: {"type":"text_delta","text":"second"}\n',
          'data: {"type":"done"}\n',
        ]),
      );

    vi.resetModules();
    const { fetchAI } = await import('../client');
    const controller = new AbortController();

    const first = await fetchAI('same prompt', { signal: controller.signal });
    const second = await fetchAI('same prompt', { signal: controller.signal });

    expect(first).toBe('first');
    expect(second).toBe('second');
    // Both calls must have hit fetch — signal bypasses the cache
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not serve cached response when thinking flag differs', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeOkResponse([
          'data: {"type":"text_delta","text":"non-thinking answer"}\n',
          'data: {"type":"done"}\n',
        ]),
      )
      .mockResolvedValueOnce(
        makeOkResponse([
          'data: {"type":"text_delta","text":"thinking answer"}\n',
          'data: {"type":"done"}\n',
        ]),
      );

    vi.resetModules();
    const { fetchAI } = await import('../client');

    const nonThinking = await fetchAI('same prompt', { model: 'claude-sonnet-4-6', thinking: false });
    const withThinking = await fetchAI('same prompt', { model: 'claude-sonnet-4-6', thinking: true });

    expect(nonThinking).toBe('non-thinking answer');
    expect(withThinking).toBe('thinking answer');
    // Both must hit the network — thinking=true must not reuse the thinking=false cache entry
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent in-flight requests for the same prompt', async () => {
    let resolveResponse!: () => void;
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        resolveResponse = () => {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('data: {"type":"text_delta","text":"deduped"}\n'));
          controller.enqueue(encoder.encode('data: {"type":"done"}\n'));
          controller.close();
        };
      },
    });
    mockFetch.mockResolvedValue(new Response(streamBody, { status: 200 }));

    vi.resetModules();
    const { fetchAI } = await import('../client');

    // Start two concurrent calls before the first resolves
    const p1 = fetchAI('concurrent prompt', { model: 'claude-sonnet-4-6' });
    const p2 = fetchAI('concurrent prompt', { model: 'claude-sonnet-4-6' });

    // Resolve the underlying stream
    resolveResponse();

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both callers get the same result
    expect(r1).toBe('deduped');
    expect(r2).toBe('deduped');
    // fetch was called exactly once despite two concurrent callers
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
