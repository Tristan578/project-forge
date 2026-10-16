/**
 * Reference game `qa-score3-v1/platformer-2d` — the 2D member of #9878's
 * `qa-score3-v1` set (#10159).
 *
 * A single-screen side-scroller built to be WON BY HOLDING RIGHT: the player
 * starts on the start ledge, walks along one level floor past a coin, and wins
 * by touching the goal flag on the end ledge. Behind the player, to the left,
 * is a spike pit that loses the game when walked into. Seven entities, all
 * spawned by `spawn_entity` and configured through the same store actions the
 * editor uses, so the engine spec applies it exactly the way a creator would.
 *
 * ROUTE — WHY IT IS FLAT. The engine's 2D character controller cannot jump,
 * and that decides every coordinate below (details under JUMP). All it can do
 * is walk sideways at `speed` and let the 2D simulation's gravity pull the body
 * down, so a route has to be completable with horizontal input alone:
 *
 *   - win: hold right. Walk from x=-5 over the start ledge (top y=0, x -8..-1)
 *     and straight on over the end ledge (top y=0, x -1..8). The two ledges
 *     meet flush at x=-1 with coplanar tops, so the 0.8-wide box straddles the
 *     seam and never drops or rises. The coin (x=2.5, y 0.15..0.65) and the
 *     goal flag (x=7, y 0..1.5) both overlap the box's own height band
 *     (y 0..0.8) at floor level, so walking collects the one and touches the
 *     other. No floor on the route is higher than the one before it, because
 *     the controller cannot climb even a hundredth of a unit. The layout has
 *     no drop and no gap either: how far the body drifts sideways while it
 *     falls depends on the frame rate (the controller moves by the frame's
 *     `dt`, the simulation's step is capped), so a route that needed a landing
 *     spot could not be reproduced. The checker (`walkRoute.ts`) is not as
 *     strict on that last point: it refuses a gap the box cannot straddle and
 *     any climb, but it ACCEPTS a step down onto an adjoining lower floor,
 *     because it does not model the fall. That drop is avoided by THIS layout
 *     (both ledges are coplanar), not forbidden by the checker; a test pins
 *     that the checker allows it.
 *   - lose: hold left. The spike pit is a sensor filling the cavity between the
 *     left bank and the start ledge (x -10..-8, y -3..0.5). Its tips stand 0.5
 *     above the floor, inside the box's height band, so the box touches it
 *     while still standing on the start ledge: the lose path needs no fall
 *     either. The bank on the far side makes the pit a recess in the floor
 *     rather than a void.
 *   - the hazard sits BESIDE the winning route, behind the spawn, so winning
 *     never has to avoid it by jumping.
 *
 * `e2e/lib/__tests__/referenceGames.test.ts` pins this against the fixture's own
 * data (`walkRoute.ts` sweeps the player's box along it): the winning walk reaches
 * the goal over floors that never rise, collects the coin and touches no damage
 * zone, and the left walk reaches the pit without leaving the floor. It cannot
 * see the engine; no live-engine journey has yet played this route.
 *
 * VERSIONS. v1 routed the player across a spike pit by way of a floating
 * platform (jump needed). No walk could win it under the controller described
 * below, so it described a game that could not be won; v2 was this layout. v3
 * keeps v2's layout and world extents and changes only how the colliders express
 * them: v2 set each box's `size` to its scale, which the engine multiplies by the
 * scale again (see COORDINATES), so the game it simulated was not the one drawn
 * here. A platform-and-jump route returns as a new version once the 2D
 * controller has a real jump (#10378).
 *
 * WIN — `winCondition { conditionType: 'reachGoal', targetEntityId: 'goal' }`
 * on the goal flag itself. The engine's `system_win_condition`
 * (`engine/src/core/game_components.rs`) fires `game_win` once when an entity
 * with a character controller shares a collision pair with the target, and
 * `game_win` flips the store's `gameWon`. Because the condition lives on the
 * goal, removing that one entity leaves the scene with no win condition, which
 * is the negative case the winnability suite pins.
 *
 * LOSE — there is no first-class lost state. Lose is the player's HP reaching 0
 * in the spike pit: `damageZone { oneShot: true }` zeroes the player's
 * `health`, and `system_health` then moves the player back to `respawnPoint`
 * (above the start ledge) and refills HP, because `respawnOnDeath` is true and
 * `despawnOnDeath` is false. An engine query of the player's transform and
 * health observes it.
 *
 * 2D CONTACTS — the win-condition, collectible and damage-zone systems
 * (`system_win_condition`, `system_collectible` and `system_damage_zone` in
 * `engine/src/core/game_components.rs`) read their contacts from
 * `GameComponentRuntime.active_collisions`, which `system_track_collisions`
 * fills from BOTH simulations: `bevy_rapier3d`'s `CollisionEvent` stream and,
 * since #10212 (closing #10194), `bevy_rapier2d`'s as well. Before that fix
 * the set was fed by the 3D reader only, so in a 2D project the goal, the coin
 * and the spike pit never saw a contact (a probe recorded in #10194 saw a 2D
 * collectible left in place under an overlapping player). The fix is pinned by
 * `a_2d_contact_reaches_active_collisions` in `engine/src/core/game_components.rs`.
 * This fixture declares the mechanics a 2D platformer needs; the journey that
 * plays it (#10152) is where the outcome is observed. Loading it, which is all
 * #10159 asserts, never depended on the contacts.
 *
 * JUMP — `jumpHeight: 6` is NOT an apex height here. The kinematic character
 * controller (`engine/src/core/character_controller.rs`: a gravity integrator
 * and a launch speed derived from the authored height) is attached on
 * Edit→Play only when the project is not 2D (`entering_play && !is_2d`) and
 * the character has a collider. A 2D project therefore takes the legacy
 * direct-translation branch of `system_character_controller`
 * (`engine/src/core/game_components.rs`), which writes the transform itself:
 * walking moves `speed * dt` per frame, and a jump is a single-frame nudge of
 * `jump_height * 0.5 * dt` (about 0.05 units a press at 60 Hz) with no vertical
 * velocity, no grounded state and no gravity integrator of its own — pinned by
 * `in_2d_a_jump_adds_to_the_vertical_walk_on_the_same_axis` and recorded as an
 * unresolved divergence on `CharacterControllerData`. The only gravity acting
 * on the player is the 2D simulation's, through its dynamic body's
 * `gravityScale: 1` (`physics_2d_sim.rs` inserts Rapier's `GravityScale`). The
 * value and the `jump` binding stay so the player is authored like a platformer
 * and the binding is ready for the day the jump works; nothing on the route
 * uses it.
 *
 * COORDINATES. Positions and scales are world units in the XY plane (a 2D
 * project's camera looks down -Z). Every 2D collider is the UNIT shape in the
 * entity's local space (a box of `size: [1, 1]`) and the entity's X/Y scale gives
 * it its world extent: bevy_rapier2d multiplies each collider by the entity's
 * transform scale, and the engine inserts no `ColliderScale`
 * (`make_collider_2d` in `engine/src/core/physics_2d_sim.rs` builds
 * `Collider::cuboid(size / 2)` and `Collider::ball(radius)`). The web's own
 * default is the same `size: [1, 1]` (`defaultPhysics2dData`). A collider whose
 * `size` also equalled its scale would be simulated at size x scale: the 7-wide
 * start ledge as 49 wide, the 0.8 player as 0.64. `walkRoute.ts` measures
 * colliders that way, and the suite pins both the unit size and the world
 * extents the layout above needs.
 *
 * Every collider is a box; `radius` is read only by a circle, so it sits at the
 * default 0.5 and does nothing here.
 */
