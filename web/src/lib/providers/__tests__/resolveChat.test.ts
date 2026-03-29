/**
 * Tests for the resolveChat wrapper.
 *
 * Covers:
 * - resolveChat returns ok:false when no backend is configured
 * - resolveChat routes through streamViaSdk for all backends
 * - resolveChatRoute returns null with no config, ResolvedRoute with config
 * - circuitBreakerWarning is surfaced in the result
 * - options (systemPrompt, thinking, manifestTools) are forwarded to streamViaSdk
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ResolveChatStreamEvent } from '@/lib/providers/resolveChat';

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
    'ANTHROPIC_API_KEY', 'PLATFORM_OPENAI_KEY',
    'PLATFORM_MESHY_KEY', 'PLATFORM_HYPER3D_KEY',
    'PLATFORM_ELEVENLABS_KEY', 'PLATFORM_SUNO_KEY',
    'PLATFORM_REPLICATE_KEY', 'PLATFORM_REMOVEBG_KEY',
  ];
  for (const k of keys) {
    delete process.env[k];
  }
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

/**
 * Build a minimal fake streamViaSdk generator that yields the given events.
 * Used to mock @/lib/ai/aiSdkAdapter without needing real AI provider calls.
 */
async function* fakeStream(
  events: ResolveChatStreamEvent[]
): AsyncGenerator<ResolveChatStreamEvent> {
  for (const event of events) yield event;
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

  it('returns a route with direct backendId when only ANTHROPIC_API_KEY is set', async () => {
    setEnv({ ANTHROPIC_API_KEY: 'sk-platform' });
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
// Tests: resolveChat — AI SDK adapter path
// All backends now route through streamViaSdk; we mock it to avoid real calls.
// ---------------------------------------------------------------------------

describe('resolveChat — AI SDK adapter path (direct backend)', () => {
  beforeEach(() => {
    clearAllProviderEnv();
    vi.resetModules();
  });

  afterEach(() => {
    Object.assign(process.env, envBackup);
    vi.restoreAllMocks();
  });

  it('returns ok:true with backendId direct when only ANTHROPIC_API_KEY is set', async () => {
    setEnv({ ANTHROPIC_API_KEY: 'sk-platform' });

    vi.doMock('@/lib/ai/aiSdkAdapter', () => ({
      streamViaSdk: vi.fn().mockReturnValue(fakeStream([
        { type: 'text_start' },
        { type: 'text_delta', text: 'Hello' },
        { type: 'turn_complete', stop_reason: 'end_turn' },
      ])),
    }));

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backendId).toBe('direct');

    const events = await collectEvents(result.stream as AsyncGenerator<Record<string, unknown>>);
    const types = events.map((e) => e.type);
    expect(types).toContain('text_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('turn_complete');

    const textDelta = events.find((e) => e.type === 'text_delta');
    expect(textDelta!.text).toBe('Hello');
  });

  it('emits thinking events when thinking mode is enabled', async () => {
    setEnv({ ANTHROPIC_API_KEY: 'sk-platform' });

    vi.doMock('@/lib/ai/aiSdkAdapter', () => ({
      streamViaSdk: vi.fn().mockReturnValue(fakeStream([
        { type: 'thinking_start' },
        { type: 'thinking_delta', text: 'I think...' },
        { type: 'turn_complete', stop_reason: 'end_turn' },
      ])),
    }));

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
    setEnv({ ANTHROPIC_API_KEY: 'sk-platform' });

    vi.doMock('@/lib/ai/aiSdkAdapter', () => ({
      streamViaSdk: vi.fn().mockReturnValue(fakeStream([
        { type: 'tool_start', id: 'tu_1', name: 'spawn_entity', input: {} },
        { type: 'tool_input_delta', json: '{"type":"cube"}' },
        { type: 'turn_complete', stop_reason: 'tool_use' },
      ])),
    }));

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

describe('resolveChat — AI SDK adapter path (gateway backend)', () => {
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

    vi.doMock('@/lib/ai/aiSdkAdapter', () => ({
      streamViaSdk: vi.fn().mockReturnValue(fakeStream([
        { type: 'text_delta', text: 'Hi' },
        { type: 'usage', inputTokens: 5, outputTokens: 2 },
        { type: 'turn_complete', stop_reason: 'stop' },
      ])),
    }));

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

  it('falls back to OpenRouter when Vercel Gateway is not configured', async () => {
    setEnv({ OPENROUTER_API_KEY: 'or-key' });

    vi.doMock('@/lib/ai/aiSdkAdapter', () => ({
      streamViaSdk: vi.fn().mockReturnValue(fakeStream([
        { type: 'turn_complete', stop_reason: 'stop' },
      ])),
    }));

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backendId).toBe('openrouter');
  });

  it('passes options through to streamViaSdk', async () => {
    setEnv({ AI_GATEWAY_API_KEY: 'gw-key' });

    const mockStreamViaSdk = vi.fn().mockReturnValue(fakeStream([
      { type: 'turn_complete', stop_reason: 'stop' },
    ]));

    vi.doMock('@/lib/ai/aiSdkAdapter', () => ({
      streamViaSdk: mockStreamViaSdk,
    }));

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    await resolveChat(
      [{ role: 'user', content: 'hello' }],
      { systemPrompt: 'You are a game engine assistant.', thinking: true }
    );

    expect(mockStreamViaSdk).toHaveBeenCalledOnce();
    const [, , options] = mockStreamViaSdk.mock.calls[0] as [unknown, unknown, { systemPrompt?: string; thinking?: boolean }];
    expect(options.systemPrompt).toBe('You are a game engine assistant.');
    expect(options.thinking).toBe(true);
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

    vi.doMock('@/lib/ai/aiSdkAdapter', () => ({
      streamViaSdk: vi.fn().mockReturnValue(fakeStream([
        { type: 'turn_complete', stop_reason: 'stop' },
      ])),
    }));

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

    vi.doMock('@/lib/ai/aiSdkAdapter', () => ({
      streamViaSdk: vi.fn().mockReturnValue(fakeStream([
        { type: 'turn_complete', stop_reason: 'stop' },
      ])),
    }));

    const { resolveChat } = await import('@/lib/providers/resolveChat');
    const result = await resolveChat([{ role: 'user', content: 'hello' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.circuitBreakerWarning).toBeUndefined();
  });
});
