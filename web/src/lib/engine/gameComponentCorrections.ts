/**
 * What happened to a game-component value between the request and the engine.
 *
 * `gameComponentWire.ts` coerces every field into the range the engine will
 * actually hold — it clamps, rounds, caps a waypoint route at 64 points and
 * replaces what it cannot use with the default. That keeps the store and the
 * engine on one value, which is what PF-1147 fixed. It also meant the author's
 * stated intent and the running game could disagree with no record that they
 * ever differed: `dispatchCommand` returns `void`, the chat said "Added", and the
 * inspector showed the capped number as if it were the one asked for (PF-1148).
 *
 * This module is the record. The wire layer writes one
 * {@link GameComponentFieldCorrection} per field whose applied value differs
 * from the value the caller supplied, and nothing else: a field the caller left
 * out, a value already in range, or a default filling a gap is not a correction.
 * A false "we adjusted this" is worse than silence, so the absence of a record
 * is as deliberate as its presence.
 *
 * The record is built from the TypeScript mirror of the engine's coercions, not
 * reported back by the engine. `dispatchCommand` returns `void`, so an
 * engine-emitted report would need a new event and a WASM build; the mirror is
 * pinned to the Rust source by `__tests__/gameComponentWire.test.ts`, which is
 * what makes it a faithful stand-in.
 */

import type { GameComponentData } from '@/stores/slices/types';
import { gameComponentFields } from './gameComponentWire';

export type GameComponentType = GameComponentData['type'];

/**
 * Why a value changed.
 *
 * - `clamped`: a number outside the engine's range, moved to the nearest bound.
 * - `rounded`: a whole-number field given a fraction.
 * - `truncated`: a list longer than the engine keeps; the tail was dropped.
 * - `dropped`: some list entries were unusable and left out; the rest were kept.
 * - `invalid-replaced`: a value the field cannot take at all, replaced by the default.
 */
export type CorrectionReason = 'clamped' | 'rounded' | 'truncated' | 'dropped' | 'invalid-replaced';

/**
 * A value as it can be shown and serialized.
 *
 * Numbers, booleans and short strings are carried as themselves, so an MCP
 * client reading `requested: 99999, applied: 1000` gets numbers it can compare.
 * Anything that would not survive JSON (`NaN`, a hole) or is not worth echoing
 * (a 300-character id) is carried as a `description` instead.
 */
export type CorrectionValue =
  | number
  | boolean
  | string
  | null
  | readonly number[]
  | { readonly description: string };

export interface GameComponentFieldCorrection {
  /** The store discriminant, e.g. `movingPlatform`. */
  readonly component: GameComponentType;
  /** The store field name, e.g. `speed` or `waypoints`. */
  readonly field: string;
  readonly requested: CorrectionValue;
  readonly applied: CorrectionValue;
  readonly reason: CorrectionReason;
  /**
   * Set when `requested` / `applied` are counts of list entries rather than
   * the values themselves. Only `waypoints` uses it today.
   */
  readonly unit?: 'points';
  /**
   * The entity the value landed on. The wire layer never sets it — a build
   * knows nothing about entities — and the store keys markers by entity
   * already. A tool result that spans several entities (the compound tools)
   * tags each record so the author can tell which one it was.
   */
  readonly entityId?: string;
}

/**
 * What a write did to the caller's request: the corrections, and which fields
 * the caller named at all. `supplied` is what lets a later write clear a stale
 * marker on a field it set explicitly, even to the value it already held.
 */
export interface GameComponentWriteReport {
  readonly corrections: readonly GameComponentFieldCorrection[];
  readonly supplied: readonly string[];
}

// ---------------------------------------------------------------------------
// Author-facing wording
// ---------------------------------------------------------------------------

type ComponentOf<K extends GameComponentType> = Extract<GameComponentData, { type: K }>;
type DataOf<K extends GameComponentType> = ComponentOf<K>[K & keyof ComponentOf<K>];

const COMPONENT_LABELS: Record<GameComponentType, string> = {
  characterController: 'Character Controller',
  health: 'Health',
  collectible: 'Collectible',
  damageZone: 'Damage Zone',
  checkpoint: 'Checkpoint',
  teleporter: 'Teleporter',
  movingPlatform: 'Moving Platform',
  triggerZone: 'Trigger Zone',
  spawner: 'Spawner',
  follower: 'Follower',
  projectile: 'Projectile',
  winCondition: 'Win Condition',
  dialogueTrigger: 'Dialogue Trigger',
};

/**
 * One label per store field, typed so a new field is a compile error until it
 * has one — a correction whose field fell back to its camelCase key would be
 * the raw diff the author is not supposed to see.
 */
