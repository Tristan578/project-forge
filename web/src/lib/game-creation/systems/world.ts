/**
 * World system definition.
 *
 * Produces one step:
 *  1. scene_create — configure the world/level layout in the scene
 */

import { registerSystem } from './registry';
import type { SystemStepInput } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';

registerSystem({
  category: 'world',
  setupSteps(system: GameSystem, _gdd: OrchestratorGDD): SystemStepInput[] {
    return [
      {
        executor: 'scene_create',
        input: { worldType: system.type, worldConfig: system.config },
      },
    ];
  },
});
