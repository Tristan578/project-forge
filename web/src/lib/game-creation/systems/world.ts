/**
 * World system definition — the GDD category that describes the level itself.
 *
 * It used to plan a single `scene_create` step carrying `worldType` and
 * `worldConfig`. That executor accepted both and then dropped both (its own
 * comment said so), so the ground, platforms and boundaries the design asked
 * for reached no engine command at any point in the pipeline's history and
 * every generated game was an empty room (PF-1138).
 *
 * The geometry is decided HERE, at plan time, for one concrete reason: this is
 * the only place with a warning channel. `SystemStepContext.warn` surfaces a
 * dropped piece of config on the approval gate; `ExecutorContext` has no
 * equivalent. Config the builder cannot use is therefore dropped WITH a warning
 * rather than planned as a step certain to fail.
 *
 * Ids are minted here and bound BY UUID, the same discipline `buildPlan` uses
 * for entities. The engine addresses entities through their `EntityId`
 * component, and `dispatchCommand` returns void — so a step bound to an
 * authored name would match nothing and report nothing.
 *
 * KNOWN LIMITATION (2D). 2D worlds are built from the same `cube` primitives as
 * 3D ones, laid out in the XY plane at z = 0 for the side view a 2D game gets.
 * The tilemap route is not available: the engine's real vocabulary is
 * `set_tilemap_data` / `paint_tile` / `erase_tile` / `fill_tiles`, and all of it
 * needs a real tileset asset id that no step in this pipeline can produce. The
 * names this comment used to cite — `create_tilemap`, `set_tile`,
 * `create_tileset` — were routed with no handler behind them and were deleted
 * from `route_domain` outright in PF-1181. `spawn_sprite` has no `id` field at all, so a
 * sprite cannot carry a planned UUID and nothing downstream could bind to it.
 * Primitives are the only geometry that is both reachable and bindable today.
 */

import { registerSystem } from './registry';
import type { SystemStepInput, SystemStepContext } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';
import { buildWorldGeometry } from '../worldGeometry';

registerSystem({
  category: 'world',
  setupSteps(
    system: GameSystem,
    gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ): SystemStepInput[] {
    const { descriptors, warnings } = buildWorldGeometry({
      worldType: system.type,
      worldConfig: system.config,
      projectType: gdd.projectType,
    });

    for (let i = 0; i < warnings.length; i += 1) ctx.warn(warnings[i]);

    if (descriptors.length === 0) {
      // The builder always grounds the scene, so this is unreachable today —
      // but `world_build` refuses an empty entity list by design, and a
      // non-optional step failing sets the whole plan to `failed`. Planning no
      // step at all is the safe shape.
      ctx.warn('The world description produced nothing to build, so the level was left empty.');
      return [];
    }

    // Indexed loop, not `.map`: a callback form skips an array hole outright,
    // and `.map` keeps the hole positionally, so a gap would survive into the
    // step input and reach the executor as `undefined`.
    const entities: Array<Record<string, unknown>> = [];
    // The same ids again, shaped for the physics step. Built in the same pass so
    // the two lists cannot drift: geometry ids exist ONLY here (they are not in
    // `plannedEntities`), so if this step misses one, that piece of the level is
    // never made solid and the player falls through it.
    const physicsEntities: Array<Record<string, unknown>> = [];
    for (let i = 0; i < descriptors.length; i += 1) {
      const descriptor = descriptors[i];
      const entityId = crypto.randomUUID();
      entities.push({
        entityId,
        name: descriptor.name,
        entityType: descriptor.entityType,
        position: descriptor.position,
        scale: descriptor.scale,
      });
      // Ground, platforms and walls are all static solids — the `geometry`
      // physics role. Their shape comes from the descriptor rather than a role
      // default, so the collider matches whatever mesh the builder chose.
      physicsEntities.push({
        entityId,
        name: descriptor.name,
        role: 'geometry',
        shape: descriptor.entityType,
      });
    }

    return [
      {
        executor: 'world_build',
        input: { worldType: system.type, entities },
      },
      // Immediately after the spawn, and before any later system step: the
      // engine gives a collider only to an entity carrying `PhysicsEnabled`, so
      // without this the ground the builder just laid down is scenery the player
      // falls straight through (PF-1213).
      {
        executor: 'physics_enable',
        input: { entities: physicsEntities },
      },
    ];
  },
});
