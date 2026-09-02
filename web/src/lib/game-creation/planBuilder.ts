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
import { SYSTEM_REGISTRY, defaultWinConditionStep } from './systems';
import type { PlannedEntity } from './systems';
import { physicsProfileForRole } from './physicsRoles';
import { planBehaviorSteps } from './behaviorSteps';
import { resolveEntityShape } from './entityShape';
import { TIER_DISPLAY_NAMES } from '@/lib/billing/tierPlans';

// --- Topological sort for system dependency ordering ---
// Ensures systems are processed after their dependsOn categories.
// Within same depth, sorted by priority (core first).
//
// A cyclic dependsOn graph is a build-time error, not something to route
// around silently: it must FAIL loudly (naming the offending cycle), never
// hang, and never silently drop a step to break the cycle.
function topoSortSystems(
  systems: GameSystem[],
  priorityOrder: Record<string, number>,
): GameSystem[] {
  // Sort by priority first so that within same dependency depth — and within
  // a single category — core comes before secondary before polish.
  const sorted = [...systems].sort(
    (a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2),
  );

  // Several systems may legitimately share a category: there are only 12
  // categories and a real game routinely wants more mechanics than that
  // (walk + swim, enemy waves + environmental hazards). The graph node is
  // therefore the CATEGORY, and every system in it is emitted together —
  // keying the visited set by category while emitting one system per node
  // silently dropped all but the first, so the user got a plan missing a
  // mechanic they asked for, with nothing surfaced anywhere.
  const byCategory = new Map<SystemCategory, GameSystem[]>();
  for (const s of sorted) {
    const bucket = byCategory.get(s.category);
    if (bucket) {
      bucket.push(s);
    } else {
      byCategory.set(s.category, [s]);
    }
  }

  const visited = new Set<SystemCategory>();
  const stackPath: SystemCategory[] = []; // ordered path, for cycle reporting
  const inStack = new Set<SystemCategory>(); // cycle detection
  const result: GameSystem[] = [];

  function visit(category: SystemCategory): void {
    if (visited.has(category)) return;
    if (inStack.has(category)) {
      const cycleStart = stackPath.indexOf(category);
      const cyclePath = [...stackPath.slice(cycleStart), category];
      throw new Error(
        `Cyclic system dependency detected: ${cyclePath.join(' -> ')}`,
      );
    }
    const bucket = byCategory.get(category);
    if (!bucket) return;

    stackPath.push(category);
    inStack.add(category);
    // A category is ready only once the dependencies of EVERY system in it
    // have been emitted.
    for (const system of bucket) {
      for (const dep of system.dependsOn) {
        if (byCategory.has(dep)) {
          visit(dep);
        }
      }
    }
    stackPath.pop();
    inStack.delete(category);
    visited.add(category);
    result.push(...bucket);
  }

  for (const system of sorted) {
    visit(system.category);
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
// Base costs are derived from pricing.ts TOKEN_COSTS where applicable.
// Variance is the proportional uncertainty for cost estimation UI.
import { TOKEN_COSTS as PRICING } from '@/lib/tokens/pricing';

const PLAN_COST_ESTIMATES: Record<string, { base: number; variance: number }> = {
  scene_create: { base: 0, variance: 0 },
  // Two engine commands per entity and no model call.
  physics_enable: { base: 0, variance: 0 },
  physics_profile: { base: 0, variance: 0 },
  // Pure engine dispatch, no model call — same as the two above.
  camera_setup: { base: 0, variance: 0 },
  character_setup: { base: 0, variance: 0 },
  game_component: { base: 0, variance: 0 },
  // ZERO, and deliberately unlike `custom_script_generate` below. A behaviour
  // step attaches a template that ships in the repo: no model call, no network,
  // no tokens. Pricing it like a generated script would put a cost on the
  // approval gate that the run never incurs, and would make the engine-native
  // path look like the expensive one.
  behavior_script: { base: 0, variance: 0 },
  entity_setup: { base: PRICING.plan_entity_setup, variance: 0.1 },
  // Spawns the ground/platforms/walls the world system planned. Pure engine
  // dispatch — the geometry was decided at plan time, so no model is called.
  world_build: { base: 0, variance: 0 },
  asset_generate: { base: PRICING.plan_asset_generate, variance: 0.4 },
  custom_script_generate: { base: PRICING.plan_script_generate, variance: 0.3 },
  verify_all_scenes: { base: 0, variance: 0 },
  auto_polish: { base: PRICING.plan_auto_polish, variance: 0.2 },
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
/**
 * Does the plan already carry a win condition?
 *
 * Indexed reads, never `.some`: a callback form skips array holes, so a sparse
 * step list would report "yes, covered" for a plan carrying nothing — and this
 * predicate failing open is exactly the unplayable game it exists to prevent.
 */
function plansAWinCondition(planned: PlanStep[]): boolean {
  for (let i = 0; i < planned.length; i += 1) {
    const step = planned[i];
    if (!step) continue;
    if (step.executor === 'game_component' && step.input.type === 'winCondition') return true;
  }
  return false;
}

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
  // The engine identifies entities by their `EntityId` component, which defaults
  // to a random UUID it never reports back synchronously. `spawn_entity` accepts
  // a caller-supplied id precisely so JS can reference the entity without waiting
  // for the async SELECTION_CHANGED round-trip — so the plan mints the id here and
  // every later step binds to it. Binding to the designed NAME instead matches no
  // entity in the engine, and the engine's match loops emit nothing on a miss.
  const entityIds: Record<string, string> = {};
  // Same ids, in declaration order, for system definitions that must target an
  // entity (e.g. movement's character_setup) but are not driven by this loop.
  const plannedEntities: PlannedEntity[] = [];
  // Plan-level warnings raised while systems are being planned. A system that
  // cannot plan one of its steps drops it and says so here rather than emitting
  // a step certain to fail — a non-optional step failing sets the whole plan to
  // `failed`, discarding everything else the build would have produced. These
  // surface on the final approval gate.
  const planWarnings: string[] = [];
  for (const scene of gdd.scenes) {
    const sceneStepId = sceneStepIds[scene.name];
    for (const entity of scene.entities) {
      const entityId = crypto.randomUUID();
      const step = makeStep(
        'entity_setup',
        {
          entity,
          entityId,
          scene: scene.name,
          projectType: gdd.projectType, // [B5] Propagated
        },
        [sceneStepId],
      );
      // Scope entity step IDs by scene to avoid collisions when
      // entities in different scenes share the same name
      entityStepIds[`${scene.name}:${entity.name}`] = step.id;
      entityIds[`${scene.name}:${entity.name}`] = entityId;
      plannedEntities.push({ entityId, scene: scene.name, entity });
      steps.push(step);
    }
  }

  // All entity step IDs as a baseline dependency for later steps.
  const allEntityStepIds = Object.values(entityStepIds);

  // --- Phase 2.5: Physics enablement (depends on every entity existing) ---
  // The engine attaches a Rapier collider only to an entity carrying
  // `PhysicsEnabled`, and `runtime.active_collisions` is built purely from the
  // `CollisionEvent`s those colliders emit. Without this step the pipeline
  // spawned a player, a floor and a set of collectibles and then never made any
  // of them solid: nothing collided, `system_collectible` never fired, score
  // never moved and `game_win` was unreachable (PF-1213).
  //
  // It sits here, before Phase 3, because every later consumer needs the bodies
  // to already exist: `physics_profile` tunes mass and friction on them,
  // `character_setup` rigs the controller that walks one around, and
  // `verify_all_scenes` decides whether the game is winnable. `runPipeline`
  // executes steps in ARRAY ORDER (dependsOn only gates), so this placement is
  // the ordering.
  const physicsEnableEntities: Array<{
    entityId: string;
    name: string;
    role: string;
    shape: string;
  }> = [];
  for (let i = 0; i < plannedEntities.length; i += 1) {
    const planned = plannedEntities[i];
    // A role with no profile gets no body on purpose — the GDD files the camera
    // rig and the key light as `decoration`, and a collider on those would drop
    // an invisible wall at the origin of every generated game.
    if (!physicsProfileForRole(planned.entity.role)) continue;
    physicsEnableEntities.push({
      entityId: planned.entityId,
      name: planned.entity.name,
      role: planned.entity.role,
      // Resolved from the SAME function `entity_setup` spawns with, so the
      // collider provably matches the mesh rather than approximating it.
      shape: resolveEntityShape(planned.entity.role, planned.entity.appearance, gdd.projectType),
    });
  }

  // EVERY enablement step, not just this one: `systems/world.ts` plans a second
  // `physics_enable` for the ground, platforms and walls it mints, and the feel
  // pass below has to come after ALL of them.
  const physicsEnableStepIds: string[] = [];
  if (physicsEnableEntities.length > 0) {
    const physicsEnableStep = makeStep(
      'physics_enable',
      { entities: physicsEnableEntities },
      allEntityStepIds,
    );
    physicsEnableStepIds.push(physicsEnableStep.id);
    steps.push(physicsEnableStep);
  }

  // --- Phase 2.6: Per-entity behaviour (PF-1114) ---
  //
  // The GDD's `behavior` verb becomes a `follower` / `movingPlatform` component
  // or a parameterized script, per `BEHAVIOR_PLANS`. It sits HERE, after Phase
  // 2.5, because every behaviour acts on a body: `system_follower` writes the
  // Transform of an entity the physics pass has already made solid, and a
  // behaviour script that translates an entity with no collider moves a thing
  // nothing can touch.
  //
  // It also sits BEFORE Phase 3 so the ownership rule reads in execution order:
  // `systems/challenge.ts` skips any entity carrying a `behavior` (see
  // `hasAuthoredBehavior`), so the per-entity intent is planned first and the
  // system-level default fills in around it. Two writers for one component is
  // the bug that rule exists to prevent, not a redundancy.
  const behaviorDeps = [...allEntityStepIds, ...physicsEnableStepIds];
  const behaviorSteps = planBehaviorSteps(gdd, plannedEntities, message =>
    planWarnings.push(message),
  );
  for (let i = 0; i < behaviorSteps.length; i += 1) {
    const behaviorStep = behaviorSteps[i];
    if (!behaviorStep) continue;
    steps.push(
      makeStep(
        behaviorStep.executor,
        {
          ...behaviorStep.input,
          // Same two fields Phase 3 injects into every system step.
          // `gameComponentExecutor`'s discriminated union strips both; the
          // behaviour script executor reads `projectType` and strips the rest.
          projectType: gdd.projectType,
          feelDirective: gdd.feelDirective,
        },
        behaviorDeps,
      ),
    );
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

  // The movement feel pass, held back until every system has been planned.
  // See the deferral note inside the loop.
  const deferredFeelSteps: Array<{ input: Record<string, unknown>; dependsOn: string[] }> = [];

  for (const system of orderedSystems) {
    const def = SYSTEM_REGISTRY.get(system.category);
    // Physics enablement is a baseline dependency alongside the entities
    // themselves: a system step that tunes or rigs a body must not run before
    // the body exists.
    const systemDeps = [...allEntityStepIds, ...physicsEnableStepIds];

    // Add dependency on steps from categories this system depends on
    for (const depCat of system.dependsOn) {
      const depSteps = systemCategoryStepIds[depCat];
      if (depSteps) {
        systemDeps.push(...depSteps);
      }
    }

    if (def) {
      const systemSteps = def.setupSteps(system, gdd, {
        entities: plannedEntities,
        warn: message => planWarnings.push(message),
      });
      for (const stepInput of systemSteps) {
        // [S1] Hardcoded values injected by executor, not spread from config
        const stepPayload: Record<string, unknown> = {
          ...stepInput.input,
          // [B5] Required by `character_setup` and `entity_setup`, neither of
          // which is given it by the system registry that builds these steps
          // (`systems/movement.ts` supplies only movementType/systemConfig/
          // entityId/entity). `physics_profile` no longer declares it — it
          // reads `ctx.projectType` — so zod strips it there; that is the
          // intended shape, not a leak.
          projectType: gdd.projectType,
          feelDirective: gdd.feelDirective, // [B3]
        };

        // THE FEEL PASS IS DEFERRED TO THE END OF THIS PHASE.
        //
        // `physics_profile` tunes friction, restitution and gravity on every
        // entity that has a body, and it finds them through
        // `resolveStepOutputs('physics_enable')` — which can only report steps
        // that have ALREADY run. `systems/world.ts` plans a SECOND
        // `physics_enable` for the ground, platforms and walls, and nothing in
        // `topoSortSystems` puts `world` before `movement`: both are `core`, so
        // the order is whatever the GDD happened to list. With movement first
        // the feel pass saw only the Phase 2.5 cast and the geometry the player
        // stands on silently kept default friction and restitution (PF-1224).
        //
        // Construction is deferred rather than the step being built here and
        // moved later, so ids stay monotonic with array position — and array
        // position is the real ordering, since `runPipeline` executes in array
        // order and `dependsOn` only GATES. (Adding a dependency on a step that
        // sits later in the array does not reorder anything: the dependency is
        // unmet when the step is reached, so it is marked `skipped` and, being
        // non-optional, fails the whole plan.)
        if (stepInput.executor === 'physics_profile') {
          deferredFeelSteps.push({ input: stepPayload, dependsOn: [...systemDeps] });
          continue;
        }

        const step = makeStep(stepInput.executor, stepPayload, systemDeps);
        steps.push(step);
        // A system can plan enablement of its own (world geometry). Recording it
        // here is what makes the deferred feel pass depend on it below.
        if (stepInput.executor === 'physics_enable') {
          physicsEnableStepIds.push(step.id);
        }
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
      let target: { scene: string; name: string } | undefined;
      for (const scene of gdd.scenes) {
        for (const entity of scene.entities) {
          if (entity.systems.includes(system.category)) {
            target = { scene: scene.name, name: entity.name };
            break;
          }
        }
        if (target) break;
      }
      if (!target && gdd.scenes.length > 0 && gdd.scenes[0].entities.length > 0) {
        target = { scene: gdd.scenes[0].name, name: gdd.scenes[0].entities[0].name };
      }
      // The engine binds set_script by id; the name rides along only so the
      // generated prompt can name what it is scripting.
      const targetEntityId = target ? entityIds[`${target.scene}:${target.name}`] : '';
      const targetEntityName = target?.name ?? '';

      // If no entity exists to bind the script to, skip the step entirely.
      // Sending 'unbound' as entityId would cause set_script to fail in the engine.
      if (!targetEntityId) continue;

      const step = makeStep(
        'custom_script_generate',
        {
          system,
          description: `Implement ${system.category}:${system.type} behavior`,
          targetEntityId,
          targetEntityName,
          projectType: gdd.projectType,
          feelDirective: gdd.feelDirective,
        },
        systemDeps,
      );
      steps.push(step);
    }
  }

  // --- Phase 3a: the deferred movement feel pass ---
  //
  // Planned last within Phase 3 so it runs after every `physics_enable`, and
  // GATED on all of them so a failed enablement stops the feel pass instead of
  // half-tuning the scene. The step id is deliberately NOT registered in
  // `systemCategoryStepIds`: a later system declaring `dependsOn: ['movement']`
  // means the character rig (`character_setup`, which stays in place above),
  // not the feel pass that now runs after it.
  //
  // Indexed loops: a callback form skips an array hole, which would silently
  // drop a feel step or one of the enablement ids it must wait for.
  for (let i = 0; i < deferredFeelSteps.length; i += 1) {
    const deferred = deferredFeelSteps[i];
    const feelDeps = [...deferred.dependsOn];
    for (let j = 0; j < physicsEnableStepIds.length; j += 1) {
      const enableId = physicsEnableStepIds[j];
      if (!feelDeps.includes(enableId)) feelDeps.push(enableId);
    }
    steps.push(makeStep('physics_profile', deferred.input, feelDeps));
  }

  // --- Phase 3b: The win-condition guarantee ---
  //
  // A scene with no `winCondition` component can never be won, so
  // `validateWinnability` answers NO_WIN_CONDITION and `gameSlice.play()`
  // returns before it dispatches anything — the generated game does not merely
  // play badly, it does not start. Only the 'progression' system definition
  // plans a win condition, and most GDDs never declare one, so leaving this to
  // the system loop means most generated games are unplayable (PF-1199).
  //
  // This DEFERS to a real progression system: two win conditions on one scene
  // is a second rule the player was never told about.
  if (!plansAWinCondition(steps)) {
    // The condition is a rule about the game rather than about a particular
    // prop, so it rides on the player where there is one — that is where a user
    // opening the Inspector will look for it.
    let owner: PlannedEntity | undefined;
    for (let i = 0; i < plannedEntities.length; i += 1) {
      const candidate = plannedEntities[i];
      if (!candidate) continue;
      if (candidate.entity.role === 'player') {
        owner = candidate;
        break;
      }
      if (!owner) owner = candidate;
    }

    if (owner) {
      // No warning on this path. Supplying a default is not the same as
      // dropping something the design asked for, and a warnings channel that
      // speaks on every ordinary plan is one users learn to skip.
      const stepInput = defaultWinConditionStep(owner.entityId);
      steps.push(
        makeStep(
          stepInput.executor,
          {
            ...stepInput.input,
            projectType: gdd.projectType,
            feelDirective: gdd.feelDirective,
          },
          allEntityStepIds,
        ),
      );
    } else {
      // Nothing in the world to carry the component. Binding to an empty id
      // would be rejected by the engine, and a rejected non-optional step fails
      // the entire plan — so say what happened instead.
      planWarnings.push(
        'The design never said how the game is won and placed nothing in the world to win with, so this game has no goal yet.',
      );
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
          estimatedTokenCost: PLAN_COST_ESTIMATES.asset_generate.base,
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
        warnings: planWarnings,
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
    const cost = PLAN_COST_ESTIMATES[step.executor] ?? { base: 0, variance: 0 };
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

  // Capitalizing the internal key produced "Hobbyist tier" / "Pro tier" — names
  // that appear on no plan the user can buy. `hobbyist` sells as "Starter".
  const tierLabel = `${TIER_DISPLAY_NAMES[userTier]} tier`;
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
