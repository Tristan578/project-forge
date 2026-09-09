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
import {
  AI_MODEL_PRIMARY,
  AI_MODELS,
  anthropicThinkingOption,
  gatewayFallbackModels,
  supportsEffort,
  type AnthropicThinkingOption,
} from '@/lib/ai/models';
import { buildAnthropicCacheControl, type CacheTtlTier } from '@/lib/ai/cachedContext';
import { isCommandAvailable } from '@/lib/config/providers';
import manifestJson from '@/data/commands.json';

// ---------------------------------------------------------------------------
// Manifest → AI SDK tools (cached at module level)
// ---------------------------------------------------------------------------

interface ManifestEntry extends ManifestTool {
  category: string;
  tokenCost: number;
  requiredScope: string;
  /**
   * Whether undoing this command would make the user re-AUTHOR content, rather
   * than re-issue the inverse command with the same arguments. Three families
   * are `true`:
   *
   *   1. it deletes or overwrites authored content — an entity, scene, prefab,
   *      cutscene, dialogue tree, tilemap layer (or the tiles painted into one,
   *      including a resize that discards what falls outside the new bounds),
   *      UI screen or widget, library asset, animation clip, or script source;
   *   2. it wholesale replaces the current scene — `new_scene`, `load_scene`,
   *      `switch_scene`, `load_template`, and the `*_from_description` /
   *      `start_from_idea` scaffolders;
   *   3. it has an irreversible effect outside the editor session —
   *      `publish_game`, `delete_leaderboard`, `delete_asset`.
   *
   * Detaching a COMPONENT from an entity is `false`: re-attaching it is a
   * single command carrying the same parameters. That is the line
   * `remove_physics2d` (false) and `remove_script` (true) sit either side of.
   *
   * Mandatory on every command — an absent flag used to be indistinguishable
   * from a deliberate `false`, which is how `remove_script` shipped ungated.
   * `mcp-server/src/manifest.test.ts` enforces both the explicit boolean and a
   * naming RULE that fails when a new `delete_*`/`remove_*` command is neither
   * flagged nor exempted with a reason.
   */
  destructive: boolean;
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
  // #9117: a command whose capability is declared unavailable is withheld from
  // the model entirely (static config, so it belongs in this static filter).
  // `lib/chat/tools.getChatTools()` applies the same predicate.
  return (
    (cmd.requiredScope.endsWith(':write') || cmd.category === 'query') &&
    isCommandAvailable(cmd.name)
  );
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
 * `blockedToolCallIds`, so the tool is never executed server-side and the loop
 * does not advance until the user answers.
 *
 * What it does NOT do — verified against `ai@7.0.84` and pinned by
 * `toolApprovalResume.integration.test.ts`: the gated call's
 * `tool-input-available` chunk IS still emitted, immediately before the
 * `tool-approval-request`. The stream therefore hands the browser everything it
 * needs to run a destructive tool on its own. The security-load-bearing check
 * is the CLIENT-side one in `chatStore.drainBufferedToolInputs()`, which
 * withholds every buffered input until a terminal `finish` chunk arrives and
 * refuses outright to execute a `DESTRUCTIVE_COMMANDS` member that carries no
 * approvalId. This map is what makes the server stop calling the model; that
 * drain is what stops the tool running.
 *
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
// Approval signing key
// ---------------------------------------------------------------------------

/**
 * HMAC key the SDK uses to sign and verify tool approvals.
 *
 * Must be STABLE across instances: the approval is signed by whichever
 * serverless instance streamed the turn and verified by whichever instance
 * handles the resume. A per-process random value would therefore fail every
 * cross-instance resume, so there is deliberately no random fallback.
 *
 * `TOOL_APPROVAL_SECRET` is the dedicated variable. Absent it, the key is
 * derived from `CLERK_SECRET_KEY` (required in every deployed environment —
 * see the root CLAUDE.md) with a domain-separating prefix, so the gate is
 * signed by default rather than only where someone remembered to add a
 * variable. HMAC never exposes its key material, and the value is never sent
 * to the client — only the 32-byte digest is.
 *
 * Returns undefined only in a bare local/test environment with neither
 * variable set; the agent then omits the option and behaves as before, which
 * is why the client-side destructive check is the load-bearing one.
 */
export function resolveToolApprovalSecret(): string | undefined {
  const explicit = process.env.TOOL_APPROVAL_SECRET?.trim();
  if (explicit) return explicit;

  const derived = process.env.CLERK_SECRET_KEY?.trim();
  if (derived) return `spawnforge-tool-approval-v1:${derived}`;

  return undefined;
}

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
  /**
   * Enable Claude thinking mode (direct backend only).
   *
   * The request SHAPE is chosen per model by `anthropicThinkingOption()` —
   * adaptive for Claude 4.6+/5, the legacy hard budget for Haiku 4.5, and
   * omitted entirely for a model with no known shape. Passing `true` for a
   * model with no supported shape is a no-op, never a 400.
   */
  thinking?: boolean;
  /**
   * Reasoning effort hint (direct Anthropic backend only). Replaces hand-tuned
   * `thinking.budgetTokens` for callers that want the SDK to manage the budget.
   * Independent of `thinking`; both can be set, though setting `effort` alone is
   * preferred for non-chat generators. Dropped for models that do not accept it
   * (`supportsEffort()`) rather than forwarded into a 400.
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

  const toolApprovalSecret = resolveToolApprovalSecret();

  const canonicalModel = model || AI_MODEL_PRIMARY;

  const gatewayModelId = canonicalModel.includes('/') ? canonicalModel : AI_MODELS.gatewayChat;
  const modelInstance = isDirectBackend ? anthropic(canonicalModel) : gateway(gatewayModelId);

  // Provider options for thinking + effort (Anthropic direct only). Both fields
  // are independent in the Anthropic provider schema. Gateway routes ignore
  // these fields, so we only emit them on the direct backend.
  //
  // BOTH are model-gated, not backend-gated (PF-1216 / #9339). Emitting one
  // literal for every Claude is what produced the HTTP 400s this migration
  // fixes: Claude 4.7+ rejects `{ type: 'enabled' }` and Haiku 4.5 rejects both
  // `{ type: 'adaptive' }` and `effort`. `models.ts` owns the per-model
  // decision so there is exactly one table to update for a new model.
  const anthropicOptions: {
    thinking?: AnthropicThinkingOption;
    effort?: 'low' | 'medium' | 'high';
  } = {};
  if (isDirectBackend) {
    if (thinking) {
      const thinkingOption = anthropicThinkingOption(canonicalModel);
      if (thinkingOption) {
        anthropicOptions.thinking = thinkingOption;
      }
    }
    if (effort && supportsEffort(canonicalModel)) {
      anthropicOptions.effort = effort;
    }
  }
  // Provider options for AI Gateway request tagging (gateway backend only;
  // PF-969 / #8954). `user`/`tags` are Gateway-dashboard reporting fields —
  // they identify who/what a request belongs to for cost breakdowns, never
  // affect model selection or output. Anthropic direct calls bypass the
  // Gateway entirely, so these fields have no effect there and are omitted.
  //
  // `models` (ordered fallback list) and `caching: 'auto'` (#9631) are Gateway
  // routing fields: a provider outage becomes a degraded-model answer instead
  // of a 500, and repeated prefixes are cached where the provider supports it.
  // Both are validated server-side; the Gateway ignores what it does not know.
  const gatewayOptions: { user?: string; tags?: string[]; models?: string[]; caching?: 'auto' } = {};
  if (!isDirectBackend) {
    if (userId) {
      gatewayOptions.user = userId;
    }
    if (tags && tags.length > 0) {
      gatewayOptions.tags = tags;
    }
    const fallbacks = gatewayFallbackModels(gatewayModelId);
    if (fallbacks.length > 0) {
      gatewayOptions.models = fallbacks;
    }
    gatewayOptions.caching = 'auto';
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
    // Server-side gate on which destructive calls the model may proceed past
    // (PF-8860). It stops the step loop; it does NOT stop the browser running
    // the tool — see the note on AGENT_TOOL_APPROVAL for where that happens.
    toolApproval: AGENT_TOOL_APPROVAL,
    // Binds each approval to the exact (approvalId, toolCallId, toolName,
    // canonical-hashed input) the server issued, via HMAC-SHA256. The resume
    // history is reconstructed by the browser, so without this a client could
    // widen the arguments after the user approved a narrow call — approve
    // `delete_entities({ids:["a"]})`, resume with `{ids:["a","b","c"]}`. The
    // signature round-trips: the SDK emits it on the `tool-approval-request` UI
    // chunk, `chatStore` records it, `appendToolTurn` puts it back on the
    // assistant part, and `validateApprovedToolApprovals` verifies it here.
    // When the secret is set a missing or altered signature is a hard throw
    // (`InvalidToolApprovalSignatureError`), which `/api/chat`'s `onError`
    // surfaces — the failure mode is fail-CLOSED.
    ...(toolApprovalSecret ? { experimental_toolApprovalSecret: toolApprovalSecret } : {}),
    stopWhen: stepCountIs(maxSteps),
    ...(hasProviderOptions ? { providerOptions } : {}),
    experimental_telemetry: { isEnabled: true },
  });
}
