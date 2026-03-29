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
 * All paths are routed through the AI SDK v5 adapter (streamViaSdk) which
 * handles provider selection, prompt caching, thinking mode, and tool streaming.
 *
 * Usage:
 *   const result = await resolveChat(messages, { model, thinking, systemBlocks });
 *   if (!result.ok) throw new Error(result.error);
 *   for await (const event of result.stream) { ... }
 */

import type { ResolvedRoute } from './types';
import { resolveBackend, resolveBackendWithCircuitBreaker } from './registry';
import { streamViaSdk } from '@/lib/ai/aiSdkAdapter';
import type { ManifestTool } from '@/lib/ai/toolAdapter';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single Anthropic-style content block carried in a message.
 * Typed inline to avoid importing @anthropic-ai/sdk in this module —
 * the AI SDK adapter handles the actual Anthropic types internally.
 */
export type AnthropicContentBlock = Record<string, unknown>;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | AnthropicContentBlock[];
}

/**
 * Minimal representation of an Anthropic text block used for system prompts.
 * Typed inline so resolveChat.ts has no dependency on @anthropic-ai/sdk.
 */
export interface SystemTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: string };
}

export interface ResolveChatOptions {
  /** Canonical model name (e.g. 'claude-sonnet-4-6') */
  model?: string;
  /** Anthropic structured system prompt blocks (supports cache_control) */
  systemBlocks?: SystemTextBlock[];
  /** Plain text system prompt — used when systemBlocks is not provided */
  systemPrompt?: string;
  /** Enable extended thinking (Anthropic-only) */
  thinking?: boolean;
  /** Max output tokens */
  maxTokens?: number;
  /**
   * MCP manifest tools in commands.json format.
   * Converted to AI SDK v5 tool definitions via toolAdapter.ts.
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
      error: 'No chat backend is configured. Set AI_GATEWAY_API_KEY, OPENROUTER_API_KEY, GITHUB_MODELS_PAT, or ANTHROPIC_API_KEY.',
    };
  }

  const { circuitBreakerWarning, ...resolvedRoute } = route;

  const stream = streamViaSdk(resolvedRoute, messages, options, options.manifestTools);

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
