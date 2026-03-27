# Game Creation Orchestrator -- Phase 2A Spec (v2)

> **Status:** DRAFT -- Awaiting Approval
> **Date:** 2026-03-25
> **Revision:** v2 (addresses all findings from 4-reviewer panel)
> **Ticket:** TBD

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2026-03-25 | Initial draft |
| v2 | 2026-03-25 | Complete rewrite addressing 10 blockers, 6 security, 5 UX, 4 DX findings |

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
export interface ExecutorContext {
  dispatchCommand: (command: string, payload: unknown) => void;
  projectType: '2d' | '3d';
  userTier: UserTier;
  signal: AbortSignal;
  resolveStepOutput: (stepId: string) => Record<string, unknown> | undefined;
}

export type UserTier = 'starter' | 'hobbyist' | 'creator' | 'pro';

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
import type { OrchestratorGDD, SystemCategory } from './types';

// --- Zod schema for LLM output validation ---

const SYSTEM_CATEGORIES: SystemCategory[] = [
  'movement', 'input', 'camera', 'world', 'challenge',
  'entities', 'progression', 'feedback', 'narrative',
  'audio', 'visual', 'physics',
];

const zSystemCategory = z.enum(SYSTEM_CATEGORIES as [string, ...string[]]);

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
        oneLiner: sanitizedOneLiner.safe
          ? sanitizedOneLiner.filtered!
          : data.feelDirective.oneLiner.slice(0, 200),
      },
      constraints: data.constraints.map(
        c => sanitizePrompt(c, 200).filtered ?? c.slice(0, 200)
      ),
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

