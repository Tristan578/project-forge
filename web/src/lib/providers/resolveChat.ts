/**
 * resolveChat — unified chat streaming wrapper.
 *
 * Routes streaming chat completions through the best available backend via
 * the provider registry. Priority order:
 *   1. Vercel AI Gateway (OpenAI-compatible, OIDC auth)
 *   2. OpenRouter       (OpenAI-compatible, wide model selection)
 *   3. GitHub Models    (OpenAI-compatible, free tier)
 *   4. Direct           (Anthropic SDK, platform key)
 *
 * All gateway-backed paths are called via a plain fetch to the OpenAI-compatible
 * /chat/completions endpoint so we don't need provider-specific SDKs.
 * The direct (Anthropic) path retains prompt-cache headers and thinking mode
 * via the Anthropic SDK.
 *
 * Usage:
 *   const result = await resolveChat(messages, { model, thinking, systemBlocks });
 *   if (!result.ok) throw new Error(result.error);
 *   for await (const event of result.stream) { ... }
 */

import type { ResolvedRoute } from './types';
import { resolveBackend, resolveBackendWithCircuitBreaker } from './registry';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, AI_MODEL_PRIMARY } from '@/lib/ai/models';
import { streamViaSdk } from '@/lib/ai/aiSdkAdapter';
import type { ManifestTool } from '@/lib/ai/toolAdapter';

// Feature flag: set USE_AI_SDK=true to route through AI SDK v5 adapter.
// When false (default), the existing Anthropic SDK / fetch-based paths run unchanged.
const USE_AI_SDK = process.env.USE_AI_SDK === 'true';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | Anthropic.TextBlockParam
  | Anthropic.ToolResultBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ThinkingBlockParam;

export interface ResolveChatOptions {
  /** Canonical model name (e.g. 'claude-sonnet-4-6') */
  model?: string;
  /** Anthropic structured system prompt blocks (supports cache_control) */
  systemBlocks?: Anthropic.TextBlockParam[];
  /** Plain text system prompt — used when systemBlocks is not provided */
  systemPrompt?: string;
  /** Anthropic tool definitions */
  tools?: Anthropic.Tool[];
  /** Enable extended thinking (Anthropic-only, ignored on gateway/OpenAI paths) */
  thinking?: boolean;
  /** Max output tokens */
  maxTokens?: number;
  /**
   * MCP manifest tools in commands.json format.
   * When USE_AI_SDK=true, these are converted to AI SDK v5 tool definitions
   * via toolAdapter.ts. Ignored on the legacy code paths.
   */
  manifestTools?: ManifestTool[];
}

export type ResolveChatStreamEvent =
  | { type: 'text_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_input_delta'; json: string }
  | { type: 'content_block_stop'; index: number }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'turn_complete'; stop_reason: string }
  | { type: 'error'; message: string };

