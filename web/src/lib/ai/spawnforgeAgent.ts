/**
 * SpawnForge AI Agent — reusable ToolLoopAgent for the game engine.
 *
 * Defines the agent once with model, instructions, and tools. Used by:
 * - POST /api/chat (streaming chat with tool calling)
 * - Future: MCP server endpoints, webhook triggers, background jobs
 *
 * The agent has NO execute functions on tools — tool calls are forwarded
 * to the client for execution against the WASM engine.
 *
 * Callers are responsible for:
 * - Resolving the model backend (direct vs gateway) via resolveChatRoute()
 * - Sanitizing `instructions` (the agent trusts its input)
 * - Handling billing, auth, and rate limiting
 */

import { ToolLoopAgent, stepCountIs, type SystemModelMessage } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { convertManifestToolsToSdkTools, type ManifestTool } from '@/lib/ai/toolAdapter';
import { AI_MODEL_PRIMARY, AI_MODELS } from '@/lib/ai/models';
import { buildAnthropicCacheControl, type CacheTier } from '@/lib/ai/cachedContext';
import manifestJson from '@/data/commands.json';

// ---------------------------------------------------------------------------
// Manifest → AI SDK tools (cached at module level)
// ---------------------------------------------------------------------------

interface ManifestEntry extends ManifestTool {
  category: string;
  tokenCost: number;
  requiredScope: string;
}

const manifest = manifestJson as { version: string; commands: ManifestEntry[] };

/**
 * Build AI SDK tool definitions from the MCP command manifest.
 *
 * Filter policy: includes `:write`-scoped commands and `query`-category commands.
 * Read-only informational commands are excluded to reduce tool count (274 of 350)
 * and prevent the model from calling informational endpoints when it should be acting.
 *
 * IMPORTANT: This function runs once at module load and the result is cached in
 * AGENT_TOOLS. It must NEVER contain per-user or per-request logic (e.g. tier-based
 * tool gating). If per-user filtering is needed in the future, move the call inside
 * createSpawnforgeAgent() and pass user context as a parameter.
 */
function getAgentTools() {
  const writeTools = manifest.commands
    .filter((cmd) => cmd.requiredScope.endsWith(':write') || cmd.category === 'query')
    .map((cmd) => {
      const params = cmd.parameters;
      const isObject = params && !Array.isArray(params) && typeof params === 'object';
      return {
        name: cmd.name,
        description: cmd.description,
        parameters: {
          type: (isObject ? params.type : undefined) || 'object',
          properties: (isObject ? params.properties : undefined) || {},
          required: (isObject ? params.required : undefined) || [],
        },
      };
    });

  return convertManifestToolsToSdkTools(writeTools);
}

// Cached tools — computed once at module load. Safe for serverless because
// the manifest is a static JSON import (no I/O, deterministic).
const AGENT_TOOLS = getAgentTools();

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

/**
 * Structured instruction block. When `tier` is set on the direct Anthropic
 * backend, the block is sent as a separate SystemModelMessage with a
 * provider-specific `cacheControl` marker so Anthropic caches the prefix.
 *
 * The gateway path joins blocks back into a plain string — provider-side
 * caching there is best-effort and not exposed by the AI Gateway today.
 */
export interface InstructionBlock {
  text: string;
  tier?: CacheTier;
}

export interface SpawnforgeAgentOptions {
  /** Whether the model backend is direct Anthropic (true) or gateway (false). */
  isDirectBackend: boolean;
  /** Model ID — bare name for direct, provider/model for gateway. */
  model: string;
  /**
   * System instructions. Pass a string for the simple case, or an
   * `InstructionBlock[]` to mark prefixes for Anthropic prompt caching.
   * Caller must sanitize text before passing.
   */
  instructions: string | InstructionBlock[];
  /** Enable Claude thinking mode (direct backend only). */
  thinking?: boolean;
  /** Maximum tool-calling steps before stopping. Default: 10. */
  maxSteps?: number;
}

/**
 * Convert structured instruction blocks to the AI SDK's `instructions`
 * argument. On the direct Anthropic backend each tier-tagged block becomes a
 * separate `SystemModelMessage` carrying `providerOptions.anthropic.cacheControl`,
 * so Anthropic can cache the prefix. On non-direct backends we collapse blocks
 * back into one string — the AI Gateway does not currently surface tier-aware
 * cache controls.
 */
export function buildAgentInstructions(
  instructions: string | InstructionBlock[],
  isDirectBackend: boolean,
): string | SystemModelMessage[] {
  if (typeof instructions === 'string') return instructions;

  const blocks = instructions.filter((b) => b.text.length > 0);
  if (blocks.length === 0) return '';
  if (!isDirectBackend) return blocks.map((b) => b.text).join('\n\n');

  return blocks.map((b) => ({
    role: 'system' as const,
    content: b.text,
    ...(b.tier ? { providerOptions: buildAnthropicCacheControl(b.tier) } : {}),
  }));
}

/**
 * Create a SpawnForge agent configured for a specific model backend.
 *
 * Created per-request because the model instance depends on the user's
 * backend (BYOK direct vs gateway). Tools and step limit are shared.
 */
export function createSpawnforgeAgent(options: SpawnforgeAgentOptions) {
  const { isDirectBackend, model, instructions, thinking, maxSteps = 10 } = options;

  const canonicalModel = model || AI_MODEL_PRIMARY;

  const modelInstance = isDirectBackend
    ? anthropic(canonicalModel)
    : gateway(
        canonicalModel.includes('/') ? canonicalModel : AI_MODELS.gatewayChat,
      );

  // Provider options for thinking mode (Anthropic direct only)
  const providerOptions =
    thinking && isDirectBackend
      ? { anthropic: { thinking: { type: 'enabled' as const, budgetTokens: 10000 } } }
      : undefined;

  return new ToolLoopAgent({
    id: 'spawnforge',
    model: modelInstance,
    instructions: buildAgentInstructions(instructions, isDirectBackend),
    tools: AGENT_TOOLS,
    stopWhen: stepCountIs(maxSteps),
    ...(providerOptions ? { providerOptions } : {}),
    experimental_telemetry: { isEnabled: true },
  });
}
