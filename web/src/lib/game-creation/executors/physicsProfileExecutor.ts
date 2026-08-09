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

    const ids = entityIds ?? [];

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

    // When called from movement system registry without entityIds, apply the
    // physics profile globally via update_physics_config (scene-level settings).
    // Per-entity physics is applied when entityIds are provided.
    if (ids.length === 0) {
      // No entityIds provided (common path from movement system registry).
      // Look up physics-enabled entities from the store.
      const storeNodes = Object.values(liveStore.sceneGraph.nodes);
      const physicsNodes = storeNodes
        .filter(n => n.components.some(c => ['PhysicsData', 'RigidBody', 'Collider'].includes(c)))
        .map(n => n.entityId)
        .filter(id => typeof id === 'string' && id.trim().length > 0);

      if (physicsNodes.length === 0) {
        return successResult({ presetUsed: presetKey, entityCount: 0, appliedGlobally: false });
      }

      applyPhysicsProfile(finalProfile, ctx.dispatchCommand, physicsNodes, liveGameComponents);
      return successResult({ presetUsed: presetKey, entityCount: physicsNodes.length, appliedGlobally: false });
    }

    applyPhysicsProfile(finalProfile, ctx.dispatchCommand, ids, liveGameComponents);

    return successResult({ presetUsed: presetKey, entityCount: ids.length, appliedGlobally: false });
  },
};