import type { Physics2dData } from '@/stores/slices/types';
import {
  REFERENCE_GAME_SET,
  type ReferenceGame,
  type ReferenceGameExpectedState,
} from './referenceGame';

/**
 * Static 2D body; `isSensor` for triggers the player passes through.
 *
 * The collider is the UNIT box, `size: [1, 1]`, on purpose: `size` is in the
 * entity's local space and the engine multiplies it by the transform scale, so
 * the entity's `scale` is what gives the collider its world extent (see the
 * header's COORDINATES note). There is deliberately no `size` parameter. Passing
 * the scale in here as well would have the engine apply it twice.
 */
function staticBody(isSensor: boolean): Physics2dData {
  return {
    bodyType: 'static',
    colliderShape: 'box',
    size: [1, 1],
    radius: 0.5,
    vertices: [],
    mass: 1,
    friction: isSensor ? 0 : 0.6,
    restitution: 0,
    gravityScale: 1,
    isSensor,
    lockRotation: true,
    continuousDetection: false,
    oneWayPlatform: false,
    surfaceVelocity: [0, 0],
  };
}

export const platformer2d = {
  set: REFERENCE_GAME_SET,
  member: '2d',
  fixtureId: `${REFERENCE_GAME_SET}/platformer-2d`,
  version: 3,
  description:
    '2D platformer reference game: hold right to walk the level floor, take the coin and touch the goal flag. ' +
    'Win = reachGoal on the goal; lose = hold left into the spike pit (HP to 0), then respawn at the start ledge.',
  projectType: '2d',
  completionMode: 'win',
  inputBindings: [
    {
      actionName: 'move_right',
      actionType: 'axis',
      sources: [],
      positiveKeys: ['KeyD', 'ArrowRight'],
      negativeKeys: ['KeyA', 'ArrowLeft'],
      deadZone: 0.1,
    },
    {
      actionName: 'jump',
      actionType: 'digital',
      sources: ['Space', 'KeyW', 'ArrowUp'],
    },
  ],
  entities: [
    {
      id: 'player',
      name: 'Player',
      entityType: 'cube',
      position: [-5, 0.5, 0],
      scale: [0.8, 0.8, 0.8],
      physics: {
        dimension: '2d',
        data: {
          bodyType: 'dynamic',
          colliderShape: 'box',
          size: [1, 1],
          radius: 0.5,
          vertices: [],
          mass: 1,
          friction: 0.2,
          restitution: 0,
          gravityScale: 1,
          isSensor: false,
          lockRotation: true,
          continuousDetection: true,
          oneWayPlatform: false,
          surfaceVelocity: [0, 0],
        },
      },
      gameComponents: [
        {
          type: 'characterController',
          characterController: { speed: 5, jumpHeight: 6, gravityScale: 1, canDoubleJump: false },
        },
        {
          type: 'health',
          health: {
            maxHp: 3,
            currentHp: 3,
            invincibilitySecs: 0.5,
            respawnOnDeath: true,
            respawnPoint: [-5, 1, 0],
            despawnOnDeath: false,
          },
        },
      ],
    },
    {
      id: 'ledge_start',
      name: 'Start Ledge',
      entityType: 'cube',
      position: [-4.5, -0.5, 0],
      scale: [7, 1, 1],
      physics: { dimension: '2d', data: staticBody(false) },
      gameComponents: [],
    },
    {
      id: 'spike_pit',
      name: 'Spike Pit',
      entityType: 'cube',
      position: [-9, -1.25, 0],
      scale: [2, 3.5, 1],
      physics: { dimension: '2d', data: staticBody(true) },
      gameComponents: [{ type: 'damageZone', damageZone: { damagePerSecond: 100, oneShot: true } }],
    },
    {
      id: 'left_bank',
      name: 'Left Bank',
      entityType: 'cube',
      position: [-12, -0.5, 0],
      scale: [4, 1, 1],
      physics: { dimension: '2d', data: staticBody(false) },
      gameComponents: [],
    },
    {
      id: 'coin',
      name: 'Coin',
      entityType: 'cylinder',
      position: [2.5, 0.4, 0],
      scale: [0.5, 0.5, 0.5],
      physics: { dimension: '2d', data: staticBody(true) },
      gameComponents: [
        {
          type: 'collectible',
          collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 },
        },
      ],
    },
    {
      id: 'ledge_end',
      name: 'End Ledge',
      entityType: 'cube',
      position: [3.5, -0.5, 0],
      scale: [9, 1, 1],
      physics: { dimension: '2d', data: staticBody(false) },
      gameComponents: [],
    },
    {
      id: 'goal',
      name: 'Goal Flag',
      entityType: 'cone',
      position: [7, 0.75, 0],
      scale: [0.5, 1.5, 0.5],
      physics: { dimension: '2d', data: staticBody(true) },
      gameComponents: [
        {
          type: 'winCondition',
          winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId: 'goal' },
        },
      ],
    },
  ],
  winConditionEntityId: 'goal',
} satisfies ReferenceGame;

