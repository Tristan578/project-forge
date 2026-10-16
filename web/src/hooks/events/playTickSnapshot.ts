/**
 * The editor's reconstituted Play frame (#10375).
 *
 * The engine's per-frame Play system emits ONLY `PLAY_TICK_DELTA`
 * (`emit_play_tick_system`, engine/src/bridge/scripts.rs): the entities whose
 * transform or info changed since its previous frame, the ids that vanished,
 * and the input state. The full-frame `PLAY_TICK` emitter has no caller. Every
 * consumer downstream of `firePlayTick` — the script runner's worker tick and
 * the record/replay bus — reads a FULL frame, so the delta is merged here and
 * the full shape is what goes on; nothing downstream has to know about deltas.
 *
 * The merge mirrors the engine's own cache (`core/play_tick_delta.rs`): the
 * first frame after entering (or resuming) Play lists every entity, so it is a
 * keyframe for an empty snapshot; later frames list only what changed plus
 * what was removed. The snapshot is forgotten on every transition out of Play
 * (`useEngineEvents`, on `ENGINE_MODE_CHANGED`) and whenever the engine is
 * reset or re-initialised (`resetEngine` in `useEngine.ts`, and the hub's
 * callback registration): a recovered engine starts from an empty cache and
 * emits no mode event, so a snapshot left over from before the crash would
 * have its full first frame merged ONTO it and never lose an entity that no
 * longer exists (Sentry review on #10390).
 *
 * This module imports nothing. `useEngine.ts` has to reset the snapshot, and
 * `gameEvents.ts` is reached from `useEngine.ts` only through a cycle
 * (`gameEvents -> useScriptRunner / renderErrorEvents -> useEngine`), so the
 * state lives here where both can import it without one.
 *
 * Each frame gets a FRESH `entities`/`entityInfos` object rather than an
 * in-place merge: `publishPlayTick` caches the latest frame by reference and
 * the input-trace recorder reads frames after the fact, so mutating in place
 * would silently rewrite every frame a subscriber kept into the newest one.
 */

export type PlayTickVec3 = [number, number, number];

export interface PlayTickEntityState {
  position: PlayTickVec3;
  rotation: PlayTickVec3;
  scale: PlayTickVec3;
}

export interface PlayTickEntityInfo {
  name: string;
  type: string;
  colliderRadius: number;
}

export interface PlayTickInputState {
  pressed: Record<string, boolean>;
  justPressed: Record<string, boolean>;
  justReleased: Record<string, boolean>;
  axes: Record<string, number>;
}

/** The full frame `firePlayTick` hands on — the shape `PLAY_TICK` carries. */
export interface PlayTickFrame {
  entities: Record<string, PlayTickEntityState>;
  entityInfos: Record<string, PlayTickEntityInfo>;
  inputState: PlayTickInputState;
}

/** The engine's `PLAY_TICK_DELTA` payload (`emit_play_tick_delta`, camelCase). */
export interface PlayTickDeltaPayload {
  changedEntities?: Record<string, PlayTickEntityState>;
  changedEntityInfos?: Record<string, PlayTickEntityInfo>;
  removedEntityIds?: string[];
  inputState: PlayTickInputState;
}

/**
 * A map with NO prototype, keyed by entity id.
 *
 * A scene file keeps its entity ids, so a crafted one can name an entity
 * `__proto__`, `constructor` or `prototype`. On a `{}`-based map,
 * `map['__proto__'] = state` is `Object.prototype`'s inherited setter: it
 * swaps the map's prototype instead of adding an entry, the entity never
 * appears in `Object.keys`, and every later lookup resolves through whatever
 * the hostile state carries (Devin security review on #10390). With no
 * prototype in the chain there is no setter to hit, so those three names are
 * ordinary own keys and `Object.prototype` is never involved. Every consumer
 * downstream reads these maps through `Object.keys`/`Object.entries`/
 * `Object.hasOwn` or by id, all of which work on a prototype-less object, and
 * `postMessage`'s structured clone turns one into a plain object.
 */
function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * A prototype-less copy of `source`'s own enumerable entries. `Object.assign`
 * reads own enumerable keys only and writes through `[[Set]]`, which on a
 * target with no prototype creates an own property for `__proto__` too.
 */
function copyMap<T>(source: Record<string, T>): Record<string, T> {
  return Object.assign(emptyMap<T>(), source);
}

let entities: Record<string, PlayTickEntityState> = emptyMap();
let entityInfos: Record<string, PlayTickEntityInfo> = emptyMap();

/**
 * Forget the reconstituted frame, so the next delta is treated as a keyframe.
 *
 * Called on every transition out of Play, on engine reset/recovery, when the
 * hub registers its callback against a (re)initialised engine, and by tests.
 */
export function resetPlayTickSnapshot(): void {
  entities = emptyMap();
  entityInfos = emptyMap();
}

/**
 * A full frame is a keyframe: whatever it does not list no longer exists, so
 * it REPLACES the snapshot rather than merging into it. The engine has no
 * caller for `PLAY_TICK` today, but the wire shape is still declared and this
 * keeps a build that sends full frames working.
 */
export function replacePlayTickSnapshot(frame: Partial<Pick<PlayTickFrame, 'entities' | 'entityInfos'>>): void {
  entities = copyMap(frame.entities ?? {});
  entityInfos = copyMap(frame.entityInfos ?? {});
}

/**
 * Merge one delta onto the snapshot and return the full frame.
 *
 * Remove, then apply — the same order `DeltaSerializer.applyDelta` uses. The
 * engine never lists one id in both (removed = in its cache but gone; changed
 * = present), so the order is a convention, not a tie-break. Always returns a
 * frame, even for an empty delta: the engine emits every frame because the
 * script runtime needs input state each frame, and a static scene is all
 * empty deltas after the first.
 */
export function mergePlayTickDelta(delta: PlayTickDeltaPayload): PlayTickFrame {
  const next = copyMap(entities);
  const nextInfos = copyMap(entityInfos);
  for (const id of delta.removedEntityIds ?? []) {
    delete next[id];
    delete nextInfos[id];
  }
  for (const [id, state] of Object.entries(delta.changedEntities ?? {})) {
    next[id] = state;
  }
  for (const [id, info] of Object.entries(delta.changedEntityInfos ?? {})) {
    nextInfos[id] = info;
  }
  entities = next;
  entityInfos = nextInfos;
  return { entities: next, entityInfos: nextInfos, inputState: delta.inputState };
}
