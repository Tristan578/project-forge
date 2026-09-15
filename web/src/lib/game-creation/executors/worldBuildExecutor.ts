import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import {
  engineEntityId,
  waitForEngineFrame,
  sendCommands,
  observeTransformEffect,
  SPAWN_TRANSFORM_OPERATION,
} from './engineDispatch';
import { SPAWNABLE_SHAPES } from '../entityShape';

/**
 * PF-1138 — build the world the design asked for.
 *
 * Before this step existed, `worldConfig` was accepted by the `scene_create`
 * schema and then dropped, so every generated game was an empty room: the player
 * and the collectibles were spawned into a void with nothing under them.
 *
 * WHY A SEPARATE EXECUTOR rather than folding the spawns into `scene_create`:
 *
 *  - `scene_create` owns scene BOOKKEEPING — `sceneManager` persistence plus
 *    `store.newScene()`, which despawns everything deletable. Spawning geometry
 *    from the same step would put a create-then-clear ordering hazard inside one
 *    executor. As a separate Phase 3 step it runs strictly after Phase 1's
 *    `newScene()`, so the geometry cannot be wiped by the step that made room
 *    for it.
 *  - The failure modes are different and should be reported differently. A
 *    rejected spawn must not fail scene creation, and a partially-applied world
 *    must surface its own warnings through `collectStepWarnings`.
 *  - The geometry decision belongs at PLAN time, because that is the only place
 *    with a `warn` channel (`SystemStepContext.warn`); `ExecutorContext` has
 *    none. `systems/world.ts` therefore computes descriptors and mints their
 *    ids, and this executor is the dumb, fully-validated dispatch half.
 *
 * Every number is re-validated here even though the builder already clamped it.
 * The input crosses a plan boundary (it is serialized into `PlanStep.input`), and
 * `dispatchCommand` returns void — a rejected command is invisible, so the last
 * chance to notice a bad number is before it is sent.
 */

/**
 * Only shapes `EntityType::from_str` maps to a mesh the renderer actually draws.
 * `terrain`, `sprite`, `gltf_model` and friends deserialize and are then skipped
 * by the spawn system without a word.
 *
 * Built from the shared `SPAWNABLE_SHAPES` rather than restated, because
 * `systems/world.ts` feeds each descriptor's `entityType` straight into the
 * `physics_enable` step, whose schema validates `shape` against that same list.
 * Two hand-written copies that must silently agree is how a shape added to one
 * and not the other turns every piece of world geometry into an `INVALID_INPUT`
 * — the whole level losing its colliders, with nothing naming the cause.
 */
const spawnableShape = z.enum(SPAWNABLE_SHAPES);

/** Finite, inside f32's usable range, and not a denormal masquerading as zero. */
const coordinate = z.number().finite().min(-10_000).max(10_000);

/**
 * `update_transform` returns `Err` for ANY scale component with
 * `abs < f32::EPSILON` — and the error takes the whole command with it, not just
 * the offending axis.
 */
const scaleAxis = z.number().finite().min(0.01).max(1000);

const vec3 = z.tuple([coordinate, coordinate, coordinate]);
const scaleVec3 = z.tuple([scaleAxis, scaleAxis, scaleAxis]);

const worldEntity = z.object({
  entityId: engineEntityId,
  name: z.string().min(1).max(200),
  entityType: spawnableShape,
  position: vec3,
  scale: scaleVec3,
});

const inputSchema = z.object({
  // Not `.optional()`: a `world_build` step with nothing to build is a planning
  // bug, and reporting it as a success is how the empty room shipped in the
  // first place. `systems/world.ts` plans no step at all when it has nothing.
  entities: z.array(worldEntity).min(1).max(64),
  worldType: z.string().max(120).optional(),
});

