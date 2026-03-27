# Game Creation Orchestrator -- Phase 2A Spec (v4)

> **Status:** DRAFT -- Awaiting Approval
> **Date:** 2026-03-25
> **Revision:** v4 (fixes 8 remaining issues from v3 review)
> **Ticket:** TBD

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2026-03-25 | Initial draft |
| v2 | 2026-03-25 | Complete rewrite addressing 10 blockers, 6 security, 5 UX, 4 DX findings |
| v3 | 2026-03-25 | Fixes 12 issues from antagonistic v2 review (NB1-NB5, NS1-NS3, NU1-NU2, ND1-ND2) |
| v4 | 2026-03-25 | Fixes 8 remaining issues (V4-1 through V4-8): off-by-one, type name, sanitization gaps, fallback safety, resolveStepOutput lookup, file count |

### v4 Changes Summary

| Fix ID | Severity | What Changed |
|--------|----------|-------------|
| V4-1 | Blocker | `stepCounter` starts at `-1` so `++stepCounter` produces `step_0` as first ID; `gate_plan.afterStepId = 'step_0'` now valid |
| V4-2 | Blocker | `EditorStore` renamed to `EditorState` throughout (matches actual export from `web/src/stores/editorStore.ts`) |
| V4-3 | Security | `targetEntityId` sanitized via `sanitizePrompt()` before interpolation into LLM prompt |
| V4-4 | Security | `system.type` sanitized via `sanitizePrompt()` before interpolation into LLM prompt; `category` input schema changed from `z.string()` to `zSystemCategory` enum for type consistency |
| V4-5 | Security | Unsafe `mood` falls back to `'neutral'` (not raw string); unsafe `referenceGames` entries are dropped entirely (not truncated to raw substring) |
| V4-6 | Blocker | `gate_assets` skipped entirely when `allEntityStepIds` is empty (no entities = no assets to approve) |
| V4-7 | Blocker | `resolveStepOutput()` accepts step ID OR executor name; falls back to `s.executor === name` lookup when input lacks `step_` prefix |
| V4-8 | DX | Summary table corrected: "20 lib files, 12 fixtures, 8 test files = 40 total" (v3 summary table said 21/41 but v3 body said 20/40) |

### v3 Changes Summary (retained for history)

| Fix ID | Severity | What Changed |
|--------|----------|-------------|
| NB1 | Blocker | `update_script` replaced with `set_script`; correct payload; removed `language` field |
| NB2 | Blocker | Approval gate trigger uses `onStepComplete(completedStepId)` callback, not `dependsOn[0]` |
| NB3 | Blocker | `constraints` sanitization checks `.safe` before using `.filtered`; rejects unsafe |
| NB4 | Blocker | `set_ambient_light` replaced with `update_ambient_light`; correct payload `{ color, brightness }` |
| NB5 | Blocker | Removed `TIER_MONTHLY_TOKENS` contract; specified `buildPlan()` caller and `tokenBalance` source |
| NS1 | Security | `system.config` values sanitized / excluded from LLM prompt in customScriptExecutor |
| NS2 | Security | `mood` and each `referenceGames` entry sanitized in decomposer alongside `oneLiner` |
| NS3 | Security | `ExecutorContext` construction specified in runner; context passed as second arg |
| NU1 | UX | Dynamic confidence on custom scripts: high/medium/low based on line count and API usage |
| NU2 | UX | (Same root as NB2) Gate trigger fragility resolved by `onStepComplete` pattern |
| ND1 | DX | Variance aggregation uses `sqrt(sum of variances^2)`; documented as known approximation |
| ND2 | DX | File count recounted honestly: 20 lib files, 12 fixtures, 8 test files = 40 total |

---

## Vision

A user describes ANY game they can imagine in natural language. The system decomposes it into composable systems, builds a plan, and executes it -- producing a playable game in the SpawnForge editor. No genre labels. No template constraints.

## Core Principle: Systems, Not Genres

Games are compositions of independent systems. A "platformer" is `movement:walk+jump` + `camera:side-scroll` + `challenge:physics` + `progression:levels`. The system handles all combinations equally.

**There are no genre strings anywhere in the pipeline code.** The GDD schema has no genre field. Templates are "starter system bundles" -- marketing labels, never constraints.

### System Taxonomy

| System | Config Examples | Engine Primitives |
|--------|----------------|-------------------|
| **Movement** | walk, run, jump, fly, swim, drive, climb | CharacterController, physics bodies, input bindings |
| **Input** | keyboard, touch, gamepad, timing, drag-drop | InputMap, InputPreset, custom scripts |
| **Camera** | follow, fixed, first-person, top-down, side-scroll | GameCamera (6 modes) |
| **World** | rooms, open-world, procedural, tiled, vertical | Scenes, TilemapData, TerrainData |
| **Challenge** | physics-puzzle, combat, timing, stealth | Game components, scripts, collision events |
| **Entities** | characters, NPCs, enemies, vehicles | EntityType, spawn commands, game components |
| **Progression** | levels, narrative-branch, score-chase, sandbox | Multi-scene, DialogueTree, script state |
| **Feedback** | score, health, collectibles, music-intensity | UI widgets, AudioData, PostProcessing |
| **Narrative** | linear, branching, dialogue-driven | DialogueTree, Cutscene, scripts |
| **Audio** | ambient, reactive, layered, spatial | AudioBus, AdaptiveMusic, reverb zones |
| **Visual** | art-style, lighting-mood, weather, screen-effects | Materials, environment, post-processing |
| **Physics** | gravity, collision-response, joints | PhysicsData, Joint types, Rapier config |

---

## Architecture

### Layer 1: GDD Schema (systems-based)

```typescript
// web/src/lib/game-creation/types.ts

import { z } from 'zod';

// --- Finding B8: GDD type collision resolution ---
// The new interface is named OrchestratorGDD to avoid collision with the
// existing GameDesignDocument in gddGenerator.ts. Migration strategy:
//   1. Phase 2A ships OrchestratorGDD as a new type (no changes to gddGenerator.ts)
//   2. A separate migration ticket (filed at Phase 2A completion) deprecates
//      gddGenerator.GameDesignDocument and adds an adapter:
//      function legacyGddToOrchestrator(old: GameDesignDocument): OrchestratorGDD
//   3. detectGenre() is deprecated (not removed) with a @deprecated JSDoc tag
// This avoids a breaking migration within Phase 2A scope.

// --- Finding D4: estimatedScope value set ---
// Removed 'tiny' -- the existing GDD_SCOPES enum is ['small', 'medium', 'large'].
// Reuse that exact set to avoid breaking validators.
import type { GddScope } from '@/lib/config/enums';

// --- Finding B9: Type-safe executor names ---
// Every executor must be a member of this union. makeStep() enforces this
// at compile time. Adding a new executor requires adding to this union.
export type ExecutorName =
  | 'scene_create'
  | 'physics_profile'
  | 'character_setup'
  | 'entity_setup'
  | 'asset_generate'
  | 'custom_script_generate'
  | 'verify_all_scenes'
  | 'auto_polish';

export interface OrchestratorGDD {
  id: string;
  title: string;
  description: string;              // Original user prompt (sanitized)
  systems: GameSystem[];
  scenes: SceneBlueprint[];
  assetManifest: AssetNeed[];
  estimatedScope: GddScope;         // [D4] Reuses existing 'small' | 'medium' | 'large'
  styleDirective: string;            // Free-text art/mood description
  feelDirective: FeelDirective;      // [B3] Captures experiential intent
  constraints: string[];
  projectType: '2d' | '3d';         // [B5] Propagated to all executors
}

// --- Finding B3: Feel directive ---
// Captures the emotional/experiential intent that raw system decomposition loses.
// The LLM populates this during decomposition. It directly influences:
//   - physics_profile executor: selects closest PHYSICS_PRESETS key by mapping
//     pacing + weight to preset names (e.g. 'cozy' + 'light' -> platformer_floaty)
//   - visual executor: styleDirective + mood inform material/lighting choices
//   - audio executor: pacing + mood inform tempo and reverb choices
export interface FeelDirective {
  mood: string;              // e.g. "cozy", "tense", "frantic", "dreamy"
  pacing: 'slow' | 'medium' | 'fast';
  weight: 'floaty' | 'light' | 'medium' | 'heavy' | 'weighty';
  referenceGames: string[];  // e.g. ["Stardew Valley", "Celeste"] -- max 5
  oneLiner: string;          // e.g. "A cozy farming sim that feels like a warm Sunday morning"
}

export interface GameSystem {
  category: SystemCategory;          // [B9] Type-safe, not freeform string
  type: string;                      // Specific config: 'walk+jump', 'timing', etc.
  config: Record<string, unknown>;
  priority: 'core' | 'secondary' | 'polish';
  dependsOn: SystemCategory[];       // [B2] Explicit dependency declaration
}

// Type-safe system categories -- extensible via union expansion
export type SystemCategory =
  | 'movement' | 'input' | 'camera' | 'world' | 'challenge'
  | 'entities' | 'progression' | 'feedback' | 'narrative'
  | 'audio' | 'visual' | 'physics';

// [FIX: V4-4] Exported Zod enum for SystemCategory validation.
// Used by customScriptExecutor's inputSchema to validate category at runtime
// instead of accepting arbitrary strings. Also used in decomposer.ts.
const SYSTEM_CATEGORIES_ARRAY: [SystemCategory, ...SystemCategory[]] = [
  'movement', 'input', 'camera', 'world', 'challenge',
  'entities', 'progression', 'feedback', 'narrative',
  'audio', 'visual', 'physics',
];
export const zSystemCategory = z.enum(SYSTEM_CATEGORIES_ARRAY);

export interface SceneBlueprint {
  name: string;
  purpose: string;
  systems: SystemCategory[];
  entities: EntityBlueprint[];
  transitions: { to: string; trigger: string }[];
}

export interface EntityBlueprint {
  name: string;
  role: 'player' | 'enemy' | 'npc' | 'decoration' | 'trigger' | 'interactable' | 'projectile';
  systems: SystemCategory[];
  appearance: string;
  behaviors: string[];
}

export interface AssetNeed {
  type: '3d-model' | 'texture' | 'sound' | 'music' | 'voice' | 'sprite';
  description: string;
  entityRef?: string;
  styleDirective: string;
  priority: 'required' | 'nice-to-have';
  fallback: string;               // [S5] Validated by FALLBACK_SCHEMA
}

// --- Finding S5: Fallback string validation ---
export const FALLBACK_SCHEMA = z.string().regex(
  /^(primitive|builtin):[a-z][a-z0-9_-]{0,63}$/,
  'Fallback must be "primitive:<name>" or "builtin:<name>" with lowercase alphanumeric name'
);

// --- Finding B2: Topological step ordering ---
export interface PlanStep {
  id: string;
  executor: ExecutorName;           // [B9] Compile-time checked
  input: Record<string, unknown>;
  dependsOn: string[];              // Step IDs that must complete first
  maxRetries: number;
  optional: boolean;
  fallbackStepId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: Record<string, unknown>;
  error?: OrchestratorStepError;
  userFacingErrorMessage?: string;  // [U4] Human-readable error
}

export interface OrchestratorPlan {
  id: string;
  projectId: string;
  prompt: string;
  gdd: OrchestratorGDD;
  steps: PlanStep[];
  approvalGates: ApprovalGate[];    // [U3] Defined approval points
  tokenEstimate: TokenEstimate;     // [U5] Cost projection
  status: 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  createdAt: number;
}

export interface OrchestratorStepError {
  code: string;
  message: string;
  userFacingMessage: string;        // [U4] Always present on errors
  retryable: boolean;
  details?: unknown;
}

// --- Finding U3: Approval gate specification ---
export interface ApprovalGate {
  id: string;
  label: string;                    // User-facing: "Review your game plan"
  description: string;              // Explains what was built so far
  afterStepId: string;              // Gate triggers after this step completes
  status: 'pending' | 'approved' | 'rejected';
  displayData: ApprovalDisplayData;
}

// What the approval UI shows at each gate
export interface ApprovalDisplayData {
  // Scene plan gate: shows scene names, entity counts, system summaries
  sceneSummaries?: Array<{
    name: string;
    entityCount: number;
    systemDescriptions: string[];   // [U1] User-friendly, not category names
  }>;
  // Asset gate: shows asset list with cost estimates
  assetList?: Array<{
    description: string;
    type: string;
    estimatedTokenCost: number;
    hasFallback: boolean;
  }>;
  // Final gate: shows completion summary
  completionSummary?: {
    totalEntities: number;
    totalScenes: number;
    totalScripts: number;
    warnings: string[];
  };
}

// --- Finding U5: Token cost estimation ---
export interface TokenEstimate {
  breakdown: Array<{
    category: string;              // "AI generation", "Asset creation", "Script generation"
    estimatedTokens: number;
    variance: number;              // +/- percentage (e.g. 0.3 = +/-30%)
  }>;
  totalEstimated: number;
  totalVarianceHigh: number;       // Upper bound
  totalVarianceLow: number;        // Lower bound
  userTier: string;                // For display: "Creator tier -- 1000 tokens/month"
  sufficientBalance: boolean;
  warningMessage?: string;         // e.g. "This will use ~80% of your remaining tokens"
}

// --- Finding D2: Consolidated error handling ---
// [FIX: NS3] ExecutorContext construction is specified in the runner (Layer 4).
// The runner constructs this and passes it as the second argument to every
// executor's execute() call. See runPipeline() for construction details.
export interface ExecutorContext {
  dispatchCommand: (command: string, payload: unknown) => void;
  store: EditorState;               // [FIX: NS3] Full store ref for reading state [FIX: V4-2]
  projectType: '2d' | '3d';
  userTier: UserTier;
  signal: AbortSignal;
  // [FIX: V4-7] Accepts step ID (e.g. 'step_5') OR executor name (e.g.
  // 'verify_all_scenes'). If the input doesn't start with 'step_', falls
  // back to searching by executor name. This avoids callers needing to
  // know internal step IDs when they just want the output of a known executor.
  resolveStepOutput: (stepIdOrExecutorName: string) => Record<string, unknown> | undefined;
}

export type UserTier = 'starter' | 'hobbyist' | 'creator' | 'pro';

// [FIX: NS3] EditorState type imported from store for type-safety
// [FIX: V4-2] The actual export is EditorState, not EditorStore.
// Verified: `grep "export.*EditorState" web/src/stores/editorStore.ts` -> line 73
import type { EditorState } from '@/stores/editorStore';

export interface ExecutorDefinition {
  name: ExecutorName;
  inputSchema: z.ZodType;
  execute: (input: Record<string, unknown>, ctx: ExecutorContext) => Promise<ExecutorResult>;
  userFacingErrorMessage: string;   // [U4] Default error message for this executor type
}

export interface ExecutorResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: OrchestratorStepError;
}
```

