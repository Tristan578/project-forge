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
 * The engine rejects a payload with no `componentType` ("Missing componentType"), and
 * `dispatchCommand` returns `void`, so that rejection is not observable from the
 * caller — the store keeps the component and the UI shows it as applied while the
 * engine has nothing. Every dispatch of a game component must therefore go through
 * `toWireComponent`.
 *
 * Within a recognised component, `build_game_component` is permissive rather than
 * strict: it merges each recognised field onto the type's `Default`, and anything
 * missing, unknown, wrongly typed or out of range leaves its default standing. That
 * makes the second failure mode quieter than an outright rejection — a value the
 * engine will not accept does not fail, it diverges. The store keeps what it was
 * given and the engine keeps its own, and every surface that reads one shows a
 * different game than the one being played. Matching the engine's coercions here
 * — `F32_RANGES`, `U32_MAXES`, `oneOf`, `vec3List` — is what keeps the two sides
 * on a single value.
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
 * The component's own data object, keyed by its discriminant.
 *
 * Written as an exhaustive switch rather than an index into the union so that adding
 * a component type is a compile error here — silent drift between the two shapes is
 * the whole failure mode this module exists to prevent. It replaced a
 * `component as unknown as Record<string, Record<string, unknown>>` index, which
 * type-checked for every value including ones that were not components at all.
 */
function storePropsOf(component: GameComponentData): Record<string, unknown> {
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
    case 'dialogueTrigger': return { ...component.dialogueTrigger };
  }
}

/**
 * The engine's properties bag for a component.
 *
 * Identical to the store's bag except for `dialogueTrigger`, the one type whose field
 * names diverge from the Rust struct. `DialogueTriggerData` in the store is
 * `{ treeId, triggerRadius, requireInteract, interactKey, oneShot }`; the engine's is
 * `{ dialogueTreeId, interactionRadius, autoStart, interactionKey, oneShot }`.
 * `autoStart` is the inverse of `requireInteract`: the engine fires on proximity when
 * `auto_start` is set and otherwise waits for `interaction_key`
 * (`game_components.rs` `system_dialogue_trigger`).
 */
function propertiesOf(component: GameComponentData): Record<string, unknown> {
  if (component.type === 'dialogueTrigger') {
    return {
      dialogueTreeId: component.dialogueTrigger.treeId,
      interactionRadius: component.dialogueTrigger.triggerRadius,
      autoStart: !component.dialogueTrigger.requireInteract,
      interactionKey: component.dialogueTrigger.interactKey,
      oneShot: component.dialogueTrigger.oneShot,
    };
  }
  return storePropsOf(component);
}

/**
 * Re-run a complete component through the same coercions a freshly-built one gets.
 *
 * The inspector edits a component field-by-field and hands the whole object back,
 * so it never passes through `buildStoreComponent` — a `10.4` typed into the
 * Value box would be stored verbatim while the engine rounds it. Normalizing at
 * the store boundary means one value goes into both. Lossless for an already-valid
 * component: every field is read back under its own name, so this is a no-op
 * except where the engine would have disagreed.
 */
export function normalizeGameComponent(component: GameComponentData): GameComponentData {
  return buildStoreComponent(component.type, storePropsOf(component)) ?? component;
}

/** Convert a store component into the flat payload the engine expects. */
export function toWireComponent(component: GameComponentData): GameComponentWirePayload {
  return {
    componentType: ENGINE_TYPE_BY_STORE_TYPE[component.type],
    properties: propertiesOf(component),
  };
}

/**
 * Read a wire payload back into a store component — the inverse of `toWireComponent`.
 *
 * Without an inverse, nothing could check that the two vocabularies actually line up:
 * the tests could only compare the builder's output against a re-derivation of the
 * builder's own logic, which cannot fail on a wrong mapping. With it, a round trip is
 * a real assertion — `dialogueTrigger`'s five renamed fields and its inverted
 * `autoStart` either survive the trip or they do not.
 *
 * It also gives the read direction a home. A payload arriving from a scene file or a
 * tool call is exactly as untrusted as one arriving from the LLM, and `buildStoreComponent`
 * is where every field gets range-checked against the engine's own bounds.
 *
 * Returns `null` for an unrecognised `componentType` or a `properties` that is not an
 * object, matching `build_game_component`'s two hard errors.
 */
