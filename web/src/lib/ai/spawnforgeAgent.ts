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
import { modelToolSchema } from '@/lib/ai/modelToolSchema';
import { AI_MODEL_PRIMARY, AI_MODELS } from '@/lib/ai/models';
import { buildAnthropicCacheControl, type CacheTtlTier } from '@/lib/ai/cachedContext';
import manifestJson from '@/data/commands.json';

// ---------------------------------------------------------------------------
// Manifest → AI SDK tools (cached at module level)
// ---------------------------------------------------------------------------

interface ManifestEntry extends ManifestTool {
  category: string;
  tokenCost: number;
  requiredScope: string;
  /**
   * True when the command destroys or wholesale-replaces content the user
   * already has, or has an irreversible effect outside the editor session.
   * Absent (not `false`) on the ~92% of commands that are ordinary edits.
   * Drives the agent's `toolApproval` map — see `getAgentToolApproval()`.
   */
  destructive?: boolean;
}

const manifest = manifestJson as { version: string; commands: ManifestEntry[] };

/**
 * The predicate that decides which manifest commands the agent advertises.
 *
 * Extracted so `getAgentTools()` and `getAgentToolApproval()` cannot drift:
 * an approval map with a key the tool set does not contain is dead config,
 * and a tool the map does not cover falls through the gate silently.
 */
function isAgentAdvertised(cmd: ManifestEntry): boolean {
  return cmd.requiredScope.endsWith(':write') || cmd.category === 'query';
}

/**
 * Build AI SDK tool definitions from the MCP command manifest.
 *
 * Filter policy: includes `:write`-scoped commands and `query`-category commands.
 * Read-only informational commands are excluded to reduce tool count (274 of 350)
 * and prevent the model from calling informational endpoints when it should be acting.
 *
 * Schemas go through `modelToolSchema`, which withholds the manifest parameters
 * that are meaningful only to a direct-to-engine MCP client. This is the surface
 * the chat route actually reaches — `lib/chat/tools.getChatTools()` shares the
 * same filter, and filtering only there would leave those parameters on offer here.
 *
 * IMPORTANT: This function runs once at module load and the result is cached in
 * AGENT_TOOLS. It must NEVER contain per-user or per-request logic (e.g. tier-based
 * tool gating). If per-user filtering is needed in the future, move the call inside
 * createSpawnforgeAgent() and pass user context as a parameter.
 */
function getAgentTools() {
  const writeTools = manifest.commands
    .filter(isAgentAdvertised)
    .map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      parameters: modelToolSchema(cmd.name, cmd.parameters),
    }));

  return convertManifestToolsToSdkTools(writeTools);
}

/**
 * The tool set the agent advertises. Computed once at module load — safe for
 * serverless because the manifest is a static JSON import (no I/O, deterministic).
 *
 * Exported so the withheld-parameter guarantee is assertable against the surface
 * the chat route really uses, rather than against a helper it does not call.
 */
export const AGENT_TOOLS = getAgentTools();

/**
 * Per-tool approval statuses handed to the SDK as `toolApproval` (PF-8860).
 *
 * `'user-approval'` makes the SDK stop the step loop for that call, emit a
 * `tool-approval-request` UI chunk and add the toolCallId to
 * `blockedToolCallIds` — no `tool-input-available` follows, so a destructive
 * call cannot reach the client executor at all until the user answers.
 * `'not-applicable'` is the SDK's "no gate" status and leaves a call on
 * exactly today's path.
 *
 * Derived from the manifest's `destructive` flag rather than from
 * `requiredScope`: `:write` covers 260 of 351 commands, so scope-gating would
 * put an approval prompt in front of every `spawn_entity` in a normal
 * "build me a platformer" turn. A gate that fires on 95% of ordinary edits is
 * a gate users turn off.
 *
 * Keys are restricted to `isAgentAdvertised()` — the same predicate
 * `getAgentTools()` uses — so the map can never name a tool the agent does not
 * offer, and every offered tool has an explicit status.
 */
function getAgentToolApproval(): Record<string, 'user-approval' | 'not-applicable'> {
  const approval: Record<string, 'user-approval' | 'not-applicable'> = {};
  for (const cmd of manifest.commands) {
    if (!isAgentAdvertised(cmd)) continue;
    approval[cmd.name] = cmd.destructive === true ? 'user-approval' : 'not-applicable';
  }
  return approval;
}