### Layer 2: decomposeIntoSystems() -- Full Specification

**[B1] Resolution: Complete LLM prompt template, Zod output schema, validation/retry.**

```typescript
// web/src/lib/game-creation/decomposer.ts

import { z } from 'zod';
import { fetchAI } from '@/lib/ai/client';
import { AI_MODEL_PRIMARY } from '@/lib/ai/models';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
// [FIX: V4-4] Import zSystemCategory from types.ts (single source of truth)
import { zSystemCategory } from './types';
import type { OrchestratorGDD, SystemCategory } from './types';

// --- Zod schema for LLM output validation ---

const SYSTEM_CATEGORIES: SystemCategory[] = [
  'movement', 'input', 'camera', 'world', 'challenge',
  'entities', 'progression', 'feedback', 'narrative',
  'audio', 'visual', 'physics',
];

const zGameSystem = z.object({
  category: zSystemCategory,
  type: z.string().min(1).max(100),
  config: z.record(z.unknown()),
  priority: z.enum(['core', 'secondary', 'polish']),
  dependsOn: z.array(zSystemCategory).default([]),
});

const zFeelDirective = z.object({
  mood: z.string().min(1).max(100),
  pacing: z.enum(['slow', 'medium', 'fast']),
  weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
  referenceGames: z.array(z.string().max(100)).max(5).default([]),
  oneLiner: z.string().min(1).max(200),
});

const zEntityBlueprint = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['player', 'enemy', 'npc', 'decoration', 'trigger', 'interactable', 'projectile']),
  systems: z.array(zSystemCategory),
  appearance: z.string().max(300),
  behaviors: z.array(z.string().max(200)),
});

const zSceneBlueprint = z.object({
  name: z.string().min(1).max(100),
  purpose: z.string().max(200),
  systems: z.array(zSystemCategory),
  entities: z.array(zEntityBlueprint),
  transitions: z.array(z.object({
    to: z.string().min(1),
    trigger: z.string().min(1),
  })),
});

const zAssetNeed = z.object({
  type: z.enum(['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite']),
  description: z.string().min(1).max(300),
  entityRef: z.string().optional(),
  styleDirective: z.string().max(300),
  priority: z.enum(['required', 'nice-to-have']),
  fallback: z.string().regex(/^(primitive|builtin):[a-z][a-z0-9_-]{0,63}$/),
});

const zDecompositionOutput = z.object({
  title: z.string().min(1).max(200),
  systems: z.array(zGameSystem).min(1),
  scenes: z.array(zSceneBlueprint).min(1),
  assetManifest: z.array(zAssetNeed),
  estimatedScope: z.enum(['small', 'medium', 'large']),
  styleDirective: z.string().max(500),
  feelDirective: zFeelDirective,
  constraints: z.array(z.string().max(200)),
});

export type DecompositionOutput = z.infer<typeof zDecompositionOutput>;

// --- LLM Prompt Template ---

const DECOMPOSITION_SYSTEM_PROMPT = `You are a game systems architect for SpawnForge, a browser-based game engine.

Given a game description, decompose it into composable SYSTEMS -- not genres. Every game is a combination of independent functional systems.

## Available System Categories
${SYSTEM_CATEGORIES.map(c => `- "${c}"`).join('\n')}

## Rules
1. NEVER use genre labels. Decompose into functional systems only.
2. Every game MUST have at least: one movement OR input system, one camera system, and one world system.
3. Set system priorities: "core" for essential gameplay, "secondary" for important polish, "polish" for nice-to-have.
4. Set dependsOn correctly: movement depends on physics, camera depends on entities, feedback depends on challenge, etc.
5. The feelDirective captures the EMOTIONAL EXPERIENCE, not just function. A "cozy farming sim" and a "hardcore farming sim" have similar systems but different feel.
6. Asset fallbacks must use format "primitive:<name>" or "builtin:<name>" (e.g., "primitive:cube", "builtin:footstep").
7. Limit assetManifest to items the game genuinely needs. Fewer high-impact assets over many decorative ones.
8. estimatedScope: "small" = 1-3 scenes, few entities; "medium" = 3-8 scenes, moderate entities; "large" = 8+ scenes, many entities.

## Output Format
Respond with ONLY valid JSON matching this exact structure (no markdown, no explanation):
{
  "title": "string",
  "systems": [{ "category": "movement", "type": "walk+jump", "config": { "gravity": 20 }, "priority": "core", "dependsOn": ["physics"] }],
  "scenes": [{ "name": "string", "purpose": "string", "systems": ["movement"], "entities": [{ "name": "string", "role": "player|enemy|npc|decoration|trigger|interactable|projectile", "systems": ["movement"], "appearance": "string", "behaviors": ["string"] }], "transitions": [{ "to": "scene name", "trigger": "description" }] }],
  "assetManifest": [{ "type": "3d-model|texture|sound|music|voice|sprite", "description": "string", "entityRef": "optional entity name", "styleDirective": "string", "priority": "required|nice-to-have", "fallback": "primitive:cube" }],
  "estimatedScope": "small|medium|large",
  "styleDirective": "string",
  "feelDirective": { "mood": "string", "pacing": "slow|medium|fast", "weight": "floaty|light|medium|heavy|weighty", "referenceGames": ["string"], "oneLiner": "string" },
  "constraints": ["string"]
}`;

// --- Decomposition function ---

const MAX_RETRIES = 2;

export async function decomposeIntoSystems(
  prompt: string,
  projectType: '2d' | '3d',
): Promise<OrchestratorGDD> {
  // [S3] Sanitize the user prompt before LLM call
  const sanitized = sanitizePrompt(prompt, 1000);
  if (!sanitized.safe) {
    throw new Error(`Prompt rejected: ${sanitized.reason}`);
  }
  const cleanPrompt = sanitized.filtered!;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const userMessage = [
      `Game description: ${cleanPrompt}`,
      `Project type: ${projectType}`,
      attempt > 0
        ? '(Previous attempt had invalid output. Please follow the JSON schema exactly.)'
        : '',
    ].filter(Boolean).join('\n');

    const content = await fetchAI(userMessage, {
      model: AI_MODEL_PRIMARY,
      sceneContext: '',
      thinking: false,
      systemOverride: DECOMPOSITION_SYSTEM_PROMPT,
      priority: 2,
    });

    // Parse JSON from response (strip markdown fences if present)
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      lastError = new Error(
        `Attempt ${attempt + 1}: Failed to parse JSON from LLM response`
      );
      continue;
    }

    // Validate against Zod schema
    const result = zDecompositionOutput.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      lastError = new Error(
        `Attempt ${attempt + 1}: Schema validation failed: ${issues}`
      );
      continue;
    }

    const data = result.data;

    // [S3] Sanitize all GDD string fields before they become second-stage LLM inputs
    const sanitizedTitle = sanitizePrompt(data.title, 200);
    const sanitizedStyle = sanitizePrompt(data.styleDirective, 500);
    const sanitizedOneLiner = sanitizePrompt(data.feelDirective.oneLiner, 200);

    // [FIX: NS2] Sanitize mood and each referenceGames entry.
    // These are LLM-generated strings that flow into second-stage prompts
    // (e.g. physics_profile, audio, visual executors receive feelDirective).
    // Without sanitization, a malicious LLM response could inject prompts
    // via mood or referenceGames fields.
    const sanitizedMood = sanitizePrompt(data.feelDirective.mood, 100);
    // [FIX: V4-5] Unsafe referenceGames entries are dropped entirely (same
    // pattern as constraints). Falling back to raw .slice() would pass
    // unsanitized LLM output into second-stage prompts.
    const sanitizedRefGames: string[] = [];
    for (const game of data.feelDirective.referenceGames) {
      const gameResult = sanitizePrompt(game, 100);
      // [FIX: NS2] Check .safe before using .filtered
      if (gameResult.safe) {
        sanitizedRefGames.push(gameResult.filtered ?? game.slice(0, 100));
      }
      // Unsafe entries are dropped -- not truncated to raw substring
    }

    // [FIX: NB3] Sanitize constraints: check .safe BEFORE using .filtered.
    // If sanitization marks a constraint as unsafe (entirely composed of
    // injection patterns), reject it rather than silently passing through.
    const sanitizedConstraints: string[] = [];
    for (const c of data.constraints) {
      const cResult = sanitizePrompt(c, 200);
      if (cResult.safe) {
        sanitizedConstraints.push(cResult.filtered ?? c.slice(0, 200));
      }
      // [FIX: NB3] Unsafe constraints are dropped entirely -- they were
      // composed entirely of injection content. We do NOT fall back to
      // the raw string because that would pass unsanitized text to
      // downstream LLM prompts.
    }

    return {
      id: crypto.randomUUID(),
      title: sanitizedTitle.safe
        ? sanitizedTitle.filtered!
        : data.title.slice(0, 200),
      description: cleanPrompt,
      systems: data.systems,
      scenes: data.scenes,
      assetManifest: data.assetManifest.map(a => ({
        ...a,
        // [S4] Sanitize styleDirective on each asset
        styleDirective: sanitizePrompt(a.styleDirective, 300).filtered
          ?? a.styleDirective.slice(0, 300),
      })),
      estimatedScope: data.estimatedScope,
      styleDirective: sanitizedStyle.safe
        ? sanitizedStyle.filtered!
        : data.styleDirective.slice(0, 500),
      feelDirective: {
        ...data.feelDirective,
        // [FIX: NS2] mood sanitized
        // [FIX: V4-5] Unsafe mood falls back to 'neutral', not raw string.
        // A mood string that is entirely injection content must not be passed
        // to second-stage prompts (physics_profile, audio, visual executors).
        mood: sanitizedMood.safe
          ? (sanitizedMood.filtered ?? data.feelDirective.mood.slice(0, 100))
          : 'neutral',
        // [FIX: NS2] referenceGames entries sanitized
        referenceGames: sanitizedRefGames,
        oneLiner: sanitizedOneLiner.safe
          ? sanitizedOneLiner.filtered!
          : data.feelDirective.oneLiner.slice(0, 200),
      },
      constraints: sanitizedConstraints, // [FIX: NB3] unsafe constraints dropped
      projectType,
    };
  }

  throw lastError ?? new Error('decomposeIntoSystems failed after all retries');
}
```

