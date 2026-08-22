/**
 * Movement system definition.
 *
 * Produces up to two steps:
 *  - character_setup — rig the player entity so it can be controlled
 *    (only when the GDD actually designed a player to rig)
 *  - physics_profile — configure physics for the movement type
 *
 * They are NOT planned in that order. `planBuilder` lifts `physics_profile`
 * out of this system's step list and re-plans it once, after every
 * `physics_enable` step in the whole plan (Phase 3a), so the feel pass can see
 * the world geometry the `world` system enabled. `character_setup` stays in
 * place, which means the feel pass runs AFTER it and finds the player's
 * CharacterController already in the store. Read the order off `planBuilder`,
 * never off the array this function returns.
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
    // along for the step's own reporting.
    const player = ctx.entities.find(e => e.entity.role === 'player');

    const steps: SystemStepInput[] = [
      {
        executor: 'physics_profile',
        input: { config: system.config, systemType: system.type },
      },
    ];

    // A GDD is LLM-authored, so a movement system with no player-role entity is
    // reachable. There is no character to rig, and `character_setup` is a
    // non-optional step — planning one that cannot resolve a target would fail
    // the whole plan and discard the level, the collectibles and the win
    // condition along with the rig. Drop the step and say why instead.
    if (!player) {
      ctx.warn(
        'The design asked for a movement system but named no player character, so nothing was set up to be controlled.',
      );
      return steps;
    }

    steps.push({
      executor: 'character_setup',
      input: {
        movementType: system.type,
        systemConfig: system.config,
        entityId: player.entityId,
        entity: player.entity,
      },
    });

    return steps;
  },
});