/**
 * The approval map the agent is constructed with. Cached at module load for
 * the same reason as AGENT_TOOLS — static JSON, no per-request input.
 *
 * Exported so a test can assert the map against the tool set it must mirror.
 */
export const AGENT_TOOL_APPROVAL = getAgentToolApproval();

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
  tier?: CacheTtlTier;
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
  /**
   * Reasoning effort hint (direct Anthropic backend only). Replaces hand-tuned
   * `thinking.budgetTokens` for callers that want the SDK to manage the budget.
   * Independent of `thinking`; both can be set, though setting `effort` alone is
   * preferred for non-chat generators.
   */
  effort?: 'low' | 'medium' | 'high';
  /** Maximum tool-calling steps before stopping. Default: 10. */
  maxSteps?: number;
  /**
   * End-user identifier for AI Gateway spend tracking/attribution (gateway
   * backend only; PF-969 / #8954). Maps to `providerOptions.gateway.user`.
   * Purely observability — never influences routing or output. Omit for
   * anonymous/unauthenticated callers.
   */
  userId?: string;
  /**
   * Request tags for AI Gateway cost-reporting/filtering (gateway backend
   * only; PF-969 / #8954). Maps to `providerOptions.gateway.tags`. Purely
   * observability — never influences routing or output.
   */
  tags?: string[];
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
  const { isDirectBackend, model, instructions, thinking, effort, maxSteps = 10, userId, tags } = options;

  const canonicalModel = model || AI_MODEL_PRIMARY;

  const modelInstance = isDirectBackend
    ? anthropic(canonicalModel)
    : gateway(
        canonicalModel.includes('/') ? canonicalModel : AI_MODELS.gatewayChat,
      );

  // Provider options for thinking + effort (Anthropic direct only). Both fields
  // are independent in the Anthropic provider schema — thinking sets a hard token
  // budget, effort lets the SDK pick a sensible default. Gateway routes ignore
  // these fields, so we only emit them on the direct backend.
  const anthropicOptions: { thinking?: { type: 'enabled'; budgetTokens: number }; effort?: 'low' | 'medium' | 'high' } = {};
  if (isDirectBackend) {
    if (thinking) {
      anthropicOptions.thinking = { type: 'enabled', budgetTokens: 10000 };
    }
    if (effort) {
      anthropicOptions.effort = effort;
    }
  }
  // Provider options for AI Gateway request tagging (gateway backend only;
  // PF-969 / #8954). `user`/`tags` are Gateway-dashboard reporting fields —
  // they identify who/what a request belongs to for cost breakdowns, never
  // affect model selection or output. Anthropic direct calls bypass the
  // Gateway entirely, so these fields have no effect there and are omitted.
  const gatewayOptions: { user?: string; tags?: string[] } = {};
  if (!isDirectBackend) {
    if (userId) {
      gatewayOptions.user = userId;
    }
    if (tags && tags.length > 0) {
      gatewayOptions.tags = tags;
    }
  }

  const providerOptions = {
    ...(Object.keys(anthropicOptions).length > 0 ? { anthropic: anthropicOptions } : {}),
    ...(Object.keys(gatewayOptions).length > 0 ? { gateway: gatewayOptions } : {}),
  };
  const hasProviderOptions = Object.keys(providerOptions).length > 0;

  return new ToolLoopAgent({
    id: 'spawnforge',
    model: modelInstance,
    instructions: buildAgentInstructions(instructions, isDirectBackend),
    tools: AGENT_TOOLS,
    // Server-side gate on destructive calls (PF-8860). This is the only place
    // the gate is enforced — the client-side `approvalMode` toggle in
    // chatStore is a user convenience that never talks back to the model.
    //
    // `experimental_toolApprovalSecret` is deliberately NOT set. Setting it
    // makes a missing/incorrect `signature` on the resumed approval-request a
    // hard throw, and our resume history is reconstructed by the browser, so
    // enabling it requires echoing the signature through the whole client
    // resume path. Without it, the approval is not cryptographically bound to
    // the arguments the user saw — acceptable here only because the browser
    // executes every tool anyway (the client is the user), and because the SDK
    // still rejects an `approvalId` it never issued. Revisit if tools ever
    // gain server-side `execute` functions.
    toolApproval: AGENT_TOOL_APPROVAL,
    stopWhen: stepCountIs(maxSteps),
    ...(hasProviderOptions ? { providerOptions } : {}),
    experimental_telemetry: { isEnabled: true },
  });
}