### Layer 3: Plan Builder with Topological Sort

**[B2] Resolution: Explicit dependsOn on every step, topological sort, not priority-sort.**

```typescript
// web/src/lib/game-creation/planBuilder.ts

import type {
  OrchestratorGDD, OrchestratorPlan, PlanStep, ApprovalGate,
  TokenEstimate, ExecutorName, UserTier, SystemCategory,
} from './types';
import { FALLBACK_SCHEMA } from './types';
import { SYSTEM_REGISTRY } from './systems';

// --- Finding S2: Tier-based asset caps ---
const ASSET_TIER_CAPS: Record<UserTier, number> = {
  starter: 5,
  hobbyist: 15,
  creator: 30,
  pro: 50,
};

// --- Token cost estimates per operation (for U5) ---
const TOKEN_COSTS: Record<string, { base: number; variance: number }> = {
  scene_create: { base: 0, variance: 0 },
  physics_profile: { base: 0, variance: 0 },
  character_setup: { base: 0, variance: 0 },
  entity_setup: { base: 2, variance: 0.1 },
  asset_generate: { base: 15, variance: 0.4 },
  custom_script_generate: { base: 8, variance: 0.3 },
  verify_all_scenes: { base: 0, variance: 0 },
  auto_polish: { base: 5, variance: 0.2 },
};

// [FIX: NB5] buildPlan() is called by the orchestrator entry point
// (web/src/lib/game-creation/index.ts :: createGame()) after decomposeIntoSystems().
// The caller reads tokenBalance from useUserStore.getState().tokenBalance.total
// and userTier from useUserStore.getState().tier. Both are available in the
// React context where the orchestrator is invoked (e.g. ChatPanel or
// OrchestratorPanel in Phase 2D).
//
// The orchestrator entry point:
//   const { tier, tokenBalance } = useUserStore.getState();
//   const plan = buildPlan(gdd, projectId, tier as UserTier, tokenBalance?.total ?? 0);
//
// TIER_MONTHLY_TOKENS from pricing.ts is NOT used here -- it is for
// billing display, not orchestration. The orchestrator needs the user's
// CURRENT balance, not their monthly allocation.
export function buildPlan(
  gdd: OrchestratorGDD,
  projectId: string,
  userTier: UserTier,          // [S2] Required for asset cap enforcement
  tokenBalance: number,        // [FIX: NB5] Current balance from useUserStore
): OrchestratorPlan {
  const steps: PlanStep[] = [];
  // [FIX: V4-1] Start at -1 so ++stepCounter produces step_0 as the first ID.
  // gate_plan.afterStepId = 'step_0' references the first scene creation step.
  // Previously stepCounter started at 0, making the first ID step_1 and leaving
  // gate_plan's afterStepId pointing at a nonexistent step.
  let stepCounter = -1;

  function nextId(): string {
    return `step_${++stepCounter}`;
  }

  // [B9] Type-checked step creation
  function makeStep(
    executor: ExecutorName,
    input: Record<string, unknown>,
    dependsOn: string[] = [],
    optional = false,
  ): PlanStep {
    return {
      id: nextId(),
      executor,
      input,
      dependsOn,
      maxRetries: executor === 'asset_generate' ? 2 : 1,
      optional,
      status: 'pending',
    };
  }

  // --- Phase 1: Scene creation ---
  const sceneStepIds: Record<string, string> = {};
  for (const scene of gdd.scenes) {
    const step = makeStep('scene_create', {
      name: scene.name,
      purpose: scene.purpose,
    });
    sceneStepIds[scene.name] = step.id;
    steps.push(step);
  }

  // --- Phase 2: Entity setup (depends on scene creation) ---
  // [B2] Entities must exist BEFORE physics/camera/systems can reference them
  const entityStepIds: Record<string, string> = {};
  for (const scene of gdd.scenes) {
    const sceneStepId = sceneStepIds[scene.name];
    for (const entity of scene.entities) {
      const step = makeStep(
        'entity_setup',
        {
          entity,
          scene: scene.name,
          projectType: gdd.projectType,     // [B5] Propagated
        },
        [sceneStepId],
      );
      entityStepIds[entity.name] = step.id;
      steps.push(step);
    }
  }

  // --- Phase 3: System configuration (depends on entities) ---
  // [B2] Systems declare dependsOn categories. We resolve to step IDs.
  const systemCategoryStepIds: Record<string, string[]> = {};

  const PRIORITY_ORDER: Record<string, number> = {
    core: 0,
    secondary: 1,
    polish: 2,
  };
  const orderedSystems = [...gdd.systems].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  );

  // All entity step IDs as a baseline dependency for system steps
  const allEntityStepIds = Object.values(entityStepIds);

  for (const system of orderedSystems) {
    const def = SYSTEM_REGISTRY.get(system.category);
    const systemDeps = [...allEntityStepIds];

    // Add dependency on steps from categories this system depends on
    for (const depCat of system.dependsOn) {
      const depSteps = systemCategoryStepIds[depCat];
      if (depSteps) {
        systemDeps.push(...depSteps);
      }
    }

    if (def) {
      const systemSteps = def.setupSteps(system, gdd);
      for (const stepInput of systemSteps) {
        // [S1] Hardcoded values injected by executor, not spread from config
        const step = makeStep(
          stepInput.executor,
          {
            ...stepInput.input,
            projectType: gdd.projectType,     // [B5]
            feelDirective: gdd.feelDirective,  // [B3]
          },
          systemDeps,
        );
        steps.push(step);
        if (!systemCategoryStepIds[system.category]) {
          systemCategoryStepIds[system.category] = [];
        }
        systemCategoryStepIds[system.category].push(step.id);
      }
    } else {
      // Unknown system category -- fall through to custom script
      const step = makeStep(
        'custom_script_generate',
        {
          system,
          description: `Implement ${system.category}:${system.type} behavior`,
          projectType: gdd.projectType,
          feelDirective: gdd.feelDirective,
        },
        systemDeps,
      );
      steps.push(step);
    }
  }

  // --- Phase 4: Asset generation (depends on entities + systems) ---
  // [S2] Truncate asset manifest to tier cap
  const allPriorStepIds = steps.map(s => s.id);
  const tierCap = ASSET_TIER_CAPS[userTier];
  const cappedAssets = gdd.assetManifest
    .sort((a, b) =>
      (a.priority === 'required' ? 0 : 1) - (b.priority === 'required' ? 0 : 1)
    )
    .slice(0, tierCap);

  for (const asset of cappedAssets) {
    // [S5] Validate fallback string
    const fallbackResult = FALLBACK_SCHEMA.safeParse(asset.fallback);
    const safeFallback = fallbackResult.success ? asset.fallback : 'primitive:cube';

    const step = makeStep(
      'asset_generate',
      {
        ...asset,
        fallback: safeFallback,
        maxRetries: 2,
        optional: asset.priority === 'nice-to-have',
      },
      allPriorStepIds,
      asset.priority === 'nice-to-have',
    );
    steps.push(step);
  }

  // --- Phase 5: Verification + polish ---
  const allBeforeVerify = steps.map(s => s.id);
  const verifyStep = makeStep('verify_all_scenes', {}, allBeforeVerify);
  steps.push(verifyStep);

  const polishStep = makeStep('auto_polish', {
    projectType: gdd.projectType,
    feelDirective: gdd.feelDirective,
  }, [verifyStep.id]);
  steps.push(polishStep);

  // --- Approval gates [U3] ---
  // [FIX: NB2] Gates use afterStepId to specify which step's completion
  // triggers the gate. The runner checks gates via the onStepComplete
  // callback pattern (see Layer 4), NOT by inspecting dependsOn[0].
  // [FIX: V4-1] stepCounter starts at -1, so the first scene step gets step_0.
  // gate_plan.afterStepId = 'step_0' now correctly references that first step.
  const approvalGates: ApprovalGate[] = [
    {
      id: 'gate_plan',
      label: 'Review your game plan',
      description: 'Check the scenes, entities, and systems before building starts.',
      afterStepId: 'step_0',         // [FIX: V4-1] First scene step is step_0
      status: 'pending',
      displayData: {
        sceneSummaries: gdd.scenes.map(s => ({
          name: s.name,
          entityCount: s.entities.length,
          // [U1] User-friendly descriptions, not system category names
          systemDescriptions: s.systems.map(
            cat => systemCategoryToUserLabel(cat)
          ),
        })),
      },
    },
  ];

  // [FIX: V4-6] Only add gate_assets if there are entity steps.
  // When allEntityStepIds is empty (e.g. a game with zero entities -- puzzle
  // games with only scene-level systems), there are no entities to attach
  // assets to, so the asset approval gate is meaningless. The v3 code fell
  // back to 'step_0' which is a scene step, not an entity step, causing the
  // gate to fire at the wrong time.
  if (allEntityStepIds.length > 0) {
    const lastEntityStepId = allEntityStepIds[allEntityStepIds.length - 1];
    approvalGates.push({
      id: 'gate_assets',
      label: 'Confirm asset generation',
      description: `Generating ${cappedAssets.length} assets will use tokens. Review the list and estimated costs.`,
      afterStepId: lastEntityStepId,  // After all entities are created
      status: 'pending',
      displayData: {
        assetList: cappedAssets.map(a => ({
          description: a.description,
          type: a.type,
          estimatedTokenCost: TOKEN_COSTS.asset_generate.base,
          hasFallback: FALLBACK_SCHEMA.safeParse(a.fallback).success,
        })),
      },
    });
  }

  approvalGates.push(
    {
      id: 'gate_final',
      label: 'Final review',
      description: 'Your game is built. Review before applying polish.',
      afterStepId: verifyStep.id,     // After verification completes
      status: 'pending',
      displayData: {
        completionSummary: {
          totalEntities: gdd.scenes.reduce(
            (sum, s) => sum + s.entities.length, 0
          ),
          totalScenes: gdd.scenes.length,
          totalScripts: steps.filter(
            s => s.executor === 'custom_script_generate'
          ).length,
          warnings: [],
        },
      },
    },
  ];

  // --- Token estimate [U5] ---
  // [FIX: ND1] Variance aggregation: use sqrt(sum of squared variances)
  // for combined variance. This is an approximation treating step variances
  // as independent random variables. It produces a tighter (more accurate)
  // combined bound than the v2 approach of taking max(variance).
  // Known approximation: assumes independence between steps, which may not
  // hold if a single LLM call affects multiple steps. In practice this is
  // close enough for a user-facing cost estimate.
  const costByCategory: Record<string, { tokens: number; varianceSumSq: number }> = {};
  for (const step of steps) {
    const cost = TOKEN_COSTS[step.executor] ?? { base: 0, variance: 0 };
    const cat = step.executor === 'asset_generate'
      ? 'Asset creation'
      : step.executor === 'custom_script_generate'
        ? 'Script generation'
        : 'Engine operations';
    if (!costByCategory[cat]) {
      costByCategory[cat] = { tokens: 0, varianceSumSq: 0 };
    }
    costByCategory[cat].tokens += cost.base;
    // [FIX: ND1] Sum squared variances (as fractions of per-step cost)
    // Each step contributes (base * variance)^2 to the sum of squares.
    costByCategory[cat].varianceSumSq += (cost.base * cost.variance) ** 2;
  }

  const breakdown: TokenEstimate['breakdown'] = [];
  for (const [category, { tokens, varianceSumSq }] of Object.entries(costByCategory)) {
    // [FIX: ND1] Combined variance as fraction of category total
    const combinedAbsVariance = Math.sqrt(varianceSumSq);
    const variance = tokens > 0 ? combinedAbsVariance / tokens : 0;
    breakdown.push({ category, estimatedTokens: tokens, variance });
  }

  const totalEstimated = breakdown.reduce((s, b) => s + b.estimatedTokens, 0);
  // [FIX: ND1] Total variance bounds use sqrt(sum of all squared absolute variances)
  const totalAbsVariance = Math.sqrt(
    Object.values(costByCategory).reduce((s, c) => s + c.varianceSumSq, 0)
  );
  const totalVarianceHigh = Math.round(totalEstimated + totalAbsVariance);
  const totalVarianceLow = Math.round(Math.max(0, totalEstimated - totalAbsVariance));

  const tierLabel = `${userTier.charAt(0).toUpperCase() + userTier.slice(1)} tier`;
  const pctOfBalance = tokenBalance > 0
    ? Math.round((totalEstimated / tokenBalance) * 100)
    : 100;

  const tokenEstimate: TokenEstimate = {
    breakdown,
    totalEstimated,
    totalVarianceHigh,
    totalVarianceLow,
    userTier: tierLabel,
    sufficientBalance: tokenBalance >= totalVarianceHigh,
    warningMessage: pctOfBalance > 80
      ? `This will use ~${pctOfBalance}% of your remaining tokens.`
      : pctOfBalance > 50
        ? `Estimated cost: ~${totalEstimated} tokens (~${pctOfBalance}% of balance).`
        : undefined,
  };

  return {
    id: crypto.randomUUID(),
    projectId,
    prompt: gdd.description,
    gdd,
    steps,
    approvalGates,
    tokenEstimate,
    status: 'planning',
    currentStepIndex: 0,
    createdAt: Date.now(),
  };
}

// --- Finding U1: System category to user-friendly label ---
// Users NEVER see system category strings. These labels are for approval gates.
function systemCategoryToUserLabel(category: SystemCategory): string {
  const labels: Record<SystemCategory, string> = {
    movement: 'Character movement and controls',
    input: 'Input handling',
    camera: 'Camera behavior',
    world: 'Level and world structure',
    challenge: 'Gameplay challenges',
    entities: 'Characters and objects',
    progression: 'Progression and goals',
    feedback: 'Score, health, and feedback',
    narrative: 'Story and dialogue',
    audio: 'Sound and music',
    visual: 'Art style and lighting',
    physics: 'Physics simulation',
  };
  return labels[category] ?? category;
}
```

