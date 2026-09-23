/**
 * Reference game `qa-score3-v1/collect-and-win-3d` — the 3D member of #9878's
 * `qa-score3-v1` set (#10159).
 *
 * A flat arena: the player starts in the middle, three crystals sit around it,
 * a lava pool lies between the player and one of them, and a crystal altar at
 * the back carries the win condition. A directional light makes it readable.
 * Eight entities, all spawned by `spawn_entity` and configured through the same
 * store actions the editor uses.
 *
 * WIN — `winCondition { conditionType: 'collectAll' }` on the altar, the form
 * the 3D platformer template uses (`web/src/data/templates/platformer.ts`).
 * Each crystal is a sensor with `collectible { destroyOnCollect: true }`;
 * `system_collectible` (`engine/src/core/game_components.rs`) counts a crystal
 * when it shares a collision pair with the player, and `system_win_condition`
 * fires `game_win` once when every collectible is collected. Because the
 * condition lives on the altar, removing that one entity leaves the scene with
 * no win condition, which is the negative case the winnability suite pins.
 *
 * LOSE — there is no first-class lost state. Lose is the player's HP reaching 0
 * in the lava pool: `damageZone { oneShot: true }` zeroes the player's
 * `health`, and `system_health` then moves the player back to `respawnPoint`
 * (the arena centre) and refills HP, because `respawnOnDeath` is true and
 * `despawnOnDeath` is false. An engine query of the player's transform and
 * health observes it.
 *
 * On entering Play, `manage_character_controller_lifecycle`
 * (`engine/src/core/character_controller.rs`) swaps the player's dynamic body
 * for a kinematic character controller and opts it into kinematic-vs-static
 * contacts, which is how the fixed sensors above produce collision pairs at
 * all. Proving those outcomes in the running game is #10163; #10159 asserts
 * only that the game loads and enters Play.
 */
import type { PhysicsData } from '@/stores/slices/types';
import {
  REFERENCE_GAME_SET,
  type ReferenceGame,
  type ReferenceGameExpectedState,
} from './referenceGame';

/** A 3D rigid body with every translation/rotation lock off unless asked for. */
function body(
  bodyType: PhysicsData['bodyType'],
  colliderShape: PhysicsData['colliderShape'],
  isSensor: boolean,
  lockRotation = false,
): PhysicsData {
  return {
    bodyType,
    colliderShape,
    restitution: 0,
    friction: isSensor ? 0 : 0.5,
    density: 1,
    gravityScale: 1,
    lockTranslationX: false,
    lockTranslationY: false,
    lockTranslationZ: false,
    lockRotationX: lockRotation,
    lockRotationY: lockRotation,
    lockRotationZ: lockRotation,
    isSensor,
  };
}

const crystal = {
  type: 'collectible',
  collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 },
} as const;