const FIELD_LABELS: { [K in GameComponentType]: { [F in keyof DataOf<K>]-?: string } } = {
  characterController: {
    speed: 'speed',
    jumpHeight: 'jump height',
    gravityScale: 'gravity scale',
    canDoubleJump: 'double jump',
  },
  health: {
    maxHp: 'max HP',
    currentHp: 'current HP',
    invincibilitySecs: 'invincibility time',
    respawnOnDeath: 'respawn on death',
    respawnPoint: 'respawn point',
    despawnOnDeath: 'despawn on death',
  },
  collectible: {
    value: 'value',
    destroyOnCollect: 'destroy on collect',
    pickupSoundAsset: 'pickup sound',
    rotateSpeed: 'rotate speed',
  },
  damageZone: { damagePerSecond: 'damage per second', oneShot: 'one-shot' },
  checkpoint: { autoSave: 'auto-save' },
  teleporter: { targetPosition: 'target position', cooldownSecs: 'cooldown' },
  movingPlatform: {
    speed: 'speed',
    waypoints: 'waypoints',
    pauseDuration: 'pause',
    loopMode: 'loop mode',
  },
  triggerZone: { eventName: 'event name', oneShot: 'one-shot' },
  spawner: {
    entityType: 'entity type',
    intervalSecs: 'interval',
    maxCount: 'max count',
    spawnOffset: 'spawn offset',
    onTrigger: 'trigger event',
  },
  follower: {
    targetEntityId: 'target',
    speed: 'speed',
    stopDistance: 'stop distance',
    lookAtTarget: 'look at target',
  },
  projectile: {
    speed: 'speed',
    damage: 'damage',
    lifetimeSecs: 'lifetime',
    gravity: 'gravity',
    destroyOnHit: 'destroy on hit',
  },
  winCondition: {
    conditionType: 'condition type',
    targetScore: 'target score',
    targetEntityId: 'goal',
  },
  dialogueTrigger: {
    treeId: 'dialogue tree',
    triggerRadius: 'radius',
    requireInteract: 'require interact',
    interactKey: 'interact key',
    oneShot: 'one-shot',
  },
};

function fieldLabel(component: GameComponentType, field: string): string {
  const labels = FIELD_LABELS[component] as Record<string, string>;
  return Object.hasOwn(labels, field) ? labels[field] : field;
}

