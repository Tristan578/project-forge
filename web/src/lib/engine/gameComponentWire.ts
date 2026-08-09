/**
 * Translation between the store's game-component shape and the engine's wire format.
 *
 * These are two different vocabularies for the same data and they must not be
 * confused:
 *
 * - **Store** — a tagged union, `{ type: 'characterController', characterController: {...} }`.
 *   The discriminant is camelCase and the payload is nested under a key equal to it.
 *   This is what `allGameComponents`, the inspector and the chat handlers speak.
 * - **Engine** — flat, `{ entityId, componentType: 'character_controller', properties: {...} }`.
 *   `componentType` is the snake_case name from `GameComponentData::component_name()`
 *   in `engine/src/core/game_components.rs`; `properties` is deserialized straight
 *   into the matching Rust struct.
 *
 * The engine rejects a payload with no `componentType` ("Missing componentType") and
 * `build_game_component` runs strict serde on any non-empty properties bag, so a
 * partial bag drops the whole component. `dispatchCommand` returns `void`, so neither
 * rejection is observable from the caller — the store keeps the component and the UI
 * shows it as applied while the engine has nothing. Every dispatch of a game component
 * must therefore go through `toWireComponent`.
 */

import type { GameComponentData, PlatformLoopMode, WinConditionType } from '@/stores/slices/types';

/** Store discriminant -> the engine's `component_name()`. */
const ENGINE_TYPE_BY_STORE_TYPE: Record<GameComponentData['type'], string> = {
  characterController: 'character_controller',
  health: 'health',
  collectible: 'collectible',
  damageZone: 'damage_zone',
  checkpoint: 'checkpoint',
  teleporter: 'teleporter',
  movingPlatform: 'moving_platform',
  triggerZone: 'trigger_zone',
  spawner: 'spawner',
  follower: 'follower',
  projectile: 'projectile',
  winCondition: 'win_condition',
  dialogueTrigger: 'dialogue_trigger',
};

const STORE_TYPE_BY_ENGINE_TYPE = Object.fromEntries(
  Object.entries(ENGINE_TYPE_BY_STORE_TYPE).map(([storeType, engineType]) => [engineType, storeType])
) as Record<string, GameComponentData['type']>;

/** A payload `add_game_component` / `update_game_component` will accept. */
export interface GameComponentWirePayload {
  componentType: string;
  properties: Record<string, unknown>;
}

/**
 * The engine's properties bag for a component.
 *
 * Written as an exhaustive switch rather than an index into the union so that adding
 * a component type is a compile error here — silent drift between the two shapes is
 * the whole failure mode this module exists to prevent.
 */
function propertiesOf(component: GameComponentData): Record<string, unknown> {
  switch (component.type) {
    case 'characterController': return { ...component.characterController };
    case 'health': return { ...component.health };
    case 'collectible': return { ...component.collectible };
    case 'damageZone': return { ...component.damageZone };
    case 'checkpoint': return { ...component.checkpoint };
    case 'teleporter': return { ...component.teleporter };
    case 'movingPlatform': return { ...component.movingPlatform };
    case 'triggerZone': return { ...component.triggerZone };
    case 'spawner': return { ...component.spawner };
    case 'follower': return { ...component.follower };
    case 'projectile': return { ...component.projectile };
    case 'winCondition': return { ...component.winCondition };
    // The one type whose field names diverge from the Rust struct. `DialogueTriggerData`
    // in the store is `{ treeId, triggerRadius, requireInteract, interactKey, oneShot }`;
    // the engine's is `{ dialogueTreeId, interactionRadius, autoStart, interactionKey, oneShot }`.
    // `autoStart` is the inverse of `requireInteract`: the engine fires on proximity when
    // `auto_start` is set and otherwise waits for `interaction_key`
    // (`game_components.rs` `system_dialogue_trigger`).
    case 'dialogueTrigger': return {
      dialogueTreeId: component.dialogueTrigger.treeId,
      interactionRadius: component.dialogueTrigger.triggerRadius,
      autoStart: !component.dialogueTrigger.requireInteract,
      interactionKey: component.dialogueTrigger.interactKey,
      oneShot: component.dialogueTrigger.oneShot,
    };
  }
}

