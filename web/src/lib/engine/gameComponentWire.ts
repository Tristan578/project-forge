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
 * (see `int` below) is what keeps the two sides on a single value.
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
  return buildStoreComponent(component.type, propsOf(component)) ?? component;
}

/** The component's own data object, keyed by its discriminant. */
function propsOf(component: GameComponentData): Record<string, unknown> {
  return (component as unknown as Record<string, Record<string, unknown>>)[component.type];
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

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
/**
 * Finite as the engine sees it, not as JS sees it.
 *
 * Every numeric field crosses the wire as JSON, which the engine reads with
 * `as_f64() as f32` and then tests with `is_finite()`. A double the size of
 * `1e300` survives `Number.isFinite` here and becomes `f32::INFINITY` there, so
 * a plain finite check accepted values the engine drops on the floor — the store
 * showing a waypoint the running platform never visits.
 *
 * `Math.fround` is the same narrowing, so this is the engine's own test.
 */
const isEngineFinite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(Math.fround(v));

/**
 * Read each slot ONCE, and read it before deciding.
 *
 * `Array.prototype.every` **skips holes**, so `[1, , 3]` has `length === 3` and
 * passes `.every(isEngineFinite)` without the callback ever seeing index 1. The
 * tuple was then built by re-reading the same indices, where a hole reads as
 * `undefined` and `JSON.stringify` writes `null` — which the engine's `as_f64()`
 * returns `None` for, so the point is dropped there and kept here. That is the
 * exact store/engine divergence this module exists to close, arriving through the
 * guard meant to prevent it. `some`, `filter` and `forEach` skip holes too, so no
 * callback form fixes this; destructuring is an indexed read and yields
 * `undefined` for a hole, which `isEngineFinite` rejects.
 *
 * Capturing first also closes the validate-then-re-read TOCTOU seam: a getter or
 * Proxy is free to answer differently on the second read, so a value that passed
 * the check need not be the value that crosses the wire.
 */
const vec3 = (v: unknown, fallback: [number, number, number]): [number, number, number] => {
  if (!Array.isArray(v) || v.length !== 3) return fallback;
  const [x, y, z] = v as unknown[];
  return isEngineFinite(x) && isEngineFinite(y) && isEngineFinite(z) ? [x, y, z] : fallback;
};
const nullableStr = (v: unknown, fallback: string | null): string | null =>
  v === null ? null : typeof v === 'string' ? v : fallback;

/** An engine `prop_f32` range: both bounds inclusive, both applied by clamping. */
export interface EngineRange {
  readonly min: number;
  readonly max: number;
}

const U32_MAX = 4294967295;

/**
 * The engine's range for every float field on this wire, keyed by the engine's
 * own component name and serde field name.
 *
 * `build_game_component` reads each of these through
 * `prop_f32(&props, key, min, max)`, which CLAMPS rather than rejects — a `speed`
 * of `1e9` becomes `1000` there, while a plain finite check kept it verbatim
 * here. `dispatchCommand` returns `void`, so nothing reports the disagreement:
 * the inspector shows `1e9`, the platform moves at `1000`, and every surface that
 * reads one describes a different game than the one being played.
 *
 * Clamping is also why the finite check has to be the ENGINE's one. A `1e300`
 * passes `Number.isFinite` but is `f32::INFINITY` after the engine's `as f32`, so
 * the engine drops it and leaves its default standing; clamped here without that
 * check it would land on `max` instead, and the two sides would part company on
 * the very value the range exists to reconcile.
 *
 * These numbers are a second copy of the Rust literals, which is the kind of copy
 * that drifts. `__tests__/gameComponentWire.test.ts` parses every `prop_f32` call
 * out of `game_components.rs` and fails if this table disagrees, omits one, or
 * carries one the engine no longer has.
 */
export const ENGINE_PROP_RANGES = {
  character_controller: {
    speed: { min: 0, max: 1000 },
    jumpHeight: { min: 0, max: 100 },
    // Signed on purpose: a negative gravity scale is how an entity falls upward.
    gravityScale: { min: -10, max: 10 },
  },
  health: {
    // Floor of 1, not 0 — an entity that starts at zero max HP is dead on spawn.
    maxHp: { min: 1, max: 1_000_000 },
    currentHp: { min: 0, max: 1_000_000 },
    invincibilitySecs: { min: 0, max: 60 },
  },
  collectible: {
    // Signed: the sign is the spin direction, there is no separate flag.
    rotateSpeed: { min: -100, max: 100 },
  },
  damage_zone: {
    damagePerSecond: { min: 0, max: 10_000 },
  },
  teleporter: {
    cooldownSecs: { min: 0, max: 300 },
  },
  moving_platform: {
    speed: { min: 0, max: 1000 },
    pauseDuration: { min: 0, max: 60 },
  },
  spawner: {
    // Floor of 0.1s, not 0 — a zero interval spawns every frame forever.
    intervalSecs: { min: 0.1, max: 3600 },
  },
  follower: {
    speed: { min: 0, max: 1000 },
    stopDistance: { min: 0, max: 1000 },
  },
  projectile: {
    speed: { min: 0, max: 10_000 },
    damage: { min: 0, max: 100_000 },
    lifetimeSecs: { min: 0, max: 300 },
  },
  dialogue_trigger: {
    // The store spells this one `triggerRadius`; `propertiesOf` renames it.
    interactionRadius: { min: 0, max: 100 },
  },
} as const satisfies Record<string, Record<string, EngineRange>>;

/**
 * The engine's ceiling for each `u32` field, from the `prop_u32` call sites in
 * `game_components.rs`. Same contract as the table above and pinned by the same
 * test; separate because `prop_u32` rounds and floors at zero rather than taking
 * a minimum, so the two coercions are not interchangeable.
 */
export const ENGINE_PROP_MAXIMA = {
  collectible: { value: 1_000_000 },
  spawner: { maxCount: 1000 },
  win_condition: { targetScore: U32_MAX },
} as const satisfies Record<string, Record<string, number>>;

/**
 * Coerce a float field the same way `prop_f32` does: drop what the engine cannot
 * hold, clamp what it can.
 *
 * The range is a required argument rather than an optional one. Every numeric
 * field the engine reads is bounded, so a call site with no range is a field the
 * engine is clamping and the store is not — the divergence this whole module
 * exists to close, and making it a type error is cheaper than a test that has to
 * notice the omission.
 */
const num = (v: unknown, fallback: number, range: EngineRange): number =>
  isEngineFinite(v) ? Math.min(Math.max(v, range.min), range.max) : fallback;

/**
 * The engine's `MAX_WAYPOINTS`, mirrored so the store truncates identically.
 *
 * Must equal `pub const MAX_WAYPOINTS` in `engine/src/core/game_components.rs`;
 * `__tests__/gameComponentWire.test.ts` reads that line and fails if the two
 * drift. Truncating on one side only would leave the store and the engine
 * holding different routes, and `dispatchCommand` returns `void`, so nothing
 * anywhere would report the disagreement.
 */
const MAX_WAYPOINTS = 64;

/**
 * Mirror the engine's waypoint parse: keep the first `MAX_WAYPOINTS` entries
 * that are 3-element arrays of engine-finite numbers, and fall back to the
 * default route if that leaves nothing.
 *
 * The store used to cast `props.waypoints` through untouched. The engine
 * `filter_map`s each entry, so an array carrying a 2-element point or a string
 * left the store showing a route the platform does not follow — and an
 * arbitrarily long one left it holding a `Vec` walked every frame and written
 * into every scene save.
 */
const waypointList = (
  v: unknown,
  fallback: [number, number, number][],
): [number, number, number][] => {
  if (!Array.isArray(v)) return fallback;
  const out: [number, number, number][] = [];
  for (const point of v) {
    // Cap first: `take` after `filter_map` on the Rust side stops the iterator
    // once the cap is reached, so neither side visits the rest of the array.
    if (out.length >= MAX_WAYPOINTS) break;
    if (!Array.isArray(point) || point.length !== 3) continue;
    // Destructure rather than `.every` + re-read, for the reason `vec3` above
    // documents: `every` skips holes, so `[0, , 0]` cleared the check and was
    // pushed as `[0, undefined, 0]` — `[0, null, 0]` on the wire, dropped by the
    // engine and kept by the store.
    const [x, y, z] = point as unknown[];
    if (!isEngineFinite(x) || !isEngineFinite(y) || !isEngineFinite(z)) continue;
    out.push([x, y, z]);
  }
  // `if !waypoints.is_empty()` in the engine: an all-malformed list leaves the
  // Rust `Default` route standing rather than an empty one, which
  // `system_moving_platform` would refuse to move at all.
  return out.length > 0 ? out : fallback;
};

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

const nullableInt = (v: unknown, fallback: number | null, max: number): number | null =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) ? int(v, 0, max) : fallback;

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
          speed: num(props.speed, 5, ENGINE_PROP_RANGES.character_controller.speed),
          jumpHeight: num(props.jumpHeight, 8, ENGINE_PROP_RANGES.character_controller.jumpHeight),
          gravityScale: num(
            props.gravityScale,
            1,
            ENGINE_PROP_RANGES.character_controller.gravityScale,
          ),
          canDoubleJump: bool(props.canDoubleJump, false),
        },
      };
    case 'health': {
      // The chat tool has always accepted `maxHealth`/`currentHealth` aliases;
      // keep them working, and default current to max so a bare `maxHp` bump
      // doesn't leave the entity on the old (lower) current value.
      const maxHp = num(props.maxHealth ?? props.maxHp, 100, ENGINE_PROP_RANGES.health.maxHp);
      return {
        type: 'health',
        health: {
          maxHp,
          // Clamped, then used as the fallback — `maxHp` is already inside
          // `currentHp`'s own range, so the engine's "current defaults to max"
          // rule lands on the same number on both sides.
          currentHp: num(
            props.currentHealth ?? props.currentHp,
            maxHp,
            ENGINE_PROP_RANGES.health.currentHp,
          ),
          invincibilitySecs: num(
            props.invincibilitySecs,
            0.5,
            ENGINE_PROP_RANGES.health.invincibilitySecs,
          ),
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
          value: int(props.value, 1, ENGINE_PROP_MAXIMA.collectible.value),
          destroyOnCollect: bool(props.destroyOnCollect, true),
          pickupSoundAsset: nullableStr(props.pickupSoundAsset, null),
          rotateSpeed: num(props.rotateSpeed, 90, ENGINE_PROP_RANGES.collectible.rotateSpeed),
        },
      };
    case 'damageZone':
      return {
        type: 'damageZone',
        damageZone: {
          damagePerSecond: num(
            props.damagePerSecond,
            25,
            ENGINE_PROP_RANGES.damage_zone.damagePerSecond,
          ),
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
          cooldownSecs: num(props.cooldownSecs, 1, ENGINE_PROP_RANGES.teleporter.cooldownSecs),
        },
      };
    case 'movingPlatform':
      return {
        type: 'movingPlatform',
        movingPlatform: {
          speed: num(props.speed, 2, ENGINE_PROP_RANGES.moving_platform.speed),
          waypoints: waypointList(props.waypoints, [
            [0, 0, 0],
            [0, 3, 0],
          ]),
          pauseDuration: num(
            props.pauseDuration,
            0.5,
            ENGINE_PROP_RANGES.moving_platform.pauseDuration,
          ),
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
          intervalSecs: num(props.intervalSecs, 3, ENGINE_PROP_RANGES.spawner.intervalSecs),
          maxCount: int(props.maxCount, 5, ENGINE_PROP_MAXIMA.spawner.maxCount),
          spawnOffset: vec3(props.spawnOffset, [0, 1, 0]),
          onTrigger: nullableStr(props.onTrigger, null),
        },
      };
    case 'follower':
      return {
        type: 'follower',
        follower: {
          targetEntityId: nullableStr(props.targetEntityId, null),
          speed: num(props.speed, 3, ENGINE_PROP_RANGES.follower.speed),
          stopDistance: num(props.stopDistance, 1.5, ENGINE_PROP_RANGES.follower.stopDistance),
          lookAtTarget: bool(props.lookAtTarget, true),
        },
      };
    case 'projectile':
      return {
        type: 'projectile',
        projectile: {
          speed: num(props.speed, 15, ENGINE_PROP_RANGES.projectile.speed),
          damage: num(props.damage, 10, ENGINE_PROP_RANGES.projectile.damage),
          lifetimeSecs: num(props.lifetimeSecs, 5, ENGINE_PROP_RANGES.projectile.lifetimeSecs),
          gravity: bool(props.gravity, false),
          destroyOnHit: bool(props.destroyOnHit, true),
        },
      };
    case 'winCondition':
      return {
        type: 'winCondition',
        winCondition: {
          conditionType: (props.conditionType as WinConditionType) ?? 'score',
          targetScore: nullableInt(props.targetScore, 10, ENGINE_PROP_MAXIMA.win_condition.targetScore),
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
          triggerRadius: num(
            props.triggerRadius,
            3,
            ENGINE_PROP_RANGES.dialogue_trigger.interactionRadius,
          ),
          requireInteract: bool(props.requireInteract, true),
          interactKey: str(props.interactKey, 'interact'),
          oneShot: bool(props.oneShot, false),
        },
      };
    case null:
      return null;
  }
}
