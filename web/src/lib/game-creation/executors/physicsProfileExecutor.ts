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
  // `OrchestratorPanel`'s `StepItem` renders this under the failed step, so it
  // is read by someone whose game is already mistuned and who has no other clue
  // what to do next. "Your game will use default physics" describes the damage
  // and stops there; the remediation below is the same one the zero-ids WARNING
  // carries, for the same reason and in the same on-screen vocabulary
  // (Hierarchy, Physics › Enabled, Friction/Gravity) — one failure mode should
  // not be followable and the other a dead end.
  //
  // The third field is named twice on purpose: the 3D `PhysicsInspector` labels
  // it "Restitution", but the 2D `Physics2dInspector` labels the same value
  // "Bounciness" — there is no field literally called "Restitution" on a 2D
  // project's screen. This string is a plain object property evaluated once at
  // module load, not a function of `ctx`, so — unlike the zero-ids `warning`
  // below, which knows `projectType` at call time and names only the matching
  // label — it cannot branch and names both.
  //
  // No "re-run the build" clause here either: a new build starts at
  // `scene_create`, which calls `newScene()` and despawns everything, so it
  // would discard the very fix this sentence just asked for.
  userFacingErrorMessage:
    'Could not tune how the game moves, so everything will use default physics. '
    + 'To set it by hand: select the player in the Hierarchy, tick Enabled under Physics '
    + 'in the Inspector, then set Friction, Restitution (called Bounciness in 2D) and '
    + 'Gravity there. '
    + 'Starting a new build rebuilds the scene from scratch, so it will not keep those edits.',

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

    const { feelDirective, config, entityIds, projectType } = parsed.data;

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
    // Reading live is what makes the merge below correct, and since the
    // Phase 3a deferral (planBuilder) it is also what makes the merge REACH
    // anything. `physics_profile` is re-planned after every `physics_enable`,
    // which on a movement plan puts it AFTER `character_setup` — so the player
    // DOES have a CharacterController by the time this runs, and
    // `applyPhysicsProfile` dispatches `update_game_component` onto it on
    // every generated run. The numbers agree by construction: both paths go
    // through `resolvePhysicsProfile(feelDirective, config)`, so the merge
    // re-sends the speed/jumpHeight/gravityScale `character_setup` already
    // wrote and leaves the fields it does not name (`canDoubleJump`) alone.
    // That last part is why the merge must read live rather than default:
    // this executor is also invoked directly with explicit `entityIds`
    // against an already-built scene, and merging against `{}` would rebuild
    // the controller from `Default` and reset every field the caller did not
    // name — the PF-1118 data loss. The snapshot is correct in neither order.
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
      // Unlike the static `userFacingErrorMessage` above, `projectType` is
      // known here (parsed from this step's own input), so the warning names
      // only the label that is actually on this project's screen — "Bounciness"
      // for 2D, "Restitution" for 3D — instead of both.
      const restitutionLabel = projectType === '2d' ? 'Bounciness' : 'Restitution';
      return successResult({
        presetUsed: presetKey,
        entityCount: 0,
        appliedGlobally: false,
        // No "re-run the build" clause: a new build starts at `scene_create`,
        // which calls `newScene()` and despawns everything, so it would discard
        // the very fix the sentence had just asked for. The recovery described
        // here is one that survives, and the last sentence says so outright.
        warning:
          'No entities had physics turned on, so the movement feel could not be applied. '
          + 'Things may not move or collide the way the design describes. '
          + 'To set it by hand: select the player in the Hierarchy, tick Enabled under Physics '
          + `in the Inspector, then set Friction, ${restitutionLabel} and Gravity there. `
          + 'Starting a new build rebuilds the scene from scratch, so it will not keep those edits.',
      });
    }

    applyPhysicsProfile(finalProfile, ctx.dispatchCommand, ids, liveGameComponents);

    return successResult({ presetUsed: presetKey, entityCount: ids.length, appliedGlobally: false });
  },
};

