/**
 * SpawnForge AI Agent — reusable ToolLoopAgent for the game engine.
 *
 * Defines the agent once with model, instructions, and tools. Used by:
 * - POST /api/chat (streaming chat with tool calling)
 * - Future: MCP server endpoints, webhook triggers, background jobs
 *
 * The agent has NO execute functions on tools — tool calls are forwarded
 * to the client for execution against the WASM engine.
 */

import { ToolLoopAgent, stepCountIs } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { convertManifestToolsToSdkTools } from '@/lib/ai/toolAdapter';
import { AI_MODEL_PRIMARY, AI_MODELS } from '@/lib/ai/models';
import { resolveChatRoute } from '@/lib/providers/resolveChat';
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

// Cached tools — computed once at module load
const AGENT_TOOLS = getAgentTools();

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

/**
 * Create a SpawnForge agent configured for a specific model backend.
 *
 * We create per-request because the model instance depends on whether
 * the user is on the direct Anthropic path (BYOK) or the gateway path.
 * The tools and step limit are shared across all instances.
 */
export function createSpawnforgeAgent(options: {
  model: string;
  instructions: string;
  thinking?: boolean;
  maxSteps?: number;
}) {
  const { model, instructions, thinking, maxSteps = 10 } = options;

  // Resolve model instance based on backend
  const chatRoute = resolveChatRoute(model);
  const isDirectBackend = !chatRoute || chatRoute.backendId === 'direct';
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

/**
 * Whether the resolved model uses the direct Anthropic backend (for billing decisions).
 */
export function isDirectBackend(model: string): boolean {
  const chatRoute = resolveChatRoute(model);
  return !chatRoute || chatRoute.backendId === 'direct';
}
