/**
 * Reference game `qa-score3-v1/platformer-2d` — the 2D member of #9878's
 * `qa-score3-v1` set (#10159).
 *
 * A single-screen side-scroller: the player starts on the left ledge, crosses a
 * spike pit by way of a floating platform (a coin sits above it), and wins by
 * touching the goal flag on the right ledge. Seven entities, all spawned by
 * `spawn_entity` and configured through the same store actions the editor
 * uses, so the engine spec applies it exactly the way a creator would.
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
 * (the start ledge) and refills HP, because `respawnOnDeath` is true and
 * `despawnOnDeath` is false. An engine query of the player's transform and
 * health observes it.
 *
 * KNOWN ENGINE GAP — in a 2D project the three game-component systems
 * above read their contacts from `GameComponentRuntime.active_collisions`, and
 * `system_track_collisions` fills that set from `bevy_rapier3d` events only. 2D
 * bodies are simulated by `bevy_rapier2d`, whose contacts reach JavaScript
 * (`read_collision_events_2d`, `engine/src/bridge/physics.rs`) but not that
 * set. This fixture declares the mechanics a 2D platformer needs; whether the
 * engine carries them out in 2D is what the journey that plays it (#10152) has
 * to observe, not something this file can promise. Loading it — which is all
 * #10159 asserts — does not depend on it.
 *
 * Coordinates are world units in the XY plane (a 2D project's camera looks down
 * -Z); each entity's 2D collider size equals its X/Y scale.
 */
import type { Physics2dData } from '@/stores/slices/types';
import {
  REFERENCE_GAME_SET,
  type ReferenceGame,
  type ReferenceGameExpectedState,
} from './referenceGame';

/** Static 2D body; `isSensor` for triggers the player passes through. */
function staticBody(size: [number, number], isSensor: boolean): Physics2dData {
  return {
    bodyType: 'static',
    colliderShape: 'box',
    size,
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
  version: 1,
  description:
    '2D platformer reference game: cross the spike pit via the floating platform and touch the goal flag. ' +
    'Win = reachGoal on the goal; lose = HP to 0 in the spike pit, then respawn at the start ledge.',
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
      position: [-6, 0.5, 0],
      scale: [0.8, 0.8, 0.8],
      physics: {
        dimension: '2d',
        data: {
          bodyType: 'dynamic',
          colliderShape: 'box',
          size: [0.8, 0.8],
          radius: 0.4,
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
            respawnPoint: [-6, 1, 0],
            despawnOnDeath: false,
          },
        },
      ],
    },
    {
      id: 'ledge_start',
      name: 'Start Ledge',
      entityType: 'cube',
      position: [-4, -0.5, 0],
      scale: [6, 1, 1],
      physics: { dimension: '2d', data: staticBody([6, 1], false) },
      gameComponents: [],
    },
    {
      id: 'spike_pit',
      name: 'Spike Pit',
      entityType: 'cube',
      position: [0.5, -1.5, 0],
      scale: [3, 1, 1],
      physics: { dimension: '2d', data: staticBody([3, 1], true) },
      gameComponents: [{ type: 'damageZone', damageZone: { damagePerSecond: 100, oneShot: true } }],
    },
    {
      id: 'floating_platform',
      name: 'Floating Platform',
      entityType: 'cube',
      position: [0.5, 1.5, 0],
      scale: [2, 0.4, 1],
      physics: { dimension: '2d', data: staticBody([2, 0.4], false) },
      gameComponents: [],
    },
    {
      id: 'coin',
      name: 'Coin',
      entityType: 'cylinder',
      position: [0.5, 2.5, 0],
      scale: [0.5, 0.5, 0.5],
      physics: { dimension: '2d', data: staticBody([0.5, 0.5], true) },
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
      position: [5, -0.5, 0],
      scale: [6, 1, 1],
      physics: { dimension: '2d', data: staticBody([6, 1], false) },
      gameComponents: [],
    },
    {
      id: 'goal',
      name: 'Goal Flag',
      entityType: 'cone',
      position: [7, 0.75, 0],
      scale: [0.5, 1.5, 0.5],
      physics: { dimension: '2d', data: staticBody([0.5, 1.5], true) },
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
 * Independent expected state for `platformer-2d@1`. Hand-written: the engine
 * spec asserts against THIS, and `verify.ts` re-derives it from the fixture.
 * Changing the fixture means bumping `version` above and rewriting this record,
 * including `contentDigest`.
 */
export const platformer2dExpected = {
  fixtureId: 'qa-score3-v1/platformer-2d',
  version: 1,
  contentDigest: 'sha256:81718c4675de86da0813b8e88ac38a3123a4929a387f5b7abffd95f8401a5e06',
  entities: {
    player: { name: 'Player', entityType: 'cube', physics: '2d', gameComponents: ['characterController', 'health'] },
    ledge_start: { name: 'Start Ledge', entityType: 'cube', physics: '2d', gameComponents: [] },
    spike_pit: { name: 'Spike Pit', entityType: 'cube', physics: '2d', gameComponents: ['damageZone'] },
    floating_platform: { name: 'Floating Platform', entityType: 'cube', physics: '2d', gameComponents: [] },
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
    respawnPoint: [-6, 1, 0],
    damageZoneEntityIds: ['spike_pit'],
    oneShot: true,
  },
} satisfies ReferenceGameExpectedState;