function formatValue(value: CorrectionValue, unit: 'points' | undefined): string {
  if (value === null) return 'an empty value';
  if (typeof value === 'number') {
    if (unit === 'points') return `${value} ${value === 1 ? 'point' : 'points'}`;
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  return (value as { description: string }).description;
}

/**
 * One sentence per correction, in the author's terms: the component and field
 * by name, what was asked for, what was used, and why — never a raw diff.
 *
 * `entityName` prefixes the sentence with the entity, for a report that spans
 * several of them.
 */
export function describeCorrection(c: GameComponentFieldCorrection, entityName?: string): string {
  const field = `${COMPONENT_LABELS[c.component]} ${fieldLabel(c.component, c.field)}`;
  const where = entityName === undefined ? field : `${JSON.stringify(entityName)} ${field}`;
  const requested = formatValue(c.requested, c.unit);
  const applied = formatValue(c.applied, c.unit);
  switch (c.reason) {
    case 'clamped':
      return typeof c.requested === 'number' && typeof c.applied === 'number' && c.requested < c.applied
        ? `${where}: you asked for ${requested}, it was raised to the minimum of ${applied}.`
        : `${where}: you asked for ${requested}, it was capped at ${applied}.`;
    case 'rounded':
      return `${where}: you asked for ${requested}, it was rounded to the whole number ${applied}.`;
    case 'truncated':
      return `${where}: you gave ${requested}; only the first ${applied} were kept, the most the engine supports.`;
    case 'dropped': {
      const unusable = typeof c.requested === 'number' && typeof c.applied === 'number'
        ? c.requested - c.applied
        : null;
      return unusable === null
        ? `${where}: some of the ${requested} you gave could not be used, so ${applied} were kept.`
        : `${where}: you gave ${requested}; ${unusable} could not be used, so ${applied} were kept.`;
    }
    case 'invalid-replaced':
      if (c.unit === 'points') {
        return typeof c.requested === 'number'
          ? `${where}: you gave ${requested}, but a route needs at least 2 usable points, so the default route (${applied}) was used instead.`
          : `${where}: ${requested} is not a list of points, so the default route (${applied}) was used instead.`;
      }
      return `${where}: ${requested} is not a value this field accepts, so ${applied} was used instead.`;
  }
}

/**
 * A tool's result message with its corrections said out loud.
 *
 * `message` alone when nothing was adjusted — the absence of the sentence is a
 * claim too, and it has to be a true one.
 */
export function withCorrectionSummary(
  message: string,
  corrections: readonly GameComponentFieldCorrection[],
  entityNameOf?: (entityId: string) => string | undefined,
): string {
  if (corrections.length === 0) return message;
  const count = corrections.length === 1 ? '1 value was' : `${corrections.length} values were`;
  const sentences = corrections.map((c) =>
    describeCorrection(c, c.entityId === undefined ? undefined : (entityNameOf?.(c.entityId) ?? c.entityId)));
  // A message that already ends a sentence is not given a second full stop.
  const lead = /[.!?]$/.test(message) ? message : `${message}.`;
  return `${lead} ${count} adjusted to fit the engine’s limits: ${sentences.join(' ')}`;
}

// ---------------------------------------------------------------------------
// Matching a correction against the value a component holds now
// ---------------------------------------------------------------------------

/**
 * Whether `current` is still the value the correction applied.
 *
 * A marker is only true while the field holds the number it describes. Undo, a
 * scene load and a play session can all move a field without going through the
 * store actions that clear markers, and a marker left on a value it no longer
 * describes is exactly the false report this whole mechanism must not make.
 *
 * Numbers compare at f32 precision because the inspector reads the engine's
 * echo, which has been through an `f32` and back.
 */
export function correctionMatchesValue(c: GameComponentFieldCorrection, current: unknown): boolean {
  const applied = c.applied;
  if (c.unit === 'points') {
    return Array.isArray(current) && typeof applied === 'number' && current.length === applied;
  }
  if (typeof applied === 'number') {
    return typeof current === 'number' && Math.fround(current) === Math.fround(applied);
  }
  if (Array.isArray(applied)) {
    if (!Array.isArray(current) || current.length !== applied.length) return false;
    for (let i = 0; i < applied.length; i += 1) {
      const value: unknown = current[i];
      if (typeof value !== 'number' || Math.fround(value) !== Math.fround(applied[i])) return false;
    }
    return true;
  }
  if (applied === null || typeof applied !== 'object') return current === applied;
  // A `description` is never what the wire layer APPLIES — only requested
  // values are described — so there is nothing it could still match.
  return false;
}

// ---------------------------------------------------------------------------
// Reading corrections back out of an untrusted result
// ---------------------------------------------------------------------------

const REASONS: ReadonlySet<string> = new Set<CorrectionReason>([
  'clamped', 'rounded', 'truncated', 'dropped', 'invalid-replaced',
]);

function isCorrectionValue(value: unknown): value is CorrectionValue {
  if (value === null) return true;
  switch (typeof value) {
    case 'number':
    case 'boolean':
    case 'string':
      return true;
    case 'object':
      if (Array.isArray(value)) return value.every((n) => typeof n === 'number');
      return typeof (value as { description?: unknown }).description === 'string';
    default:
      return false;
  }
}

/** Whether `value` is a well-formed correction record. */
export function isGameComponentFieldCorrection(value: unknown): value is GameComponentFieldCorrection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.component === 'string'
    && Object.hasOwn(COMPONENT_LABELS, c.component)
    && typeof c.field === 'string'
    && typeof c.reason === 'string'
    && REASONS.has(c.reason)
    && isCorrectionValue(c.requested)
    && isCorrectionValue(c.applied)
    && (c.unit === undefined || c.unit === 'points')
    && (c.entityId === undefined || typeof c.entityId === 'string')
  );
}

/**
 * The corrections a tool result carries under its own `corrections` key, with
 * anything malformed left out.
 *
 * The chat card renders these, and a tool result is only as trustworthy as the
 * handler that produced it — a result from a stale bundle or a hand-written MCP
 * reply must not render as a note the wire layer never wrote.
 */
export function readCorrections(result: unknown): GameComponentFieldCorrection[] {
  if (typeof result !== 'object' || result === null || !Object.hasOwn(result, 'corrections')) return [];
  const list = (result as { corrections: unknown }).corrections;
  return Array.isArray(list) ? list.filter(isGameComponentFieldCorrection) : [];
}

// ---------------------------------------------------------------------------
// The editor's per-field marker map
// ---------------------------------------------------------------------------

/** field -> the correction currently marking it. */
export type ComponentAdjustments = Readonly<Record<string, GameComponentFieldCorrection>>;

