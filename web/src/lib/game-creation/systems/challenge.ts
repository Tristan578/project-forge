/**
 * Challenge system definition — the GDD category that carries hazards,
 * obstacles, the enemies that chase, the platforms that move and the nests that
 * keep producing more.
 *
 * Before PF-1199 this category fell through to `custom_script_generate`, so the
 * spikes and the lava the design asked for were spawned as scenery: touching
 * one did nothing. PF-1201 is the rest of the same defect — an enemy that never
 * moves, a platform that never travels and a spawner that never spawns are all
 * scenery too, and all four component kinds already exist end to end (the
 * engine runs their systems, `gameComponentWire` maps them, the executor
 * accepts them). The only thing missing was a definition that planned them.
 *
 * Rules that are load-bearing:
 *
 *  1. Every component is bound to `entityId` — the engine UUID — never to the
 *     authored name. The engine matches on the `EntityId` component and emits
 *     nothing when nothing matches, and `dispatchCommand` returns void, so a
 *     step bound to a name fails in complete silence. A named thing that
 *     resolves to no planned entity is therefore DROPPED with a warning rather
 *     than planned as a step certain to fail.
 *  2. The player's `health` is planned here ONLY when no health-shaped
 *     `feedback` system is going to plan it (see `feedbackPlansHealth`). A
 *     damage zone with nothing to damage is a hazard the player walks through,
 *     so the fallback exists — but two writers for one component is a race, not
 *     a design.
 *  3. Followers are planned for enemies by DEFAULT and platforms and spawners
 *     ONLY on explicit config. An enemy that stands still is the failure this
 *     ticket exists to fix, whereas making every object whose name contains
 *     "platform" start moving would break a level the design meant to be
 *     static. Default-on still honours an explicit `false` — that is why
 *     `readOptionalBoolean` distinguishes "absent" from "said no".
 */

import { registerSystem } from './registry';
import type { SystemStepInput, SystemStepContext, PlannedEntity } from './registry';
import type { GameSystem, OrchestratorGDD } from '../types';
// The ownership rule for entities that carry their own `behavior` (PF-1114).
// See the note on `planBehaviorSteps` in `../behaviorSteps.ts`: per-entity
// intent wins, so this system leaves those entities' motion components alone
// rather than planning a second writer for the same component.
import { hasAuthoredBehavior } from '../behaviorVocabulary';
// Reused rather than restated: a second copy of the health bag or of the
// health-shaped predicate is a copy that drifts, and the bag must stay COMPLETE
// (the engine merges a partial one onto `HealthData::default()` and reports
// nothing).
import { DEFAULT_MAX_HP, feedbackPlansHealth, healthStep, readMaxHp } from './feedback';
import {
  readNameList,
  readPositiveNumber,
  readBoolean,
  readOptionalBoolean,
  resolveNames,
} from './configRead';

/** Matches `DamageZoneData::default()`, so an unstated rate is the engine's. */
const DEFAULT_DAMAGE_PER_SECOND = 25;
/** The engine clamps `damage_per_second` to this; a larger number is a typo. */
const MAX_DAMAGE_PER_SECOND = 10_000;

/** Config keys an LLM plausibly uses for "the things that hurt". */
const NAME_LIST_KEYS = ['hazards', 'obstacles', 'entities', 'traps', 'damageZones', 'dangers'];
/** Config keys an LLM plausibly uses for "how much it hurts". */
const DAMAGE_KEYS = ['damagePerSecond', 'damage', 'dps', 'damagePerHit', 'damageAmount'];
/** Config keys an LLM plausibly uses for "it kills outright". */
const ONE_SHOT_KEYS = ['oneShot', 'instantKill', 'lethal', 'instaKill'];

/**
 * Names that describe something that hurts on contact. Used only when the
 * design named no hazards explicitly — a role says what an object IS, and no
 * role means "hazard", so the name is the only signal left.
 */
const HAZARD_NAME_PATTERN =
  /spike|lava|acid|fire|flame|burn|trap|hazard|saw|blade|laser|pit|chasm|poison|toxic|thorn|electric|shock|bomb|mine|crush|danger|damage|obstacle/i;

// ---------------------------------------------------------------------------
// Follower — the enemies that come after the player
// ---------------------------------------------------------------------------

/** Config keys that turn chasing off. Default is on; only `false` opts out. */
const CHASE_KEYS = ['chasePlayer', 'chase', 'pursue', 'followPlayer', 'seekPlayer', 'aiChase'];
/** Config keys an LLM plausibly uses for "how fast the enemy chases". */
const CHASE_SPEED_KEYS = ['chaseSpeed', 'enemySpeed', 'pursuitSpeed', 'speed'];
/** Config keys an LLM plausibly uses for "how close it gets before stopping". */
const STOP_DISTANCE_KEYS = ['stopDistance', 'attackRange', 'keepDistance'];