export type ResolveChatResult =
  | { ok: true; stream: AsyncGenerator<ResolveChatStreamEvent>; backendId: string; circuitBreakerWarning?: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// OpenAI-compatible path (gateway / OpenRouter / GitHub Models)
// ---------------------------------------------------------------------------

/**
 * Stream chat completions from an OpenAI-compatible endpoint.
 * Converts Server-Sent Events in the OpenAI delta format to the internal
 * ResolveChatStreamEvent format.
 */
async function* streamOpenAICompat(
  route: ResolvedRoute,
  messages: ChatMessage[],
  options: ResolveChatOptions
): AsyncGenerator<ResolveChatStreamEvent> {
  const modelId = route.modelId ?? options.model ?? AI_MODELS.gatewayChat;
  const maxTokens = options.maxTokens ?? 4096;

  // Build system message from systemBlocks or systemPrompt
  const systemText = options.systemBlocks
    ? options.systemBlocks.map((b) => b.text).join('\n\n')
    : (options.systemPrompt ?? '');

  const openAIMessages: Array<{ role: string; content: string }> = [];
  if (systemText) {
    openAIMessages.push({ role: 'system', content: systemText });
  }
  for (const msg of messages) {
    openAIMessages.push({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${route.apiKey}`,
  };

  const body = JSON.stringify({
    model: modelId,
    max_tokens: maxTokens,
    messages: openAIMessages,
    stream: true,
  });

  const resp = await fetch(`${route.endpoint}/chat/completions`, {
    method: 'POST',
    headers,
    body,
  });

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
    yield { type: 'error', message: errText };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (!trimmed.startsWith('data: ')) continue;

      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(trimmed.slice('data: '.length)) as Record<string, unknown>;
      } catch {
        continue;
      }

      // Emit usage from the usage field present on the last chunk
      const usage = chunk.usage as Record<string, unknown> | undefined;
      if (usage) {
        if (typeof usage.prompt_tokens === 'number') inputTokens = usage.prompt_tokens;
        if (typeof usage.completion_tokens === 'number') outputTokens = usage.completion_tokens;
      }

      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      if (!choices?.length) continue;

      const choice = choices[0];
      const delta = choice.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      if (typeof delta.content === 'string' && delta.content) {
        yield { type: 'text_delta', text: delta.content };
      }

      const finishReason = choice.finish_reason as string | null | undefined;
      if (finishReason) {
        if (inputTokens !== undefined || outputTokens !== undefined) {
          yield { type: 'usage', inputTokens, outputTokens };
        }
        yield { type: 'turn_complete', stop_reason: finishReason };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Anthropic direct path (uses SDK for streaming + thinking + prompt caching)
// ---------------------------------------------------------------------------

/**
 * Stream chat completions directly through the Anthropic SDK.
 * Preserves all Anthropic-specific features: prompt caching, extended thinking,
 * tool use streaming, and structured content blocks.
 */
async function* streamAnthropicDirect(
  apiKey: string,
  messages: ChatMessage[],
  options: ResolveChatOptions
): AsyncGenerator<ResolveChatStreamEvent> {
  const client = new Anthropic({ apiKey });
  const modelId = options.model ?? AI_MODEL_PRIMARY;
  const maxTokens = options.thinking ? 16384 : (options.maxTokens ?? 4096);

  // Narrow messages to Anthropic format
  const anthropicMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as string | Anthropic.ContentBlockParam[],
    }));

  const systemBlocks: Anthropic.TextBlockParam[] = options.systemBlocks ?? (
    options.systemPrompt
      ? [{ type: 'text' as const, text: options.systemPrompt }]
      : []
  );

  const baseParams = {
    model: modelId,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: anthropicMessages,
    tools: options.tools ?? [],
    stream: true as const,
    ...(options.thinking ? { thinking: { type: 'enabled' as const, budget_tokens: 10000 } } : {}),
  };

  const response = await client.messages.create(baseParams);

  let stopReason: string | null = null;

  for await (const event of response) {
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;
        if (block.type === 'text') {
          yield { type: 'text_start' };
        } else if (block.type === 'tool_use') {
          yield { type: 'tool_start', id: block.id, name: block.name, input: {} };
        } else if (block.type === 'thinking') {
          yield { type: 'thinking_start' };
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text_delta', text: delta.text };
        } else if (delta.type === 'input_json_delta') {
          yield { type: 'tool_input_delta', json: delta.partial_json };
        } else if (delta.type === 'thinking_delta') {
          yield { type: 'thinking_delta', text: delta.thinking };
        }
        break;
      }

      case 'content_block_stop': {
        yield { type: 'content_block_stop', index: event.index };
        break;
      }

      case 'message_delta': {
        if (event.delta && 'stop_reason' in event.delta) {
          stopReason = event.delta.stop_reason as string;
        }
        if (event.usage) {
          yield { type: 'usage', outputTokens: event.usage.output_tokens };
        }
        break;
      }

      case 'message_start': {
        if (event.message?.usage) {
          yield { type: 'usage', inputTokens: event.message.usage.input_tokens };
        }
        break;
      }

      case 'message_stop': {
        yield { type: 'turn_complete', stop_reason: stopReason ?? 'end_turn' };
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Resolve the best available backend and stream a chat completion.
 *
 * Returns a discriminated union so callers can handle the "no backend"
 * case gracefully without catching exceptions.
 */
export async function resolveChat(
  messages: ChatMessage[],
  options: ResolveChatOptions = {}
): Promise<ResolveChatResult> {
  const route = resolveBackendWithCircuitBreaker('chat', options.model);

  if (!route) {
    return {
      ok: false,
      error: 'No chat backend is configured. Set AI_GATEWAY_API_KEY, OPENROUTER_API_KEY, GITHUB_MODELS_PAT, or PLATFORM_ANTHROPIC_KEY.',
    };
  }

  const { circuitBreakerWarning, ...resolvedRoute } = route;

  let stream: AsyncGenerator<ResolveChatStreamEvent>;

  if (USE_AI_SDK) {
    // AI SDK v5 adapter path (feature-flagged — off by default)
    stream = streamViaSdk(resolvedRoute, messages, options, options.manifestTools);
  } else if (resolvedRoute.backendId === 'direct') {
    // Direct path: use Anthropic SDK (preserves thinking, prompt caching, tool streaming)
    stream = streamAnthropicDirect(resolvedRoute.apiKey, messages, options);
  } else {
    // Gateway / OpenRouter / GitHub Models: OpenAI-compatible endpoint
    stream = streamOpenAICompat(resolvedRoute, messages, options);
  }

  return {
    ok: true,
    stream,
    backendId: resolvedRoute.backendId,
    ...(circuitBreakerWarning !== undefined ? { circuitBreakerWarning } : {}),
  };
}

/**
 * Resolve the best available backend and return route info without making a call.
 * Useful for pre-flight checks and observability.
 */
export function resolveChatRoute(model?: string): ResolvedRoute | null {
  return resolveBackend('chat', model);
}