/**
 * Independent expected state for `platformer-2d@3`. Hand-written: the engine
 * spec asserts against THIS, and `verify.ts` re-derives it from the fixture.
 * Changing the fixture means bumping `version` above and rewriting this record,
 * including `contentDigest`.
 */
export const platformer2dExpected = {
  fixtureId: 'qa-score3-v1/platformer-2d',
  version: 3,
  contentDigest: 'sha256:c512abb4f1e7fb24e064cc06827db006d48abdbc39a1521c7aed3d0ffd8995f1',
  entities: {
    player: { name: 'Player', entityType: 'cube', physics: '2d', gameComponents: ['characterController', 'health'] },
    ledge_start: { name: 'Start Ledge', entityType: 'cube', physics: '2d', gameComponents: [] },
    spike_pit: { name: 'Spike Pit', entityType: 'cube', physics: '2d', gameComponents: ['damageZone'] },
    left_bank: { name: 'Left Bank', entityType: 'cube', physics: '2d', gameComponents: [] },
    coin: { name: 'Coin', entityType: 'cylinder', physics: '2d', gameComponents: ['collectible'] },
    ledge_end: { name: 'End Ledge', entityType: 'cube', physics: '2d', gameComponents: [] },
    goal: { name: 'Goal Flag', entityType: 'cone', physics: '2d', gameComponents: ['winCondition'] },
  },
  inputActions: {
    move_right: { type: 'axis', positive: ['KeyD', 'ArrowRight'], negative: ['KeyA', 'ArrowLeft'] },
    jump: { type: 'digital', sources: ['Space', 'KeyW', 'ArrowUp'] },
  },
  win: {
    entityId: 'goal',
    conditionType: 'reachGoal',
    targetEntityId: 'goal',
    playerEntityId: 'player',
    collectibleEntityIds: ['coin'],
  },
  lose: {
    playerEntityId: 'player',
    maxHp: 3,
    respawnOnDeath: true,
    despawnOnDeath: false,
    respawnPoint: [-5, 1, 0],
    damageZoneEntityIds: ['spike_pit'],
    oneShot: true,
  },
} satisfies ReferenceGameExpectedState;