export const worldBuildExecutor: ExecutorDefinition = {
  name: 'world_build',
  inputSchema,
  userFacingErrorMessage: 'Could not build the world geometry. Please try again.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError('INVALID_INPUT', parsed.error.message, this.userFacingErrorMessage),
      );
    }

    if (ctx.signal.aborted) {
      return failResult(
        makeStepError('ABORTED', 'Executor was aborted before running', this.userFacingErrorMessage),
      );
    }

    const { entities, worldType } = parsed.data;

    // Built key by key from the validated data, never spread from `input`.
    // `{ ...input } satisfies Payload` is inert — TypeScript's excess-property
    // check never applies to spread properties — so a spread payload ships
    // whatever the plan happened to carry and the engine drops it in silence.
    //
    // Two separate batches, deliberately. `spawn_entity` carries a position but
    // has no scale field, so sizing always costs a second command — and that
    // second command CANNOT ride in the same frame as the spawn it resizes.
    // See `waitForEngineFrame` in ./engineDispatch for why.
    // Captured once for the retry guard below; a context wired before #9899 (and
    // every unit test that supplies none) leaves it undefined and keeps the
    // legacy spawn-every-time behaviour.
    const observe = ctx.observeEntity;

    const spawnCommands: Array<{ command: string; payload: unknown }> = [];
    const sizeCommands: Array<{ command: string; payload: unknown }> = [];
    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i];

      // Idempotency guard for a RETRY (#9899 review). The confirmation branch
      // below can return `EFFECT_TIMED_OUT` marked retryable, and `pipelineRunner`
      // then reruns this WHOLE executor (world_build gets maxRetries: 1 from
      // planBuilder's `makeStep`) with the SAME static `step.input` — the same
      // entity ids. A timeout means the CONFIRMATION was slow, not that the spawn
      // failed: the engine does not reject a caller-supplied `id` already in use
      // (core/entity_factory.rs has no such check), so redispatching
      // `spawn_entity` for an entity a prior attempt already created would spawn a
      // SECOND entity carrying the identical `EntityId`, and every later step
      // addressing that id would resolve to whichever duplicate the engine's
      // query/update path finds first. The observation cache is a per-RUN
      // singleton (cleared once at run start), so an id already observable is one
      // a prior attempt spawned — skip its spawn and let the resize and
      // confirmation below run idempotently against it. Mirrors
      // `entitySetupExecutor`'s `alreadySpawned` guard.
      //
      // The resize is always (re)queued: `update_transform` writes an ABSOLUTE
      // scale, so replaying it for an already-correct entity is a no-op, while the
      // entity the retry actually exists for still needs it.
      const alreadySpawned = observe ? observe(entity.entityId) !== undefined : false;
      if (!alreadySpawned) {
        spawnCommands.push({
          command: 'spawn_entity',
          payload: {
            entityType: entity.entityType,
            name: entity.name,
            position: [entity.position[0], entity.position[1], entity.position[2]],
            id: entity.entityId,
          },
        });
      }
      sizeCommands.push({
        command: 'update_transform',
        payload: {
          entityId: entity.entityId,
          scale: [entity.scale[0], entity.scale[1], entity.scale[2]],
        },
      });
    }

    if (!sendCommands(ctx, spawnCommands)) {
      return failResult(
        makeStepError(
          'COMMAND_FAILED',
          'Engine rejected a world geometry spawn',
          this.userFacingErrorMessage,
        ),
      );
    }

    await waitForEngineFrame();

    // Re-checked after the yield: an abort during the frame gap must not size
    // geometry belonging to a run the user already cancelled.
    if (ctx.signal.aborted) {
      return failResult(
        makeStepError('ABORTED', 'Executor was aborted mid-build', this.userFacingErrorMessage),
      );
    }

    if (!sendCommands(ctx, sizeCommands)) {
      return failResult(
        makeStepError(
          'COMMAND_FAILED',
          'Engine rejected a world geometry resize',
          this.userFacingErrorMessage,
        ),
      );
    }

    // CONFIRMED path (#9899): each `update_transform` above is a deferred scale,
    // and an accepted dispatch is NOT an applied transform — `dispatchCommand`
    // reports only that the engine took the command, while the resize lands a
    // frame later inside `apply_pending_transforms`, which drops any update
    // matching no entity yet and never retries it (see `waitForEngineFrame`).
    // When the context can query the engine, prove every piece of geometry
    // reached its requested scale by READING the engine's real state, rather
    // than trusting acceptance plus a frame wait — exactly the transform half of
    // the contract that spawn confirmation established for existence. A resize
    // that never lands is a floor with a 1x1x1 collider the player falls
    // through (PF-1138), so it must fail the step, never report a built world.
    if (ctx.observeEntity) {
      const observe = ctx.observeEntity;
      for (let i = 0; i < entities.length; i += 1) {
        const entity = entities[i];
        const effect = await observeTransformEffect({
          operationId: SPAWN_TRANSFORM_OPERATION,
          entityId: entity.entityId,
          field: 'scale',
          expected: entity.scale,
          observe,
          signal: ctx.signal,
        });

        if (effect.status !== 'applied') {
          return failResult(
            makeStepError(
              effect.status === 'cancelled' ? 'ABORTED' : 'EFFECT_TIMED_OUT',
              effect.status === 'cancelled'
                ? 'World geometry resize cancelled before the engine confirmed it'
                : `World geometry entity ${entity.entityId} was not confirmed at its requested scale `
                  + `(operation ${effect.operationId})`,
              this.userFacingErrorMessage,
              effect.status === 'timed-out',
              { effect },
            ),
          );
        }
      }

      return successResult({
        spawned: entities.length,
        worldType: worldType ?? null,
        confirmed: entities.length,
        operationId: SPAWN_TRANSFORM_OPERATION,
      });
    }

    // LEGACY path: no query capability (every context wired before #9899, and
    // every unit test that supplies no `observeEntity`). The frame wait between
    // spawn and size above is the only guard, so the next pipeline step does not
    // observe an unsized floor merely because rendering is slower than the JS
    // pipeline.
    return successResult({
      spawned: entities.length,
      worldType: worldType ?? null,
    });
  },
};