### Layer 4: Pipeline Runner (0 external imports)

```typescript
// web/src/lib/game-creation/pipelineRunner.ts
//
// Generic step runner. Has 0 external imports -- 3 injected interfaces only.
// Handles topological ordering, retry, abort, progress, approval gates.

// --- Injected interfaces (no import from other modules) ---

interface StepLike {
  id: string;
  executor: string;
  input: Record<string, unknown>;
  dependsOn: string[];
  maxRetries: number;
  optional: boolean;
  fallbackStepId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    userFacingMessage: string;
    retryable: boolean;
  };
  userFacingErrorMessage?: string;
}

interface GateLike {
  id: string;
  afterStepId: string;
  status: 'pending' | 'approved' | 'rejected';
}

// [FIX: NS3] ExecutorLike.execute takes a second ctx argument.
// The runner constructs the ExecutorContext and passes it to each executor.
interface ExecutorLike {
  execute: (
    input: Record<string, unknown>,
    ctx: ExecutorContextLike,
  ) => Promise<{
    success: boolean;
    output?: Record<string, unknown>;
    error?: StepLike['error'];
  }>;
  userFacingErrorMessage: string;
}

// [FIX: NS3] Minimal context interface for the runner. The actual
// ExecutorContext (from types.ts) is constructed by the caller of
// runPipeline() and passed via the new `ctx` parameter.
interface ExecutorContextLike {
  dispatchCommand: (command: string, payload: unknown) => void;
  projectType: string;
  signal: AbortSignal;
  // [FIX: V4-7] Accepts step ID (e.g. 'step_5') or executor name
  // (e.g. 'verify_all_scenes'). See construction in runPipeline comment.
  resolveStepOutput: (stepIdOrExecutorName: string) => Record<string, unknown> | undefined;
  [key: string]: unknown;  // Allow additional fields (store, userTier, etc.)
}

interface PipelineCallbacks {
  onStepStart?: (stepId: string, index: number, total: number) => void;
  onStepComplete?: (stepId: string, success: boolean) => void;
  onGateReached?: (gateId: string) => Promise<'approved' | 'rejected'>;
  onProgress?: (completed: number, total: number) => void;
}

// --- Topological sort ---

function topologicalSort(steps: StepLike[]): StepLike[] {
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const visited = new Set<string>();
  const sorted: StepLike[] = [];

  function visit(step: StepLike): void {
    if (visited.has(step.id)) return;
    visited.add(step.id);
    for (const depId of step.dependsOn) {
      const dep = stepMap.get(depId);
      if (dep) visit(dep);
    }
    sorted.push(step);
  }

  for (const step of steps) {
    visit(step);
  }

  return sorted;
}

// --- Runner ---

// [FIX: NS3] The runner accepts an ExecutorContextLike that it passes to
// every executor. The caller (orchestrator entry point) constructs it:
//
//   const editorStore = useEditorStore.getState();
//   const userStore = useUserStore.getState();
//   const ctx: ExecutorContext = {
//     dispatchCommand: editorStore.dispatchCommand,
//     store: editorStore,
//     projectType: gdd.projectType,
//     userTier: userStore.tier as UserTier,
//     signal: abortController.signal,
//     // [FIX: V4-7] Accepts step ID or executor name.
//     resolveStepOutput: (stepIdOrExecutorName) => {
//       const step = stepIdOrExecutorName.startsWith('step_')
//         ? plan.steps.find(s => s.id === stepIdOrExecutorName)
//         : plan.steps.find(s => s.executor === stepIdOrExecutorName);
//       return step?.output;
//     },
//   };
//   await runPipeline(plan.steps, plan.approvalGates, executorRegistry, callbacks, ctx);

export async function runPipeline(
  steps: StepLike[],
  gates: GateLike[],
  executorRegistry: Map<string, ExecutorLike>,
  callbacks: PipelineCallbacks,
  ctx: ExecutorContextLike,        // [FIX: NS3] Context passed to every executor
): Promise<{
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
}> {
  const sorted = topologicalSort(steps);
  const completed = new Set<string>();
  const failed = new Set<string>();
  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const total = sorted.length;

  // [FIX: NB2] Build gate lookup: afterStepId -> gate.
  // Gates are checked after each step completes, not by inspecting dependsOn[0].
  const gateAfterStep = new Map<string, GateLike>();
  for (const gate of gates) {
    gateAfterStep.set(gate.afterStepId, gate);
  }

  for (const step of sorted) {
    // Check abort
    if (ctx.signal.aborted) {
      step.status = 'skipped';
      skippedCount++;
      continue;
    }

    // Check dependencies met
    const depsMet = step.dependsOn.every(d => completed.has(d));
    if (!depsMet) {
      if (step.optional) {
        step.status = 'skipped';
        skippedCount++;
      } else {
        step.status = 'failed';
        step.error = {
          code: 'DEPENDENCY_FAILED',
          message: `Dependency not met: ${step.dependsOn.filter(d => !completed.has(d)).join(', ')}`,
          userFacingMessage: 'A required earlier step failed. This step was skipped.',
          retryable: false,
        };
        failed.add(step.id);
        failedCount++;
      }
      callbacks.onProgress?.(
        completedCount + failedCount + skippedCount, total
      );
      continue;
    }

    // [FIX: NB2] Check if an approval gate should trigger BEFORE this step.
    // The gate's afterStepId specifies which step's completion triggers it.
    // We check: for each of this step's dependencies, did completing that
    // dependency trigger a gate? This replaces the fragile dependsOn[0] check.
    // A gate fires at most once (status transitions from 'pending').
    let rejected = false;
    for (const depId of step.dependsOn) {
      const gate = gateAfterStep.get(depId);
      if (gate && gate.status === 'pending' && callbacks.onGateReached) {
        const decision = await callbacks.onGateReached(gate.id);
        gate.status = decision;
        if (decision === 'rejected') {
          // Mark all remaining pending steps as skipped
          for (const remaining of sorted) {
            if (remaining.status === 'pending') {
              remaining.status = 'skipped';
              skippedCount++;
            }
          }
          rejected = true;
          break;
        }
      }
    }
    if (rejected) {
      return {
        completedSteps: completedCount,
        failedSteps: failedCount,
        skippedSteps: skippedCount,
      };
    }

    // Execute step with retry
    const executor = executorRegistry.get(step.executor);
    if (!executor) {
      step.status = 'failed';
      step.error = {
        code: 'EXECUTOR_NOT_FOUND',
        message: `No executor registered for "${step.executor}"`,
        userFacingMessage: `Internal error: unknown step type "${step.executor}".`,
        retryable: false,
      };
      failed.add(step.id);
      failedCount++;
      callbacks.onProgress?.(
        completedCount + failedCount + skippedCount, total
      );
      continue;
    }

    callbacks.onStepStart?.(
      step.id,
      completedCount + failedCount + skippedCount,
      total,
    );
    step.status = 'running';

    let success = false;
    for (let attempt = 0; attempt <= step.maxRetries; attempt++) {
      if (ctx.signal.aborted) break;
      // [FIX: NS3] Pass ctx as second argument to executor
      const result = await executor.execute(step.input, ctx);
      if (result.success) {
        step.status = 'completed';
        step.output = result.output;
        completed.add(step.id);
        completedCount++;
        success = true;
        break;
      }
      if (attempt === step.maxRetries) {
        step.status = 'failed';
        step.error = result.error ?? {
          code: 'EXECUTION_FAILED',
          message: `Step "${step.id}" failed after ${step.maxRetries + 1} attempts`,
          userFacingMessage: executor.userFacingErrorMessage,
          retryable: false,
        };
        step.userFacingErrorMessage = result.error?.userFacingMessage
          ?? executor.userFacingErrorMessage;
      }
    }

    if (!success) {
      if (step.optional) {
        step.status = 'skipped';
        skippedCount++;
      } else {
        failed.add(step.id);
        failedCount++;
      }
    }

    callbacks.onStepComplete?.(step.id, success);
    callbacks.onProgress?.(
      completedCount + failedCount + skippedCount, total
    );
  }

  return {
    completedSteps: completedCount,
    failedSteps: failedCount,
    skippedSteps: skippedCount,
  };
}

// Resume from last completed step
export async function resumePipeline(
  steps: StepLike[],
  gates: GateLike[],
  executorRegistry: Map<string, ExecutorLike>,
  callbacks: PipelineCallbacks,
  ctx: ExecutorContextLike,        // [FIX: NS3] Context passed through
): Promise<{
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
}> {
  // Reset non-completed steps to pending
  for (const step of steps) {
    if (step.status !== 'completed') {
      step.status = 'pending';
      step.error = undefined;
      step.output = undefined;
    }
  }
  return runPipeline(steps, gates, executorRegistry, callbacks, ctx);
}
```

