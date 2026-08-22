import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { engineEntityId, waitForEngineFrame, sendCommands, type EngineCommand } from './engineDispatch';
import { ENABLEABLE_ROLES, physicsProfileForRole } from '../physicsRoles';
import { COLLIDER_FOR_SHAPE, SPAWNABLE_SHAPES, type SpawnShape } from '../entityShape';

/**
 * Turn spawned entities into physical bodies (PF-1213).
 *
 * Rapier attaches a collider only to an entity carrying `PhysicsEnabled`
 * (`manage_physics_lifecycle`, engine/src/core/physics.rs), and
 * `system_track_collisions` builds `runtime.active_collisions` purely from the
 * `CollisionEvent`s those colliders emit. Before this executor existed the
 * pipeline spawned a player, a floor and a set of collectibles and then never
 * dispatched the one command that makes any of them solid — so
 * `active_collisions` stayed empty for the whole session, `system_collectible`
 * never fired, score never moved and `game_win` was unreachable.
 *
 * TWO COMMANDS PER ENTITY, IN TWO BATCHES, WITH A FRAME BETWEEN THEM.
 *
 * `toggle_physics { enabled: true }` inserts `PhysicsEnabled` AND
 * `PhysicsData::default()`; `update_physics` then patches that default with the
 * body type and collider this entity needs. The order is not interchangeable and
 * the gap is not optional: `apply_physics_updates` merges its patch onto an
 * EXISTING `PhysicsData` and drops it (with a `tracing::warn!` nobody sees) when
 * there is none, the toggle inserts through deferred `Commands`, and the 3D pair
 * is registered updates-first with no `.chain()` edge between them
 * (engine/src/bridge/mod.rs). A toggle and its patch in the same frame therefore
 * lose the patch. See `waitForEngineFrame`.
 *
 * Payloads are built key by key from validated data, never spread from `input`.
 * `{ ...input } satisfies Payload` is inert — TypeScript's excess-property check
 * never applies to spread properties — so a spread payload ships whatever the
 * plan happened to carry and `serde` drops the whole command in silence.
 */

const physicsEntity = z.object({
  entityId: engineEntityId,
  name: z.string().min(1).max(200).optional(),
  role: z.enum(ENABLEABLE_ROLES as unknown as [string, ...string[]]),
  /**
   * The mesh the entity was spawned as, so the collider can match it. Optional:
   * a role whose profile pins its own collider shape does not need it, and a
   * step planned before this field existed still runs.
   */
  shape: z.enum(SPAWNABLE_SHAPES as unknown as [string, ...string[]]).optional(),
});

const inputSchema = z.object({
  entities: z.array(physicsEntity).min(1).max(512),
});

export const physicsEnableExecutor: ExecutorDefinition = {
  name: 'physics_enable',
  inputSchema,
  userFacingErrorMessage:
    'Could not switch physics on for the level. Nothing in the game will collide.',

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

    const { entities } = parsed.data;

    const toggleCommands: EngineCommand[] = [];
    const patchCommands: EngineCommand[] = [];
    const enabledIds: string[] = [];
    const skipped: string[] = [];

    // Indexed loop, not `.map`/`.filter`: a callback form skips an array hole
    // outright, so a gap would silently shrink the set of entities that get a
    // body — the exact failure this step exists to prevent, reintroduced by the
    // fix for it.
    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i];
      const profile = physicsProfileForRole(entity.role);
      if (!profile) {
        // A role with no profile is a deliberate skip (cameras and lights are
        // filed as `decoration` and must not drop an invisible wall at the
        // origin), so it is recorded rather than warned about.
        skipped.push(entity.name ?? entity.entityId);
        continue;
      }

      const colliderShape =
        profile.colliderShape
        ?? (entity.shape ? COLLIDER_FOR_SHAPE[entity.shape as SpawnShape] : undefined)
        ?? 'cuboid';

      toggleCommands.push({
        command: 'toggle_physics',
        payload: { entityId: entity.entityId, enabled: true },
      });

      // Only the fields this step owns. Everything omitted keeps the engine's
      // own `PhysicsData::default()` — one copy of each number instead of two
      // that can drift — and mass/friction/restitution/gravity belong to the
      // `physics_profile` step, which runs after this one.
      const patch: Record<string, unknown> = {
        entityId: entity.entityId,
        bodyType: profile.bodyType,
        colliderShape,
      };
      if (profile.lockRotation) {
        patch['lockRotationX'] = true;
        patch['lockRotationY'] = true;
        patch['lockRotationZ'] = true;
      }
      patch['isSensor'] = profile.isSensor;

      patchCommands.push({ command: 'update_physics', payload: patch });
      enabledIds.push(entity.entityId);
    }

    if (enabledIds.length === 0) {
      // Not a step failure — the plan can still run — but the level is inert, so
      // it has to reach the user through the warning channel rather than a
      // green tick.
      return successResult({
        enabled: 0,
        skipped: skipped.length,
        entityIds: [],
        warning:
          'Nothing in this step could be given a physical body, so none of it will collide, '
          + 'land on the ground or be picked up.',
      });
    }

    if (!sendCommands(ctx, toggleCommands)) {
      return failResult(
        makeStepError(
          'COMMAND_FAILED',
          'Engine rejected a toggle_physics command',
          this.userFacingErrorMessage,
        ),
      );
    }

    await waitForEngineFrame();

    // Re-checked after the yield: an abort during the frame gap must not keep
    // patching bodies for a run the user already cancelled.
    if (ctx.signal.aborted) {
      return failResult(
        makeStepError('ABORTED', 'Executor was aborted mid-run', this.userFacingErrorMessage),
      );
    }

    if (!sendCommands(ctx, patchCommands)) {
      return failResult(
        makeStepError(
          'COMMAND_FAILED',
          'Engine rejected an update_physics command',
          this.userFacingErrorMessage,
        ),
      );
    }

    return successResult({
      enabled: enabledIds.length,
      skipped: skipped.length,
      entityIds: enabledIds,
    });
  },
};
