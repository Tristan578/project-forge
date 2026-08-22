import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { engineEntityId, waitForEngineFrame, sendCommands } from './engineDispatch';

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
 */
const spawnableShape = z.enum(['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'capsule']);

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
    const spawnCommands: Array<{ command: string; payload: unknown }> = [];
    const sizeCommands: Array<{ command: string; payload: unknown }> = [];
    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i];
      spawnCommands.push({
        command: 'spawn_entity',
        payload: {
          entityType: entity.entityType,
          name: entity.name,
          position: [entity.position[0], entity.position[1], entity.position[2]],
          id: entity.entityId,
        },
      });
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

    return successResult({
      spawned: entities.length,
      worldType: worldType ?? null,
    });
  },
};