/** Convert a store component into the flat payload the engine expects. */
export function toWireComponent(component: GameComponentData): GameComponentWirePayload {
  return {
    componentType: ENGINE_TYPE_BY_STORE_TYPE[component.type],
    properties: propertiesOf(component),
  };
}

/**
 * Normalize a component name to the engine's snake_case vocabulary.
 *
 * Callers are split: the inspector removes by the engine name while the store's own
 * state is keyed by the store discriminant, so both spellings arrive here. Returns
 * `null` for an unrecognized name so callers can decide rather than dispatching a
 * name the engine will silently ignore.
 */
export function toEngineComponentType(name: string): string | null {
  if (name in STORE_TYPE_BY_ENGINE_TYPE) return name;
  return ENGINE_TYPE_BY_STORE_TYPE[name as GameComponentData['type']] ?? null;
}

/** Normalize a component name to the store's camelCase discriminant. */
export function toStoreComponentType(name: string): GameComponentData['type'] | null {
  if (name in ENGINE_TYPE_BY_STORE_TYPE) return name as GameComponentData['type'];
  return STORE_TYPE_BY_ENGINE_TYPE[name] ?? null;
}

/** Every component name the engine accepts, for error messages. */
export const ENGINE_COMPONENT_TYPES: readonly string[] = Object.values(ENGINE_TYPE_BY_STORE_TYPE);

/**
 * One-line description per component, for the `list_game_component_types` tool.
 *
 * Keyed by the store discriminant so adding a component type is a compile error
 * until it is described — the hand-written list this replaced had drifted a type
 * behind and never mentioned `dialogue_trigger`.
 */
const DESCRIPTIONS: Record<GameComponentData['type'], string> = {
  characterController: 'First-person or third-person movement controller',
  health: 'Health points with damage, invincibility, and respawning',
  collectible: 'Item that can be collected for score points',
  damageZone: 'Area that damages entities with Health component',
  checkpoint: 'Checkpoint that updates respawn point for characters',
  teleporter: 'Teleports entities to a target position',
  movingPlatform: 'Platform that moves between waypoints',
  triggerZone: 'Zone that emits events when entered',
  spawner: 'Spawns entities at intervals or on trigger',
  follower: 'Follows a target entity',
  projectile: 'Moving object that deals damage on impact',
  winCondition: 'Defines game win condition (score, collect all, reach goal)',
  dialogueTrigger: 'Starts a dialogue tree on proximity or interaction',
};

/** Every engine component name paired with its description. */
export const ENGINE_COMPONENT_CATALOG: readonly { name: string; description: string }[] =
  (Object.keys(ENGINE_TYPE_BY_STORE_TYPE) as GameComponentData['type'][]).map(storeType => ({
    name: ENGINE_TYPE_BY_STORE_TYPE[storeType],
    description: DESCRIPTIONS[storeType],
  }));

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const vec3 = (v: unknown, fallback: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n))
    ? (v as [number, number, number])
    : fallback;
const nullableNum = (v: unknown, fallback: number | null): number | null =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const nullableStr = (v: unknown, fallback: string | null): string | null =>
  v === null ? null : typeof v === 'string' ? v : fallback;

/**
 * Build a COMPLETE store component from a partial properties bag.
 *
 * Callers that only know one field — the AI auto-iteration fixer, the chat
 * `add_game_component` tool — must not dispatch that field alone: the engine
 * deserializes the bag with strict serde, so a partial bag is rejected outright
 * and the component is silently dropped. Every missing field is filled here with
 * the same default the Rust struct's `Default` impl uses, so the resulting bag
 * always deserializes.
 *
 * `name` accepts either vocabulary (`character_controller` or `characterController`).
 * Returns `null` for an unrecognized name so the caller can report it rather than
 * dispatching something the engine will reject.
 */
