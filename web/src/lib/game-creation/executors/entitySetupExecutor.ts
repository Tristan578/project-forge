import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import {
  engineEntityId,
  sendCommands,
  waitForEngineFrame,
  observeEngineEffect,
  rejectedEffect,
  SPAWN_TRANSFORM_OPERATION,
} from './engineDispatch';
import { resolveEntityShape } from '../entityShape';

const entityBlueprintSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.enum([
    'player', 'enemy', 'npc', 'decoration', 'trigger', 'interactable', 'projectile',
  ]),
  systems: z.array(z.string()).optional(),
  appearance: z.string().optional(),
});

const inputSchema = z.object({
  entity: entityBlueprintSchema,
  // Optional so a step built before this field existed still runs; when absent the
  // engine assigns its own UUID and nothing downstream can address the entity.
  entityId: engineEntityId.optional(),
  scene: z.string().min(1),
  projectType: z.enum(['2d', '3d']),
});

export const entitySetupExecutor: ExecutorDefinition = {
  name: 'entity_setup',
  inputSchema,
  userFacingErrorMessage: 'Could not create an entity. It will be skipped.',

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

    // Checked BEFORE any command is dispatched, matching `worldBuildExecutor`'s
    // same guard. Without this, a cancel that lands right as this step starts
    // (the retry loop in `pipelineRunner` only checks `signal.aborted` BETWEEN
    // attempts, never before the first one) would still send `spawn_entity` —
    // the ABORTED failure only surfaces later, from inside
    // `observeEngineEffect`'s own abort check, by which point the engine has
    // already created an entity nothing in this run will ever address or clean
    // up (Sentry review, PR #9997).
    if (ctx.signal.aborted) {
      return failResult(
        makeStepError('ABORTED', 'Executor was aborted before running', this.userFacingErrorMessage),
      );
    }

    // `scene` stays a required input (a plan step that names no scene is malformed)
    // but is not dispatched — see the note on `commands` below.
    const { entity, entityId, projectType } = parsed.data;
    // Manifest: spawn_entity entityType is lowercase enum. Resolved by the
    // shared `entityShape` module rather than a local table, because
    // `physics_enable` has to derive the entity's COLLIDER from the same answer
    // — a second copy here would drift and leave a capsule player floating
    // inside a cuboid collider.
    const entityType = resolveEntityShape(entity.role, entity.appearance, projectType);
    const operationId = SPAWN_TRANSFORM_OPERATION;

    // Idempotency guard for a RETRY (`pipelineRunner` reruns the whole executor
    // when the observation below reports `timed-out`, which is retryable — see
    // that branch's comment). A timeout means the CONFIRMATION was slow, not
    // that the spawn failed: the engine does not reject a caller-supplied `id`
    // already in use (core/entity_factory.rs has no such check), so blindly
    // redispatching `spawn_entity` on retry would create a SECOND entity
    // carrying the identical `EntityId`, and every later step addressing this
    // id would then hit whichever of the two duplicates the engine's query/
    // update path happens to find first (#9997 review). The observation cache
    // is a per-RUN singleton (cleared once, at `runPipelineFromPlan`'s start —
    // see `clearEntityObservations`), so a confirmation that arrived just after
    // the first attempt's deadline is already sitting in it by the time a
    // retry checks: this reads as "already spawned" and skips straight to
    // confirming, rather than spawning a duplicate.
    //
    // Gated on `!ctx.signal.aborted` too: an already-cancelled call must reach
    // the engine exactly as often as before this guard existed (zero times),
    // not once more for a check whose answer it will never act on.
    const alreadySpawned =
      ctx.observeEntity !== undefined && entityId !== undefined && !ctx.signal.aborted
        ? ctx.observeEntity(entityId) !== undefined
        : false;

    if (!alreadySpawned) {
      // Spawn into the engine's active scene. The engine holds exactly one scene at a
      // time and rejects `switch_scene` by design — multi-scene management is JS-side
      // (`lib/scenes/sceneManager`), and the plan's `scene` field is JS-side metadata.
      // Leading the batch with it made every entity step fail on the rejection (PF-1097).
      // The engine honors a caller-supplied `id` on spawn_entity (see
      // core/entity_factory.rs `is_valid_override_id`) precisely so JS can address the
      // entity without waiting for the async SELECTION_CHANGED round-trip. Every later
      // step in the plan binds to this id.
      const commands = [
        {
          command: 'spawn_entity',
          payload: { entityType, name: entity.name, ...(entityId ? { id: entityId } : {}) },
        },
      ];

      if (!sendCommands(ctx, commands)) {
        // Acceptance failed at the wire — no observation to attempt. Report the
        // rejection with its operation id so the failure is correlatable.
        const rejected = rejectedEffect(operationId, entityId ?? entity.name);
        return failResult(
          makeStepError(
            'COMMAND_FAILED',
            'Engine command rejected',
            this.userFacingErrorMessage,
            false,
            { effect: rejected },
          ),
        );
      }
    }

    // CONFIRMED path (#9899): when the context can query the engine AND the plan
    // supplied an addressable id, prove the spawn by reading the engine's real
    // state after the deferred command applies — not by trusting acceptance plus
    // a frame wait. An accepted dispatch reports only that the engine took the
    // command; the spawn runs a frame later inside a system with no way back
    // here (see `waitForEngineFrame`).
    if (ctx.observeEntity && entityId) {
      const effect = await observeEngineEffect({
        operationId,
        entityId,
        observe: ctx.observeEntity,
        // Existence is the whole proof for a spawn — any observation means the
        // engine's `get_entity_details` found the entity.
        satisfied: () => true,
        signal: ctx.signal,
      });

      if (effect.status !== 'applied') {
        // timed-out or cancelled — the entity was NEVER confirmed. Reporting
        // success here is precisely the false-success the slice exists to
        // prevent, so this is a failure carrying the correlated effect.
        return failResult(
          makeStepError(
            effect.status === 'cancelled' ? 'ABORTED' : 'EFFECT_TIMED_OUT',
            effect.status === 'cancelled'
              ? 'Spawn observation cancelled before the entity was confirmed'
              : `Spawned entity was not observed before the deadline (operation ${operationId})`,
            this.userFacingErrorMessage,
            effect.status === 'timed-out',
            { effect },
          ),
        );
      }

      return successResult({
        entityName: entity.name,
        role: entity.role,
        entityType,
        entityId,
        effectStatus: effect.status,
        operationId,
      });
    }

    // LEGACY path: no query capability, or an engine-assigned id nothing can
    // address. Fall back to the frame wait so the next pipeline step does not
    // observe the pre-spawn scene graph and reject this entity as missing merely
    // because rendering is slower than the JS pipeline.
    await waitForEngineFrame();

    return successResult({
      entityName: entity.name,
      role: entity.role,
      entityType,
      ...(entityId ? { entityId } : {}),
    });
  },
};