/** `FollowerData::default()`, so an unstated value is the engine's own. */
const DEFAULT_CHASE_SPEED = 3;
const DEFAULT_STOP_DISTANCE = 1.5;
/** `ENGINE_PROP_RANGES.follower` — past these the engine clamps anyway. */
const MAX_CHASE_SPEED = 1000;
const MAX_STOP_DISTANCE = 1000;

// ---------------------------------------------------------------------------
// Moving platform — explicit config only
// ---------------------------------------------------------------------------

const PLATFORM_NAME_KEYS = ['movingPlatforms', 'platforms', 'movers', 'elevators'];
const PLATFORM_SPEED_KEYS = ['platformSpeed', 'moveSpeed'];
const PLATFORM_DISTANCE_KEYS = ['distance', 'range', 'travelDistance', 'amplitude'];
const PLATFORM_PAUSE_KEYS = ['pauseDuration', 'pause', 'waitTime'];

/** `MovingPlatformData::default()`. */
const DEFAULT_PLATFORM_SPEED = 2;
const DEFAULT_PLATFORM_PAUSE = 0.5;
/** How far a platform travels when the design named no distance. */
const DEFAULT_PLATFORM_DISTANCE = 4;
/** `ENGINE_PROP_RANGES.moving_platform`. */
const MAX_PLATFORM_SPEED = 1000;
const MAX_PLATFORM_PAUSE = 60;
/**
 * A route longer than this is TRUNCATED by the engine (`MAX_WAYPOINTS`), not
 * refused — so the cap belongs here, where the drop can still be explained.
 * Two waypoints is the engine's floor: `system_moving_platform` returns early
 * below it and the platform never moves.
 */
const MAX_PLATFORM_TRAVEL = 1000;

/** Names that describe something that goes up rather than across. */
const VERTICAL_NAME_PATTERN = /elevator|lift|riser|hoist|ascend/i;

// ---------------------------------------------------------------------------
// Spawner — explicit config, or an unmistakable name
// ---------------------------------------------------------------------------

const SPAWNER_NAME_KEYS = ['spawners', 'generators', 'nests', 'spawnPoints'];
const SPAWN_TYPE_KEYS = ['spawnEntityType', 'spawnType', 'spawns', 'spawnShape'];
const SPAWN_INTERVAL_KEYS = ['spawnInterval', 'intervalSecs', 'interval', 'spawnRate'];
const SPAWN_MAX_KEYS = ['maxSpawns', 'maxCount', 'spawnLimit'];

/**
 * `portal` is deliberately absent: `progression`'s goal detection already
 * claims that word, and one entity cannot be both the exit and a nest.
 */
const SPAWNER_NAME_PATTERN = /spawner|generator|nest|hive|dispenser/i;

/** The four meshes `system_spawner` can build — anything else becomes a cube. */
const SPAWNABLE_TYPES = ['cube', 'sphere', 'cylinder', 'capsule'] as const;
type SpawnableType = (typeof SPAWNABLE_TYPES)[number];

/** `SpawnerData::default()`. */
const DEFAULT_SPAWN_TYPE: SpawnableType = 'cube';
const DEFAULT_SPAWN_INTERVAL = 3;
const DEFAULT_SPAWN_MAX = 5;
/** `ENGINE_PROP_RANGES.spawner` — a zero interval spawns every frame forever. */
const MIN_SPAWN_INTERVAL = 0.1;
const MAX_SPAWN_INTERVAL = 3600;
/** No engine clamp; a runaway count is a typo, and 1000 entities is already a lot. */
const MAX_SPAWN_COUNT = 1000;
/** `SpawnerData::default().spawn_offset` — above the nest, not inside it. */
const SPAWN_OFFSET: [number, number, number] = [0, 1, 0];

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function damageZoneStep(
  entity: PlannedEntity,
  damagePerSecond: number,
  oneShot: boolean,
): SystemStepInput {
  return {
    executor: 'game_component',
    input: {
      entityId: entity.entityId,
      type: 'damageZone',
      damagePerSecond,
      oneShot,
    },
  };
}

function followerStep(
  entity: PlannedEntity,
  targetEntityId: string,
  speed: number,
  stopDistance: number,
): SystemStepInput {
  return {
    executor: 'game_component',
    input: {
      entityId: entity.entityId,
      type: 'follower',
      targetEntityId,
      speed,
      stopDistance,
      lookAtTarget: true,
    },
  };
}

