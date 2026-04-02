/**
 * Plan Builder for the Game Creation Orchestrator.
 *
 * Converts an OrchestratorGDD into a topologically-sorted OrchestratorPlan
 * with tier caps, approval gates, and token estimation.
 *
 * Approved spec: specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md
 * Resolution [B2]: Explicit dependsOn on every step, topological sort.
 */

import type {
  OrchestratorGDD,
  OrchestratorPlan,
  PlanStep,
  ApprovalGate,
  TokenEstimate,
  ExecutorName,
  UserTier,
  SystemCategory,
  GameSystem,
} from './types';
import { FALLBACK_SCHEMA } from './types';
import { SYSTEM_REGISTRY } from './systems';

// --- Topological sort for system dependency ordering ---
// Ensures systems are processed after their dependsOn categories.
// Within same depth, sorted by priority (core first).
function topoSortSystems(
  systems: GameSystem[],
  priorityOrder: Record<string, number>,
): GameSystem[] {
  const byCategory = new Map<SystemCategory, GameSystem>();
  for (const s of systems) {
    byCategory.set(s.category, s);
  }

  const visited = new Set<SystemCategory>();
  const inStack = new Set<SystemCategory>(); // cycle detection
  const result: GameSystem[] = [];

  function visit(system: GameSystem): void {
    if (visited.has(system.category)) return;
    if (inStack.has(system.category)) {
      // Cycle detected — break it by skipping this dependency
      return;
    }
    inStack.add(system.category);
    // Visit dependencies first
    for (const dep of system.dependsOn) {
      const depSystem = byCategory.get(dep);
      if (depSystem) {
        visit(depSystem);
      }
    }
    inStack.delete(system.category);
    visited.add(system.category);
    result.push(system);
  }

  // Sort by priority first so that within same dependency depth, core comes first
  const sorted = [...systems].sort(
    (a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2),
  );
  for (const system of sorted) {
    visit(system);
  }
  return result;
}

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
  userTier: UserTier,    // [S2] Required for asset cap enforcement
  tokenBalance: number,  // [FIX: NB5] Current balance from useUserStore
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

  // --- Phase 0: Plan presentation (no-op step for gate_plan to anchor on) ---
  // gate_plan fires AFTER afterStepId completes. If we anchor on the first
  // scene_create step, one scene is already created before the user reviews.
  // A no-op step_0 lets the gate fire before any engine commands.
  const planPresentStep = makeStep('plan_present', {
    sceneCount: gdd.scenes.length,
    systemCount: gdd.systems.length,
    entityCount: gdd.scenes.reduce((n, s) => n + s.entities.length, 0),
  });
  steps.push(planPresentStep);

  // --- Phase 1: Scene creation ---
  const sceneStepIds: Record<string, string> = {};
  for (const scene of gdd.scenes) {
    const step = makeStep('scene_create', {
      name: scene.name,
      purpose: scene.purpose,
    }, [planPresentStep.id]); // Depend on plan_present so scenes wait for gate
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
          projectType: gdd.projectType, // [B5] Propagated
        },
        [sceneStepId],
      );
      // Scope entity step IDs by scene to avoid collisions when
      // entities in different scenes share the same name
      entityStepIds[`${scene.name}:${entity.name}`] = step.id;
      steps.push(step);
    }
  }

  // --- Phase 3: System configuration (depends on entities) ---
  // [B2] Systems declare dependsOn categories. We resolve to step IDs.
  const systemCategoryStepIds: Record<string, string[]> = {};

  // Topological sort: systems with dependencies come after their dependencies.
  // Within the same dependency depth, sort by priority (core > secondary > polish).
  const PRIORITY_ORDER: Record<string, number> = {
    core: 0,
    secondary: 1,
    polish: 2,
  };
  const orderedSystems = topoSortSystems(gdd.systems, PRIORITY_ORDER);

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
            projectType: gdd.projectType,    // [B5]
            feelDirective: gdd.feelDirective, // [B3]
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
      // Find the first entity that declares this system category, or fall back
      // to the first entity in the GDD. The customScriptExecutor requires
      // targetEntityId to bind the generated script to an entity.
      let targetEntityId = '';
      for (const scene of gdd.scenes) {
        for (const entity of scene.entities) {
          if (entity.systems.includes(system.category)) {
            targetEntityId = entity.name;
            break;
          }
        }
        if (targetEntityId) break;
      }
      if (!targetEntityId && gdd.scenes.length > 0 && gdd.scenes[0].entities.length > 0) {
        targetEntityId = gdd.scenes[0].entities[0].name;
      }

      // If no entity exists to bind the script to, mark step as optional
      // so the pipeline doesn't abort — the system simply won't have a script
      const hasTarget = targetEntityId.length > 0;
      const step = makeStep(
        'custom_script_generate',
        {
          system,
          description: `Implement ${system.category}:${system.type} behavior`,
          targetEntityId: hasTarget ? targetEntityId : 'unbound',
          projectType: gdd.projectType,
          feelDirective: gdd.feelDirective,
        },
        systemDeps,
        !hasTarget, // optional when no entity to bind to
      );
      steps.push(step);
    }
  }

  // --- Phase 4: Asset generation (depends on entities + systems) ---
  // [S2] Truncate asset manifest to tier cap
  const allPriorStepIds = steps.map(s => s.id);
  const tierCap = ASSET_TIER_CAPS[userTier];
  // Copy before sorting to avoid mutating gdd.assetManifest in-place
  const cappedAssets = [...gdd.assetManifest]
    .sort(
      (a, b) =>
        (a.priority === 'required' ? 0 : 1) - (b.priority === 'required' ? 0 : 1),
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

  const polishStep = makeStep(
    'auto_polish',
    {
      projectType: gdd.projectType,
      feelDirective: gdd.feelDirective,
    },
    [verifyStep.id],
  );
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
      afterStepId: 'step_0', // [FIX: V4-1] First scene step is step_0
      status: 'pending',
      displayData: {
        sceneSummaries: gdd.scenes.map(s => ({
          name: s.name,
          entityCount: s.entities.length,
          // [U1] User-friendly descriptions, not system category names
          systemDescriptions: s.systems.map(cat => systemCategoryToUserLabel(cat)),
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
      afterStepId: lastEntityStepId, // After all entities are created
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

  approvalGates.push({
    id: 'gate_final',
    label: 'Final review',
    description: 'Your game is built. Review before applying polish.',
    afterStepId: verifyStep.id, // After verification completes
    status: 'pending',
    displayData: {
      completionSummary: {
        totalEntities: gdd.scenes.reduce((sum, s) => sum + s.entities.length, 0),
        totalScenes: gdd.scenes.length,
        totalScripts: steps.filter(s => s.executor === 'custom_script_generate').length,
        warnings: [],
      },
    },
  });

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
    const cat =
      step.executor === 'asset_generate'
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
    Object.values(costByCategory).reduce((s, c) => s + c.varianceSumSq, 0),
  );
  const totalVarianceHigh = Math.round(totalEstimated + totalAbsVariance);
  const totalVarianceLow = Math.round(Math.max(0, totalEstimated - totalAbsVariance));

  const tierLabel = `${userTier.charAt(0).toUpperCase() + userTier.slice(1)} tier`;
  const pctOfBalance =
    tokenBalance > 0 ? Math.round((totalEstimated / tokenBalance) * 100) : 100;

  const tokenEstimate: TokenEstimate = {
    breakdown,
    totalEstimated,
    totalVarianceHigh,
    totalVarianceLow,
    userTier: tierLabel,
    sufficientBalance: tokenBalance >= totalVarianceHigh,
    warningMessage:
      pctOfBalance > 80
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
