import { z } from 'zod';
import type { PhysicsData } from '@/stores/slices/types';
import { buildPhysicsPatch } from '@/lib/physics/updatePhysicsPayload';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { engineEntityId, waitForEngineFrame, sendCommands, type EngineCommand } from './engineDispatch';
import { ENABLEABLE_ROLES, physicsProfileForRole } from '../physicsRoles';
import { COLLIDER_FOR_SHAPE, SPAWNABLE_SHAPES } from '../entityShape';

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
 * TWO COMMANDS PER ENTITY, IN TWO BATCHES, WITH A FRAME BEFORE AND BETWEEN.
 *
 * The FIRST wait is against the SPAWN. `entitySetupExecutor` returns without
 * yielding and `runPipeline` awaits it on a microtask, so the blueprint spawns
 * and these toggles would otherwise share one engine frame — and
 * `apply_physics_toggles` drains its queue whether or not the entity exists
 * yet, so every toggle would be dropped in silence.
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
  role: z.enum(ENABLEABLE_ROLES),
  /**
   * The mesh the entity was spawned as, so the collider can match it. Optional:
   * a role whose profile pins its own collider shape does not need it, and a
   * step planned before this field existed still runs.
   */
  shape: z.enum(SPAWNABLE_SHAPES).optional(),
});

const inputSchema = z.object({
  entities: z.array(physicsEntity).min(1).max(512),
});

export const physicsEnableExecutor: ExecutorDefinition = {
  name: 'physics_enable',
  inputSchema,
  // Every noun here is a label that is actually on screen: the panel is
  // "Hierarchy", the Inspector's section is "Physics" with an "Enabled"
  // checkbox, and the immovable Body Type option is named "Fixed" in the 3D
  // `PhysicsInspector` and "Static" in the 2D `Physics2dInspector` — the two
  // inspectors do not share a vocabulary here, so a copy that says only
  // "Fixed" sends a 2D reader looking for an option that is not on their
  // screen (there is no "Fixed" choice in 2D; there is no "Static" choice in
  // 3D).
  //
  // This field is a plain string evaluated once at module load, not a
  // function of `ctx`, so it cannot branch on `ctx.projectType` the way the
  // zero-match `warning` below does — it names both spellings instead. The
  // runtime warning knows which project it is actually looking at and says
  // only the one that matches.
  //
  // Naming Body Type is not padding. `PhysicsData::default()` is DYNAMIC
  // (engine/src/core/physics.rs), so a user who follows guidance that stops at
  // "tick Enabled" turns the ground, the platforms and the walls into falling
  // bodies — the advice would make the game worse than the failure did.
  //
  // No "please try again" either, for the same reason the profile step's copy
  // does not say it: a new build starts at `scene_create`, which calls
  // `newScene()` and despawns everything, so re-running is not a way to keep a
  // hand fix — it is the way to lose one. The last sentence says so outright
  // rather than leaving the reader to find out.
  userFacingErrorMessage:
    'Could not switch physics on for the level, so nothing in the game will collide. '
    + 'To set it by hand: select an entity in the Hierarchy, tick Enabled under Physics '
    + 'in the Inspector, then set Body Type to Fixed (3D) or Static (2D) for ground, '
    + 'platforms and walls (the default, Dynamic, makes them fall). '
    + 'Starting a new build rebuilds the scene from scratch, so it will not keep those edits.',

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
        ?? (entity.shape ? COLLIDER_FOR_SHAPE[entity.shape] : undefined)
        ?? 'cuboid';

      toggleCommands.push({
        command: 'toggle_physics',
        payload: { entityId: entity.entityId, enabled: true },
      });

      // Only the fields this step owns. Everything omitted keeps the engine's
      // own `PhysicsData::default()` — one copy of each number instead of two
      // that can drift — and mass/friction/restitution/gravity belong to the
      // `physics_profile` step, which runs after this one.
      //
      // Built through `buildPhysicsPatch` rather than by hand: the engine's
      // `PhysicsPatch` is all-`Option` under `#[serde(flatten)]`, which makes
      // `#[serde(deny_unknown_fields)]` impossible, so a misspelled key
      // deserializes to `None` and no-ops with nothing to show for it. The
      // builder picks from an allowlist carrying
      // `satisfies Record<keyof PhysicsData, true>`, so a typo or a renamed
      // field is a compile error here instead of a silent engine-side drop.
      const patch: Partial<PhysicsData> = {
        bodyType: profile.bodyType,
        colliderShape,
        isSensor: profile.isSensor,
        ...(profile.lockRotation
          ? { lockRotationX: true, lockRotationY: true, lockRotationZ: true }
          : {}),
      };

      patchCommands.push({
        command: 'update_physics',
        payload: buildPhysicsPatch(entity.entityId, patch),
      });
      enabledIds.push(entity.entityId);
    }

    if (enabledIds.length === 0) {
      // Not a step failure — the plan can still run — but the level is inert, so
      // it has to reach the user through the warning channel rather than a
      // green tick.
      //
      // Unlike the static `userFacingErrorMessage` above, this string is built
      // at call time and `ctx.projectType` is known here, so it names the one
      // Body Type spelling that is actually on the reader's screen instead of
      // both.
      const bodyTypeLabel = ctx.projectType === '2d' ? 'Static' : 'Fixed';
      return successResult({
        enabled: 0,
        skipped: skipped.length,
        entityIds: [],
        warning:
          'Nothing in this step could be given a physical body, so none of it will collide, '
          + 'land on the ground or be picked up. '
          + 'To set it by hand: select an entity in the Hierarchy, tick Enabled under Physics '
          + `in the Inspector, then set Body Type to ${bodyTypeLabel} for ground, platforms and walls `
          + '(the default, Dynamic, makes them fall) and tick Sensor for pickups.',
      });
    }

    // WAIT ONE: against the SPAWN, not against the toggle/patch pair below.
    //
    // `entitySetupExecutor` dispatches its `spawn_entity` and returns without
    // yielding, and `runPipeline` awaits each executor on a microtask, so every
    // blueprint spawn and every toggle here would otherwise land inside one JS
    // task — one engine frame. `apply_spawn_requests` creates entities through
    // deferred `Commands` with no ordering edge to `apply_physics_toggles`
    // (engine/src/bridge/mod.rs), and that system `drain(..)`s its queue whether
    // or not the id matched anything. A toggle for a not-yet-flushed entity is
    // therefore consumed and lost with no exception, no event and no log — the
    // whole step silently enabling nothing. `worldBuildExecutor` escapes this
    // only because it happens to await a frame of its own before returning.
    await waitForEngineFrame();

    if (ctx.signal.aborted) {
      return failResult(
        makeStepError(
          'ABORTED',
          'Executor was aborted while waiting for the engine to flush the spawns',
          this.userFacingErrorMessage,
        ),
      );
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
