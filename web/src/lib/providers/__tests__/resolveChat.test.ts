/**
 * Tests for the resolveChat wrapper.
 *
 * Covers:
 * - resolveChat returns ok:false when no backend is configured
 * - resolveChat routes to Anthropic SDK path when direct backend is used
 * - resolveChat routes to OpenAI-compat path when gateway backend is used
 * - resolveChatRoute returns null with no config, ResolvedRoute with config
 * - streamAnthropicDirect emits the expected event sequence
 * - streamOpenAICompat emits the expected event sequence
 * - error events are emitted on API failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

const envBackup = { ...process.env };

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function clearAllProviderEnv(): void {
  const keys = [
    'AI_GATEWAY_API_KEY', 'VERCEL', 'VERCEL_ENV',
    'OPENROUTER_API_KEY', 'GITHUB_MODELS_PAT',
    'PLATFORM_ANTHROPIC_KEY', 'PLATFORM_OPENAI_KEY',
    'PLATFORM_MESHY_KEY', 'PLATFORM_HYPER3D_KEY',
    'PLATFORM_ELEVENLABS_KEY', 'PLATFORM_SUNO_KEY',
    'PLATFORM_REPLICATE_KEY', 'PLATFORM_REMOVEBG_KEY',
  ];
  for (const k of keys) {
    delete process.env[k];
  }
  // Disable AI SDK adapter so legacy-path tests exercise the Anthropic SDK /
  // fetch-based streams they mock (the SDK path is on by default in production).
  process.env.USE_AI_SDK = 'false';
}

// ---------------------------------------------------------------------------
// Helpers to collect all events from a generator
// ---------------------------------------------------------------------------

async function collectEvents(
  gen: AsyncGenerator<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests: resolveChatRoute
// ---------------------------------------------------------------------------

describe('resolveChatRoute', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
  });

  it('returns null when no backend is configured', async () => {
    const { resolveChatRoute } = await import('@/lib/providers/resolveChat');
    expect(resolveChatRoute()).toBeNull();
  });

  it('returns a route with vercel-gateway backendId when AI_GATEWAY_API_KEY is set', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });
    const { resolveChatRoute } = await import('@/lib/providers/resolveChat');
    const route = resolveChatRoute();
    expect(route).not.toBeNull();
    expect(route!.backendId).toBe('vercel-gateway');
  });

  it('returns a route with direct backendId when only PLATFORM_ANTHROPIC_KEY is set', async () => {
    setEnv({ PLATFORM_ANTHROPIC_KEY: 'sk-platform' });
    const { resolveChatRoute } = await import('@/lib/providers/resolveChat');
    const route = resolveChatRoute();
    expect(route).not.toBeNull();
    expect(route!.backendId).toBe('direct');
  });

  it('resolves the model ID when a preferred model is given', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });
    const { resolveChatRoute } = await import('@/lib/providers/resolveChat');
    const route = resolveChatRoute('claude-sonnet-4-6');
    expect(route!.modelId).toBe('anthropic/claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveChat — no backend
// ---------------------------------------------------------------------------

describe('resolveChat — no backend configured', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
  });

  it('returns ok:false with a descriptive error', async () => {
    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No chat backend');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveChat — Anthropic direct path
// ---------------------------------------------------------------------------

describe('resolveChat — Anthropic direct path', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
    vi.restoreAllMocks();
  });

  it('returns ok:true with backendId direct when only platform key is set', async () => {
    setEnv({ PLATFORM_ANTHROPIC_KEY: 'sk-platform' });

    // Mock Anthropic SDK to yield a minimal streaming sequence
    vi.doMock('@anthropic-ai/sdk', () => {
      async function* fakeStream() {
        yield {
          type: 'message_start',
          message: { usage: { input_tokens: 10 } },
        };
        yield { type: 'content_block_start', content_block: { type: 'text' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
        yield { type: 'content_block_stop', index: 0 };
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 3 },
        };
        yield { type: 'message_stop' };
      }
      const mockCreate = vi.fn().mockResolvedValue(fakeStream());
      class MockAnthropic {
        messages = { create: mockCreate };
      }
      return { default: MockAnthropic };
    });

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backendId).toBe('direct');

    const events = await collectEvents(result.stream as AsyncGenerator<Record<string, unknown>>);
    const types = events.map((e) => e.type);

    expect(types).toContain('usage');
    expect(types).toContain('text_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('turn_complete');

    const textDeltas = events.filter((e) => e.type === 'text_delta');
    expect(textDeltas[0].text).toBe('Hello');

    const usageEvents = events.filter((e) => e.type === 'usage');
    const inputUsage = usageEvents.find((e) => e.inputTokens !== undefined);
    expect(inputUsage).toBeDefined();
    expect(inputUsage!.inputTokens).toBe(10);
  });

  it('emits thinking events when thinking mode is enabled', async () => {
    setEnv({ PLATFORM_ANTHROPIC_KEY: 'sk-platform' });

    vi.doMock('@anthropic-ai/sdk', () => {
      async function* fakeStream() {
        yield { type: 'content_block_start', content_block: { type: 'thinking' } };
        yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'I think...' } };
        yield { type: 'content_block_stop', index: 0 };
        yield { type: 'message_stop' };
      }
      const mockCreate = vi.fn().mockResolvedValue(fakeStream());
      class MockAnthropic {
        messages = { create: mockCreate };
      }
      return { default: MockAnthropic };
    });

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat(
      [{ role: 'user', content: 'think about this' }],
      { thinking: true }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await collectEvents(result.stream as AsyncGenerator<Record<string, unknown>>);
    const types = events.map((e) => e.type);

    expect(types).toContain('thinking_start');
    expect(types).toContain('thinking_delta');
    const thinkDelta = events.find((e) => e.type === 'thinking_delta');
    expect(thinkDelta!.text).toBe('I think...');
  });

  it('emits tool_start and tool_input_delta for tool use blocks', async () => {
    setEnv({ PLATFORM_ANTHROPIC_KEY: 'sk-platform' });

    vi.doMock('@anthropic-ai/sdk', () => {
      async function* fakeStream() {
        yield {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tu_1', name: 'spawn_entity' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"type":"cube"}' },
        };
        yield { type: 'content_block_stop', index: 0 };
        yield { type: 'message_stop' };
      }
      const mockCreate = vi.fn().mockResolvedValue(fakeStream());
      class MockAnthropic {
        messages = { create: mockCreate };
      }
      return { default: MockAnthropic };
    });

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'spawn a cube' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await collectEvents(result.stream as AsyncGenerator<Record<string, unknown>>);
    const toolStart = events.find((e) => e.type === 'tool_start');
    expect(toolStart).toBeDefined();
    expect(toolStart!.name).toBe('spawn_entity');
    expect(toolStart!.id).toBe('tu_1');

    const toolDelta = events.find((e) => e.type === 'tool_input_delta');
    expect(toolDelta!.json).toBe('{"type":"cube"}');
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveChat — OpenAI-compatible gateway path
// ---------------------------------------------------------------------------

describe('resolveChat — OpenAI-compatible gateway path', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
    vi.restoreAllMocks();
  });

  it('returns ok:true with backendId vercel-gateway and emits text_delta', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });

    // Build an SSE stream that mimics what the OpenAI-compat endpoint returns
    function makeSSEStream(chunks: string[]): Response {
      const body = chunks.join('\n') + '\n';
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }

    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
      'data: [DONE]',
    ];

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeSSEStream(sseChunks)));

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backendId).toBe('vercel-gateway');

    const events = await collectEvents(result.stream as AsyncGenerator<Record<string, unknown>>);
    const textDelta = events.find((e) => e.type === 'text_delta');
    expect(textDelta).toBeDefined();
    expect(textDelta!.text).toBe('Hi');

    const turnComplete = events.find((e) => e.type === 'turn_complete');
    expect(turnComplete).toBeDefined();
    expect(turnComplete!.stop_reason).toBe('stop');

    const usageEvent = events.find((e) => e.type === 'usage' && e.inputTokens !== undefined);
    expect(usageEvent).toBeDefined();
    expect(usageEvent!.inputTokens).toBe(5);
  });

  it('emits an error event when the fetch response is not ok', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"error":"model not found"}', { status: 404 })
    ));

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await collectEvents(result.stream as AsyncGenerator<Record<string, unknown>>);
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
  });

  it('calls the correct OpenAI-compat endpoint URL', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);
    expect(result.ok).toBe(true);

    // Drain the stream
    if (result.ok) {
      for await (const _event of result.stream) { /* drain */ }
    }

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
  });

  it('falls back to OpenRouter when Vercel Gateway is not configured', async () => {
    setEnv({ OPENROUTER_API_KEY: 'or-key' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    ));

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backendId).toBe('openrouter');
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveChat — circuitBreakerWarning surface (PF-737)
// ---------------------------------------------------------------------------

describe('resolveChat — circuitBreakerWarning (PF-737)', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
    vi.restoreAllMocks();
  });

  it('includes circuitBreakerWarning in result when resolver returns one', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });

    // Override the registry to inject a warning — simulates a HALF_OPEN or OPEN state
    vi.doMock('@/lib/providers/registry', () => ({
      resolveBackend: vi.fn().mockReturnValue({
        backendId: 'vercel-gateway',
        apiKey: 'gw-key',
        endpoint: 'https://ai-gateway.vercel.sh/v1',
        modelId: undefined,
        metered: true,
      }),
      resolveBackendWithCircuitBreaker: vi.fn().mockReturnValue({
        backendId: 'vercel-gateway',
        apiKey: 'gw-key',
        endpoint: 'https://ai-gateway.vercel.sh/v1',
        modelId: undefined,
        metered: true,
        circuitBreakerWarning: 'WARNING: vercel-gateway circuit breaker is HALF_OPEN (error rate exceeded). Proceeding cautiously.',
      }),
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    ));

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // PF-737: circuitBreakerWarning must be surfaced in the result, not discarded
    expect(result.circuitBreakerWarning).toBeDefined();
    expect(result.circuitBreakerWarning).toContain('WARNING');
    expect(result.circuitBreakerWarning).toContain('vercel-gateway');
  });

  it('does not include circuitBreakerWarning when circuit is healthy', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });

    vi.doMock('@/lib/providers/registry', () => ({
      resolveBackend: vi.fn().mockReturnValue({
        backendId: 'vercel-gateway',
        apiKey: 'gw-key',
        endpoint: 'https://ai-gateway.vercel.sh/v1',
        modelId: undefined,
        metered: true,
      }),
      resolveBackendWithCircuitBreaker: vi.fn().mockReturnValue({
        backendId: 'vercel-gateway',
        apiKey: 'gw-key',
        endpoint: 'https://ai-gateway.vercel.sh/v1',
        modelId: undefined,
        metered: true,
        // No circuitBreakerWarning — circuit is healthy
      }),
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    ));

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.circuitBreakerWarning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveChat — system prompt handling
// ---------------------------------------------------------------------------

describe('resolveChat — system prompt', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
    vi.restoreAllMocks();
  });

  it('includes systemPrompt in the request body for OpenAI-compat path', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat(
      [{ role: 'user', content: 'hello' }],
      { systemPrompt: 'You are a game engine assistant.' }
    );
    expect(result.ok).toBe(true);

    if (result.ok) {
      for await (const _event of result.stream) { /* drain */ }
    }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemMsg = body.messages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toContain('game engine assistant');
  });
});