### Layer 5: Step Executors

**[D2] Resolution: All executors use shared makeStepError helper. No per-executor error reinvention.**

```typescript
// web/src/lib/game-creation/executors/shared.ts

import type { OrchestratorStepError } from '../types';

export function makeStepError(
  code: string,
  message: string,
  userFacingMessage: string,
  retryable = false,
  details?: unknown,
): OrchestratorStepError {
  return { code, message, userFacingMessage, retryable, details };
}
```

#### Executor Registry and Definitions

| Executor | Input Schema | Dependencies | userFacingErrorMessage | Notes |
|----------|-------------|--------------|----------------------|-------|
| `scene_create` | `{ name: string, purpose: string }` | None | "Could not create the scene. Please try again." | Thin wrapper around dispatchCommand |
| `physics_profile` | `{ config, feelDirective, projectType, entityIds? }` | Entity steps | "Could not configure physics. Your game will use default physics." | [S1][B3][B5] |
| `character_setup` | `{ entity, projectType, entityId? }` | Entity steps | "Could not set up the character rig. The character will work without animations." | [B5] 2D/3D routing |
| `entity_setup` | `{ entity, scene, projectType }` | Scene steps | "Could not create an entity. It will be skipped." | Spawns entity + components |
| `asset_generate` | `{ type, description, fallback, ... }` | Entity + system steps | "Asset generation failed. Using a placeholder instead." | Calls /api/generate, falls back |
| `custom_script_generate` | `{ system, description, targetEntityId, projectType }` | Entity steps | "Could not generate a custom script. This behavior will need manual implementation." | [B6] Full spec below |
| `verify_all_scenes` | `{}` | All prior | "Verification found issues, but your game is still playable." | Structural heuristics |
| `auto_polish` | `{ projectType, feelDirective }` | Verify step | "Auto-polish could not run. Your game is ready as-is." | [B4] Structural, NOT telemetry |

#### physics_profile Executor Detail

**[S1] Resolution: Config spread order -- hardcoded preset values MUST win over user config.**

```typescript
// web/src/lib/game-creation/executors/physicsProfileExecutor.ts

import { z } from 'zod';
import { PHYSICS_PRESETS, applyPhysicsProfile } from '@/lib/ai/physicsFeel';
import type {
  FeelDirective, ExecutorDefinition, ExecutorContext, ExecutorResult,
} from '../types';
import { makeStepError } from './shared';

// [B3] Map feel directive to closest physics preset
const FEEL_TO_PRESET: Record<string, Record<string, string>> = {
  floaty: {
    slow: 'space_zero_g',
    medium: 'platformer_floaty',
    fast: 'platformer_floaty',
  },
  light: {
    slow: 'underwater',
    medium: 'platformer_floaty',
    fast: 'platformer_snappy',
  },
  medium: {
    slow: 'puzzle_precise',
    medium: 'arcade_classic',
    fast: 'arcade_classic',
  },
  heavy: {
    slow: 'rpg_weighty',
    medium: 'rpg_weighty',
    fast: 'rpg_weighty',
  },
  weighty: {
    slow: 'rpg_weighty',
    medium: 'rpg_weighty',
    fast: 'platformer_snappy',
  },
};

function resolvePresetFromFeel(feel: FeelDirective): string {
  const byWeight = FEEL_TO_PRESET[feel.weight];
  if (byWeight) {
    return byWeight[feel.pacing] ?? 'arcade_classic';
  }
  return 'arcade_classic';
}

const inputSchema = z.object({
  config: z.record(z.unknown()).optional(),
  feelDirective: z.object({
    mood: z.string(),
    pacing: z.enum(['slow', 'medium', 'fast']),
    weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
    referenceGames: z.array(z.string()),
    oneLiner: z.string(),
  }),
  projectType: z.enum(['2d', '3d']),
  entityIds: z.array(z.string()).optional(),
});

export const physicsProfileExecutor: ExecutorDefinition = {
  name: 'physics_profile',
  inputSchema,
  userFacingErrorMessage:
    'Could not configure physics. Your game will use default physics.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      };
    }

    const { feelDirective, config, entityIds } = parsed.data;

    // [B3] Resolve preset from feel directive
    const presetKey = resolvePresetFromFeel(feelDirective);
    const baseProfile = PHYSICS_PRESETS[presetKey]
      ?? PHYSICS_PRESETS.arcade_classic;

    // [S1] Preset values are the base. Only SAFE overrides from config are applied.
    // User-controlled config CANNOT override gravity, friction, or terminal velocity.
    const finalProfile = {
      ...baseProfile,
      ...(typeof config?.moveSpeed === 'number'
        ? { moveSpeed: config.moveSpeed }
        : {}),
      ...(typeof config?.jumpForce === 'number'
        ? { jumpForce: config.jumpForce }
        : {}),
    };

    const ids = entityIds ?? [];
    if (ids.length === 0) {
      return {
        success: true,
        output: { presetUsed: presetKey, entityCount: 0 },
      };
    }

    applyPhysicsProfile(finalProfile, ctx.dispatchCommand, ids);

    return {
      success: true,
      output: { presetUsed: presetKey, entityCount: ids.length },
    };
  },
};
```

#### character_setup Executor Detail

**[B5] Resolution: Detects 2D vs 3D project type and routes accordingly.**

```typescript
// web/src/lib/game-creation/executors/characterSetupExecutor.ts

import { z } from 'zod';
import { generateRig, rigToCommands } from '@/lib/ai/autoRigging';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError } from './shared';

const inputSchema = z.object({
  entity: z.object({
    name: z.string(),
    role: z.string(),
    appearance: z.string(),
    behaviors: z.array(z.string()),
  }),
  projectType: z.enum(['2d', '3d']),
  entityId: z.string().optional(),
});

export const characterSetupExecutor: ExecutorDefinition = {
  name: 'character_setup',
  inputSchema,
  userFacingErrorMessage:
    'Could not set up the character rig. The character will work without animations.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      };
    }

    const { entity, projectType, entityId } = parsed.data;
    if (!entityId) {
      return {
        success: false,
        error: makeStepError(
          'MISSING_ENTITY',
          'No entityId provided',
          this.userFacingErrorMessage,
        ),
      };
    }

    // [B5] Route based on project type
    if (projectType === '2d') {
      // 2D: rigToCommands emits set_skeleton_2d -- correct for 2D
      const rig = await generateRig(entity.appearance);
      const commands = rigToCommands(rig, entityId);
      for (const cmd of commands) {
        ctx.dispatchCommand(cmd.command, cmd.payload);
      }
    } else {
      // 3D: Use game components for character controller
      // autoRigging.rigToCommands emits set_skeleton_2d which is 2D-only.
      // For 3D, we add a CharacterController game component instead.
      ctx.dispatchCommand('add_game_component', {
        entityId,
        componentType: 'character_controller',
        speed: 5,
        jumpHeight: 2,
        gravityScale: 1,
      });
    }

    return {
      success: true,
      output: {
        entityId,
        projectType,
        rigApplied: projectType === '2d',
      },
    };
  },
};
```

#### custom_script_generate Executor Detail

**[B6] Resolution: Entity binding, prompt template, output validation, test strategy, Reflect/Proxy prereq.**

```typescript
// web/src/lib/game-creation/executors/customScriptExecutor.ts

import { z } from 'zod';
import { fetchAI } from '@/lib/ai/client';
import { AI_MODEL_PRIMARY } from '@/lib/ai/models';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError } from './shared';

// --- [S6] PREREQUISITE: Reflect and Proxy must be in SHADOWED_GLOBALS ---
// Before this executor can be used, the following MUST be added to
// web/src/lib/scripting/scriptWorker.ts SHADOWED_GLOBALS:
//   'Reflect', 'Proxy'
// This is a blocking prerequisite tracked as a subtask.
// Without this, LLM-generated scripts could use Reflect/Proxy to escape
// the sandbox.

// [FIX: V4-4] Import zSystemCategory for type-safe category validation.
// Defined in decomposer.ts; re-exported from types.ts for cross-module use.
// Using z.string() here would allow arbitrary strings to flow into LLM prompts.
import { zSystemCategory } from '../types';

const inputSchema = z.object({
  system: z.object({
    category: zSystemCategory,          // [FIX: V4-4] Enum, not freeform string
    type: z.string().min(1).max(100),
    config: z.record(z.unknown()),
  }),
  description: z.string().min(1),
  targetEntityId: z.string().min(1),    // [B6] Entity binding is required
  projectType: z.enum(['2d', '3d']),
});

const SCRIPT_SYSTEM_PROMPT = `You are a game script generator for SpawnForge, a browser-based game engine.

Generate a TypeScript game script that runs in a sandboxed Web Worker. The script has access to the forge API.

