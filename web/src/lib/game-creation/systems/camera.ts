/**
 * Camera system definition.
 *
 * Produces one step:
 *  1. scene_create — configure camera mode and parameters in the scene
 */

import { registerSystem } from './registry';
import type { SystemStepInput } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';

registerSystem({
  category: 'camera',
  setupSteps(system: GameSystem, _gdd: OrchestratorGDD): SystemStepInput[] {
    return [
      {
        executor: 'scene_create',
        input: { cameraMode: system.type, cameraConfig: system.config },
      },
    ];
  },
});