export function buildPlan(
  gdd: OrchestratorGDD,
  projectId: string,
  userTier: UserTier,          // [S2] Required for asset cap enforcement
  tokenBalance: number,        // [U5] For sufficiency check
): OrchestratorPlan {
  const steps: PlanStep[] = [];
  let stepCounter = 0;

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
  const lastEntityStepId = allEntityStepIds[allEntityStepIds.length - 1]
    ?? 'step_0';
  const approvalGates: ApprovalGate[] = [
    {
      id: 'gate_plan',
      label: 'Review your game plan',
      description: 'Check the scenes, entities, and systems before building starts.',
      afterStepId: 'step_0',
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
    {
      id: 'gate_assets',
      label: 'Confirm asset generation',
      description: `Generating ${cappedAssets.length} assets will use tokens. Review the list and estimated costs.`,
      afterStepId: lastEntityStepId,
      status: 'pending',
      displayData: {
        assetList: cappedAssets.map(a => ({
          description: a.description,
          type: a.type,
          estimatedTokenCost: TOKEN_COSTS.asset_generate.base,
          hasFallback: FALLBACK_SCHEMA.safeParse(a.fallback).success,
        })),
      },
    },
    {
      id: 'gate_final',
      label: 'Final review',
      description: 'Your game is built. Review before applying polish.',
      afterStepId: verifyStep.id,
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
  const costByCategory: Record<string, { tokens: number; variance: number }> = {};
  for (const step of steps) {
    const cost = TOKEN_COSTS[step.executor] ?? { base: 0, variance: 0 };
    const cat = step.executor === 'asset_generate'
      ? 'Asset creation'
      : step.executor === 'custom_script_generate'
        ? 'Script generation'
        : 'Engine operations';
    if (!costByCategory[cat]) {
      costByCategory[cat] = { tokens: 0, variance: 0 };
    }
    costByCategory[cat].tokens += cost.base;
    costByCategory[cat].variance = Math.max(
      costByCategory[cat].variance, cost.variance
    );
  }

  const breakdown: TokenEstimate['breakdown'] = [];
  for (const [category, { tokens, variance }] of Object.entries(costByCategory)) {
    breakdown.push({ category, estimatedTokens: tokens, variance });
  }

  const totalEstimated = breakdown.reduce((s, b) => s + b.estimatedTokens, 0);
  const totalVarianceHigh = Math.round(totalEstimated * 1.4);
  const totalVarianceLow = Math.round(totalEstimated * 0.7);

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

interface ExecutorLike {
  execute: (
    input: Record<string, unknown>
  ) => Promise<{
    success: boolean;
    output?: Record<string, unknown>;
    error?: StepLike['error'];
  }>;
  userFacingErrorMessage: string;
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

export async function runPipeline(
  steps: StepLike[],
  gates: GateLike[],
  executorRegistry: Map<string, ExecutorLike>,
  callbacks: PipelineCallbacks,
  signal: AbortSignal,
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

  // Build gate lookup: afterStepId -> gate
  const gateAfterStep = new Map<string, GateLike>();
  for (const gate of gates) {
    gateAfterStep.set(gate.afterStepId, gate);
  }

  for (const step of sorted) {
    // Check abort
    if (signal.aborted) {
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

    // Check if an approval gate triggers before this step
    const gate = gateAfterStep.get(step.dependsOn[0] ?? '');
    if (gate && gate.status === 'pending' && callbacks.onGateReached) {
      const decision = await callbacks.onGateReached(gate.id);
      gate.status = decision;
      if (decision === 'rejected') {
        for (const remaining of sorted) {
          if (remaining.status === 'pending') {
            remaining.status = 'skipped';
            skippedCount++;
          }
        }
        break;
      }
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
      if (signal.aborted) break;
      const result = await executor.execute(step.input);
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
  signal: AbortSignal,
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
  return runPipeline(steps, gates, executorRegistry, callbacks, signal);
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

const inputSchema = z.object({
  system: z.object({
    category: z.string(),
    type: z.string(),
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

    const userMessage = [
      `Generate a script for entity "${targetEntityId}" (project: ${projectType}).`,
      `System: ${system.category}:${system.type}`,
      `Behavior: ${sanitized.filtered}`,
      `Config: ${JSON.stringify(system.config)}`,
    ].join('\n');

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

    // [B6] Bind script to entity via update_script command
    ctx.dispatchCommand('update_script', {
      entityId: targetEntityId,
      source: code,
      language: 'typescript',
    });

    return {
      success: true,
      output: {
        entityId: targetEntityId,
        scriptLength: code.length,
        // [U2] Confidence indicator for custom scripts
        confidence: 'medium',
        warning: 'This script was AI-generated and may need manual adjustments.',
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
    if (issues.includes('no_ambient_light')) {
      ctx.dispatchCommand('set_ambient_light', {
        color: [1, 1, 1, 1],
        intensity: 0.3,
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
| `ai/contentSafety.ts` | `sanitizePrompt` | `(prompt: string, maxLength?: number) => ContentSafetyResult` | `decomposer.ts`, `customScriptExecutor.ts` |
| `ai/client.ts` | `fetchAI` | `(message: string, options: FetchAIOptions) => Promise<string>` | `decomposer.ts`, `customScriptExecutor.ts` |
| `tokens/pricing.ts` | `TIER_MONTHLY_TOKENS` | `Record<string, number>` | `planBuilder.ts` (for cost estimates) |

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

**[B7] Resolution: Honest file count. Actual count is 18 lib files, exceeding the original 15-file cap. Justification: reviewers identified 6 new required files (decomposer, shared error helper, 4 additional executor details for complete coverage). The 15-file cap was set before B1/B2/B6/D2 findings revealed necessary scope. 18 is the revised cap.**

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
```

**Lib files: 21** (types + decomposer + planBuilder + pipelineRunner + index + 4 systems + 10 executors + shared)

Honest admission: this exceeds both the original 15-file cap and the "revised 18" noted above. The actual count is 21 source files. The increase from 15 to 21 is driven by:
- decomposer.ts (B1 -- was unspecified, now fully specified)
- shared.ts (D2 -- error consolidation)
- 4 additional system definition files (movement, camera, world, entities)
- All 10 executors explicitly defined (v1 only had 8, reviewer findings added detail)

The 15-file cap was aspirational and did not account for the complexity revealed by review. 21 files is the honest number.

```
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

**Total: 21 lib + 12 fixtures + 8 test = 41 files**

---

## Finding Resolution Cross-Reference

### Blockers

| ID | Finding | Resolution |
|----|---------|-----------|
| B1 | decomposeIntoSystems() unspecified | Full LLM prompt template, zDecompositionOutput Zod schema, retry loop in decomposer.ts. See Layer 2. |
| B2 | Step ordering broken | PlanStep.dependsOn: string[] field, topologicalSort() in pipelineRunner, entity steps before system steps. See Layers 3-4. |
| B3 | Feel directive missing | FeelDirective interface with mood/pacing/weight/referenceGames/oneLiner. FEEL_TO_PRESET mapping in physicsProfileExecutor. Propagated to all executors. |
| B4 | auto_polish uses telemetry | Replaced with structural heuristics in autoPolishExecutor. Reads verify step output. Does NOT call diagnoseIssues(). |
| B5 | character_setup 2D-only | characterSetupExecutor checks projectType: 2D uses rigToCommands (skeleton_2d), 3D uses add_game_component (CharacterController). |
| B6 | custom_script_generate underspecified | Full executor with: targetEntityId binding, SCRIPT_SYSTEM_PROMPT, FORBIDDEN_PATTERNS validation, update_script dispatch, confidence indicator. S6 prerequisite documented. |
| B7 | File count exceeds 15 | Honest count: 21 lib files. Increase justified by B1/B2/B6/D2 findings. Original cap did not account for review-identified scope. |
| B8 | GDD type collision | New type named OrchestratorGDD (not GameDesignDocument). Separate migration ticket to add adapter. detectGenre() deprecated, not removed. |
| B9 | String coupling, no type safety | ExecutorName union type. makeStep() parameter typed as ExecutorName. Compile-time checked. |
| B10 | genreAgnosticism test broken | Test rewritten: scans only non-test non-fixture .ts files, uses word-boundary regex, checks synonyms. |

### Security

| ID | Finding | Resolution |
|----|---------|-----------|
| S1 | Config spread order | physicsProfileExecutor: preset profile is the base, only whitelisted config keys (moveSpeed, jumpForce) are applied. Hardcoded values win. |
| S2 | Asset manifest tier cap | planBuilder accepts userTier param, applies ASSET_TIER_CAPS truncation before generating asset steps. |
| S3 | GDD fields unsanitized | decomposer.ts calls sanitizePrompt() on title, styleDirective, oneLiner, constraints, and each asset styleDirective after LLM returns. |
| S4 | styleDirective unsanitized | Sanitized in decomposer (S3) and validated via Zod .max(500) length constraint. |
| S5 | Fallback string unvalidated | FALLBACK_SCHEMA = z.string().regex() validated in planBuilder before step creation. |
| S6 | Reflect/Proxy not shadowed | Documented as blocking prerequisite. Exact 1-line change specified. Must land before PR merge. |

### UX

| ID | Finding | Resolution |
|----|---------|-----------|
| U1 | System categories exposed to users | systemCategoryToUserLabel() maps categories to friendly labels. Approval gates use these labels, never raw category strings. |
| U2 | Custom script quality cliff | customScriptExecutor returns confidence: 'medium' and warning in output. UI (Phase 2D) will display this. |
| U3 | Approval gates unspecified | ApprovalGate interface with ApprovalDisplayData -- specifies what each gate shows: scene summaries (gate_plan), asset list with costs (gate_assets), completion summary (gate_final). |
| U4 | Error messages developer-facing | Every ExecutorDefinition has userFacingErrorMessage. Every OrchestratorStepError has userFacingMessage. Plain English, not stack traces. |
| U5 | Token cost unspecified | TokenEstimate with per-category breakdown, variance ranges, tier label, sufficiency check, and warning messages. Computed in planBuilder. |

### DX

| ID | Finding | Resolution |
|----|---------|-----------|
| D1 | 5 fixtures inadequate | 12 fixtures: zero-movement, single-system, 20+ systems, vague prompt, adversarial prompt, 2D game, cozy-farming (feel-directive heavy), plus 5 original. |
| D2 | No error consolidation | shared.ts provides makeStepError(). All executors use it. No per-executor error reinvention. |
| D3 | Cross-module deps fragile | Interface contracts table lists every upstream dependency with exact signature. TypeScript compilation catches breaks. |
| D4 | estimatedScope has 'tiny' | Removed 'tiny'. Uses existing GddScope type from @/lib/config/enums: 'small' | 'medium' | 'large'. |

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

1. Given any free-text game description, When `decomposeIntoSystems()` is called, Then the OrchestratorGDD contains zero genre fields, all systems have valid SystemCategory values, and feelDirective is populated.

2. Given a GDD with an unknown system category, When the plan is built, Then a `custom_script_generate` step is created with proper targetEntityId binding.

3. Given a plan with 10 steps where step 5 fails, When the step has maxRetries: 2, Then the runner retries twice, and the step's userFacingErrorMessage is populated.

4. Given a failed asset generation step with fallback: "primitive:cube", When all retries exhausted, Then the fallback is validated against FALLBACK_SCHEMA and the pipeline continues.

5. Given a running pipeline, When signal.abort() is called, Then the current step completes and remaining steps are marked 'skipped'.

6. Given the full codebase, When genreAgnosticism.test.ts runs, Then no non-test non-fixture file in game-creation/ contains genre terminology.

7. Given 12 GDD fixtures, When each is run through buildPlan(), Then each produces a valid plan with all steps having resolvable executors and correct dependsOn chains.

8. Given a starter tier user with 10 assets in manifest, When buildPlan() is called, Then only 5 asset steps are generated (tier cap enforced).

9. Given a 2D project type, When character_setup executes, Then it dispatches rigToCommands (set_skeleton_2d). Given 3D, Then it dispatches add_game_component (CharacterController).

10. Given an approval gate with status: 'pending', When the pipeline reaches it, Then execution pauses until onGateReached callback resolves.

11. Given a freshly-built game (no play metrics), When auto_polish runs, Then it uses structural heuristics from verify output, NOT diagnoseIssues().

12. Given a user prompt with injection attempts, When decomposeIntoSystems() processes it, Then sanitizePrompt() strips the injection and all GDD fields are also sanitized before any second-stage LLM call.

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
| Lib file count | 21 | Revised from 15; justified by review findings |
| Test count | 50+ | Across 8 test files |