/**
 * entityId -> component type -> field -> correction.
 *
 * Ephemeral editor state. It is never written into a component, a wire payload,
 * a scene file or an export: it records how a value came to be, which is a fact
 * about this session's edits and not part of the game.
 */
export type GameComponentAdjustments = Readonly<
  Record<string, Readonly<Partial<Record<GameComponentType, ComponentAdjustments>>>>
>;

/** The markers for one component, read without walking the prototype chain. */
export function componentAdjustmentsOf(
  map: GameComponentAdjustments,
  entityId: string,
  type: GameComponentType,
): ComponentAdjustments | undefined {
  if (!Object.hasOwn(map, entityId)) return undefined;
  const byType = map[entityId];
  return Object.hasOwn(byType, type) ? byType[type] : undefined;
}

/**
 * Only the corrections that still describe the component as it is — the ones
 * the inspector may show.
 */
export function currentAdjustments(
  adjustments: ComponentAdjustments | undefined,
  component: GameComponentData,
): GameComponentFieldCorrection[] {
  if (!adjustments) return [];
  const fields = gameComponentFields(component);
  return Object.values(adjustments).filter(
    (c) => c.component === component.type
      && Object.hasOwn(fields, c.field)
      && correctionMatchesValue(c, fields[c.field]),
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The markers a component should carry after a write.
 *
 * - `previous` (with `previousFields`, the component before the write) is kept
 *   field by field, except where the write supplied that field or changed its
 *   value — either one means the old marker no longer describes it.
 * - Each correction the write produced then marks its field, but only if the
 *   field really holds the value the correction says was applied.
 *
 * Returns `undefined` when nothing is left, so the caller can drop the key
 * rather than keep an empty record.
 */
export function nextComponentAdjustments(input: {
  previous: ComponentAdjustments | undefined;
  previousFields: Readonly<Record<string, unknown>> | undefined;
  nextFields: Readonly<Record<string, unknown>>;
  corrections: readonly GameComponentFieldCorrection[];
  supplied: readonly string[];
}): ComponentAdjustments | undefined {
  const { previous, previousFields, nextFields, corrections, supplied } = input;
  const result: Record<string, GameComponentFieldCorrection> = {};
  if (previous && previousFields) {
    const suppliedSet = new Set(supplied);
    for (const [field, correction] of Object.entries(previous)) {
      if (suppliedSet.has(field)) continue;
      if (!sameValue(previousFields[field], nextFields[field])) continue;
      result[field] = correction;
    }
  }
  for (const correction of corrections) {
    if (!Object.hasOwn(nextFields, correction.field)) continue;
    if (!correctionMatchesValue(correction, nextFields[correction.field])) continue;
    result[correction.field] = correction;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** `map` with one component's markers replaced (or removed, for `undefined`). */
export function withComponentAdjustments(
  map: GameComponentAdjustments,
  entityId: string,
  type: GameComponentType,
  adjustments: ComponentAdjustments | undefined,
): GameComponentAdjustments {
  const existing = Object.hasOwn(map, entityId) ? map[entityId] : undefined;
  if (adjustments === undefined) {
    if (!existing || !Object.hasOwn(existing, type)) return map;
    const { [type]: _removed, ...restTypes } = existing;
    if (Object.keys(restTypes).length > 0) return { ...map, [entityId]: restTypes };
    const { [entityId]: _entity, ...restEntities } = map;
    return restEntities;
  }
  // Computed keys in a literal are DefineOwnProperty, so an entity id of
  // `__proto__` lands as an own key instead of reparenting the record.
  return { ...map, [entityId]: { ...existing, [type]: adjustments } };
}

/**
 * Drop every marker on `entityId` that the engine's latest report no longer
 * bears out: a component that is gone, or a field that now holds a different
 * value than the one the marker says was applied.
 */
export function pruneEntityAdjustments(
  map: GameComponentAdjustments,
  entityId: string,
  components: readonly GameComponentData[],
): GameComponentAdjustments {
  if (!Object.hasOwn(map, entityId)) return map;
  let next = map;
  for (const type of Object.keys(map[entityId]) as GameComponentType[]) {
    const markers = componentAdjustmentsOf(map, entityId, type);
    const component = components.find((c) => c.type === type);
    const kept = component ? currentAdjustments(markers, component) : [];
    const keptCount = kept.length;
    if (markers && keptCount === Object.keys(markers).length) continue;
    const rebuilt: Record<string, GameComponentFieldCorrection> = {};
    for (const c of kept) rebuilt[c.field] = c;
    next = withComponentAdjustments(next, entityId, type, keptCount > 0 ? rebuilt : undefined);
  }
  return next;
}
