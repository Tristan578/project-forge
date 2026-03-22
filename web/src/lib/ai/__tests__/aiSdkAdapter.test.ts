/**
 * Tests for aiSdkAdapter.ts
 *
 * Verifies that streamViaSdk() correctly bridges AI SDK v5 fullStream events
 * to ResolveChatStreamEvent objects. Uses vi.mock to replace streamText with
 * controlled async iterables.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock 'ai' before importing the adapter
// ---------------------------------------------------------------------------

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

vi.mock('@ai-sdk/gateway', () => ({
  gateway: vi.fn(() => ({ _provider: 'gateway-mock' })),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn(() => ({ _provider: 'anthropic-mock' })),
}));

vi.mock('@/lib/ai/toolAdapter', () => ({
  convertManifestToolsToSdkTools: vi.fn(() => ({})),
}));

vi.mock('@/lib/ai/models', () => ({
  AI_MODEL_PRIMARY: 'claude-sonnet-4.5',
  AI_MODELS: { gatewayChat: 'anthropic/claude-sonnet-4.6' },
}));

import { streamText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { streamViaSdk } from '@/lib/ai/aiSdkAdapter';
import type { ResolveChatStreamEvent } from '@/lib/providers/resolveChat';
import type { ResolvedRoute } from '@/lib/providers/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all events from the async generator into an array. */
async function collectEvents(
  gen: AsyncGenerator<ResolveChatStreamEvent>,
): Promise<ResolveChatStreamEvent[]> {
  const events: ResolveChatStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Create an async iterable from an array of parts. */
async function* makeFullStream(
  parts: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const part of parts) {
    yield part;
  }
}

const gatewayRoute: ResolvedRoute = {
  backendId: 'vercel-gateway',
  apiKey: 'test-key',
  metered: false,
};

const directRoute: ResolvedRoute = {
  backendId: 'direct',
  apiKey: 'sk-ant-test',
  metered: true,
};

const simpleMessages = [{ role: 'user' as const, content: 'Hello' }];

// ---------------------------------------------------------------------------
// Basic text streaming
// ---------------------------------------------------------------------------

describe('streamViaSdk — text streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields text_start on text-start event', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([{ type: 'text-start', id: '1' }]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({ type: 'text_start' });
  });

  it('yields text_delta with correct text', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        { type: 'text-delta', id: '1', text: 'Hello world' },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({ type: 'text_delta', text: 'Hello world' });
  });

  it('yields multiple text_delta events in order', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        { type: 'text-delta', id: '1', text: 'foo' },
        { type: 'text-delta', id: '1', text: 'bar' },
        { type: 'text-delta', id: '1', text: 'baz' },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    const textDeltas = events.filter((e) => e.type === 'text_delta') as Array<{
      type: 'text_delta';
      text: string;
    }>;
    expect(textDeltas.map((e) => e.text)).toEqual(['foo', 'bar', 'baz']);
  });
});

// ---------------------------------------------------------------------------
// Thinking / reasoning streaming
// ---------------------------------------------------------------------------

describe('streamViaSdk — thinking streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields thinking_start on reasoning-start event', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([{ type: 'reasoning-start', id: '1' }]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(directRoute, simpleMessages, { thinking: true }),
    );

    expect(events).toContainEqual({ type: 'thinking_start' });
  });

  it('yields thinking_delta with correct text', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        { type: 'reasoning-delta', id: '1', text: 'Let me think...' },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(directRoute, simpleMessages, { thinking: true }),
    );

    expect(events).toContainEqual({
      type: 'thinking_delta',
      text: 'Let me think...',
    });
  });
});

// ---------------------------------------------------------------------------
// Tool call streaming
// ---------------------------------------------------------------------------

describe('streamViaSdk — tool call streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields tool_start with id and name on tool-input-start', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        {
          type: 'tool-input-start',
          id: 'tool-123',
          toolName: 'spawn_entity',
          providerExecuted: false,
        },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'tool_start',
      id: 'tool-123',
      name: 'spawn_entity',
      input: {},
    });
  });

  it('yields tool_input_delta with json on tool-input-delta', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        {
          type: 'tool-input-delta',
          id: 'tool-123',
          delta: '{"entityType":"cube"}',
        },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'tool_input_delta',
      json: '{"entityType":"cube"}',
    });
  });

  it('yields content_block_stop on tool-input-end', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        { type: 'tool-input-end', id: 'tool-123' },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({ type: 'content_block_stop', index: 0 });
  });
});

// ---------------------------------------------------------------------------
// Finish / usage events
// ---------------------------------------------------------------------------

describe('streamViaSdk — finish and usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields usage event from finish-step', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        {
          type: 'finish-step',
          usage: { inputTokens: 100, outputTokens: 50 },
          finishReason: 'stop',
          rawFinishReason: 'stop',
          response: {},
        },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it('yields turn_complete with end_turn for stop finish reason', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: { inputTokens: 10, outputTokens: 5 },
        },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'turn_complete',
      stop_reason: 'end_turn',
    });
  });

  it('maps tool-calls finish reason to tool_use stop reason', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        {
          type: 'finish',
          finishReason: 'tool-calls',
          rawFinishReason: 'tool_use',
          totalUsage: { inputTokens: 10, outputTokens: 5 },
        },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'turn_complete',
      stop_reason: 'tool_use',
    });
  });

  it('passes through other finish reasons unchanged', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        {
          type: 'finish',
          finishReason: 'length',
          rawFinishReason: 'max_tokens',
          totalUsage: { inputTokens: 10, outputTokens: 5 },
        },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'turn_complete',
      stop_reason: 'length',
    });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('streamViaSdk — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields error event on stream error part', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        { type: 'error', error: new Error('Rate limit exceeded') },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'error',
      message: 'Rate limit exceeded',
    });
  });

  it('yields error event with string error message', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        { type: 'error', error: 'Connection timeout' },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'error',
      message: 'Connection timeout',
    });
  });

  it('yields error event when streamText throws', async () => {
    vi.mocked(streamText).mockImplementation(() => {
      throw new Error('Network error');
    });

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'error',
      message: 'Network error',
    });
  });

  it('yields error with generic message for non-Error throws', async () => {
    vi.mocked(streamText).mockImplementation(() => {
      throw 'Something went wrong';
    });

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    expect(events).toContainEqual({
      type: 'error',
      message: 'Something went wrong',
    });
  });
});

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

