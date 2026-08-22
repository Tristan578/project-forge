import { z } from 'zod';
import { applyPhysicsProfile } from '@/lib/ai/physicsFeel';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import {
  feelDirectiveSchema,
  resolvePhysicsProfile,
  resolvePresetFromFeel,
} from '../physicsProfileResolution';

const inputSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  feelDirective: feelDirectiveSchema,
  projectType: z.enum(['2d', '3d']),
  entityIds: z.array(z.string()).optional(),
});

/**
 * Every entity this step should tune, in preference order and de-duplicated.
 *
 * Indexed loops throughout: `.filter`/`.map` skip an array hole outright, and a
 * hole in an id list would silently drop an entity from the tuning pass with no
 * error anywhere — `dispatchCommand` returns void.
 */
function collectTargetIds(
  explicit: string[] | undefined,
  ctx: ExecutorContext,
  liveStore: ReturnType<ExecutorContext['getStore']>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const id = value.trim();
    if (id.length === 0 || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  if (explicit) {
    for (let i = 0; i < explicit.length; i += 1) push(explicit[i]);
    if (out.length > 0) return out;
  }

  // EVERY `physics_enable` step, not the first one.
  //
  // A plan runs that executor twice — planBuilder Phase 2.5 enables the
  // blueprint cast, and `systems/world.ts` enables the ground, platforms and
  // walls it minted. `resolveStepOutput` answers with the first match, so
  // reading it here tuned the player and the collectibles and left the geometry
  // they stand on with default friction and restitution, with nothing to show
  // for it: the ids simply never arrived. The only other route to the geometry
  // is the store scan below, which cannot be relied on this soon after dispatch
  // (the engine has not necessarily echoed the spawns back yet).
  const enableOutputs = ctx.resolveStepOutputs('physics_enable');
  for (let i = 0; i < enableOutputs.length; i += 1) {
    const enabledIds = enableOutputs[i]?.['entityIds'];
    if (!Array.isArray(enabledIds)) continue;
    for (let j = 0; j < enabledIds.length; j += 1) push(enabledIds[j]);
  }

  const storeNodes = Object.values(liveStore.sceneGraph.nodes);
  for (let i = 0; i < storeNodes.length; i += 1) {
    const node = storeNodes[i];
    const components = node?.components;
    if (!Array.isArray(components)) continue;
    let physical = false;
    for (let j = 0; j < components.length; j += 1) {
      const component = components[j];
      if (component === 'PhysicsData' || component === 'RigidBody' || component === 'Collider') {
        physical = true;
        break;
      }
    }
    if (physical) push(node.entityId);
  }

  return out;
}

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
      return failResult(
        makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      );
    }

    const { feelDirective, config, entityIds } = parsed.data;

    // [B3] + [S1] both live in the shared resolver — `character_setup` builds
    // the player's CharacterController from the very same answer, and the two
    // steps have to agree by construction rather than by two copies of the
    // table staying in sync by luck.
    const presetKey = resolvePresetFromFeel(feelDirective);
    const finalProfile = resolvePhysicsProfile(feelDirective, config);

    // Read the store LIVE, never off `ctx.store`. The orchestrator builds the
    // executor context ONCE with `useEditorStore.getState()` (orchestratorSlice)
    // and `pipelineRunner` reuses that same object for every step, so
    // `ctx.store` is a snapshot taken before the pipeline ran. Zustand 5
    // replaces the state object on every write
    // (`state = Object.assign({}, state, next)`), so that snapshot can never
    // observe a write made by an earlier step — it is frozen at pipeline start,
    // and every entity the pipeline itself spawned is missing from it.
    //
    // On the movement pipeline `physics_profile` runs BEFORE `character_setup`
    // (see systems/movement.ts), so the controller usually does not exist yet
    // and the merge below is a no-op. It is still read live rather than
    // defaulted: this executor is also invoked directly with explicit
    // `entityIds` against an already-built scene, where the entity DOES have a
    // controller, and merging against `{}` there would rebuild it from
    // `Default` and reset every field the caller did not name — the PF-1118
    // data loss. Reading live is correct in both orders; the snapshot is
    // correct in neither.
    //
    // Read through `ctx.getStore()` rather than importing the store here.
    // Importing it — statically OR dynamically — creates a real module edge
    // that Turbopack traces, and this file is reachable from the server route
    // /api/game/decompose via the executor barrel; that pulls `useEngine` and
    // its `useSyncExternalStore` into a React Server Component and fails
    // `next build`. A getter supplied by the (client-only) orchestrator has no
    // such edge, and it also sidesteps the editorStore -> slices/index ->
    // orchestratorSlice -> executors/index -> this file module cycle.
    const liveStore = ctx.getStore();
    const liveGameComponents = liveStore.allGameComponents;

    // Which entities to tune.
    //
    // Explicit `entityIds` win. Failing that, the `physics_enable` step that ran
    // earlier in the plan reports exactly which entities were given a body, and
    // that is a far better source than the store scan below: the store's
    // `sceneGraph.nodes[].components` is populated ONLY by the engine's async
    // SCENE_GRAPH_UPDATE event, so right after enablement it has usually not
    // arrived yet — and under a non-browser caller it never does. Scanning alone
    // therefore reports "no physics entities" on a scene that has just been made
    // entirely physical.
    //
    // EVERY `physics_enable` step is read, not the first: a plan runs that
    // executor twice (blueprint cast, then world geometry), and the geometry the
    // player lands on needs the design's friction and restitution just as much
    // as the player does. See `collectTargetIds`.
    const ids = collectTargetIds(entityIds, ctx, liveStore);

    if (ids.length === 0) {
      // Reporting plain success here was the defect (PF-1213). This step exists
      // to make the game feel the way the design asked for; matching nothing
      // means it changed nothing, and a green tick on that is a lie that hides
      // the enablement failure upstream. It is a WARNING rather than a failure
      // because the step is not optional — failing it would set the whole plan
      // to `failed` and discard a game that is merely mistuned.
      return successResult({
        presetUsed: presetKey,
        entityCount: 0,
        appliedGlobally: false,
        warning:
          'No entities had physics turned on, so the movement feel could not be applied. '
          + 'Things may not move or collide the way the design describes. '
          + 'Select the player in the scene hierarchy and turn on Physics in the Inspector, '
          + 'then re-run the build to apply the feel settings.',
      });
    }

    applyPhysicsProfile(finalProfile, ctx.dispatchCommand, ids, liveGameComponents);

    return successResult({ presetUsed: presetKey, entityCount: ids.length, appliedGlobally: false });
  },
};

