/**
 * Entities system definition.
 *
 * Produces one entity_setup step for every entity in every scene of the GDD.
 * The plan builder uses these steps to spawn and configure each scene entity.
 */

import { registerSystem } from './registry';
import type { SystemStepInput } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';

registerSystem({
  category: 'entities',
  setupSteps(_system: GameSystem, gdd: OrchestratorGDD): SystemStepInput[] {
    const steps: SystemStepInput[] = [];
    for (const scene of gdd.scenes) {
      for (const entity of scene.entities) {
        steps.push({
          executor: 'entity_setup',
          input: { entity, scene: scene.name },
        });
      }
    }
    return steps;
  },
});
