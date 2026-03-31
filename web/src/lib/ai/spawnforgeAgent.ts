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

import { ToolLoopAgent, stepCountIs } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { convertManifestToolsToSdkTools } from '@/lib/ai/toolAdapter';
import { AI_MODEL_PRIMARY, AI_MODELS } from '@/lib/ai/models';
import manifestJson from '@/data/commands.json';

// ---------------------------------------------------------------------------
// Manifest → AI SDK tools (cached at module level)
// ---------------------------------------------------------------------------

interface ManifestCommand {
  name: string;
  description: string;
  category: string;
  parameters: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  tokenCost: number;
  requiredScope: string;
}

const manifest = manifestJson as { version: string; commands: ManifestCommand[] };

/**
 * Build AI SDK tool definitions from the MCP command manifest.
 * Includes write-scoped commands and query commands — read-only commands
 * are excluded to reduce tool count and prevent the model from calling
 * informational endpoints when it should be acting.
 */
function getAgentTools() {
  const writeTools = manifest.commands
    .filter((cmd) => cmd.requiredScope.endsWith(':write') || cmd.category === 'query')
    .map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      parameters: {
        type: cmd.parameters.type || 'object',
        properties: cmd.parameters.properties || {},
        required: cmd.parameters.required || [],
      },
    }));

  return convertManifestToolsToSdkTools(writeTools);
}

// Cached tools — computed once at module load. Safe for serverless because
// the manifest is a static JSON import (no I/O, deterministic).
const AGENT_TOOLS = getAgentTools();

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

export interface SpawnforgeAgentOptions {
  /** Whether the model backend is direct Anthropic (true) or gateway (false). */
  isDirectBackend: boolean;
  /** Model ID — bare name for direct, provider/model for gateway. */
  model: string;
  /** System instructions. Caller must sanitize before passing. */
  instructions: string;
  /** Enable Claude thinking mode (direct backend only). */
  thinking?: boolean;
  /** Maximum tool-calling steps before stopping. Default: 10. */
  maxSteps?: number;
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
    instructions,
    tools: AGENT_TOOLS,
    stopWhen: stepCountIs(maxSteps),
    ...(providerOptions ? { providerOptions } : {}),
    experimental_telemetry: { isEnabled: true },
  });
}