## Available APIs
- forge.entity.getPosition(entityId) -> [x, y, z]
- forge.entity.setPosition(entityId, x, y, z)
- forge.entity.getRotation(entityId) -> [x, y, z]
- forge.entity.setRotation(entityId, x, y, z)
- forge.entity.getScale(entityId) -> [x, y, z]
- forge.entity.setScale(entityId, x, y, z)
- forge.input.isKeyDown(key) -> boolean
- forge.input.isKeyJustPressed(key) -> boolean
- forge.physics.applyForce(entityId, x, y, z)
- forge.physics.applyImpulse(entityId, x, y, z)
- forge.physics.setVelocity(entityId, x, y, z)
- forge.audio.play(entityId)
- forge.audio.stop(entityId)
- forge.scene.load(sceneName)
- forge.time.delta -> number (seconds)
- forge.ui.setText(widgetId, text)
- forge.ui.setVisible(widgetId, visible)

## Script Structure
Variables declared at module scope persist across frames.

function onStart() { /* Called once when the entity spawns */ }
function onUpdate(dt: number) { /* Called every frame */ }
function onDestroy() { /* Called when the entity is removed */ }

## Rules
1. NEVER use fetch, XMLHttpRequest, WebSocket, eval, Function constructor, import, require
2. NEVER use Reflect, Proxy, globalThis, self, window, document
3. NEVER access __proto__ or constructor.constructor
4. Use ONLY the forge.* API for engine interaction
5. Keep scripts simple and focused on one behavior
6. Use onUpdate(dt) for frame-by-frame logic, multiply movement by dt
7. Return ONLY the script code. No markdown, no explanation, no code fences.`;

// [B6] Output validation: check for sandbox escape attempts
const FORBIDDEN_PATTERNS = [
  /\beval\b/,
  /\bFunction\b\s*\(/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bimportScripts\b/,
  /\bReflect\b/,
  /\bProxy\b/,
  /\bglobalThis\b/,
  /\b__proto__\b/,
  /constructor\.constructor/,
  /\brequire\b\s*\(/,
  /\bimport\b\s*\(/,
];

function validateGeneratedScript(
  code: string,
): { valid: boolean; reason?: string } {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      return {
        valid: false,
        reason: `Script contains forbidden pattern: ${pattern.source}`,
      };
    }
  }
  // Must define at least onStart or onUpdate
  if (!code.includes('onStart') && !code.includes('onUpdate')) {
    return {
      valid: false,
      reason: 'Script must define onStart() or onUpdate()',
    };
  }
  return { valid: true };
}

// [FIX: NU1] Dynamic confidence scoring for custom scripts.
// Heuristic: scripts that are short and use few API namespaces are more
// likely to be correct. Scripts that are long or use many namespaces are
// more likely to have bugs.
const FORGE_NAMESPACES = [
  'forge.entity', 'forge.input', 'forge.physics', 'forge.audio',
  'forge.scene', 'forge.time', 'forge.ui', 'forge.camera',
  'forge.physics2d', 'forge.sprite', 'forge.skeleton2d',
  'forge.dialogue', 'forge.tilemap',
];

function computeScriptConfidence(code: string): 'high' | 'medium' | 'low' {
  const lineCount = code.split('\n').length;
  const namespacesUsed = FORGE_NAMESPACES.filter(ns => code.includes(ns)).length;

  // [FIX: NU1] high if <30 lines and uses basic APIs (<=2 namespaces)
  if (lineCount < 30 && namespacesUsed <= 2) {
    return 'high';
  }
  // [FIX: NU1] low if 3+ namespaces or >80 lines -- complex scripts are
  // more likely to have subtle bugs
  if (namespacesUsed >= 3 || lineCount > 80) {
    return 'low';
  }
  // [FIX: NU1] medium otherwise
  return 'medium';
}

export const customScriptExecutor: ExecutorDefinition = {
  name: 'custom_script_generate',
  inputSchema,
  userFacingErrorMessage:
    'Could not generate a custom script. This behavior will need manual implementation.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      };
    }

    const { system, description, targetEntityId, projectType } = parsed.data;

    // [S3] Sanitize the description before using it in the LLM prompt
    const sanitized = sanitizePrompt(description, 500);
    if (!sanitized.safe) {
      return {
        success: false,
        error: makeStepError(
          'UNSAFE_INPUT',
          `Description rejected: ${sanitized.reason}`,
          this.userFacingErrorMessage,
        ),
      };
    }

    // [FIX: NS1] Sanitize system.config values before interpolation into
    // the LLM prompt. Config values come from the LLM's first-stage output
    // (decomposer) and could contain injection payloads. We serialize only
    // primitive values (string, number, boolean) and cap string length.
    // Objects and arrays are excluded to prevent nested injection vectors.
    const safeConfigEntries: Record<string, string | number | boolean> = {};
    for (const [key, val] of Object.entries(system.config)) {
      if (typeof val === 'number' || typeof val === 'boolean') {
        safeConfigEntries[key] = val;
      } else if (typeof val === 'string') {
        const sanitizedVal = sanitizePrompt(val, 100);
        if (sanitizedVal.safe && sanitizedVal.filtered) {
          safeConfigEntries[key] = sanitizedVal.filtered;
        }
        // Unsafe string values are silently dropped from the prompt
      }
      // Objects, arrays, null, undefined are excluded from the prompt
    }

    // [FIX: V4-3] Sanitize targetEntityId before interpolation into LLM prompt.
    // Entity IDs are typically UUIDs from crypto.randomUUID(), but they flow
    // through user-controlled state (entity rename -> ID reuse is not impossible).
    // Defense-in-depth: sanitize before any string interpolation into an LLM call.
    const safeEntityId = sanitizePrompt(targetEntityId, 100);
    if (!safeEntityId.safe) {
      return {
        success: false,
        error: makeStepError(
          'UNSAFE_INPUT',
          `Entity ID rejected: ${safeEntityId.reason}`,
          this.userFacingErrorMessage,
        ),
      };
    }

    // [FIX: V4-4] Sanitize system.type before interpolation into LLM prompt.
    // system.type is LLM-generated (from decomposer) and could contain injection.
    // category is already validated by zSystemCategory enum (V4-4 schema fix above),
    // but type is a freeform string that needs sanitization.
    const safeType = sanitizePrompt(system.type, 100);
    if (!safeType.safe) {
      return {
        success: false,
        error: makeStepError(
          'UNSAFE_INPUT',
          `System type rejected: ${safeType.reason}`,
          this.userFacingErrorMessage,
        ),
      };
    }

    const userMessage = [
      `Generate a script for entity "${safeEntityId.filtered}" (project: ${projectType}).`,
      `System: ${system.category}:${safeType.filtered}`,       // [FIX: V4-4]
      `Behavior: ${sanitized.filtered}`,
      // [FIX: NS1] Only sanitized primitive config values are included
      Object.keys(safeConfigEntries).length > 0
        ? `Config hints: ${JSON.stringify(safeConfigEntries)}`
        : '',
    ].filter(Boolean).join('\n');

    let scriptCode: string;
    try {
      scriptCode = await fetchAI(userMessage, {
        model: AI_MODEL_PRIMARY,
        sceneContext: '',
        thinking: false,
        systemOverride: SCRIPT_SYSTEM_PROMPT,
        priority: 2,
      });
    } catch (err) {
      return {
        success: false,
        error: makeStepError(
          'AI_CALL_FAILED',
          String(err),
          this.userFacingErrorMessage,
          true,
        ),
      };
    }

    // Strip markdown fences if present
    let code = scriptCode.trim();
    const fenceMatch = code.match(
      /```(?:typescript|ts|javascript|js)?\s*\n?([\s\S]*?)\n?```/
    );
    if (fenceMatch) {
      code = fenceMatch[1].trim();
    }

    // [B6] Validate the generated script
    const validation = validateGeneratedScript(code);
    if (!validation.valid) {
      return {
        success: false,
        error: makeStepError(
          'SCRIPT_VALIDATION_FAILED',
          validation.reason!,
          this.userFacingErrorMessage,
          true,
        ),
      };
    }

    // [FIX: NB1] Bind script to entity via set_script command.
    // Verified against actual source:
    //   - web/src/lib/chat/handlers/scriptLibraryHandlers.ts (line 24-33):
    //     set_script handler accepts { entityId, source, enabled?, template? }
    //   - web/src/stores/slices/scriptSlice.ts (line 43):
    //     dispatches set_script with { entityId, source, enabled, template }
    // The command name is "set_script", NOT "update_script".
    // The payload does NOT have a "language" field -- TypeScript is the only
    // supported scripting language and is implicit.
    ctx.dispatchCommand('set_script', {
      entityId: targetEntityId,
      source: code,
      enabled: true,
    });

    // [FIX: NU1] Dynamic confidence based on script complexity
    const confidence = computeScriptConfidence(code);
    const confidenceWarnings: Record<string, string> = {
      high: 'This script is simple and likely correct.',
      medium: 'This script was AI-generated and may need manual adjustments.',
      low: 'This script is complex and should be reviewed carefully before use.',
    };

    return {
      success: true,
      output: {
        entityId: targetEntityId,
        scriptLength: code.length,
        lineCount: code.split('\n').length,
        confidence,                        // [FIX: NU1] Dynamic, not hardcoded
        warning: confidenceWarnings[confidence],
      },
    };
  },
};
```

#### auto_polish Executor Detail

**[B4] Resolution: Uses structural heuristics, NOT telemetry-based diagnoseIssues().**

```typescript
// web/src/lib/game-creation/executors/autoPolishExecutor.ts

import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError } from './shared';

// [B4] diagnoseIssues() requires GameMetrics (avgPlayTime, completionRate, etc.)
// which do not exist on a freshly-built game. auto_polish uses STRUCTURAL
// heuristics instead -- checking for common setup problems, not player behavior.

const inputSchema = z.object({
  projectType: z.enum(['2d', '3d']),
  feelDirective: z.object({
    mood: z.string(),
    pacing: z.enum(['slow', 'medium', 'fast']),
    weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
    referenceGames: z.array(z.string()),
    oneLiner: z.string(),
  }),
});

export const autoPolishExecutor: ExecutorDefinition = {
  name: 'auto_polish',
  inputSchema,
  userFacingErrorMessage:
    'Auto-polish could not run. Your game is ready as-is.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      };
    }

    // Read verification results from the prior verify step
    const verifyOutput = ctx.resolveStepOutput('verify_all_scenes');
    const issues = (verifyOutput?.issues as string[]) ?? [];

    const fixes: string[] = [];

    // [B4] Structural heuristics only -- no telemetry data required

    // [FIX: NB4] Use the correct command name: "update_ambient_light"
    // Verified against actual source:
    //   - mcp-server/manifest/commands.json (line 841): "update_ambient_light"
    //   - web/src/lib/chat/handlers/materialHandlers.ts (line 131):
    //     update_ambient_light handler accepts { color, brightness }
    // The command accepts { color: [r,g,b] (0-1), brightness: number }
    // NOT { color: [r,g,b,a], intensity: number }
    if (issues.includes('no_ambient_light')) {
      ctx.dispatchCommand('update_ambient_light', {
        color: [1, 1, 1],
        brightness: 0.3,
      });
      fixes.push('Added ambient lighting');
    }

    if (issues.includes('no_camera_on_player')) {
      ctx.dispatchCommand('set_game_camera', {
        mode: parsed.data.projectType === '2d'
          ? 'SideScroller'
          : 'ThirdPerson',
        followSmoothing: 0.8,
      });
      fixes.push('Added player camera');
    }

    if (issues.includes('no_ground_plane')) {
      ctx.dispatchCommand('spawn_entity', {
        entityType: 'plane',
        name: 'Ground',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 50, y: 1, z: 50 },
      });
      fixes.push('Added ground plane');
    }

    if (issues.includes('player_no_physics')) {
      ctx.dispatchCommand('update_physics', {
        gravityScale: 1,
        friction: 0.5,
      });
      fixes.push('Added physics to player');
    }

    return {
      success: true,
      output: {
        fixesApplied: fixes,
        fixCount: fixes.length,
      },
    };
  },
};
```

