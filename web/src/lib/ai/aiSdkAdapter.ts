/**
 * aiSdkAdapter — wraps AI SDK v5 `streamText` and yields `ResolveChatStreamEvent` objects.
 *
 * It bridges the AI SDK's streaming format to the existing
 * `ResolveChatStreamEvent` envelope used by `resolveChat.ts` and its callers.
 * The migration is complete: `resolveChat()` calls `streamViaSdk()`
 * unconditionally (`resolveChat.ts:110`) and the hand-rolled streaming
 * functions are gone. There is no `USE_AI_SDK` feature flag — an earlier
 * revision of this comment described one, but nothing has ever read it.
 *
 * Architecture notes:
 * - Uses `gateway()` for vercel-gateway, openrouter, and github-models backends
 * - Uses `anthropic()` for the direct backend (preserves thinking mode + prompt caching)
 * - Tools have no `execute` function — they are forwarded to the client for
 *   execution against the WASM engine (see spec section on client-side tool execution)
 * - `experimental_telemetry: { isEnabled: true }` enables Sentry AI spans via
 *   `vercelAIIntegration()` (Phase 5)
 */

import { streamText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import type { ResolveChatStreamEvent, ChatMessage, ResolveChatOptions } from '@/lib/providers/resolveChat';
import type { ResolvedRoute } from '@/lib/providers/types';
import { convertManifestToolsToSdkTools } from '@/lib/ai/toolAdapter';
import type { ManifestTool } from '@/lib/ai/toolAdapter';
import { AI_MODEL_PRIMARY, AI_MODELS, anthropicThinkingOption } from '@/lib/ai/models';
import { DEFAULT_MAX_TOKENS, THINKING_MAX_TOKENS } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Anthropic model ID mapping for the gateway (provider/model format)
// ---------------------------------------------------------------------------

/**
 * Map a canonical SpawnForge model name to the gateway format string.
 * Gateway uses `provider/model` format (e.g. `anthropic/claude-sonnet-5`).
 *
 * Derives the mapping from AI_MODELS (the single source of truth) rather
 * than maintaining a duplicate local map that can drift out of sync.
 *
 * Matching is EXACT. It used to fall through to `.includes('sonnet')` /
 * `'opus'` / `'haiku'`, which turns a version bump into a silent model swap:
 * once `AI_MODELS.deep` moved to Opus 5, an explicit `claude-opus-4-8` request
 * matched the `opus` substring and came back as `anthropic/claude-opus-5` —
 * a different model than the caller named, with no warning (PF-1216 / #9339).
 * An unrecognised `claude-*` id now keeps its own name under the `anthropic/`
 * prefix, so a wrong id fails loudly at the provider instead of quietly
 * resolving to something else.
 */
function toGatewayModelId(canonicalModel: string): string {
  // Already in gateway format
  if (canonicalModel.includes('/')) return canonicalModel;
  // Map known canonical model IDs to their gateway equivalents via AI_MODELS
  if (canonicalModel === AI_MODELS.chat) return AI_MODELS.gatewayChat;
  // Deliberate, pre-existing behaviour: the fast tier has no separate gateway
  // route here and rides the chat gateway model.
  if (canonicalModel === AI_MODELS.fast) return AI_MODELS.gatewayChat;
  if (canonicalModel === AI_MODELS.deep) return AI_MODELS.gatewayDeep;
  // Fallback: construct gateway ID from canonical name
  return `anthropic/${canonicalModel}`;
}

/**
 * Map a canonical SpawnForge model name to the Anthropic direct provider format.
 * Direct Anthropic uses `claude-*` model IDs without the provider prefix.
 */
function toAnthropicModelId(canonicalModel: string): string {
  if (canonicalModel.includes('/')) {
    // Strip provider prefix if present
    return canonicalModel.split('/').slice(1).join('/');
  }
  return canonicalModel;
}

/**
 * Build the AI SDK model instance for a resolved backend route.
 *
 * Direct routes get `anthropic()` (thinking mode + prompt caching); every
 * other backend goes through `gateway()`. Exported so non-streaming callers —
 * the decomposer's structured-output call, for one — pick the same provider
 * for the same route instead of re-deriving the rule and drifting from it.
 */
export function resolveModelInstance(
  route: ResolvedRoute,
  canonicalModel: string,
): ReturnType<typeof gateway> | ReturnType<typeof anthropic> {
  return route.backendId === 'direct'
    ? anthropic(toAnthropicModelId(canonicalModel))
    : gateway(toGatewayModelId(canonicalModel));
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

/**
 * Convert SpawnForge `ChatMessage[]` to the format required by AI SDK v5's
 * `messages` parameter. System messages are extracted and returned separately
 * as AI SDK handles system via the top-level `system` param.
 *
 * Returns flat user/assistant messages only — system role is stripped.
 */
function convertMessages(
  messages: ChatMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
}

// ---------------------------------------------------------------------------
// Main adapter: streamViaSdk
// ---------------------------------------------------------------------------

/**
 * Stream chat completions via AI SDK v5, yielding `ResolveChatStreamEvent` objects.
 *
 * This is a drop-in replacement for `streamAnthropicDirect` and `streamOpenAICompat`
 * in `resolveChat.ts`. It preserves the exact same event envelope so callers
 * (route handlers, chatStore) need no changes when the feature flag is enabled.
 *
 * @param route - The resolved backend route (from the provider registry)
 * @param messages - Conversation messages in SpawnForge format
 * @param options - Chat options (model, system prompt, tools, thinking, etc.)
 * @param manifestTools - Optional array of manifest tools to convert to SDK format
 */
export async function* streamViaSdk(
  route: ResolvedRoute,
  messages: ChatMessage[],
  options: ResolveChatOptions,
  manifestTools?: ManifestTool[],
): AsyncGenerator<ResolveChatStreamEvent> {
  // Build the system prompt string
  const systemText = options.systemBlocks
    ? options.systemBlocks.map((b) => b.text).join('\n\n')
    : (options.systemPrompt ?? '');

  const canonicalModel = options.model ?? AI_MODEL_PRIMARY;
  const maxTokens = options.thinking ? THINKING_MAX_TOKENS : (options.maxTokens ?? DEFAULT_MAX_TOKENS);

  // Convert tools if provided
  const tools =
    manifestTools && manifestTools.length > 0
      ? convertManifestToolsToSdkTools(manifestTools)
      : undefined;

  // Select model provider based on resolved backend. Direct Anthropic
  // preserves thinking mode and prompt caching; everything else (gateway,
  // OpenRouter, GitHub Models) goes through the AI Gateway provider.
  const modelInstance = resolveModelInstance(route, canonicalModel);

  // Model-gated thinking shape — see `models.ts`. `undefined` means this model
  // has no known thinking shape, so the field is omitted rather than sent in a
  // form the API rejects (PF-1216 / #9339).
  const thinkingOption =
    route.backendId === 'direct' && options.thinking
      ? anthropicThinkingOption(canonicalModel)
      : undefined;

  try {
    let toolIndex = 0;
    const result = streamText({
      model: modelInstance,
      system: systemText || undefined,
      messages: convertMessages(messages),
      maxOutputTokens: maxTokens,
      tools,
      experimental_telemetry: { isEnabled: true },
      ...(thinkingOption
        ? { providerOptions: { anthropic: { thinking: thinkingOption } } }
        : {}),
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-start':
          yield { type: 'text_start' };
          break;

        case 'text-delta':
          yield { type: 'text_delta', text: part.text };
          break;

        case 'reasoning-start':
          yield { type: 'thinking_start' };
          break;

        case 'reasoning-delta':
          yield { type: 'thinking_delta', text: part.text };
          break;

        case 'tool-input-start':
          yield {
            type: 'tool_start',
            id: part.id,
            name: part.toolName,
            input: {},
          };
          break;

        case 'tool-input-delta':
          yield { type: 'tool_input_delta', json: part.delta };
          break;

        case 'tool-input-end':
          yield { type: 'content_block_stop', index: toolIndex++ };
          break;

        case 'finish-step': {
          const usage = part.usage;
          if (usage) {
            yield {
              type: 'usage',
              inputTokens: usage.inputTokens ?? undefined,
              outputTokens: usage.outputTokens ?? undefined,
            };
          }
          break;
        }

        case 'finish': {
          // Map AI SDK finish reasons to Anthropic-compatible stop reasons
          const stopReason = part.finishReason === 'tool-calls'
            ? 'tool_use'
            : part.finishReason === 'stop'
              ? 'end_turn'
              : part.finishReason;
          yield { type: 'turn_complete', stop_reason: stopReason };
          break;
        }

        case 'error':
          yield {
            type: 'error',
            message:
              part.error instanceof Error
                ? part.error.message
                : String(part.error),
          };
          break;

        // Ignore other part types (source, file, start, start-step, abort, raw, etc.)
        default:
          break;
      }
    }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
