/**
 * Movement system definition.
 *
 * Produces two steps:
 *  1. physics_profile — configure physics for the movement type
 *  2. character_setup — spawn a controllable character entity
 */

import { registerSystem } from './registry';
import type { SystemStepInput } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';

registerSystem({
  category: 'movement',
  setupSteps(system: GameSystem, _gdd: OrchestratorGDD): SystemStepInput[] {
    return [
      {
        executor: 'physics_profile',
        input: { config: system.config, systemType: system.type },
      },
      {
        executor: 'character_setup',
        input: { movementType: system.type, systemConfig: system.config },
      },
    ];
  },
});