export function buildStoreComponent(
  name: string,
  props: Record<string, unknown> = {},
): GameComponentData | null {
  switch (toStoreComponentType(name)) {
    case 'characterController':
      return {
        type: 'characterController',
        characterController: {
          speed: num(props.speed, 5),
          jumpHeight: num(props.jumpHeight, 8),
          gravityScale: num(props.gravityScale, 1),
          canDoubleJump: bool(props.canDoubleJump, false),
        },
      };
    case 'health': {
      // The chat tool has always accepted `maxHealth`/`currentHealth` aliases;
      // keep them working, and default current to max so a bare `maxHp` bump
      // doesn't leave the entity on the old (lower) current value.
      const maxHp = num(props.maxHealth ?? props.maxHp, 100);
      return {
        type: 'health',
        health: {
          maxHp,
          currentHp: num(props.currentHealth ?? props.currentHp, maxHp),
          invincibilitySecs: num(props.invincibilitySecs, 0.5),
          respawnOnDeath: bool(props.respawnOnDeath, true),
          respawnPoint: vec3(props.respawnPoint, [0, 1, 0]),
        },
      };
    }
    case 'collectible':
      return {
        type: 'collectible',
        collectible: {
          value: num(props.value, 1),
          destroyOnCollect: bool(props.destroyOnCollect, true),
          pickupSoundAsset: nullableStr(props.pickupSoundAsset, null),
          rotateSpeed: num(props.rotateSpeed, 90),
        },
      };
    case 'damageZone':
      return {
        type: 'damageZone',
        damageZone: {
          damagePerSecond: num(props.damagePerSecond, 25),
          oneShot: bool(props.oneShot, false),
        },
      };
    case 'checkpoint':
      return { type: 'checkpoint', checkpoint: { autoSave: bool(props.autoSave, true) } };
    case 'teleporter':
      return {
        type: 'teleporter',
        teleporter: {
          targetPosition: vec3(props.targetPosition, [0, 1, 0]),
          cooldownSecs: num(props.cooldownSecs, 1),
        },
      };
    case 'movingPlatform':
      return {
        type: 'movingPlatform',
        movingPlatform: {
          speed: num(props.speed, 2),
          waypoints: Array.isArray(props.waypoints)
            ? (props.waypoints as [number, number, number][])
            : [[0, 0, 0], [0, 3, 0]],
          pauseDuration: num(props.pauseDuration, 0.5),
          loopMode: (props.loopMode as PlatformLoopMode) ?? 'pingPong',
        },
      };
    case 'triggerZone':
      return {
        type: 'triggerZone',
        triggerZone: {
          eventName: str(props.eventName, 'trigger'),
          oneShot: bool(props.oneShot, false),
        },
      };
    case 'spawner':
      return {
        type: 'spawner',
        spawner: {
          entityType: str(props.entityType, 'cube'),
          intervalSecs: num(props.intervalSecs, 3),
          maxCount: num(props.maxCount, 5),
          spawnOffset: vec3(props.spawnOffset, [0, 1, 0]),
          onTrigger: nullableStr(props.onTrigger, null),
        },
      };
    case 'follower':
      return {
        type: 'follower',
        follower: {
          targetEntityId: nullableStr(props.targetEntityId, null),
          speed: num(props.speed, 3),
          stopDistance: num(props.stopDistance, 1.5),
          lookAtTarget: bool(props.lookAtTarget, true),
        },
      };
    case 'projectile':
      return {
        type: 'projectile',
        projectile: {
          speed: num(props.speed, 15),
          damage: num(props.damage, 10),
          lifetimeSecs: num(props.lifetimeSecs, 5),
          gravity: bool(props.gravity, false),
          destroyOnHit: bool(props.destroyOnHit, true),
        },
      };
    case 'winCondition':
      return {
        type: 'winCondition',
        winCondition: {
          conditionType: (props.conditionType as WinConditionType) ?? 'score',
          targetScore: nullableNum(props.targetScore, 10),
          targetEntityId: nullableStr(props.targetEntityId, null),
        },
      };
    case 'dialogueTrigger':
      // Accepts the store's field names; the engine's spellings are applied by
      // `toWireComponent`, which is the only place the two vocabularies meet.
      return {
        type: 'dialogueTrigger',
        dialogueTrigger: {
          treeId: str(props.treeId, ''),
          triggerRadius: num(props.triggerRadius, 3),
          requireInteract: bool(props.requireInteract, true),
          interactKey: str(props.interactKey, 'interact'),
          oneShot: bool(props.oneShot, false),
        },
      };
    case null:
      return null;
  }
}
