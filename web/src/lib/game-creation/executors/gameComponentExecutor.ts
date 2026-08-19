import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
// Single line deliberately: `serverSafeImports.test.ts` scans line by line, so
// a wrapped `import type` puts the specifier on a line with no `type` keyword
// and reads as a value import of a client-only module.
// prettier-ignore
import type { GameComponentData, HealthData, CollectibleData, DamageZoneData, WinConditionData, CheckpointData, FollowerData, MovingPlatformData, SpawnerData } from '@/stores/slices/types';
import { makeStepError, successResult, failResult } from './shared';

/**
 * Attaches a gameplay component to an entity the plan already spawned.
 *
 * This step exists because nothing in the generation pipeline could do it, so
 * no generated game ever carried a `winCondition` — and `validateWinnability`
 * answers NO_WIN_CONDITION for a scene without one, which makes `gameSlice`
 * refuse the Edit -> Play transition. A generated game that cannot be played is
 * the whole bug (PF-1199).
 *
 * Three properties are deliberate and load-bearing:
 *
 *  1. The schema is a CLOSED discriminated union over exactly the four
 *     component kinds this pipeline plans. `z.discriminatedUnion` strips
 *     unknown keys, so the `projectType` / `feelDirective` the plan injects into
 *     every step input are dropped rather than smuggled into a component, and an
 *     LLM-authored key can never reach the engine.
 *  2. Every property bag is built key-by-key and is COMPLETE. The engine's
 *     `build_game_component` does NOT strict-deserialize: it starts from
 *     `<T>Data::default()` and merges the keys it recognises, so an omitted
 *     field is not an error — it silently keeps the ENGINE default, which is a
 *     different number from the one the design asked for. `dispatchCommand`
 *     returns void, so nothing anywhere would report the divergence.
 *  3. The write goes through `ctx.getStore().addGameComponent`, never
 *     `ctx.dispatchCommand('add_game_component', …)`. The store action
 *     normalizes the payload, writes `allGameComponents` AND dispatches the
 *     command itself. Dispatching directly leaves the store blind: the
 *     Inspector shows nothing, and — fatally for this ticket — the winnability
 *     gate reads `allGameComponents`, so a win condition the store never saw
 *     does not count.
 */

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * The engine addresses entities by their `EntityId` component (a UUID, separate
 * from `EntityName`) and its match loops emit nothing when nothing matches, so
 * a malformed id is a silent no-op rather than an error. Reject it here, where
 * there is still something to report.
 */
const zEntityId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(id => !/[\u0000-\u001F\u007F]/.test(id), {
    message: 'entityId contains control characters',
  });

/** A finite number — `z.number()` already rejects both NaN and Infinity. */
const zFinite = z.number();

const zVec3 = z.tuple([zFinite, zFinite, zFinite]);

const zWinCondition = z.object({
  type: z.literal('winCondition'),
  entityId: zEntityId,
  conditionType: z.enum(['score', 'collectAll', 'reachGoal']),
  targetScore: zFinite.nullable(),
  targetEntityId: zEntityId.nullable(),
});

const zHealth = z.object({
  type: z.literal('health'),
  entityId: zEntityId,
  maxHp: zFinite,
  currentHp: zFinite,
  invincibilitySecs: zFinite,
  respawnOnDeath: z.boolean(),
  respawnPoint: zVec3,
  despawnOnDeath: z.boolean(),
});

const zCollectible = z.object({
  type: z.literal('collectible'),
  entityId: zEntityId,
  value: zFinite,
  destroyOnCollect: z.boolean(),
  pickupSoundAsset: z.string().nullable(),
  rotateSpeed: zFinite,
});

const zDamageZone = z.object({
  type: z.literal('damageZone'),
  entityId: zEntityId,
  damagePerSecond: zFinite,
  oneShot: z.boolean(),
});

const zCheckpoint = z.object({
  type: z.literal('checkpoint'),
  entityId: zEntityId,
  autoSave: z.boolean(),
});

