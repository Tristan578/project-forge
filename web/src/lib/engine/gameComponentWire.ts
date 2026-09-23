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

import type {
  CharacterControllerData,
  CheckpointData,
  CollectibleData,
  DamageZoneData,
  DialogueTriggerData,
  FollowerData,
  GameComponentData,
  HealthData,
  MovingPlatformData,
  PlatformLoopMode,
  ProjectileData,
  SpawnerData,
  TeleporterData,
  TriggerZoneData,
  WinConditionData,
  WinConditionType,
} from '@/stores/slices/types';
// Type-only: `gameComponentCorrections` imports `gameComponentFields` from here
// at runtime, so a value import in this direction would be a cycle.
import type {
  CorrectionReason,
  CorrectionValue,
  GameComponentFieldCorrection,
  GameComponentWriteReport,
} from './gameComponentCorrections';

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
 * Copy only own enumerable wire fields into a prototype-free record.
 *
 * Component payloads can arrive from imported scenes and model tool calls. A
 * direct `props.field` read would otherwise accept values inherited from a
 * polluted prototype as though the sender supplied them.
 */
function ownEnumerableSnapshot(source: Record<string, unknown>): Record<string, unknown> {
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) snapshot[key] = value;
  return snapshot;
}

/**
 * The component's own data object, keyed by its discriminant.
 *
 * Written as an exhaustive switch rather than an index into the union so that adding
 * a component type is a compile error here — silent drift between the two shapes is
 * the whole failure mode this module exists to prevent. It replaced a
 * `component as unknown as Record<string, Record<string, unknown>>` index, which
 * type-checked for every value including ones that were not components at all.
 *
 * Exported for `gameComponentCorrections`, which compares a field's value before
 * and after a write to decide whether an adjustment marker still describes it.
 * Returns a fresh shallow copy, so a caller cannot write through it.
 */
export function gameComponentFields(component: GameComponentData): Record<string, unknown> {
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
  return gameComponentFields(component);
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
  return normalizeGameComponentWithReport(component).component;
}

/** A built component together with what building it did to the request. */
export interface BuiltGameComponent extends GameComponentWriteReport {
  readonly component: GameComponentData;
}

/**
 * `normalizeGameComponent`, plus a record of every field the normalization
 * changed (PF-1148).
 *
 * Zero corrections for an already-valid component — every field is read back
 * under its own name and lands on itself — so the store can run this on every
 * write and only ever hear about a value the engine would have disagreed with.
 * `supplied` lists every field, since a complete component names all of them.
 */
