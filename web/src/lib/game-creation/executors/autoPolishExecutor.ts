import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { buildSetGameCameraPayload } from '@/lib/game/gameCameraPayload';
import { buildPhysicsPatch } from '@/lib/physics/updatePhysicsPayload';
import { resolveCameraEntityId } from '../cameraResolution';
import { waitForEngineFrame, sendCommands, type EngineCommand } from './engineDispatch';
import { PHYSICS_ROLE_PROFILES } from '../physicsRoles';
import { COLLIDER_FOR_SHAPE } from '../entityShape';
import { buildDefaultGroundDescriptor } from '../worldGeometry';

// [B4] diagnoseIssues() requires GameMetrics (avgPlayTime, completionRate, etc.)
// which do not exist on a freshly-built game. auto_polish uses STRUCTURAL
// heuristics instead -- checking for common setup problems, not player behavior.

const inputSchema = z.object({
  projectType: z.enum(['2d', '3d']),
  feelDirective: z.object({
    mood: z.string(),
    pacing: z.enum(['slow', 'medium', 'fast']),
    weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
    referenceGames: z.array(z.string()),
    oneLiner: z.string(),
  }),
});

export const autoPolishExecutor: ExecutorDefinition = {
  name: 'auto_polish',
  inputSchema,
  userFacingErrorMessage:
    'Auto-polish could not run. Your game is ready as-is.',

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

    // Read verification results from the prior verify step
    const verifyOutput = ctx.resolveStepOutput('verify_all_scenes');
    const issues = (verifyOutput?.['issues'] as string[]) ?? [];

    const fixes: string[] = [];
    const commands: EngineCommand[] = [];

    // [B4] Structural heuristics only -- no telemetry data required

    // [FIX: NB4] update_ambient_light — manifest: { color: [r,g,b] (0-1), brightness: number }
    if (issues.includes('no_ambient_light')) {
      commands.push({ command: 'update_ambient_light', payload: { color: [1, 1, 1], brightness: 0.3 } });
      fixes.push('Added ambient lighting');
    }

    // set_game_camera — manifest requires { entityId, mode }
    if (issues.includes('no_camera_on_player')) {
      // Live read: this runs at the end of the pipeline, and the entityId below
      // is dispatched straight to the engine. A snapshot taken before the
      // pipeline started names entities that no longer exist, and
      // `set_game_camera` against a despawned id is a silent no-op (PF-1118).
      // Same heuristic as `camera_setup`, shared rather than copied — two
      // executors resolving "the scene's camera" by different rules is how one
      // of them silently configures nothing.
      const cameraEntityId = resolveCameraEntityId(Object.values(ctx.getStore().sceneGraph.nodes));

      // The issue being fixed is `no_camera_on_player`, and both modes below are
      // follow modes: the engine skips their entire update arm when
      // `target_entity` is `None`, so a targetless "fix" produces a motionless
      // camera while reporting `Configured camera as …` in the user-visible fix
      // list. `character_setup` is the step that rigged the player, and its
      // output carries the id the plan minted for it.
      const playerEntityId = ctx.resolveStepOutput('character_setup')?.['entityId'];
      const targetEntity = typeof playerEntityId === 'string' && playerEntityId.length > 0
        ? playerEntityId
        : null;

      if (cameraEntityId) {
        const mode = parsed.data.projectType === '2d' ? 'sideScroller' : 'thirdPersonFollow';
        // Translated, never flat: the store's authoring names share no key with
        // the engine's wire form, and the engine drops every key it does not
        // recognize without an error (PF-1126).
        //
        // No `followSmoothing` here. It used to send 0.8, read as a 0..1 blend
        // factor — but the engine's `damping` is a RATE PER SECOND
        // (`let t = (damping * delta).min(1.0)`), so 0.8 is roughly six times
        // slower than the default 5.0, and every auto-polished 3D game shipped a
        // sluggish follow camera. Omitting the field is how you ask for the
        // engine default, and it carries no second copy of that number to drift.
        commands.push({
          command: 'set_game_camera',
          payload: buildSetGameCameraPayload(cameraEntityId, {
            mode,
            targetEntity,
          }),
        });
        // Configuring a camera the engine is not rendering through changes
        // nothing a player can see. `game_camera_system`, `first_person_look_system`
        // and `orbital_system` are each `With<ActiveGameCamera>`, and the ONLY
        // things that insert that marker are `set_active_game_camera` and a
        // snapshot restore of a camera that was already active — so
        // `set_game_camera` alone leaves this repair inert in exactly the way it
        // was written to prevent. `camera_setup` pairs the two commands for the
        // same reason.
        commands.push({
          command: 'set_active_game_camera',
          payload: { entityId: cameraEntityId },
        });
        fixes.push(
          targetEntity
            ? `Configured camera as ${mode}`
            : `Configured camera as ${mode}, but found no player for it to follow — it will not move`,
        );
      } else {
        fixes.push('Warning: no camera entity found to configure');
      }
    }

    // spawn_entity — manifest: { entityType, name?, position?: [x,y,z], id? }
    //
    // The id is minted here rather than left to the engine. `spawn_entity`
    // honours a caller-supplied id (`is_valid_override_id`,
    // core/entity_factory.rs) and silently invents a random UUID otherwise — one
    // this executor never learns, which would leave the two physics commands
    // below with no entity to name.
    let groundEntityId: string | null = null;
    // The descriptor `world_build` would have used, not a bare primitive.
    //
    // A SPAWN WITH NO SCALE IS NOT A FLOOR. The engine derives collider
    // half-extents from `transform.scale` (`make_collider`,
    // engine/src/core/physics.rs — `scale * 0.5`), and `spawn_entity` carries a
    // position but NO scale field, so an unscaled primitive gets a 1x1x1
    // collider centred on the origin: the player is supported within half a
    // metre of it, and everywhere else falls through the floor this step
    // reports having added. Sizing therefore always costs the second
    // `update_transform` below, exactly as `worldBuildExecutor` pays it.
    const groundDescriptor = buildDefaultGroundDescriptor(parsed.data.projectType);
    if (issues.includes('no_ground_plane')) {
      groundEntityId = crypto.randomUUID();
      commands.push({
        command: 'spawn_entity',
        payload: {
          id: groundEntityId,
          entityType: groundDescriptor.entityType,
          name: groundDescriptor.name,
          position: groundDescriptor.position,
        },
      });
      fixes.push('Added ground plane');
    }

    // update_physics — manifest requires { entityId }
    if (issues.includes('physics_without_collider')) {
      fixes.push('Warning: entity has physics without collider — manual fix needed');
    }

    if (!sendCommands(ctx, commands)) {
      return failResult(
        makeStepError('COMMAND_FAILED', 'Engine command rejected', this.userFacingErrorMessage),
      );
    }

    // A GROUND PLANE WITH NO COLLIDER IS NOT A REPAIR.
    //
    // Rapier attaches a collider only to an entity carrying `PhysicsEnabled`
    // (`manage_physics_lifecycle`, engine/src/core/physics.rs), so a bare
    // `spawn_entity` leaves the player falling through the very floor this step
    // reports having added. `auto_polish` is the LAST step in the plan — it runs
    // after `physics_enable`, which is what gives every other spawned entity its
    // body — so nothing downstream can cover for it.
    //
    // Same three-phase sequence, and the same shared profile table, as
    // `physicsEnableExecutor`: toggle inserts `PhysicsEnabled` +
    // `PhysicsData::default()`, the patch then merges onto that default, and a
    // frame separates each pair because Bevy's deferred `Commands` are flushed
    // only at an explicit ordering edge — `apply_physics_toggles` drains its
    // queue whether or not the entity exists yet, and `apply_physics_updates`
    // drops a patch with no existing `PhysicsData`. See `waitForEngineFrame`.
    if (groundEntityId) {
      await waitForEngineFrame();

      // The frame waits are this executor's only yields, so they are also the
      // only points at which a cancelled run can be noticed. Dispatching into
      // an aborted run keeps mutating a scene the user has walked away from.
      if (ctx.signal.aborted) {
        return failResult(
          makeStepError(
            'ABORTED',
            'Executor was aborted while waiting for the engine to flush the ground spawn',
            this.userFacingErrorMessage,
          ),
        );
      }

      // Sized in the same batch as the toggle: the two are independent (one
      // drains through `apply_pending_transforms`, the other through
      // `apply_physics_toggles`) and both need only that the entity now exists.
      // The scale has to land before Play, because the collider is built from
      // `transform.scale` at the Edit→Play transition and never resized after.
      if (!sendCommands(ctx, [
        {
          command: 'update_transform',
          payload: { entityId: groundEntityId, scale: groundDescriptor.scale },
        },
        {
          command: 'toggle_physics',
          payload: { entityId: groundEntityId, enabled: true },
        },
      ])) {
        return failResult(
          makeStepError(
            'COMMAND_FAILED',
            'Engine rejected the size or toggle_physics command for the repaired ground plane',
            this.userFacingErrorMessage,
          ),
        );
      }

      await waitForEngineFrame();

      if (ctx.signal.aborted) {
        return failResult(
          makeStepError('ABORTED', 'Executor was aborted mid-repair', this.userFacingErrorMessage),
        );
      }

      // The `geometry` profile — the one `worldBuildExecutor`'s ground, walls
      // and platforms use — read from the shared table rather than written out a
      // fourth time, and built through `buildPhysicsPatch` because the engine's
      // `PhysicsPatch` is all-`Option` under `#[serde(flatten)]`: a misspelled
      // key there deserializes to `None` and no-ops with nothing to show for it.
      const profile = PHYSICS_ROLE_PROFILES.geometry;
      if (!sendCommands(ctx, [{
        command: 'update_physics',
        payload: buildPhysicsPatch(groundEntityId, {
          bodyType: profile.bodyType,
          colliderShape: profile.colliderShape ?? COLLIDER_FOR_SHAPE[groundDescriptor.entityType],
          isSensor: profile.isSensor,
        }),
      }])) {
        return failResult(
          makeStepError(
            'COMMAND_FAILED',
            'Engine rejected update_physics for the repaired ground plane',
            this.userFacingErrorMessage,
          ),
        );
      }
    }

    return successResult({
      fixesApplied: fixes,
      fixCount: fixes.length,
    });
  },
};