export function parseGameComponentWire(payload: {
  componentType: string;
  properties?: unknown;
}): GameComponentData | null {
  const storeType = toStoreComponentType(payload.componentType);
  if (storeType === null) return null;

  const properties = payload.properties;
  if (properties === undefined || properties === null) return buildStoreComponent(storeType);
  if (typeof properties !== 'object' || Array.isArray(properties)) return null;

  const props = properties as Record<string, unknown>;
  if (storeType !== 'dialogueTrigger') return buildStoreComponent(storeType, props);

  return buildStoreComponent(storeType, {
    treeId: props.dialogueTreeId,
    triggerRadius: props.interactionRadius,
    // `undefined` rather than `!props.autoStart`: a missing `autoStart` must fall
    // through to the store default, and `!undefined` is `true`, which would assert
    // "requires interaction" for a payload that said nothing at all. It happens to
    // agree with the default here, so the bug would only surface if either side's
    // default ever moved.
    requireInteract: typeof props.autoStart === 'boolean' ? !props.autoStart : undefined,
    interactKey: props.interactionKey,
    oneShot: props.oneShot,
  });
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
  // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so `'toString'`,
  // `'constructor'` and `'valueOf'` were all reported as component names and
  // returned verbatim. The engine has no systems for them, and `dispatchCommand`
  // returns void, so the resulting `add_game_component` was discarded in silence.
  if (Object.hasOwn(STORE_TYPE_BY_ENGINE_TYPE, name)) return name;
  return Object.hasOwn(ENGINE_TYPE_BY_STORE_TYPE, name)
    ? ENGINE_TYPE_BY_STORE_TYPE[name as GameComponentData['type']]
    : null;
}

/** Normalize a component name to the store's camelCase discriminant. */
export function toStoreComponentType(name: string): GameComponentData['type'] | null {
  if (Object.hasOwn(ENGINE_TYPE_BY_STORE_TYPE, name)) return name as GameComponentData['type'];
  return Object.hasOwn(STORE_TYPE_BY_ENGINE_TYPE, name) ? STORE_TYPE_BY_ENGINE_TYPE[name] : null;
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

/**
 * Every `f32` field's `(min, max)`, keyed by the engine's own component name and
 * property spelling — i.e. exactly the shape of the `prop_f32` call sites in
 * `engine/src/core/game_components.rs`.
 *
 * Keyed the engine's way rather than the store's so the pin test can compare it
 * against the Rust directly, with no translation step of its own to be wrong in.
 * `__tests__/gameComponentWire.test.ts` parses those call sites and fails on any
 * bound that has drifted, any field the engine clamps that is missing here, and
 * any entry naming a field the engine does not clamp at all.
 *
 * There is no `f32` precision mirroring to go with the clamping, deliberately.
 * The engine stores these as `f32`, so a `0.1` really does come back as
 * `0.100000001490116`; reproducing that with `Math.fround` would make every
 * stored float ugly in the inspector to buy back a sub-epsilon difference. The
 * clamps are the part that matters — an out-of-range value diverges by orders of
 * magnitude, not by an epsilon.
 */
export const F32_RANGES = {
  character_controller: {
    speed: [0, 1000],
    jumpHeight: [0, 100],
    gravityScale: [-10, 10],
  },
  health: {
    maxHp: [1, 1_000_000],
    currentHp: [0, 1_000_000],
    invincibilitySecs: [0, 60],
  },
  collectible: { rotateSpeed: [-100, 100] },
  damage_zone: { damagePerSecond: [0, 10_000] },
  teleporter: { cooldownSecs: [0, 300] },
  moving_platform: {
    speed: [0, 1000],
    pauseDuration: [0, 60],
  },
  spawner: { intervalSecs: [0.1, 3600] },
  follower: {
    speed: [0, 1000],
    stopDistance: [0, 1000],
  },
  projectile: {
    speed: [0, 10_000],
    damage: [0, 100_000],
    lifetimeSecs: [0, 300],
  },
  dialogue_trigger: { interactionRadius: [0, 100] },
} as const satisfies Record<string, Record<string, readonly [number, number]>>;

/**
 * Every `u32` field's ceiling, from the `prop_u32` call sites in the same file
 * and pinned against them by the same test.
 */
export const U32_MAXES = {
  collectible: { value: 1_000_000 },
  spawner: { maxCount: 1000 },
  win_condition: { targetScore: 4294967295 },
} as const satisfies Record<string, Record<string, number>>;

/**
 * Coerce a float field the same way the engine's `prop_f32` does.
 *
 * The range is required rather than optional because every float on this wire has
 * one — the engine clamps all thirteen of them. Making it a parameter that could
 * be left off would let a new field be added with no clamp at all, which is the
 * state this replaced: `num` checked only `Number.isFinite`, so a `speed` of
 * `1e9` or a `gravityScale` of `-500` was stored verbatim while the engine
 * simulated `1000` and `-10`. `dispatchCommand` returns void, so nothing
 * anywhere reported the disagreement — the inspector kept showing the number the
 * user typed and the game kept playing by a different one.
 */
const num = (v: unknown, fallback: number, [min, max]: readonly [number, number]): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));