### Layer 6: System Registry

```typescript
// web/src/lib/game-creation/systems/index.ts

import type { GameSystem, OrchestratorGDD, ExecutorName } from '../types';

export interface SystemStepInput {
  executor: ExecutorName;
  input: Record<string, unknown>;
}

export interface SystemDefinition {
  category: string;
  types: string[];
  setupSteps: (system: GameSystem, gdd: OrchestratorGDD) => SystemStepInput[];
}

export const SYSTEM_REGISTRY = new Map<string, SystemDefinition>();

export function registerSystem(def: SystemDefinition): void {
  SYSTEM_REGISTRY.set(def.category, def);
}
```

```typescript
// web/src/lib/game-creation/systems/movement.ts

import type { SystemDefinition, SystemStepInput } from './index';
import { registerSystem } from './index';

const movementSystem: SystemDefinition = {
  category: 'movement',
  types: ['walk', 'walk+jump', 'fly', 'swim', 'drive', 'zero-gravity', 'climb'],
  setupSteps: (system, _gdd) => {
    const steps: SystemStepInput[] = [];

    // [S1] Profile key is determined by executor from feelDirective,
    // NOT by user config. Config is passed but executor controls what
    // gets applied.
    if (system.type.includes('jump') || system.type.includes('walk')) {
      steps.push({
        executor: 'physics_profile',
        input: { config: system.config },
      });
      steps.push({
        executor: 'character_setup',
        input: {
          entity: {
            name: 'Player',
            role: 'player',
            appearance: 'character',
            behaviors: [],
          },
        },
      });
    }

    if (system.type.includes('fly')) {
      steps.push({
        executor: 'physics_profile',
        input: { config: { ...system.config, gravity: 0.5 } },
      });
    }

    return steps;
  },
};

registerSystem(movementSystem);
```

---

## Cross-Module Interface Contracts

**[D3] Resolution: Define interface contracts explicitly. TypeScript compilation catches breaks.**

| Upstream Module | Function Used | Signature Contract | Injection Site |
|----------------|--------------|-------------------|----------------|
| `ai/physicsFeel.ts` | `applyPhysicsProfile` | `(profile: PhysicsProfile, dispatch: CommandDispatcher, entityIds: string[]) => void` | `physicsProfileExecutor.ts` |
| `ai/autoRigging.ts` | `generateRig` | `(modelDescription: string, rigType?: RigType) => Promise<RigTemplate>` | `characterSetupExecutor.ts` |
| `ai/autoRigging.ts` | `rigToCommands` | `(rig: RigTemplate, entityId: string) => EngineCommand[]` | `characterSetupExecutor.ts` |
| `ai/contentSafety.ts` | `sanitizePrompt` | `(prompt: string, maxLength?: number) => ContentSafetyResult` where `ContentSafetyResult = { safe: boolean; reason?: string; filtered?: string }` | `decomposer.ts`, `customScriptExecutor.ts` |
| `ai/client.ts` | `fetchAI` | `(message: string, options: FetchAIOptions) => Promise<string>` | `decomposer.ts`, `customScriptExecutor.ts` |
| `stores/userStore.ts` | `useUserStore` | `.getState().tier: Tier`, `.getState().tokenBalance: TokenBalance \| null` | [FIX: NB5] Orchestrator entry point (caller of `buildPlan`) |
| `stores/editorStore.ts` | `useEditorStore` | `.getState().dispatchCommand` | [FIX: NS3] Orchestrator entry point (constructs `ExecutorContext`) |

[FIX: NB5] The v2 spec incorrectly listed `TIER_MONTHLY_TOKENS` from `tokens/pricing.ts` as a contract entry. While `TIER_MONTHLY_TOKENS` does exist in that file (verified: `export const TIER_MONTHLY_TOKENS = { starter: 50, hobbyist: 300, creator: 1000, pro: 3000 }`), it is the monthly allocation for billing display -- NOT the user's current balance. The orchestrator needs the user's actual remaining balance, which comes from `useUserStore.getState().tokenBalance.total`.

All imports are direct TypeScript imports. If any upstream signature changes, `npx tsc --noEmit` will catch the break at compile time.

---

## Prerequisites (Blocking)

### S6: Shadow Reflect and Proxy in Script Worker

**Before `custom_script_generate` executor can be enabled**, the following change MUST be made to `web/src/lib/scripting/scriptWorker.ts`:

```typescript
// Current (line 911-917):
const SHADOWED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'indexedDB', 'caches', 'navigator', 'location',
  'EventSource', 'BroadcastChannel',
  'self', 'globalThis',
  'Function', 'eval',
] as const;

// Required -- add 'Reflect' and 'Proxy':
const SHADOWED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'indexedDB', 'caches', 'navigator', 'location',
  'EventSource', 'BroadcastChannel',
  'self', 'globalThis',
  'Function', 'eval',
  'Reflect', 'Proxy',       // S6 prerequisite
] as const;
```

This is a 1-line change with no impact on existing scripts (no legitimate script uses Reflect or Proxy). It MUST land before the Phase 2A PR is mergeable.

---

## File Plan

**[FIX: ND2] Honest file count. The tree below lists every file. Count verified by enumeration.**

Breakdown:
- Top-level: `types.ts`, `decomposer.ts`, `planBuilder.ts`, `pipelineRunner.ts`, `index.ts` = **5 files**
- Systems: `systems/index.ts`, `systems/movement.ts`, `systems/camera.ts`, `systems/world.ts`, `systems/entities.ts` = **5 files**
- Executors: `executors/index.ts`, `executors/shared.ts`, `executors/sceneCreateExecutor.ts`, `executors/physicsProfileExecutor.ts`, `executors/characterSetupExecutor.ts`, `executors/entitySetupExecutor.ts`, `executors/assetGenerateExecutor.ts`, `executors/customScriptExecutor.ts`, `executors/verifyExecutor.ts`, `executors/autoPolishExecutor.ts` = **10 files**
- Fixtures: 12 JSON files
- Tests: 8 test files

**Lib files: 5 + 5 + 10 = 20** [FIX: ND2]

Note: The v2 spec claimed 21 lib files. The actual count when enumerated file-by-file is **20**. The v2 text counted "4 systems + 10 executors + shared" and arrived at 21, but `shared.ts` was already counted in the 10 executor files. The corrected breakdown: 5 top-level + 5 system + 10 executor = 20.

```
web/src/lib/game-creation/
  types.ts                           # All interfaces, Zod schemas, ExecutorName union
  decomposer.ts                      # [B1] decomposeIntoSystems() with LLM prompt + Zod
  planBuilder.ts                     # [B2] GDD -> OrchestratorPlan with topological dependsOn
  pipelineRunner.ts                  # Generic step runner (0 external imports)
  index.ts                           # Public API: decomposeIntoSystems, buildPlan, runPipeline
  systems/
    index.ts                         # SYSTEM_REGISTRY map + registerSystem()
    movement.ts                      # Movement system definition
    camera.ts                        # Camera system definition
    world.ts                         # World/level system definition
    entities.ts                      # Entity setup system definition
  executors/
    index.ts                         # Executor registry (Map<ExecutorName, ExecutorDefinition>)
    shared.ts                        # [D2] makeStepError, shared error handling
    sceneCreateExecutor.ts           # scene_create
    physicsProfileExecutor.ts        # [B3][B5][S1] physics_profile
    characterSetupExecutor.ts        # [B5] character_setup (2D/3D routing)
    entitySetupExecutor.ts           # entity_setup
    assetGenerateExecutor.ts         # asset_generate with fallback
    customScriptExecutor.ts          # [B6] custom_script_generate
    verifyExecutor.ts                # verify_all_scenes (structural heuristics)
    autoPolishExecutor.ts            # [B4] auto_polish (structural, not telemetry)

  __fixtures__/                      # [D1] 12 fixtures
    rhythm-platformer.json
    exploration-puzzle.json
    narrative-adventure.json
    arena-combat.json
    sandbox-creative.json
    zero-movement.json               # No movement system (puzzle/card game)
    single-system.json               # Only one system (minimal)
    twenty-systems.json              # 20+ systems (stress test)
    vague-prompt.json                # Ambiguous user input
    adversarial-prompt.json          # Injection attempts + contradictions
    2d-sprite-game.json              # 2D project type
    cozy-farming.json                # Feel-directive-heavy (cozy, slow, light)

  __tests__/
    decomposer.test.ts               # [B1] 10+ tests: LLM output validation, retry, sanitization
    planBuilder.test.ts              # [B2] 15+ tests: topological sort, tier caps, gates
    pipelineRunner.test.ts           # 15+ tests: ordering, retry, abort, resume, gates
    verifyExecutor.test.ts           # 10+ tests: structural checks
    systemRegistry.test.ts           # 5+ tests: registration, unknown systems
    genreAgnosticism.test.ts         # [B10] Rewritten: excludes fixtures, word-boundary
    tokenEstimate.test.ts            # [U5] 5+ tests: cost accuracy, tier messaging
    executors.test.ts                # [D2] Tests for shared error handling + all executors
```

**Total: 20 lib + 12 fixtures + 8 test = 40 files** [FIX: ND2]

---

## Finding Resolution Cross-Reference

### Blockers (v1)

| ID | Finding | Resolution |
|----|---------|-----------|
| B1 | decomposeIntoSystems() unspecified | Full LLM prompt template, zDecompositionOutput Zod schema, retry loop in decomposer.ts. See Layer 2. |
| B2 | Step ordering broken | PlanStep.dependsOn: string[] field, topologicalSort() in pipelineRunner, entity steps before system steps. See Layers 3-4. |
| B3 | Feel directive missing | FeelDirective interface with mood/pacing/weight/referenceGames/oneLiner. FEEL_TO_PRESET mapping in physicsProfileExecutor. Propagated to all executors. |
| B4 | auto_polish uses telemetry | Replaced with structural heuristics in autoPolishExecutor. Reads verify step output. Does NOT call diagnoseIssues(). |
| B5 | character_setup 2D-only | characterSetupExecutor checks projectType: 2D uses rigToCommands (skeleton_2d), 3D uses add_game_component (CharacterController). |
| B6 | custom_script_generate underspecified | Full executor with: targetEntityId binding, SCRIPT_SYSTEM_PROMPT, FORBIDDEN_PATTERNS validation, `set_script` dispatch [FIX: NB1], dynamic confidence [FIX: NU1]. S6 prerequisite documented. |
| B7 | File count exceeds 15 | Honest count: 20 lib files [FIX: ND2]. Increase justified by B1/B2/B6/D2 findings. |
| B8 | GDD type collision | New type named OrchestratorGDD (not GameDesignDocument). Separate migration ticket to add adapter. detectGenre() deprecated, not removed. |
| B9 | String coupling, no type safety | ExecutorName union type. makeStep() parameter typed as ExecutorName. Compile-time checked. |
| B10 | genreAgnosticism test broken | Test rewritten: scans only non-test non-fixture .ts files, uses word-boundary regex, checks synonyms. |