describe('streamViaSdk — provider selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([]),
    } as ReturnType<typeof streamText>);
  });

  it('uses anthropic() provider for direct backend', async () => {
    await collectEvents(
      streamViaSdk(directRoute, simpleMessages, { model: 'claude-sonnet-4.5' }),
    );

    expect(anthropic).toHaveBeenCalledWith('claude-sonnet-4.5');
    expect(gateway).not.toHaveBeenCalled();
  });

  it('uses gateway() provider for vercel-gateway backend', async () => {
    await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {
        model: 'claude-sonnet-4.6',
      }),
    );

    expect(gateway).toHaveBeenCalledWith('anthropic/claude-sonnet-4.6');
    expect(anthropic).not.toHaveBeenCalled();
  });

  it('uses gateway() provider for openrouter backend', async () => {
    const openRouterRoute: ResolvedRoute = {
      backendId: 'openrouter',
      apiKey: 'sk-or-test',
      metered: false,
    };

    await collectEvents(
      streamViaSdk(openRouterRoute, simpleMessages, {}),
    );

    expect(gateway).toHaveBeenCalled();
    expect(anthropic).not.toHaveBeenCalled();
  });

  it('passes thinking providerOptions for direct backend with thinking=true', async () => {
    await collectEvents(
      streamViaSdk(directRoute, simpleMessages, { thinking: true }),
    );

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.providerOptions).toEqual({
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 10000 },
      },
    });
  });

  it('does not pass thinking providerOptions for gateway backend', async () => {
    await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, { thinking: true }),
    );

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.providerOptions).toBeUndefined();
  });

  it('enables experimental_telemetry', async () => {
    await collectEvents(streamViaSdk(gatewayRoute, simpleMessages, {}));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.experimental_telemetry).toEqual({ isEnabled: true });
  });
});

// ---------------------------------------------------------------------------
// Message and system prompt conversion
// ---------------------------------------------------------------------------

describe('streamViaSdk — message conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([]),
    } as ReturnType<typeof streamText>);
  });

  it('passes system prompt string', async () => {
    await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {
        systemPrompt: 'You are a helpful game designer.',
      }),
    );

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.system).toBe('You are a helpful game designer.');
  });

  it('joins systemBlocks into a single string', async () => {
    await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {
        systemBlocks: [
          { type: 'text', text: 'Block one.' },
          { type: 'text', text: 'Block two.' },
        ],
      }),
    );

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.system).toBe('Block one.\n\nBlock two.');
  });

  it('omits system when neither systemPrompt nor systemBlocks are given', async () => {
    await collectEvents(streamViaSdk(gatewayRoute, simpleMessages, {}));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.system).toBeUndefined();
  });

  it('filters out system-role messages from messages array', async () => {
    const messagesWithSystem = [
      { role: 'system' as const, content: 'System instruction' },
      { role: 'user' as const, content: 'Hello' },
    ];

    await collectEvents(
      streamViaSdk(gatewayRoute, messagesWithSystem, {}),
    );

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    const msgs = callArgs.messages as Array<{ role: string }>;
    expect(msgs.every((m) => m.role !== 'system')).toBe(true);
  });

  it('uses maxOutputTokens of 16384 when thinking is enabled', async () => {
    await collectEvents(
      streamViaSdk(directRoute, simpleMessages, { thinking: true }),
    );

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.maxOutputTokens).toBe(16384);
  });

  it('uses default maxOutputTokens of 4096 without thinking', async () => {
    await collectEvents(streamViaSdk(gatewayRoute, simpleMessages, {}));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.maxOutputTokens).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// Unknown / ignored stream part types
// ---------------------------------------------------------------------------

describe('streamViaSdk — ignored part types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('silently ignores unknown part types without error', async () => {
    vi.mocked(streamText).mockReturnValue({
      fullStream: makeFullStream([
        { type: 'start' },
        { type: 'start-step', request: {}, warnings: [] },
        { type: 'source', url: 'https://example.com', title: 'Example' },
        { type: 'text-delta', id: '1', text: 'visible' },
        { type: 'raw', rawValue: { someInternal: 'data' } },
      ]),
    } as ReturnType<typeof streamText>);

    const events = await collectEvents(
      streamViaSdk(gatewayRoute, simpleMessages, {}),
    );

    // Only the text_delta should produce a ResolveChatStreamEvent
    expect(events).toContainEqual({ type: 'text_delta', text: 'visible' });
    // 'start', 'start-step', 'source', 'raw' should not appear as ResolveChatStreamEvents
    const unexpectedTypes = events.filter(
      (e) =>
        e.type === 'start' ||
        e.type === 'start-step' ||
        e.type === 'source' ||
        e.type === 'raw',
    );
    expect(unexpectedTypes).toHaveLength(0);
  });
});
