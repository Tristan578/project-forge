/**
 * Camera system definition.
 *
 * Produces one step:
 *  1. camera_setup — apply the GDD's camera mode and parameters to the scene's
 *     camera entity
 *
 * This pointed at `scene_create` until PF-1125. Scene creation runs before any
 * entity exists, so it had no camera entity to configure and its camera branch —
 * gated on a `cameraConfig.entityId` the GDD never supplies — never fired. The
 * directive was stored as `pendingCameraConfig` for a consumer that was never
 * written, so every generated game silently used the engine's default camera.
 */

import { registerSystem } from './registry';
import type { SystemStepInput, SystemStepContext } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';
import { cameraModeNeedsTarget, normalizeCameraMode } from '../cameraResolution';

registerSystem({
  category: 'camera',
  setupSteps(
    system: GameSystem,
    _gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ): SystemStepInput[] {
    // Every follow mode is inert without a target — the engine skips its whole
    // update arm when `target_entity` is `None`, so the camera keeps the mode
    // the GDD asked for and never moves. Bind the player the plan minted, the
    // same way `movement.ts` binds it for `character_setup`; the engine matches
    // on the `EntityId` component, so the id is the only usable handle.
    const player = ctx.entities.find(e => e.entity.role === 'player');
    const mode = normalizeCameraMode(system.type);

    if (!player && cameraModeNeedsTarget(mode)) {
      // Still plan the step: the mode itself is worth recording, and a camera
      // on engine defaults is a better outcome than failing a non-optional step
      // and discarding the entire build. But say so, rather than shipping a
      // motionless camera that reports success.
      ctx.warn(
        `The design asked for a ${system.type} camera but named no player character to follow, so the camera stays where it is placed.`,
      );
    }

    return [
      {
        executor: 'camera_setup',
        input: {
          cameraMode: system.type,
          cameraConfig: system.config,
          ...(player ? { targetEntityId: player.entityId } : {}),
        },
      },
    ];
  },
});