### Security (v1)

| ID | Finding | Resolution |
|----|---------|-----------|
| S1 | Config spread order | physicsProfileExecutor: preset profile is the base, only whitelisted config keys (moveSpeed, jumpForce) are applied. Hardcoded values win. |
| S2 | Asset manifest tier cap | planBuilder accepts userTier param, applies ASSET_TIER_CAPS truncation before generating asset steps. |
| S3 | GDD fields unsanitized | decomposer.ts calls sanitizePrompt() on title, styleDirective, oneLiner, mood [FIX: NS2], referenceGames entries [FIX: NS2], constraints [FIX: NB3], and each asset styleDirective after LLM returns. |
| S4 | styleDirective unsanitized | Sanitized in decomposer (S3) and validated via Zod .max(500) length constraint. |
| S5 | Fallback string unvalidated | FALLBACK_SCHEMA = z.string().regex() validated in planBuilder before step creation. |
| S6 | Reflect/Proxy not shadowed | Documented as blocking prerequisite. Exact 1-line change specified. Must land before PR merge. |

### UX (v1)

| ID | Finding | Resolution |
|----|---------|-----------|
| U1 | System categories exposed to users | systemCategoryToUserLabel() maps categories to friendly labels. Approval gates use these labels, never raw category strings. |
| U2 | Custom script quality cliff | customScriptExecutor returns dynamic confidence (high/medium/low) [FIX: NU1] and context-appropriate warning in output. UI (Phase 2D) will display this. |
| U3 | Approval gates unspecified | ApprovalGate interface with ApprovalDisplayData -- specifies what each gate shows: scene summaries (gate_plan), asset list with costs (gate_assets), completion summary (gate_final). |
| U4 | Error messages developer-facing | Every ExecutorDefinition has userFacingErrorMessage. Every OrchestratorStepError has userFacingMessage. Plain English, not stack traces. |
| U5 | Token cost unspecified | TokenEstimate with per-category breakdown, sqrt-of-sum-of-squares variance [FIX: ND1], tier label, sufficiency check, and warning messages. Computed in planBuilder. |

### DX (v1)

| ID | Finding | Resolution |
|----|---------|-----------|
| D1 | 5 fixtures inadequate | 12 fixtures: zero-movement, single-system, 20+ systems, vague prompt, adversarial prompt, 2D game, cozy-farming (feel-directive heavy), plus 5 original. |
| D2 | No error consolidation | shared.ts provides makeStepError(). All executors use it. No per-executor error reinvention. |
| D3 | Cross-module deps fragile | Interface contracts table lists every upstream dependency with exact signature. TypeScript compilation catches breaks. |
| D4 | estimatedScope has 'tiny' | Removed 'tiny'. Uses existing GddScope type from @/lib/config/enums: 'small' | 'medium' | 'large'. |

### New Issues Fixed in v3 (v2 review)

| Fix ID | Finding | Resolution |
|--------|---------|-----------|
| NB1 | `update_script` wrong command name | Changed to `set_script` with payload `{ entityId, source, enabled: true }`. Removed `language` field. Verified against `scriptLibraryHandlers.ts` line 24-33 and `scriptSlice.ts` line 43. |
| NB2 | Approval gate trigger fragile (`dependsOn[0]`) | Runner now iterates ALL `step.dependsOn` entries, checking each against `gateAfterStep` map. A gate fires when any dependency's completion matches its `afterStepId`. Replaces the single `dependsOn[0]` check. |
| NB3 | `constraints` not checking `.safe` | Decomposer now checks `cResult.safe` before using `cResult.filtered`. Unsafe constraints (entirely injection content) are dropped from the array, not passed through to downstream prompts. |
| NB4 | `set_ambient_light` wrong command name | Changed to `update_ambient_light` with payload `{ color: [1,1,1], brightness: 0.3 }`. Verified against `commands.json` line 841 and `materialHandlers.ts` line 131. |
| NB5 | False `TIER_MONTHLY_TOKENS` contract | Removed from contracts table. `buildPlan()` is called by orchestrator entry point (`index.ts::createGame()`). `tokenBalance` comes from `useUserStore.getState().tokenBalance.total`. `userTier` from `useUserStore.getState().tier`. `TIER_MONTHLY_TOKENS` exists but is for billing display, not orchestration. |
| NS1 | `system.config` unsanitized in script prompt | Config values sanitized in `customScriptExecutor`: only primitives (string/number/boolean) included, strings run through `sanitizePrompt()`, objects/arrays/null excluded. |
| NS2 | `mood` and `referenceGames` unsanitized | Both sanitized in decomposer via `sanitizePrompt()` with `.safe` check before using `.filtered`. Applied to mood (single string) and each referenceGames entry (array of strings). |
| NS3 | `ExecutorContext` construction unspecified | Runner signature changed to accept `ctx: ExecutorContextLike` parameter. Passed as second arg to `executor.execute(input, ctx)`. Construction example provided in comment showing `useEditorStore.getState()` + `useUserStore.getState()`. `ExecutorContext` type updated to include `store: EditorState` [FIX: V4-2]. |
| NU1 | Hardcoded `confidence: 'medium'` | Dynamic `computeScriptConfidence()`: high (<30 lines AND <=2 namespaces), low (3+ namespaces OR >80 lines), medium (otherwise). Warning text varies by confidence level. |
| NU2 | Gate trigger fragility (same as NB2) | Resolved by NB2 fix -- same root cause, same solution. |
| ND1 | Variance aggregation uses `Math.max` | Changed to `sqrt(sum of (base * variance)^2)` for each category. Total variance computed as `sqrt(sum of all category varianceSumSq)`. Documented as known approximation assuming step independence. |
| ND2 | File count dishonest | Recounted file-by-file: 5 top-level + 5 systems + 10 executors = 20 lib files. 12 fixtures + 8 tests = 40 total files. v2 claimed 21 due to double-counting shared.ts. |

---

## genreAgnosticism Test (B10 Fix)

```typescript
// web/src/lib/game-creation/__tests__/genreAgnosticism.test.ts

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// [B10] Rewritten: fixture exclusion, word-boundary matching, synonym coverage

const GAME_CREATION_DIR = path.resolve(__dirname, '..');
const EXCLUDED_DIRS = ['__fixtures__', '__tests__', 'node_modules'];

// Genre words that must not appear in pipeline code (word-boundary match)
const GENRE_WORDS = [
  'genre',
  'platformer',
  'shooter',
  'rpg',
  'fps',
  'moba',
  'mmorpg',
  'roguelike',
  'roguelite',
  'metroidvania',
  'soulslike',
  'battle\\s*royale',
];

const GENRE_REGEX = new RegExp(
  `\\b(${GENRE_WORDS.join('|')})\\b`,
  'i'
);

function getSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getSourceFiles(full));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

describe('Genre agnosticism', () => {
  const sourceFiles = getSourceFiles(GAME_CREATION_DIR);

  it('has source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  for (const file of sourceFiles) {
    const relative = path.relative(GAME_CREATION_DIR, file);
    it(`${relative} contains no genre terminology`, () => {
      const content = fs.readFileSync(file, 'utf-8');
      // Strip single-line comments to avoid false positives
      const codeOnly = content
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
      const match = GENRE_REGEX.exec(codeOnly);
      expect(match).toBeNull();
    });
  }
});
```

---

## Acceptance Criteria

1. Given any free-text game description, When `decomposeIntoSystems()` is called, Then the OrchestratorGDD contains zero genre fields, all systems have valid SystemCategory values, feelDirective is populated, and mood + referenceGames are sanitized [FIX: NS2].

2. Given a GDD with an unknown system category, When the plan is built, Then a `custom_script_generate` step is created with proper targetEntityId binding.

3. Given a plan with 10 steps where step 5 fails, When the step has maxRetries: 2, Then the runner retries twice, and the step's userFacingErrorMessage is populated.

4. Given a failed asset generation step with fallback: "primitive:cube", When all retries exhausted, Then the fallback is validated against FALLBACK_SCHEMA and the pipeline continues.

5. Given a running pipeline, When signal.abort() is called, Then the current step completes and remaining steps are marked 'skipped'.

6. Given the full codebase, When genreAgnosticism.test.ts runs, Then no non-test non-fixture file in game-creation/ contains genre terminology.

7. Given 12 GDD fixtures, When each is run through buildPlan(), Then each produces a valid plan with all steps having resolvable executors and correct dependsOn chains.

8. Given a starter tier user with 10 assets in manifest, When buildPlan() is called, Then only 5 asset steps are generated (tier cap enforced).

9. Given a 2D project type, When character_setup executes, Then it dispatches rigToCommands (set_skeleton_2d). Given 3D, Then it dispatches add_game_component (CharacterController).

10. Given an approval gate with afterStepId matching a completed step, When the runner processes the next step depending on that completed step [FIX: NB2], Then execution pauses until onGateReached callback resolves.

11. Given a freshly-built game (no play metrics), When auto_polish runs, Then it uses structural heuristics from verify output, NOT diagnoseIssues(), and dispatches `update_ambient_light` [FIX: NB4] (not `set_ambient_light`).

12. Given a user prompt with injection attempts, When decomposeIntoSystems() processes it, Then sanitizePrompt() strips the injection, all GDD fields including mood, referenceGames [FIX: NS2], and constraints [FIX: NB3] are sanitized, and unsafe constraints are dropped.

13. Given a custom_script_generate step, When the generated script is <30 lines using <=2 forge namespaces, Then confidence is 'high'. When >80 lines or 3+ namespaces, Then confidence is 'low'. Otherwise 'medium' [FIX: NU1].

14. Given a custom_script_generate step with system.config containing nested objects or injection strings [FIX: NS1], When the LLM prompt is built, Then only sanitized primitive values appear in the prompt and objects/arrays are excluded.

---

## What This Spec Does NOT Cover

- **UI components** (OrchestratorPanel) -- Phase 2D
- **MCP command registration** -- Phase 2D
- **Automated playtesting / telemetry-based iteration** -- Phase 3
- **Full character pipeline (3D skeletal animation from scratch)** -- Phase 4
- **Plan persistence to DB** -- Phase 5
- **detectGenre() removal** -- separate cleanup ticket (deprecated, not removed)
- **Zustand slice** -- no new slice; in-memory state only until Phase 2D (UI panel)

---

## Constraints

| Resource | Budget | Phase 2A Impact |
|----------|--------|----------------|
| Frame time | 16ms | No render-time impact (all async, no Bevy systems) |
| WASM binary | ~15MB | No WASM changes |
| Command latency | < 1ms | Steps dispatch commands sequentially |
| LLM calls | 1-3 per plan | decompose (1) + custom scripts (0-N) |
| Lib file count | 20 | Revised from 15; justified by review findings [FIX: ND2] |
| Test count | 50+ | Across 8 test files |