const vec3 = (v: unknown, fallback: [number, number, number]): [number, number, number] =>
  isVec3(v) ? v : fallback;

/**
 * A list of waypoints, matching `build_game_component`'s `filter_map`: each entry
 * that is not a finite 3-vector is dropped, and a list that ends up empty leaves
 * the default standing rather than producing a platform with nowhere to go.
 *
 * This replaced an `as [number, number, number][]` on a bare `Array.isArray`
 * check, which asserted the element type without looking at a single element —
 * `['a', 'b']` satisfied it and reached the store as a waypoint list.
 */
const vec3List = (v: unknown, fallback: [number, number, number][]): [number, number, number][] => {
  if (!Array.isArray(v)) return fallback;
  const valid = v.filter(isVec3);
  return valid.length > 0 ? valid : fallback;
};

/**
 * A value from a closed vocabulary, or the fallback.
 *
 * The engine parses both of these with a trailing `_ =>` arm, so an unrecognised
 * string is not rejected there — it quietly becomes `PingPong` or `Score`. That
 * makes an unvalidated cast here worse than a hard error would be: the store kept
 * whatever string it was handed (`'bounce'`, `'PingPong'`, `'survive'`) and the
 * engine ran its own default, and the two only disagree at runtime.
 */
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const PLATFORM_LOOP_MODES: readonly PlatformLoopMode[] = ['pingPong', 'loop', 'once'];
const WIN_CONDITION_TYPES: readonly WinConditionType[] = ['score', 'collectAll', 'reachGoal'];

/**
 * Coerce a whole-number field the same way the engine's `prop_u32` does.
 *
 * Three fields on this wire are `u32` in Rust. The engine rounds to nearest and
 * clamps into `0..=max`; a plain finite-number check let the store keep `10.4`,
 * `-5` or `1e12` — values the engine can never hold. Nothing reports the
 * mismatch, so the inspector would show one number while the running game used
 * another. Doing the same arithmetic here keeps both sides on one value.
 *
 * Rounding matches Rust's `f64::round` for every input that survives the zero
 * floor: both round half away from zero, and the cases where they differ (`-2.5`
 * → `-3` in Rust, `-2` in JS) clamp to `0` either way.
 */
const int = (v: unknown, fallback: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), max) : fallback;

/**
 * As `int`, but preserving an explicit `null`.
 *
 * Known residual, and not fixable from this side: the store can hold
 * `targetScore: null`, and it survives to the engine as a JSON `null`, where
 * `as_f64()` answers `None` and `WinConditionData::default().target_score` —
 * `Some(10)` — stands. So "no target score" is a state the store can express and
 * this wire cannot, and the engine will play a score-of-10 win condition for it.
 * Closing it needs the engine to distinguish an absent key from an explicit null.
 */
const nullableInt = (v: unknown, fallback: number | null, max: number): number | null =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) ? int(v, 0, max) : fallback;

const nullableStr = (v: unknown, fallback: string | null): string | null =>
  v === null ? null : typeof v === 'string' ? v : fallback;