const zFollower = z.object({
  type: z.literal('follower'),
  entityId: zEntityId,
  // Non-nullable, unlike `FollowerData`: a follower with no target stands
  // still, and planning one is planning a component that does nothing. The
  // caller has a target or it has no business planning this.
  targetEntityId: zEntityId,
  speed: zFinite,
  stopDistance: zFinite,
  lookAtTarget: z.boolean(),
});

/** The four meshes `system_spawner` can build. Anything else becomes a cube. */
const zSpawnEntityType = z.enum(['cube', 'sphere', 'cylinder', 'capsule']);

const zSpawner = z.object({
  type: z.literal('spawner'),
  entityId: zEntityId,
  entityType: zSpawnEntityType,
  intervalSecs: zFinite,
  maxCount: zFinite,
  spawnOffset: zVec3,
  onTrigger: z.string().nullable(),
});

const zMovingPlatform = z.object({
  type: z.literal('movingPlatform'),
  entityId: zEntityId,
  speed: zFinite,
  // At least two, because `system_moving_platform` returns early below that,
  // and at most MAX_WAYPOINTS, because the engine TRUNCATES past it rather
  // than refusing — a platform silently missing the end of its route is worse
  // than a step that says why it was dropped.
  waypoints: z.array(zVec3).min(2).max(64),
  pauseDuration: zFinite,
  loopMode: z.enum(['pingPong', 'loop', 'once']),
});

const inputSchema = z.discriminatedUnion('type', [
  zWinCondition,
  zHealth,
  zCollectible,
  zDamageZone,
  zCheckpoint,
  zFollower,
  zSpawner,
  zMovingPlatform,
]);

type ParsedInput = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Component construction
// ---------------------------------------------------------------------------

/**
 * The winnability gate's own rules, restated at the point where a bad condition
 * can still be reported. A `score` condition with no positive finite target and
 * a `reachGoal` with no bound target are both conditions the gate will refuse —
 * planning one produces a game that still cannot be played, with no signal.
 */
function winConditionProblem(input: z.infer<typeof zWinCondition>): string | null {
  if (input.conditionType === 'score') {
    if (input.targetScore === null || input.targetScore <= 0) {
      return 'A score win condition needs a target score greater than zero.';
    }
  }
  if (input.conditionType === 'reachGoal' && input.targetEntityId === null) {
    return 'A reach-goal win condition needs the entity the player must reach.';
  }
  return null;
}

/**
 * A component the schema accepts but that could not do anything once attached.
 *
 * Every one of these is a step that would "succeed" — `dispatchCommand` returns
 * void, and the engine's own systems just skip a component they cannot act on —
 * so the only place the design error can still be named is here.
 */
function semanticProblem(input: ParsedInput): string | null {
  if (input.type === 'winCondition') return winConditionProblem(input);

  if (input.type === 'follower' && input.targetEntityId === input.entityId) {
    return 'A follower cannot be told to chase itself.';
  }

  return null;
}