export const collectAndWin3d = {
  set: REFERENCE_GAME_SET,
  member: '3d',
  fixtureId: `${REFERENCE_GAME_SET}/collect-and-win-3d`,
  version: 1,
  description:
    '3D collect-and-win reference game: collect all three crystals in the arena. ' +
    'Win = collectAll on the altar; lose = HP to 0 in the lava pool, then respawn at the arena centre.',
  projectType: '3d',
  completionMode: 'win',
  inputBindings: [
    {
      actionName: 'move_forward',
      actionType: 'axis',
      sources: [],
      positiveKeys: ['KeyW', 'ArrowUp'],
      negativeKeys: ['KeyS', 'ArrowDown'],
      deadZone: 0.1,
    },
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
      sources: ['Space'],
    },
  ],
  entities: [
    {
      id: 'player',
      name: 'Player',
      entityType: 'capsule',
      position: [0, 1, 0],
      scale: [1, 1, 1],
      physics: { dimension: '3d', data: body('dynamic', 'capsule', false, true) },
      gameComponents: [
        {
          type: 'characterController',
          characterController: { speed: 6, jumpHeight: 1.5, gravityScale: 1, canDoubleJump: false },
        },
        {
          type: 'health',
          health: {
            maxHp: 3,
            currentHp: 3,
            invincibilitySecs: 0.5,
            respawnOnDeath: true,
            respawnPoint: [0, 1, 0],
            despawnOnDeath: false,
          },
        },
      ],
    },
    {
      id: 'arena_floor',
      name: 'Arena Floor',
      entityType: 'cube',
      position: [0, -0.5, 0],
      scale: [20, 1, 20],
      physics: { dimension: '3d', data: body('fixed', 'cuboid', false) },
      gameComponents: [],
    },
    {
      id: 'crystal_east',
      name: 'Crystal East',
      entityType: 'sphere',
      position: [5, 0.75, 0],
      scale: [0.6, 0.6, 0.6],
      physics: { dimension: '3d', data: body('fixed', 'ball', true) },
      gameComponents: [crystal],
    },
    {
      id: 'crystal_west',
      name: 'Crystal West',
      entityType: 'sphere',
      position: [-5, 0.75, 2],
      scale: [0.6, 0.6, 0.6],
      physics: { dimension: '3d', data: body('fixed', 'ball', true) },
      gameComponents: [crystal],
    },
    {
      id: 'crystal_south',
      name: 'Crystal South',
      entityType: 'sphere',
      position: [0, 0.75, 7],
      scale: [0.6, 0.6, 0.6],
      physics: { dimension: '3d', data: body('fixed', 'ball', true) },
      gameComponents: [crystal],
    },
    {
      id: 'lava_pool',
      name: 'Lava Pool',
      entityType: 'cube',
      position: [0, 0.05, 4],
      scale: [3, 0.1, 2],
      physics: { dimension: '3d', data: body('fixed', 'cuboid', true) },
      gameComponents: [{ type: 'damageZone', damageZone: { damagePerSecond: 100, oneShot: true } }],
    },
    {
      id: 'altar',
      name: 'Crystal Altar',
      entityType: 'cylinder',
      position: [0, 0.5, -7],
      scale: [1, 1, 1],
      physics: { dimension: '3d', data: body('fixed', 'cylinder', false) },
      gameComponents: [
        {
          type: 'winCondition',
          winCondition: { conditionType: 'collectAll', targetScore: null, targetEntityId: null },
        },
      ],
    },
    {
      id: 'sun',
      name: 'Sun',
      entityType: 'directional_light',
      position: [0, 10, 0],
      scale: [1, 1, 1],
      physics: null,
      gameComponents: [],
    },
  ],
  winConditionEntityId: 'altar',
} satisfies ReferenceGame;

/**
 * Independent expected state for `collect-and-win-3d@1`. Hand-written: the
 * engine spec asserts against THIS, and `verify.ts` re-derives it from the
 * fixture. Changing the fixture means bumping `version` above and rewriting
 * this record, including `contentDigest`.
 */
export const collectAndWin3dExpected = {
  fixtureId: 'qa-score3-v1/collect-and-win-3d',
  version: 1,
  contentDigest: 'sha256:b7087f28d8a13d9f8073fce50c4d8fdeb25b0f0c2b565a49ee6b4ef0c13e7525',
  entities: {
    player: { name: 'Player', entityType: 'capsule', physics: '3d', gameComponents: ['characterController', 'health'] },
    arena_floor: { name: 'Arena Floor', entityType: 'cube', physics: '3d', gameComponents: [] },
    crystal_east: { name: 'Crystal East', entityType: 'sphere', physics: '3d', gameComponents: ['collectible'] },
    crystal_west: { name: 'Crystal West', entityType: 'sphere', physics: '3d', gameComponents: ['collectible'] },
    crystal_south: { name: 'Crystal South', entityType: 'sphere', physics: '3d', gameComponents: ['collectible'] },
    lava_pool: { name: 'Lava Pool', entityType: 'cube', physics: '3d', gameComponents: ['damageZone'] },
    altar: { name: 'Crystal Altar', entityType: 'cylinder', physics: '3d', gameComponents: ['winCondition'] },
    sun: { name: 'Sun', entityType: 'directional_light', physics: null, gameComponents: [] },
  },
  inputActions: {
    move_forward: { type: 'axis', positive: ['KeyW', 'ArrowUp'], negative: ['KeyS', 'ArrowDown'] },
    move_right: { type: 'axis', positive: ['KeyD', 'ArrowRight'], negative: ['KeyA', 'ArrowLeft'] },
    jump: { type: 'digital', sources: ['Space'] },
  },
  win: {
    entityId: 'altar',
    conditionType: 'collectAll',
    targetEntityId: null,
    playerEntityId: 'player',
    collectibleEntityIds: ['crystal_east', 'crystal_west', 'crystal_south'],
  },
  lose: {
    playerEntityId: 'player',
    maxHp: 3,
    respawnOnDeath: true,
    despawnOnDeath: false,
    respawnPoint: [0, 1, 0],
    damageZoneEntityIds: ['lava_pool'],
    oneShot: true,
  },
} satisfies ReferenceGameExpectedState;
