/**
 * Movement system definition.
 *
 * Produces two steps:
 *  1. physics_profile — configure physics for the movement type
 *  2. character_setup — spawn a controllable character entity
 */

import { registerSystem } from './registry';
import type { SystemStepInput, SystemStepContext } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';

registerSystem({
  category: 'movement',
  setupSteps(
    system: GameSystem,
    _gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ): SystemStepInput[] {
    // The engine matches `add_game_component` / `create_skeleton2d` on the
    // EntityId component and emits nothing on a miss, so the character step
    // must carry the id the plan minted for the player. The blueprint rides
    // along too — the executor's own default entity is named 'Player', so
    // without it a store lookup searches for the wrong name.
    const player = ctx.entities.find(e => e.entity.role === 'player');

    return [
      {
        executor: 'physics_profile',
        input: { config: system.config, systemType: system.type },
      },
      {
        executor: 'character_setup',
        input: {
          movementType: system.type,
          systemConfig: system.config,
          ...(player ? { entityId: player.entityId, entity: player.entity } : {}),
        },
      },
    ];
  },
});