export function normalizeGameComponentWithReport(component: GameComponentData): BuiltGameComponent {
  const sink: CorrectionSink = { corrections: [], supplied: [] };
  const built = buildComponent(component.type, gameComponentFields(component), sink);
  // Unreachable for a well-typed component; kept so a value that is not one
  // (a cast from a scene file) still comes back as itself rather than `null`.
  if (built === null) return { component, corrections: [], supplied: [] };
  return { component: built, corrections: sink.corrections, supplied: sink.supplied };
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
 * Returns `null` for an unrecognised `componentType` or a `properties` that is present
 * but not a plain object, matching `build_game_component`'s two hard errors. An ABSENT
 * `properties` is not an error — it yields a fully-defaulted component, because the
 * engine substitutes an empty object for a missing key. See the note on that split below.
 */
export function parseGameComponentWire(payload: {
  componentType: string;
  properties?: unknown;
}): GameComponentData | null {
  const storeType = toStoreComponentType(payload.componentType);
  if (storeType === null) return null;

  const properties = payload.properties;
  // An ABSENT `properties` and an explicit `null` are different payloads to the
  // engine and must be different here. `handle_add_game_component` substitutes an
  // empty object only when the key is missing (`.cloned().unwrap_or(Object)`), so
  // an explicit `null` reaches `build_game_component` as `Value::Null`, fails its
  // `props.is_object()` guard and errors out with nothing applied. Treating the
  // two alike would hand back a fully-defaulted component for a payload the engine
  // threw away — the store would show a component that does not exist.
  if (properties === undefined) return buildStoreComponent(storeType);
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) return null;

  const props = ownEnumerableSnapshot(properties as Record<string, unknown>);
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
 * Read one component out of a `GAME_COMPONENT_CHANGED` event.
 *
 * The engine emits `GameComponentData` itself, and that enum is
 * `#[serde(tag = "type", rename_all = "camelCase")]` — INTERNALLY tagged, so each
 * component arrives FLAT, with the struct's own camelCase fields sitting beside a
 * `type` discriminant:
 *
 *     { type: 'characterController', speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false }
 *
 * That is neither of this module's two vocabularies. It carries the store's
 * discriminant and the engine's field names, and the payload is not nested under a
 * key. `gameEvents.ts` used to cast the array straight to `GameComponentData[]`,
 * which type-checks and is wrong: `comp.characterController` is `undefined` on every
 * component the engine has ever emitted, so the inspector rendered an attached
 * component with no data in it.
 *
 * Returns `null` for anything that is not an object carrying a `type` this build
 * knows, so a component the editor cannot represent is dropped rather than written
 * into the store as a hole.
 */
export function parseEmittedGameComponent(raw: unknown): GameComponentData | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const { type } = raw as { type?: unknown };
  if (typeof type !== 'string') return null;

  const storeType = toStoreComponentType(type);
  if (storeType === null) return null;

  // The flat object doubles as the properties bag: `buildStoreComponent` reads
  // named engine keys only, so the sibling `type` is ignored rather than merged.
  return parseGameComponentWire({
    componentType: storeType,
    properties: raw as Record<string, unknown>,
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

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/**
 * The longest string any of these fields is allowed to carry.
 *
 * These are identifiers and event names — an entity id, a sound asset, a
 * dialogue tree key. None has a legitimate 300-character form, and the ones
 * that name something (`targetEntityId`, `onTrigger`) are matched for equality
 * on the engine side, so a value that is too long is not a value that half
 * works: it names nothing. The bound is a rejection, never a truncation —
 * half an entity id names the WRONG entity, which is worse than no id at all.
 */
const MAX_STRING_LEN = 256;

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length <= MAX_STRING_LEN ? v : fallback;
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
const parseVec3 = (v: unknown): [number, number, number] | null => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v as unknown[];
  return isEngineFinite(x) && isEngineFinite(y) && isEngineFinite(z) ? [x, y, z] : null;
};
const nullableStr = (v: unknown, fallback: string | null): string | null =>
  v === null ? null
    : typeof v === 'string' && v.length <= MAX_STRING_LEN ? v
      : fallback;

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
 * The range is a required argument rather than an optional one, because every
 * float on this wire has one — the engine clamps all eighteen of them. A call
 * site with no range would be a field the engine is clamping and the store is
 * not, which is the state this replaced: `num` checked only `Number.isFinite`,
 * so a `speed` of `1e9` or a `gravityScale` of `-500` was stored verbatim while
 * the engine simulated `1000` and `-10`. `dispatchCommand` returns void, so
 * nothing anywhere reported the disagreement — the inspector kept showing the
 * number the user typed and the game kept playing by a different one. Making the
 * omission a type error is cheaper than a test that has to notice it.
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
 * that are 3-element arrays of engine-finite numbers, and answer `null` — the
 * caller keeps the default route — if that leaves fewer than two.
 *
 * The store used to cast `props.waypoints` through untouched. The engine
 * `filter_map`s each entry, so an array carrying a 2-element point or a string
 * left the store showing a route the platform does not follow — and an
 * arbitrarily long one left it holding a `Vec` walked every frame and written
 * into every scene save.
 */
const parseWaypoints = (
  v: unknown,
): { points: [number, number, number][]; truncated: boolean; given: number } | null => {
  if (!Array.isArray(v)) return null;
  const points: [number, number, number][] = [];
  let truncated = false;
  for (const point of v) {
    // Cap first: `take` after `filter_map` on the Rust side stops the iterator
    // once the cap is reached, so neither side visits the rest of the array.
    // Reaching this with entries still unvisited is the only way anything is
    // cut off for LENGTH, as opposed to dropped for being unusable — the
    // report tells the two apart (PF-1148).
    if (points.length >= MAX_WAYPOINTS) {
      truncated = true;
      break;
    }
    if (!Array.isArray(point) || point.length !== 3) continue;
    // Destructure rather than `.every` + re-read, for the reason `parseVec3`
    // above documents: `every` skips holes, so `[0, , 0]` cleared the check and
    // was pushed as `[0, undefined, 0]` — `[0, null, 0]` on the wire, dropped by
    // the engine and kept by the store.
    const [x, y, z] = point as unknown[];
    if (!isEngineFinite(x) || !isEngineFinite(y) || !isEngineFinite(z)) continue;
    points.push([x, y, z]);
  }
  // `if !waypoints.is_empty()` in the engine: an all-malformed list leaves the
  // Rust `Default` route standing rather than an empty one, which
  // `system_moving_platform` would refuse to move at all.
  //
  // Two, not one. `system_moving_platform` early-returns below two waypoints and
  // reports nothing, so a surviving single point is a platform the store shows a
  // route for and the engine never moves — the same silent divergence an empty
  // list produces, just harder to see in the inspector.
  return points.length >= 2 ? { points, truncated, given: v.length } : null;
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

/**
 * The two enum vocabularies, built from objects rather than array literals.
 *
 * `readonly PlatformLoopMode[]` proves every element is a valid member; it cannot
 * prove the list is complete. Deleting `'collectAll'` from an array literal type-checks
 * fine and every collect-all win condition silently collapses to `'score'` on the next
 * store write — `normalizeGameComponent` runs on all of them. `satisfies Record<T, true>`
 * on an object is bidirectional: a missing key fails the `Record` constraint and an
 * invented one fails the excess-property check.
 *
 * The values are pinned against the Rust by `gameComponentWire.test.ts`. Note the
 * fallback member is deliberately absent from the engine's `match`: `pingPong` and
 * `score` are its `_ =>` arms, so they round-trip through the fallback rather than
 * through an explicit arm.
 */
export const PLATFORM_LOOP_MODES = Object.keys({
  pingPong: true,
  loop: true,
  once: true,
} satisfies Record<PlatformLoopMode, true>) as readonly PlatformLoopMode[];

export const WIN_CONDITION_TYPES = Object.keys({
  score: true,
  collectAll: true,
  reachGoal: true,
} satisfies Record<WinConditionType, true>) as readonly WinConditionType[];

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

// ---------------------------------------------------------------------------
// The correction report (PF-1148)
//
// Every coercer above answers with the value the engine will hold and says
// nothing about whether that is the value it was given. The reader below wraps
// each of them per field and, when the caller asked for a report, records the
// fields whose applied value differs from the supplied one. It never changes
// what is applied: `buildStoreComponent` and `buildStoreComponentWithReport`
// return the same component for the same bag, and the plain builder does no
// reporting work at all.
// ---------------------------------------------------------------------------

/** Longest string a correction echoes verbatim; anything longer is described. */
const MAX_ECHOED_TEXT = 48;

function describeRaw(v: unknown): string {
  if (v === undefined) return 'empty';
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') {
    return v.length <= MAX_ECHOED_TEXT ? JSON.stringify(v) : `a ${v.length}-character text`;
  }
  if (Array.isArray(v)) return `a list of ${v.length} ${v.length === 1 ? 'item' : 'items'}`;
  if (typeof v === 'object') return 'an object';
  return `a ${typeof v}`;
}

/**
 * The caller's value as a correction carries it: itself when JSON can hold it
 * and it is short enough to be worth echoing, a description otherwise. A
 * 300-character id is not repeated back, and `NaN` is not silently turned into
 * the `null` that `JSON.stringify` would write.
 */
function summarizeValue(v: unknown): CorrectionValue {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : { description: String(v) };
  if (typeof v === 'string') {
    return v.length <= MAX_ECHOED_TEXT ? v : { description: `a ${v.length}-character text` };
  }
  if (Array.isArray(v) && v.length <= 4) {
    // Indexed, so a hole reads as `undefined` and is shown as `empty`.
    const parts: string[] = [];
    for (let i = 0; i < v.length; i += 1) parts.push(describeRaw(v[i]));
    return { description: `[${parts.join(', ')}]` };
  }
  return { description: describeRaw(v) };
}

/** Where a reporting build collects what it did. */
interface CorrectionSink {
  readonly corrections: GameComponentFieldCorrection[];
  readonly supplied: string[];
}

/** Why a `u32` field moved, given that it did. */
function u32Reason(v: unknown, max: number): CorrectionReason {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'invalid-replaced';
  const rounded = Math.round(v);
  return rounded < 0 || rounded > max ? 'clamped' : 'rounded';
}

/**
 * The coercers above, bound to one component's bag and field names.
 *
 * Each method reads `props[field]` unless handed a value (the health aliases
 * are), applies exactly the coercion it wraps, and — only when `sink` exists
 * and the caller supplied a value — records a correction if what it applied is
 * not what it was given. A missing key is never a correction: filling a gap
 * with the default is the builder's job, not a change to anyone's request.
 *
 * `Field` is `keyof T`, so a reported field name that is not a real store field
 * is a compile error rather than a marker on nothing.
 */
function fieldReader<T extends object>(
  component: GameComponentData['type'],
  props: Record<string, unknown>,
  sink: CorrectionSink | undefined,
) {
  type Field = keyof T & string;
  const named = (field: Field, v: unknown): boolean => {
    if (sink === undefined || v === undefined) return false;
    sink.supplied.push(field);
    return true;
  };
  const record = (
    field: Field,
    requested: CorrectionValue,
    applied: CorrectionValue,
    reason: CorrectionReason,
  ): void => {
    sink?.corrections.push({ component, field, requested, applied, reason });
  };
  /**
   * A route correction, in counts, carrying the route it applied so a marker
   * can tell it apart from another route of the same length. The points are
   * copied: the record must not share arrays with the component it describes,
   * or an in-place edit of the stored route would move the record with it and
   * the marker would go on matching itself.
   */
  const recordRoute = (
    field: Field,
    requested: CorrectionValue,
    route: readonly (readonly [number, number, number])[],
    reason: CorrectionReason,
  ): void => {
    sink?.corrections.push({
      component,
      field,
      requested,
      applied: route.length,
      reason,
      unit: 'points',
      appliedPoints: route.map(([x, y, z]) => [x, y, z] as const),
    });
  };
  /** The shared shape of every scalar field: coerce, then compare. */
  const scalar = <V extends CorrectionValue>(
    field: Field,
    v: unknown,
    applied: V,
    reason: () => CorrectionReason,
  ): V => {
    if (named(field, v) && applied !== v) record(field, summarizeValue(v), applied, reason());
    return applied;
  };

  return {
    num: (field: Field, fallback: number, range: EngineRange, v: unknown = props[field]): number =>
      scalar(field, v, num(v, fallback, range), () => (isEngineFinite(v) ? 'clamped' : 'invalid-replaced')),
    int: (field: Field, fallback: number, max: number, v: unknown = props[field]): number =>
      scalar(field, v, int(v, fallback, max), () => u32Reason(v, max)),
    nullableInt: (field: Field, fallback: number | null, max: number, v: unknown = props[field]): number | null =>
      scalar(field, v, nullableInt(v, fallback, max), () => u32Reason(v, max)),
    bool: (field: Field, fallback: boolean, v: unknown = props[field]): boolean =>
      scalar(field, v, bool(v, fallback), () => 'invalid-replaced'),
    str: (field: Field, fallback: string, v: unknown = props[field]): string =>
      scalar(field, v, str(v, fallback), () => 'invalid-replaced'),
    nullableStr: (field: Field, fallback: string | null, v: unknown = props[field]): string | null =>
      scalar(field, v, nullableStr(v, fallback), () => 'invalid-replaced'),
    oneOf: <E extends string>(field: Field, allowed: readonly E[], fallback: E, v: unknown = props[field]): E =>
      scalar(field, v, oneOf(v, allowed, fallback), () => 'invalid-replaced'),
    vec3: (
      field: Field,
      fallback: [number, number, number],
      v: unknown = props[field],
    ): [number, number, number] => {
      const supplied = named(field, v);
      const parsed = parseVec3(v);
      if (parsed !== null) return parsed;
      if (supplied) record(field, summarizeValue(v), [...fallback], 'invalid-replaced');
      return fallback;
    },
    /**
     * Counts, not points: "you gave 300, 64 were kept" is the report an author
     * can act on, and echoing 300 coordinate triples back is the raw diff the
     * issue asks us not to show. The caller's list is never echoed; the route
     * that was APPLIED rides along as `appliedPoints`, which the author never
     * reads and a marker needs (see `recordRoute`).
     */
    waypoints: (
      field: Field,
      fallback: [number, number, number][],
      v: unknown = props[field],
    ): [number, number, number][] => {
      const supplied = named(field, v);
      const parsed = parseWaypoints(v);
      if (supplied) {
        if (parsed === null) {
          const requested = Array.isArray(v) ? v.length : summarizeValue(v);
          recordRoute(field, requested, fallback, 'invalid-replaced');
        } else if (parsed.truncated) {
          recordRoute(field, parsed.given, parsed.points, 'truncated');
        } else if (parsed.points.length !== parsed.given) {
          recordRoute(field, parsed.given, parsed.points, 'dropped');
        }
      }
      return parsed?.points ?? fallback;
    },
  };
}

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
  rawProps: Record<string, unknown> = {},
): GameComponentData | null {
  return buildComponent(name, rawProps, undefined);
}

/**
 * `buildStoreComponent`, plus the per-field record of what the build changed
 * (PF-1148): one {@link GameComponentFieldCorrection} for each field whose
 * applied value is not the value supplied, and the list of fields supplied.
 *
 * This is the call for any path whose values came from someone who will not be
 * looking at the inspector when they land — the chat and MCP tools, the
 * generation pipeline — so the request and the result can be told apart later.
 */
export function buildStoreComponentWithReport(
  name: string,
  rawProps: Record<string, unknown> = {},
): BuiltGameComponent | null {
  const sink: CorrectionSink = { corrections: [], supplied: [] };
  const component = buildComponent(name, rawProps, sink);
  return component === null
    ? null
    : { component, corrections: sink.corrections, supplied: sink.supplied };
}

function buildComponent(
  name: string,
  rawProps: Record<string, unknown>,
  sink: CorrectionSink | undefined,
): GameComponentData | null {
  const props = ownEnumerableSnapshot(rawProps);
  switch (toStoreComponentType(name)) {
    case 'characterController': {
      const f = fieldReader<CharacterControllerData>('characterController', props, sink);
      return {
        type: 'characterController',
        characterController: {
          speed: f.num('speed', 5, ENGINE_PROP_RANGES.character_controller.speed),
          jumpHeight: f.num('jumpHeight', 8, ENGINE_PROP_RANGES.character_controller.jumpHeight),
          gravityScale: f.num('gravityScale', 1, ENGINE_PROP_RANGES.character_controller.gravityScale),
          canDoubleJump: f.bool('canDoubleJump', false),
        },
      };
    }
    case 'health': {
      const f = fieldReader<HealthData>('health', props, sink);
      // The chat tool has always accepted `maxHealth`/`currentHealth` aliases;
      // keep them working, and default current to max so a bare `maxHp` bump
      // doesn't leave the entity on the old (lower) current value.
      const maxHp = f.num('maxHp', 100, ENGINE_PROP_RANGES.health.maxHp, props.maxHealth ?? props.maxHp);
      return {
        type: 'health',
        health: {
          maxHp,
          // Clamped, then used as the fallback — `maxHp` is already inside
          // `currentHp`'s own range, so the engine's "current defaults to max"
          // rule lands on the same number on both sides. A fallback is not a
          // correction: no current value was asked for.
          currentHp: f.num(
            'currentHp',
            maxHp,
            ENGINE_PROP_RANGES.health.currentHp,
            props.currentHealth ?? props.currentHp,
          ),
          invincibilitySecs: f.num('invincibilitySecs', 0.5, ENGINE_PROP_RANGES.health.invincibilitySecs),
          respawnOnDeath: f.bool('respawnOnDeath', true),
          respawnPoint: f.vec3('respawnPoint', [0, 1, 0]),
          despawnOnDeath: f.bool('despawnOnDeath', true),
        },
      };
    }
    case 'collectible': {
      const f = fieldReader<CollectibleData>('collectible', props, sink);
      return {
        type: 'collectible',
        collectible: {
          value: f.int('value', 1, ENGINE_PROP_MAXIMA.collectible.value),
          destroyOnCollect: f.bool('destroyOnCollect', true),
          pickupSoundAsset: f.nullableStr('pickupSoundAsset', null),
          rotateSpeed: f.num('rotateSpeed', 90, ENGINE_PROP_RANGES.collectible.rotateSpeed),
        },
      };
    }
    case 'damageZone': {
      const f = fieldReader<DamageZoneData>('damageZone', props, sink);
      return {
        type: 'damageZone',
        damageZone: {
          damagePerSecond: f.num('damagePerSecond', 25, ENGINE_PROP_RANGES.damage_zone.damagePerSecond),
          oneShot: f.bool('oneShot', false),
        },
      };
    }
    case 'checkpoint': {
      const f = fieldReader<CheckpointData>('checkpoint', props, sink);
      return { type: 'checkpoint', checkpoint: { autoSave: f.bool('autoSave', true) } };
    }
    case 'teleporter': {
      const f = fieldReader<TeleporterData>('teleporter', props, sink);
      return {
        type: 'teleporter',
        teleporter: {
          targetPosition: f.vec3('targetPosition', [0, 1, 0]),
          cooldownSecs: f.num('cooldownSecs', 1, ENGINE_PROP_RANGES.teleporter.cooldownSecs),
        },
      };
    }
    case 'movingPlatform': {
      const f = fieldReader<MovingPlatformData>('movingPlatform', props, sink);
      return {
        type: 'movingPlatform',
        movingPlatform: {
          speed: f.num('speed', 2, ENGINE_PROP_RANGES.moving_platform.speed),
          waypoints: f.waypoints('waypoints', [
            [0, 0, 0],
            [0, 3, 0],
          ]),
          pauseDuration: f.num('pauseDuration', 0.5, ENGINE_PROP_RANGES.moving_platform.pauseDuration),
          loopMode: f.oneOf('loopMode', PLATFORM_LOOP_MODES, 'pingPong'),
        },
      };
    }
    case 'triggerZone': {
      const f = fieldReader<TriggerZoneData>('triggerZone', props, sink);
      return {
        type: 'triggerZone',
        triggerZone: {
          eventName: f.str('eventName', 'trigger'),
          oneShot: f.bool('oneShot', false),
        },
      };
    }
    case 'spawner': {
      const f = fieldReader<SpawnerData>('spawner', props, sink);
      return {
        type: 'spawner',
        spawner: {
          entityType: f.str('entityType', 'cube'),
          intervalSecs: f.num('intervalSecs', 3, ENGINE_PROP_RANGES.spawner.intervalSecs),
          maxCount: f.int('maxCount', 5, ENGINE_PROP_MAXIMA.spawner.maxCount),
          spawnOffset: f.vec3('spawnOffset', [0, 1, 0]),
          onTrigger: f.nullableStr('onTrigger', null),
        },
      };
    }
    case 'follower': {
      const f = fieldReader<FollowerData>('follower', props, sink);
      return {
        type: 'follower',
        follower: {
          targetEntityId: f.nullableStr('targetEntityId', null),
          speed: f.num('speed', 3, ENGINE_PROP_RANGES.follower.speed),
          stopDistance: f.num('stopDistance', 1.5, ENGINE_PROP_RANGES.follower.stopDistance),
          lookAtTarget: f.bool('lookAtTarget', true),
        },
      };
    }
    case 'projectile': {
      const f = fieldReader<ProjectileData>('projectile', props, sink);
      return {
        type: 'projectile',
        projectile: {
          speed: f.num('speed', 15, ENGINE_PROP_RANGES.projectile.speed),
          damage: f.num('damage', 10, ENGINE_PROP_RANGES.projectile.damage),
          lifetimeSecs: f.num('lifetimeSecs', 5, ENGINE_PROP_RANGES.projectile.lifetimeSecs),
          gravity: f.bool('gravity', false),
          destroyOnHit: f.bool('destroyOnHit', true),
        },
      };
    }
    case 'winCondition': {
      const f = fieldReader<WinConditionData>('winCondition', props, sink);
      return {
        type: 'winCondition',
        winCondition: {
          conditionType: f.oneOf('conditionType', WIN_CONDITION_TYPES, 'score'),
          targetScore: f.nullableInt('targetScore', 10, ENGINE_PROP_MAXIMA.win_condition.targetScore),
          targetEntityId: f.nullableStr('targetEntityId', null),
        },
      };
    }
    case 'dialogueTrigger': {
      // Accepts the store's field names; the engine's spellings are applied by
      // `toWireComponent`, which is the only place the two vocabularies meet.
      const f = fieldReader<DialogueTriggerData>('dialogueTrigger', props, sink);
      return {
        type: 'dialogueTrigger',
        dialogueTrigger: {
          treeId: f.str('treeId', ''),
          triggerRadius: f.num('triggerRadius', 3, ENGINE_PROP_RANGES.dialogue_trigger.interactionRadius),
          requireInteract: f.bool('requireInteract', true),
          interactKey: f.str('interactKey', 'interact'),
          oneShot: f.bool('oneShot', false),
        },
      };
    }
    case null:
      return null;
  }
  // No `default:` arm and no trailing `return` — both are the same mistake. A
  // switch over the union is total today, so TypeScript is satisfied; add a
  // fourteenth component type and the function can fall off its end, which is
  // TS2366. Either a `default: return null` or a bare `return null` down here
  // answers that error and lets the new type ship as a silent `null`, so the
  // absence of both is what makes the miss a compile failure. Verified against
  // this repo's tsc, not assumed.
}
