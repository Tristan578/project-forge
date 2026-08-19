/**
 * Entities system definition — the GDD category that names the things in the
 * world worth touching.
 *
 * Before PF-1199 this category fell through to `custom_script_generate`, so a
 * generated game got a script and no components: the coins spawned, nothing
 * happened when the player ran through them, no score accumulated, and the
 * score win condition the progression system plans could never be met. A room
 * with a player in it.
 *
 * This definition does NOT spawn anything. planBuilder Phase 2 has already
 * walked `gdd.scenes[].entities` and minted an engine UUID per entity; this
 * runs in Phase 3 and only attaches `collectible` components to entities that
 * already exist. Registering the category is therefore safe — the duplicate
 * `spawn_entity` hazard that kept it unregistered does not apply to a
 * component-only definition.
 *
 * Which entities become pickups, and what each is worth, is resolved in
 * `./collectibles` — shared with the progression system so the two cannot
 * disagree. See that module for why that matters.
 *
 * Two rules are load-bearing:
 *
 *  1. A component is bound to `entityId` — the engine UUID — and never to the
 *     authored name. The engine matches on the `EntityId` component and its
 *     match loops emit nothing when nothing matches, so a step bound to a name
 *     is a silent no-op that `dispatchCommand` (which returns void) cannot
 *     report.
 *  2. A name the GDD invented that resolves to no planned entity is DROPPED
 *     with a warning. Planning it anyway would be planning a step certain to
 *     fail, and one failed step marks the whole plan failed.
 */

import { registerSystem } from './registry';
import type { SystemStepInput, SystemStepContext } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';
import { collectibleStep, resolveCollectibles } from './collectibles';

registerSystem({
  category: 'entities',
  setupSteps(
    system: GameSystem,
    gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ): SystemStepInput[] {
    if (ctx.entities.length === 0) {
      ctx.warn(
        'The design asked for pickups but placed no objects in the world, so there was nothing to make collectible.',
      );
      return [];
    }

    // This definition owns the components whenever it runs — it is the only one
    // that can target pickups by name — so it is the one that warns.
    const { targets, value, named } = resolveCollectibles(system, gdd, ctx, ctx.warn);

    if (targets.length === 0) {
      // A named list that resolved to nothing has already warned once per name;
      // a summary here would repeat what the user was just told. Only the role
      // path can arrive here having said nothing at all.
      if (!named) {
        ctx.warn(
          'The design asked for pickups but named nothing to pick up and marked no object as interactable, so nothing was made collectible.',
        );
      }
      return [];
    }

    return targets.map(target => collectibleStep(target, value));
  },
});
