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
import type { SystemStepInput } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';

registerSystem({
  category: 'camera',
  setupSteps(system: GameSystem, _gdd: OrchestratorGDD): SystemStepInput[] {
    return [
      {
        executor: 'camera_setup',
        input: { cameraMode: system.type, cameraConfig: system.config },
      },
    ];
  },
});