/** Built key-by-key; nothing from the input object is ever spread. */
function buildComponent(input: ParsedInput): GameComponentData {
  switch (input.type) {
    case 'winCondition': {
      const winCondition: WinConditionData = {
        conditionType: input.conditionType,
        targetScore: input.targetScore,
        targetEntityId: input.targetEntityId,
      };
      return { type: 'winCondition', winCondition };
    }
    case 'health': {
      const health: HealthData = {
        maxHp: input.maxHp,
        currentHp: input.currentHp,
        invincibilitySecs: input.invincibilitySecs,
        respawnOnDeath: input.respawnOnDeath,
        respawnPoint: [input.respawnPoint[0], input.respawnPoint[1], input.respawnPoint[2]],
        despawnOnDeath: input.despawnOnDeath,
      };
      return { type: 'health', health };
    }
    case 'collectible': {
      const collectible: CollectibleData = {
        value: input.value,
        destroyOnCollect: input.destroyOnCollect,
        pickupSoundAsset: input.pickupSoundAsset,
        rotateSpeed: input.rotateSpeed,
      };
      return { type: 'collectible', collectible };
    }
    case 'damageZone': {
      const damageZone: DamageZoneData = {
        damagePerSecond: input.damagePerSecond,
        oneShot: input.oneShot,
      };
      return { type: 'damageZone', damageZone };
    }
    case 'checkpoint': {
      const checkpoint: CheckpointData = {
        autoSave: input.autoSave,
      };
      return { type: 'checkpoint', checkpoint };
    }
    case 'follower': {
      const follower: FollowerData = {
        targetEntityId: input.targetEntityId,
        speed: input.speed,
        stopDistance: input.stopDistance,
        lookAtTarget: input.lookAtTarget,
      };
      return { type: 'follower', follower };
    }
    case 'spawner': {
      const spawner: SpawnerData = {
        entityType: input.entityType,
        intervalSecs: input.intervalSecs,
        maxCount: input.maxCount,
        spawnOffset: [
          input.spawnOffset[0],
          input.spawnOffset[1],
          input.spawnOffset[2],
        ],
        onTrigger: input.onTrigger,
      };
      return { type: 'spawner', spawner };
    }
    case 'movingPlatform': {
      const waypoints: [number, number, number][] = [];
      // Indexed, and rebuilt rather than reused: `.map` preserves a hole
      // positionally, so a gap would survive every callback-shaped transform
      // between the guard and the engine.
      for (let i = 0; i < input.waypoints.length; i += 1) {
        const point = input.waypoints[i];
        waypoints.push([point[0], point[1], point[2]]);
      }
      const movingPlatform: MovingPlatformData = {
        speed: input.speed,
        waypoints,
        pauseDuration: input.pauseDuration,
        loopMode: input.loopMode,
      };
      return { type: 'movingPlatform', movingPlatform };
    }
  }
}

/**
 * `false` only when the graph is populated AND positively lacks the id.
 *
 * An EMPTY graph means "the engine has not reported yet", not "the entity does
 * not exist": the pipeline spawns entities and the graph is only repopulated
 * when the engine emits back, so treating unreported as absent would fail every
 * step of a fresh build — the exact race that made an earlier name-lookup
 * fallback abandon whole plans.
 *
 * `Object.hasOwn` rather than a bare index: `nodes['constructor']` resolves on
 * the prototype chain and would report a phantom entity as present.
 */
function entityIsKnownMissing(ctx: ExecutorContext, entityId: string): boolean {
  const nodes = ctx.getStore().sceneGraph?.nodes;
  if (!nodes) return false;
  const ids = Object.keys(nodes);
  if (ids.length === 0) return false;
  return !Object.hasOwn(nodes, entityId);
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export const gameComponentExecutor: ExecutorDefinition = {
  name: 'game_component',
  inputSchema,
  userFacingErrorMessage:
    'Could not attach a gameplay component to one of the entities, so part of the game rules may be missing.',

  async execute(input: Record<string, unknown>, ctx: ExecutorContext): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError('INVALID_INPUT', parsed.error.message, this.userFacingErrorMessage),
      );
    }

    const data = parsed.data;

    const problem = semanticProblem(data);
    if (problem) {
      return failResult(makeStepError('INVALID_INPUT', problem, problem));
    }

    // The thing a follower chases has to be in the scene too. Bound to an id
    // the engine never reports, `system_follower` finds no target transform and
    // the enemy stands still — a game that looks built and does not play.
    if (data.type === 'follower' && entityIsKnownMissing(ctx, data.targetEntityId)) {
      return failResult(
        makeStepError(
          'ENTITY_NOT_FOUND',
          `No entity ${data.targetEntityId} in the scene graph to follow`,
          'One of the enemies was told to chase an object that is not in the scene, so it was left standing still.',
        ),
      );
    }

    if (entityIsKnownMissing(ctx, data.entityId)) {
      return failResult(
        makeStepError(
          'ENTITY_NOT_FOUND',
          `No entity ${data.entityId} in the scene graph`,
          'One of the game objects the rules refer to is not in the scene, so that rule was not applied.',
        ),
      );
    }

    ctx.getStore().addGameComponent(data.entityId, buildComponent(data));

    return successResult({ entityId: data.entityId, componentType: data.type });
  },
};