function movingPlatformStep(
  entity: PlannedEntity,
  speed: number,
  waypoints: [number, number, number][],
  pauseDuration: number,
): SystemStepInput {
  return {
    executor: 'game_component',
    input: {
      entityId: entity.entityId,
      type: 'movingPlatform',
      speed,
      waypoints,
      pauseDuration,
      // Back and forth, because a platform that travels once and stops is a
      // one-way trip the player can be stranded by.
      loopMode: 'pingPong',
    },
  };
}

function spawnerStep(
  entity: PlannedEntity,
  entityType: SpawnableType,
  intervalSecs: number,
  maxCount: number,
): SystemStepInput {
  return {
    executor: 'game_component',
    input: {
      entityId: entity.entityId,
      type: 'spawner',
      entityType,
      intervalSecs,
      maxCount,
      spawnOffset: [...SPAWN_OFFSET] as [number, number, number],
      // Free-running. A trigger name the design never wired to anything would
      // be a spawner that waits forever for an event nobody sends.
      onTrigger: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The things the design made dangerous, named explicitly or found by role. */
function resolveHazards(system: GameSystem, ctx: SystemStepContext): PlannedEntity[] {
  const names = readNameList(system.config, NAME_LIST_KEYS);

  if (names.length > 0) {
    // Each dropped name warns for itself inside `resolveNames`.
    return resolveNames(
      names,
      ctx.entities,
      ctx.warn,
      name =>
        `The design named "${name}" as a hazard, but no such object was placed in the world, so it was left out.`,
      // A damage zone on the player damages the player continuously.
      (entity, name) =>
        entity.entity.role === 'player'
          ? `The design named the player "${name}" as a hazard, which would hurt the player constantly, so it was left out.`
          : null,
    );
  }

  // Nothing named: an enemy hurts on contact by convention, and for everything
  // else the name is the only signal there is.
  const hazards: PlannedEntity[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ctx.entities.length; i += 1) {
    const entity = ctx.entities[i];
    if (!entity || entity.entity.role === 'player') continue;
    const isHazard =
      entity.entity.role === 'enemy' || HAZARD_NAME_PATTERN.test(entity.entity.name);
    if (!isHazard) continue;
    if (seen.has(entity.entityId)) continue;
    seen.add(entity.entityId);
    hazards.push(entity);
  }

  if (hazards.length === 0) {
    ctx.warn(
      'The design asked for hazards but named none and placed no enemies, so nothing in the world can hurt the player.',
    );
  }

  return hazards;
}

/**
 * The enemies that chase the player.
 *
 * Silent when there is nothing to plan: this runs on every challenge system,
 * including the ones whose whole job is a spike pit, and a warning per design
 * that simply has no enemies would be noise.
 */
function planFollowers(
  system: GameSystem,
  ctx: SystemStepContext,
  excluded: Set<string>,
): SystemStepInput[] {
  if (readOptionalBoolean(system.config, CHASE_KEYS) === false) return [];

  const enemies: PlannedEntity[] = [];
  let player: PlannedEntity | null = null;
  for (let i = 0; i < ctx.entities.length; i += 1) {
    const entity = ctx.entities[i];
    if (!entity) continue;
    if (entity.entity.role === 'player') {
      player ??= entity;
      continue;
    }
    if (entity.entity.role !== 'enemy') continue;
    // A nest that walks is a design error, not a chase.
    if (excluded.has(entity.entityId)) continue;
    // The design said what THIS enemy does, so the behaviour pass owns it —
    // including when it said `idle` or `patrol`, which mean "do not chase".
    // Planning a follower here too would give one entity two writers.
    if (hasAuthoredBehavior(entity.entity)) continue;
    enemies.push(entity);
  }

  if (enemies.length === 0) return [];

  if (!player) {
    // Worth saying: the design placed enemies and nothing for them to hunt, so
    // they will stand exactly where they spawned.
    ctx.warn(
      'The design placed enemies but no player, so they were left standing still rather than chasing nothing.',
    );
    return [];
  }

  const speed = clamp(
    readPositiveNumber(system.config, CHASE_SPEED_KEYS) ?? DEFAULT_CHASE_SPEED,
    0,
    MAX_CHASE_SPEED,
  );
  const stopDistance = clamp(
    readPositiveNumber(system.config, STOP_DISTANCE_KEYS) ?? DEFAULT_STOP_DISTANCE,
    0,
    MAX_STOP_DISTANCE,
  );

  const steps: SystemStepInput[] = [];
  for (let i = 0; i < enemies.length; i += 1) {
    const enemy = enemies[i];
    if (!enemy) continue;
    steps.push(followerStep(enemy, player.entityId, speed, stopDistance));
  }
  return steps;
}

/**
 * The chase tuning a GDD asked for, for a caller outside this system.
 *
 * `planBehaviorSteps` plans the follower for an entity carrying
 * `behavior: 'chase'`, so without this the same design saying
 * `config: { chaseSpeed: 8 }` on its challenge system would silently get the
 * engine default instead. The clamps and the key aliases are the ones
 * `planFollowers` uses, read off the same constants rather than restated.
 *
 * Indexed loop: `.find` skips array holes, and a missed challenge system here
 * is a speed the design asked for and did not get.
 */
export function chaseTuningFor(gdd: OrchestratorGDD): {
  speed: number;
  stopDistance: number;
} {
  for (let i = 0; i < gdd.systems.length; i += 1) {
    const system = gdd.systems[i];
    if (!system || system.category !== 'challenge') continue;
    return {
      speed: clamp(
        readPositiveNumber(system.config, CHASE_SPEED_KEYS) ?? DEFAULT_CHASE_SPEED,
        0,
        MAX_CHASE_SPEED,
      ),
      stopDistance: clamp(
        readPositiveNumber(system.config, STOP_DISTANCE_KEYS) ?? DEFAULT_STOP_DISTANCE,
        0,
        MAX_STOP_DISTANCE,
      ),
    };
  }
  return { speed: DEFAULT_CHASE_SPEED, stopDistance: DEFAULT_STOP_DISTANCE };
}

/**
 * The platforms the design asked to move, and only those.
 *
 * Waypoints are OFFSETS from where the entity spawned (`let target = origin +
 * waypoint`), so the route is "stay put, then travel this far" rather than a
 * pair of world positions — a world-space route would teleport every platform
 * to the origin on the first frame.
 */
function planMovingPlatforms(system: GameSystem, ctx: SystemStepContext): SystemStepInput[] {
  const names = readNameList(system.config, PLATFORM_NAME_KEYS);
  if (names.length === 0) return [];

  const platforms = resolveNames(
    names,
    ctx.entities,
    ctx.warn,
    name =>
      `The design named "${name}" as a moving platform, but no such object was placed in the world, so it was left out.`,
    (entity, name) =>
      entity.entity.role === 'player'
        ? `The design named the player "${name}" as a moving platform, which would take control away from the player, so it was left out.`
        : null,
  );
  if (platforms.length === 0) return [];

  const speed = clamp(
    readPositiveNumber(system.config, PLATFORM_SPEED_KEYS) ?? DEFAULT_PLATFORM_SPEED,
    0,
    MAX_PLATFORM_SPEED,
  );
  const pauseDuration = clamp(
    readPositiveNumber(system.config, PLATFORM_PAUSE_KEYS) ?? DEFAULT_PLATFORM_PAUSE,
    0,
    MAX_PLATFORM_PAUSE,
  );
  const distance = clamp(
    readPositiveNumber(system.config, PLATFORM_DISTANCE_KEYS) ?? DEFAULT_PLATFORM_DISTANCE,
    0,
    MAX_PLATFORM_TRAVEL,
  );

  const steps: SystemStepInput[] = [];
  for (let i = 0; i < platforms.length; i += 1) {
    const platform = platforms[i];
    if (!platform) continue;
    // Same ownership rule as the follower pass: an entity carrying its own
    // `behavior` already had its `movingPlatform` planned (or deliberately not
    // planned) by `planBehaviorSteps`.
    if (hasAuthoredBehavior(platform.entity)) continue;
    const vertical = VERTICAL_NAME_PATTERN.test(platform.entity.name);
    const waypoints: [number, number, number][] = [
      [0, 0, 0],
      vertical ? [0, distance, 0] : [distance, 0, 0],
    ];
    steps.push(movingPlatformStep(platform, speed, waypoints, pauseDuration));
  }
  return steps;
}

/** The one mesh name the engine will build, or null when it cannot tell. */
function readSpawnType(config: Record<string, unknown>): string | null {
  for (const key of SPAWN_TYPE_KEYS) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function asSpawnableType(raw: string): SpawnableType | null {
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, '');
  for (let i = 0; i < SPAWNABLE_TYPES.length; i += 1) {
    const candidate = SPAWNABLE_TYPES[i];
    if (candidate && normalized === candidate) return candidate;
  }
  return null;
}

/**
 * The things that keep producing more things.
 *
 * Returns the steps AND the entities they were planned for, so the follower
 * pass can leave those alone.
 */
function planSpawners(
  system: GameSystem,
  ctx: SystemStepContext,
): { steps: SystemStepInput[]; entityIds: Set<string> } {
  const names = readNameList(system.config, SPAWNER_NAME_KEYS);
  const entityIds = new Set<string>();

  let spawners: PlannedEntity[];
  if (names.length > 0) {
    spawners = resolveNames(
      names,
      ctx.entities,
      ctx.warn,
      name =>
        `The design named "${name}" as a spawner, but no such object was placed in the world, so it was left out.`,
      (entity, name) =>
        entity.entity.role === 'player'
          ? `The design named the player "${name}" as a spawner, so it was left out.`
          : null,
    );
  } else {
    // Nothing named: only an unmistakable name counts. Guessing wider would
    // turn scenery into an endless enemy source nobody asked for.
    spawners = [];
    const seen = new Set<string>();
    for (let i = 0; i < ctx.entities.length; i += 1) {
      const entity = ctx.entities[i];
      if (!entity || entity.entity.role === 'player') continue;
      if (!SPAWNER_NAME_PATTERN.test(entity.entity.name)) continue;
      if (seen.has(entity.entityId)) continue;
      seen.add(entity.entityId);
      spawners.push(entity);
    }
  }

  if (spawners.length === 0) return { steps: [], entityIds };

  const authoredType = readSpawnType(system.config);
  let entityType: SpawnableType = DEFAULT_SPAWN_TYPE;
  if (authoredType !== null) {
    const resolved = asSpawnableType(authoredType);
    if (resolved) {
      entityType = resolved;
    } else {
      // The executor's schema is a closed enum, so passing this through would
      // fail the whole step rather than degrade it.
      ctx.warn(
        `The design asked the spawners to produce "${authoredType}", which the engine cannot build, so they produce a ${DEFAULT_SPAWN_TYPE} instead.`,
      );
    }
  }

  const intervalSecs = clamp(
    readPositiveNumber(system.config, SPAWN_INTERVAL_KEYS) ?? DEFAULT_SPAWN_INTERVAL,
    MIN_SPAWN_INTERVAL,
    MAX_SPAWN_INTERVAL,
  );
  const maxCount = Math.round(
    clamp(readPositiveNumber(system.config, SPAWN_MAX_KEYS) ?? DEFAULT_SPAWN_MAX, 1, MAX_SPAWN_COUNT),
  );

  const steps: SystemStepInput[] = [];
  for (let i = 0; i < spawners.length; i += 1) {
    const spawner = spawners[i];
    if (!spawner) continue;
    entityIds.add(spawner.entityId);
    steps.push(spawnerStep(spawner, entityType, intervalSecs, maxCount));
  }
  return { steps, entityIds };
}

// ---------------------------------------------------------------------------

registerSystem({
  category: 'challenge',
  setupSteps(
    system: GameSystem,
    gdd: OrchestratorGDD,
    ctx: SystemStepContext,
  ): SystemStepInput[] {
    if (ctx.entities.length === 0) {
      ctx.warn(
        'The design asked for hazards but placed no objects in the world, so nothing was made dangerous.',
      );
      return [];
    }

    const hazards = resolveHazards(system, ctx);

    const damagePerSecond = Math.min(
      readPositiveNumber(system.config, DAMAGE_KEYS) ?? DEFAULT_DAMAGE_PER_SECOND,
      MAX_DAMAGE_PER_SECOND,
    );
    const oneShot = readBoolean(system.config, ONE_SHOT_KEYS);

    const spawners = planSpawners(system, ctx);

    const body: SystemStepInput[] = [];
    for (let i = 0; i < hazards.length; i += 1) {
      const hazard = hazards[i];
      if (!hazard) continue;
      body.push(damageZoneStep(hazard, damagePerSecond, oneShot));
    }
    body.push(...planFollowers(system, ctx, spawners.entityIds));
    body.push(...planMovingPlatforms(system, ctx));
    body.push(...spawners.steps);

    // Nothing to survive means nothing to give health to. A lone `health`
    // component on a player nothing can hurt is a step that reads as work done
    // while the design's actual request was dropped.
    if (body.length === 0) return [];

    const steps: SystemStepInput[] = [];

    // Health first, so the thing that has to survive the hazard is set up
    // before the hazard that damages it.
    const player = ctx.entities.find(e => e.entity.role === 'player');
    if (player && !feedbackPlansHealth(gdd)) {
      steps.push(healthStep(player, readMaxHp(system.config) ?? DEFAULT_MAX_HP, true));
    }

    steps.push(...body);
    return steps;
  },
});