/**
 * Build a COMPLETE store component from a partial properties bag.
 *
 * Callers that only know one field — the AI auto-iteration fixer, the chat
 * `add_game_component` tool — must not dispatch that field alone. The engine
 * would accept it (it merges onto `Default`), but the STORE would then be
 * holding a component with whatever the caller happened to pass and nothing for
 * the rest, so the inspector, the export and the engine would each describe the
 * entity differently. Every missing field is filled here with the same default
 * the Rust struct's `Default` impl uses, so the store's copy and the engine's
 * copy are the same component.
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
          speed: num(props.speed, 5, F32_RANGES.character_controller.speed),
          jumpHeight: num(props.jumpHeight, 8, F32_RANGES.character_controller.jumpHeight),
          gravityScale: num(props.gravityScale, 1, F32_RANGES.character_controller.gravityScale),
          canDoubleJump: bool(props.canDoubleJump, false),
        },
      };
    case 'health': {
      // The chat tool has always accepted `maxHealth`/`currentHealth` aliases;
      // keep them working, and default current to max so a bare `maxHp` bump
      // doesn't leave the entity on the old (lower) current value.
      const maxHp = num(props.maxHealth ?? props.maxHp, 100, F32_RANGES.health.maxHp);
      return {
        type: 'health',
        health: {
          maxHp,
          currentHp: num(props.currentHealth ?? props.currentHp, maxHp, F32_RANGES.health.currentHp),
          invincibilitySecs: num(props.invincibilitySecs, 0.5, F32_RANGES.health.invincibilitySecs),
          respawnOnDeath: bool(props.respawnOnDeath, true),
          respawnPoint: vec3(props.respawnPoint, [0, 1, 0]),
          despawnOnDeath: bool(props.despawnOnDeath, true),
        },
      };
    }
    case 'collectible':
      return {
        type: 'collectible',
        collectible: {
          value: int(props.value, 1, U32_MAXES.collectible.value),
          destroyOnCollect: bool(props.destroyOnCollect, true),
          pickupSoundAsset: nullableStr(props.pickupSoundAsset, null),
          rotateSpeed: num(props.rotateSpeed, 90, F32_RANGES.collectible.rotateSpeed),
        },
      };
    case 'damageZone':
      return {
        type: 'damageZone',
        damageZone: {
          damagePerSecond: num(props.damagePerSecond, 25, F32_RANGES.damage_zone.damagePerSecond),
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
          cooldownSecs: num(props.cooldownSecs, 1, F32_RANGES.teleporter.cooldownSecs),
        },
      };
    case 'movingPlatform':
      return {
        type: 'movingPlatform',
        movingPlatform: {
          speed: num(props.speed, 2, F32_RANGES.moving_platform.speed),
          waypoints: vec3List(props.waypoints, [[0, 0, 0], [0, 3, 0]]),
          pauseDuration: num(props.pauseDuration, 0.5, F32_RANGES.moving_platform.pauseDuration),
          loopMode: oneOf(props.loopMode, PLATFORM_LOOP_MODES, 'pingPong'),
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
          intervalSecs: num(props.intervalSecs, 3, F32_RANGES.spawner.intervalSecs),
          maxCount: int(props.maxCount, 5, U32_MAXES.spawner.maxCount),
          spawnOffset: vec3(props.spawnOffset, [0, 1, 0]),
          onTrigger: nullableStr(props.onTrigger, null),
        },
      };
    case 'follower':
      return {
        type: 'follower',
        follower: {
          targetEntityId: nullableStr(props.targetEntityId, null),
          speed: num(props.speed, 3, F32_RANGES.follower.speed),
          stopDistance: num(props.stopDistance, 1.5, F32_RANGES.follower.stopDistance),
          lookAtTarget: bool(props.lookAtTarget, true),
        },
      };
    case 'projectile':
      return {
        type: 'projectile',
        projectile: {
          speed: num(props.speed, 15, F32_RANGES.projectile.speed),
          damage: num(props.damage, 10, F32_RANGES.projectile.damage),
          lifetimeSecs: num(props.lifetimeSecs, 5, F32_RANGES.projectile.lifetimeSecs),
          gravity: bool(props.gravity, false),
          destroyOnHit: bool(props.destroyOnHit, true),
        },
      };
    case 'winCondition':
      return {
        type: 'winCondition',
        winCondition: {
          conditionType: oneOf(props.conditionType, WIN_CONDITION_TYPES, 'score'),
          targetScore: nullableInt(props.targetScore, 10, U32_MAXES.win_condition.targetScore),
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
          triggerRadius: num(props.triggerRadius, 3, F32_RANGES.dialogue_trigger.interactionRadius),
          requireInteract: bool(props.requireInteract, true),
          interactKey: str(props.interactKey, 'interact'),
          oneShot: bool(props.oneShot, false),
        },
      };
    case null:
      return null;
  }

  // Unreachable while `toStoreComponentType` answers only with a key of the
  // mapping or `null` — but the declared return type says `| null`, and without
  // this the function returned `undefined` for anything the switch did not
  // recognise. It sits after the switch rather than in a `default:` arm on
  // purpose: a `default:` satisfies TypeScript's exhaustiveness check, so adding
  // a fourteenth component type would compile silently and go out over the wire
  // as whatever the default happened to be.
  return null;
}
