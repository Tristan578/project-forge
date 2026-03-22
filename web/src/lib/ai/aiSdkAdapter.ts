/**
 * aiSdkAdapter — wraps AI SDK v5 `streamText` and yields `ResolveChatStreamEvent` objects.
 *
 * This is the Phase 1 adapter. It bridges the AI SDK's streaming format to the
 * existing `ResolveChatStreamEvent` envelope used by `resolveChat.ts` and its
 * callers. When the `USE_AI_SDK` feature flag is enabled, `resolveChat()` calls
 * `streamViaSdk()` instead of the hand-rolled streaming functions.
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
import { AI_MODEL_PRIMARY, AI_MODELS } from '@/lib/ai/models';

// ---------------------------------------------------------------------------
// Anthropic model ID mapping for the gateway (provider/model format)
// ---------------------------------------------------------------------------

/**
 * Map a canonical SpawnForge model name to the gateway format string.
 * Gateway uses `provider/model` format (e.g. `anthropic/claude-sonnet-4-6`).
 *
 * Derives the mapping from AI_MODELS (the single source of truth) rather
 * than maintaining a duplicate local map that can drift out of sync.
 */
function toGatewayModelId(canonicalModel: string): string {
  // Already in gateway format
  if (canonicalModel.includes('/')) return canonicalModel;
  // Map known canonical model IDs to their gateway equivalents via AI_MODELS
  if (canonicalModel === AI_MODELS.chat || canonicalModel.includes('sonnet')) {
    return AI_MODELS.gatewayChat;
  }
  if (canonicalModel === AI_MODELS.fast || canonicalModel.includes('haiku')) {
    return AI_MODELS.gatewayChat; // haiku routes to chat gateway by default
  }
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
  const maxTokens = options.thinking ? 16384 : (options.maxTokens ?? 4096);

  // Convert tools if provided
  const tools =
    manifestTools && manifestTools.length > 0
      ? convertManifestToolsToSdkTools(manifestTools)
      : undefined;

  // Select model provider based on resolved backend
  let modelInstance: ReturnType<typeof gateway> | ReturnType<typeof anthropic>;

  if (route.backendId === 'direct') {
    // Direct Anthropic path: preserves thinking mode and prompt caching
    modelInstance = anthropic(toAnthropicModelId(canonicalModel));
  } else {
    // Gateway / OpenRouter / GitHub Models: use AI Gateway provider
    modelInstance = gateway(toGatewayModelId(canonicalModel));
  }

  try {
    const result = streamText({
      model: modelInstance,
      system: systemText || undefined,
      messages: convertMessages(messages),
      maxOutputTokens: maxTokens,
      tools,
      experimental_telemetry: { isEnabled: true },
      ...(route.backendId === 'direct' && options.thinking
        ? {
            providerOptions: {
              anthropic: {
                thinking: { type: 'enabled', budgetTokens: 10000 },
              },
            },
          }
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
          yield { type: 'content_block_stop', index: 0 };
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
