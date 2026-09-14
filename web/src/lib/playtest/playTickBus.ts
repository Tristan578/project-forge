/**
 * Play-tick fan-out bus.
 *
 * `useScriptRunner` owns the single `setPlayTickCallback` slot the engine drives
 * every frame — there is exactly one, and the script worker needs it. The
 * runtime recorder and the replay runner both need to OBSERVE that same stream
 * (named-action input per tick, and entity transforms), so this is a tiny
 * multi-subscriber fan-out the runner publishes into ALONGSIDE its own callback.
 * It carries only what record/replay reads; it is not a second engine bridge.
 *
 * A snapshot is the raw engine play-tick payload, narrowed to the two fields
 * record/replay consume. `entities` positions prove the player moved and reveal
 * a `destroy_on_collect` collectible's despawn; `inputState.pressed`/`axes` are
 * the engine's OWN evaluated named actions (see `core/input.rs::capture_input`),
 * which is exactly what a recording of "named input actions" must capture.
 */

/** One entity's transform slice, as the engine reports it each play tick. */
export interface PlayTickEntity {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

/** The engine's per-tick evaluated named-action input state. */
export interface PlayTickInputState {
  pressed: Record<string, boolean>;
  justPressed?: Record<string, boolean>;
  justReleased?: Record<string, boolean>;
  axes: Record<string, number>;
}

/** The slice of the engine play-tick payload that record/replay consumes. */
export interface PlayTickSnapshot {
  entities: Record<string, PlayTickEntity>;
  inputState: PlayTickInputState;
  /** Milliseconds of wall-clock elapsed since Play started, per the runner. */
  elapsedMs: number;
}

type Listener = (snapshot: PlayTickSnapshot) => void;

const listeners = new Set<Listener>();

/** The most recent snapshot, so a late subscriber (e.g. a replay reading final
 *  state) can observe without waiting for the next frame. Cleared on stop. */
let latest: PlayTickSnapshot | null = null;

/**
 * Subscribe to the play-tick stream. Returns an unsubscribe function.
 *
 * Listeners must not throw — one bad listener would otherwise starve the rest
 * of the frame's fan-out — so each is invoked defensively by `publishPlayTick`.
 */
export function subscribePlayTick(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish a play-tick snapshot to every subscriber and cache it as `latest`. */
export function publishPlayTick(snapshot: PlayTickSnapshot): void {
  latest = snapshot;
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      // A recorder or replay observer must never take the engine's frame down
      // with it. Report and continue — the missed snapshot is recoverable, a
      // dead play loop is not.
      console.error('[playTickBus] listener threw; continuing fan-out', error);
    }
  }
}

/** The most recent published snapshot, or null if none since the last reset. */
export function getLatestPlayTick(): PlayTickSnapshot | null {
  return latest;
}

/**
 * Drop the cached snapshot. Called when Play stops so a replay started in a
 * later session cannot read a stale final frame from the previous one. Active
 * subscriptions are left untouched — their owners manage their own lifetimes.
 */
export function resetPlayTickBus(): void {
  latest = null;
}
