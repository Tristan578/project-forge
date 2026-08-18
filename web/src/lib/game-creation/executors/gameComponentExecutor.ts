import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
// Single line deliberately: `serverSafeImports.test.ts` scans line by line, so
// a wrapped `import type` puts the specifier on a line with no `type` keyword
// and reads as a value import of a client-only module.
// prettier-ignore
import type { GameComponentData, HealthData, CollectibleData, DamageZoneData, WinConditionData } from '@/stores/slices/types';
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

const inputSchema = z.discriminatedUnion('type', [
  zWinCondition,
  zHealth,
  zCollectible,
  zDamageZone,
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

    if (data.type === 'winCondition') {
      const problem = winConditionProblem(data);
      if (problem) {
        return failResult(makeStepError('INVALID_INPUT', problem, problem));
      }
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
