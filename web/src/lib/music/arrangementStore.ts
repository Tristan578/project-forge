/**
 * Music arrangement store (music.FR-2.OP-01 / OP-02, #9854).
 *
 * A standalone Zustand store holding the one `MusicArrangement` the editor is
 * working on. The state creator (`createArrangementSlice`) is exported so tests
 * can mount it in isolation with `createSliceStore()` (the `sliceTestTemplate`
 * pattern), exactly like the editor-store slices.
 *
 * Every mutation routes through the pure helpers in `arrangementTypes.ts`, so
 * the manual controls in `MusicArrangementPanel` and the future in-app AI path
 * (#9855) call the identical operations rather than drifting into two
 * implementations of "trim a clip".
 *
 * PERSISTENCE reuses the existing project path with no new table: an arrangement
 * serialises into the project's `sceneData` object under
 * `ARRANGEMENT_SCENE_DATA_KEY`, which the `/api/projects/[id]` PUT accepts
 * (`sceneData` is an open record) and the editor load returns. The engine's
 * scene file has no `deny_unknown_fields`, so the extra key rides along
 * untouched through `load_scene`; `readArrangementFromSceneData` pulls it back
 * out on reopen. See `applyArrangementToSceneData` / `readArrangementFromSceneData`.
 */

import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import {
  ARRANGEMENT_VERSION,
  ARRANGEMENT_SCENE_DATA_KEY,
  DEFAULT_TEMPO_BPM,
  clampFinite,
  clampTrimWindow,
  createEmptyArrangement,
  isArrangementEmpty,
  type MusicArrangement,
  type MusicClip,
  type MusicTrack,
} from './arrangementTypes';

let idCounter = 0;
/** Monotonic-ish unique id; the counter defends against same-millisecond collisions. */
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** Input for adding a clip. `startOffset` and `name` default sensibly. */
export interface AddClipInput {
  trackId: string;
  sourceUrl: string;
  sourceDurationSeconds: number;
  startOffset?: number;
  name?: string;
}

/** Input for the generated/imported-audio hand-off. */
export interface AddGeneratedClipInput {
  /** Asset name/id the clip's `sourceUrl` points at. */
  sourceUrl: string;
  durationSeconds: number;
  /** Track to place it on; a new track is created when omitted. */
  trackId?: string;
  name?: string;
}

export interface ArrangementSlice {
  arrangement: MusicArrangement;

  /**
   * Undo/redo history for every arrangement mutation. `past`/`future` hold
   * whole-arrangement snapshots (the model is small and value-typed, so a full
   * snapshot is cheaper and safer than a per-action inverse). A single logical
   * edit is one entry — `addGeneratedClip` creates its track and clip in one
   * commit, so one `undo()` removes both, not just the clip.
   */
  past: MusicArrangement[];
  future: MusicArrangement[];
  /** Step back to the arrangement before the last mutation. */
  undo: () => void;
  /** Re-apply the mutation a prior `undo()` reverted. */
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /** Add a track; returns its id. */
  addTrack: (name?: string) => string;
  /** Remove a track and every clip on it. */
  deleteTrack: (trackId: string) => void;
  renameTrack: (trackId: string, name: string) => void;
  setTrackMuted: (trackId: string, muted: boolean) => void;

  /** Add a clip to an existing track; returns its id, or null if the track is unknown. */
  addClip: (input: AddClipInput) => string | null;
  /** Move a clip along its track's timeline (and optionally to another track). */
  moveClip: (clipId: string, startOffset: number, trackId?: string) => void;
  /** Adjust a clip's trimmed source window (clamped to legal bounds). */
  trimClip: (clipId: string, trim: { trimStart?: number; trimEnd?: number }) => void;
  /** Toggle looping and optionally set the loop window in one operation. */
  setLoopPoints: (
    clipId: string,
    loop: { loopEnabled: boolean; trimStart?: number; trimEnd?: number },
  ) => void;
  deleteClip: (clipId: string) => void;

  /** Place a generated/imported track as a clip (the GenerateMusicDialog hand-off). */
  addGeneratedClip: (input: AddGeneratedClipInput) => string;

  setTempoBpm: (bpm: number) => void;
  clearArrangement: () => void;

  /** Snapshot for persistence; `null` when the arrangement is empty. */
  serialize: () => MusicArrangement | null;
  /** Replace the whole arrangement (project load / undo). `null` clears it. */
  hydrate: (arrangement: MusicArrangement | null) => void;
}

/** Shallow field comparison — every `MusicClip` property is a primitive. */
function clipsEqual(a: MusicClip, b: MusicClip): boolean {
  return (
    a.id === b.id &&
    a.trackId === b.trackId &&
    a.sourceUrl === b.sourceUrl &&
    a.sourceDurationSeconds === b.sourceDurationSeconds &&
    a.startOffset === b.startOffset &&
    a.trimStart === b.trimStart &&
    a.trimEnd === b.trimEnd &&
    a.loopEnabled === b.loopEnabled &&
    a.name === b.name
  );
}

/** Update one clip in the arrangement via a mapping function. `changed` is set
 *  only when `fn`'s result actually differs from the input — `fn` always
 *  returns a fresh object (spread), so a no-op edit (e.g. `moveClip` with an
 *  invalid target track and an unchanged offset) must not be mistaken for a
 *  real mutation and pushed onto the undo stack. */
function mapClip(
  arrangement: MusicArrangement,
  clipId: string,
  fn: (clip: MusicClip) => MusicClip,
): MusicArrangement {
  let changed = false;
  const clips = arrangement.clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const next = fn(clip);
    if (!clipsEqual(clip, next)) changed = true;
    return next;
  });
  return changed ? { ...arrangement, clips } : arrangement;
}

/** Cap on retained history entries so a long editing session cannot grow the
 *  undo stack without bound. */
const HISTORY_LIMIT = 100;

/** Build a track without touching state (shared by addTrack + addGeneratedClip). */
function buildTrack(name: string | undefined, existingTrackCount: number): MusicTrack {
  return {
    id: makeId('track'),
    name: name && name.trim() ? name.trim() : `Track ${existingTrackCount + 1}`,
    muted: false,
  };
}

/** Build a clip without touching state (shared by addClip + addGeneratedClip). */
function buildClip(input: AddClipInput): MusicClip {
  const duration =
    typeof input.sourceDurationSeconds === 'number' && Number.isFinite(input.sourceDurationSeconds)
      ? Math.max(0, input.sourceDurationSeconds)
      : 0;
  const { trimStart, trimEnd } = clampTrimWindow(duration, 0, duration);
  return {
    id: makeId('clip'),
    trackId: input.trackId,
    sourceUrl: input.sourceUrl,
    sourceDurationSeconds: duration,
    startOffset: clampFinite(input.startOffset, 0, Number.MAX_SAFE_INTEGER, 0),
    trimStart,
    trimEnd,
    loopEnabled: false,
    name: input.name && input.name.trim() ? input.name.trim() : input.sourceUrl,
  };
}

export const createArrangementSlice: StateCreator<ArrangementSlice, [], [], ArrangementSlice> = (
  set,
  get,
) => {
  /**
   * Apply a new arrangement and record the current one on the undo stack.
   * A `next` referentially equal to the current arrangement (the no-op result
   * of `mapClip` when nothing matched) records NOTHING, so undo never steps
   * through mutations that changed nothing. Any real mutation clears the redo
   * stack, matching every editor undo/redo in the app.
   */
  const commit = (next: MusicArrangement) => {
    set((s) => {
      if (next === s.arrangement) return s;
      const past = s.past.length >= HISTORY_LIMIT
        ? [...s.past.slice(1), s.arrangement]
        : [...s.past, s.arrangement];
      return { arrangement: next, past, future: [] };
    });
  };

  return {
    arrangement: createEmptyArrangement(),
    past: [],
    future: [],

    undo: () =>
      set((s) => {
        if (s.past.length === 0) return s;
        const previous = s.past[s.past.length - 1];
        return {
          arrangement: previous,
          past: s.past.slice(0, -1),
          future: [s.arrangement, ...s.future],
        };
      }),

    redo: () =>
      set((s) => {
        if (s.future.length === 0) return s;
        const next = s.future[0];
        return {
          arrangement: next,
          past: [...s.past, s.arrangement],
          future: s.future.slice(1),
        };
      }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    addTrack: (name) => {
      const s = get();
      const track = buildTrack(name, s.arrangement.tracks.length);
      commit({ ...s.arrangement, tracks: [...s.arrangement.tracks, track] });
      return track.id;
    },

    deleteTrack: (trackId) => {
      const s = get();
      if (!s.arrangement.tracks.some((t) => t.id === trackId)) return;
      commit({
        ...s.arrangement,
        tracks: s.arrangement.tracks.filter((t) => t.id !== trackId),
        // Deleting a track takes its clips with it — no orphaned clips.
        clips: s.arrangement.clips.filter((c) => c.trackId !== trackId),
      });
    },

    renameTrack: (trackId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const s = get();
      if (!s.arrangement.tracks.some((t) => t.id === trackId)) return;
      commit({
        ...s.arrangement,
        tracks: s.arrangement.tracks.map((t) => (t.id === trackId ? { ...t, name: trimmed } : t)),
      });
    },

    setTrackMuted: (trackId, muted) => {
      const s = get();
      if (!s.arrangement.tracks.some((t) => t.id === trackId)) return;
      commit({
        ...s.arrangement,
        tracks: s.arrangement.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
      });
    },

    addClip: (input) => {
      const s = get();
      // A clip on an empty (unknown) track is a no-op, not a phantom clip.
      if (!s.arrangement.tracks.some((t) => t.id === input.trackId)) return null;
      const clip = buildClip(input);
      commit({ ...s.arrangement, clips: [...s.arrangement.clips, clip] });
      return clip.id;
    },

    moveClip: (clipId, startOffset, trackId) => {
      const s = get();
      const targetTrackValid =
        trackId !== undefined && s.arrangement.tracks.some((t) => t.id === trackId);
      commit(
        mapClip(s.arrangement, clipId, (clip) => ({
          ...clip,
          startOffset: clampFinite(startOffset, 0, Number.MAX_SAFE_INTEGER, clip.startOffset),
          trackId: targetTrackValid ? trackId! : clip.trackId,
        })),
      );
    },

    trimClip: (clipId, trim) => {
      const s = get();
      commit(
        mapClip(s.arrangement, clipId, (clip) => {
          const { trimStart, trimEnd } = clampTrimWindow(
            clip.sourceDurationSeconds,
            trim.trimStart ?? clip.trimStart,
            trim.trimEnd ?? clip.trimEnd,
          );
          return { ...clip, trimStart, trimEnd };
        }),
      );
    },

    setLoopPoints: (clipId, loop) => {
      const s = get();
      commit(
        mapClip(s.arrangement, clipId, (clip) => {
          const { trimStart, trimEnd } = clampTrimWindow(
            clip.sourceDurationSeconds,
            loop.trimStart ?? clip.trimStart,
            loop.trimEnd ?? clip.trimEnd,
          );
          return { ...clip, loopEnabled: loop.loopEnabled, trimStart, trimEnd };
        }),
      );
    },

    deleteClip: (clipId) => {
      const s = get();
      if (!s.arrangement.clips.some((c) => c.id === clipId)) return;
      commit({ ...s.arrangement, clips: s.arrangement.clips.filter((c) => c.id !== clipId) });
    },

    addGeneratedClip: (input) => {
      // Reuse the primitives so the generated hand-off is not a second code
      // path, but land the new track (if any) and its clip in ONE history entry
      // so a single undo removes the whole generated result.
      const s = get();
      const existing =
        input.trackId && s.arrangement.tracks.some((t) => t.id === input.trackId)
          ? input.trackId
          : undefined;
      let tracks = s.arrangement.tracks;
      let trackId = existing;
      if (!trackId) {
        const track = buildTrack('Music', tracks.length);
        trackId = track.id;
        tracks = [...tracks, track];
      }
      const clip = buildClip({
        trackId,
        sourceUrl: input.sourceUrl,
        sourceDurationSeconds: input.durationSeconds,
        name: input.name ?? input.sourceUrl,
      });
      commit({ ...s.arrangement, tracks, clips: [...s.arrangement.clips, clip] });
      return clip.id;
    },

    setTempoBpm: (bpm) => {
      const s = get();
      const tempoBpm = clampFinite(bpm, 20, 400, s.arrangement.tempoBpm || DEFAULT_TEMPO_BPM);
      if (tempoBpm === s.arrangement.tempoBpm) return;
      commit({ ...s.arrangement, tempoBpm });
    },

    clearArrangement: () => set({ arrangement: createEmptyArrangement(), past: [], future: [] }),

    serialize: () => {
      const { arrangement } = get();
      return isArrangementEmpty(arrangement) ? null : arrangement;
    },

    /**
     * Replace the whole arrangement (project load). History resets: undo must
     * never step back into a different project's arrangement, so a load is a
     * fresh baseline, not an undoable mutation. `null` clears it.
     */
    hydrate: (arrangement) =>
      set({ arrangement: arrangement ?? createEmptyArrangement(), past: [], future: [] }),
  };
};

/** The app-wide music arrangement store. */
export const useMusicArrangementStore = create<ArrangementSlice>()(createArrangementSlice);

// ---------------------------------------------------------------------------
// Persistence helpers — pure, so they are testable without the store and can
// run on the server (they never touch the DOM or the store singleton).
// ---------------------------------------------------------------------------

/**
 * Return a copy of `sceneData` carrying the arrangement under
 * `ARRANGEMENT_SCENE_DATA_KEY`. A `null`/empty arrangement REMOVES the key, so
 * clearing every clip and saving does not leave a stale arrangement behind.
 */
export function applyArrangementToSceneData(
  sceneData: Record<string, unknown>,
  arrangement: MusicArrangement | null,
): Record<string, unknown> {
  const next = { ...sceneData };
  if (!arrangement || isArrangementEmpty(arrangement)) {
    delete next[ARRANGEMENT_SCENE_DATA_KEY];
    return next;
  }
  next[ARRANGEMENT_SCENE_DATA_KEY] = arrangement;
  return next;
}

/** True for a finite number, used to reject NaN/strings from untrusted JSON. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate one clip from untrusted JSON, or drop it (return null). */
function parseClip(raw: unknown): MusicClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || typeof c.trackId !== 'string') return null;
  if (typeof c.sourceUrl !== 'string') return null;
  const duration = isFiniteNumber(c.sourceDurationSeconds) ? Math.max(0, c.sourceDurationSeconds) : 0;
  const { trimStart, trimEnd } = clampTrimWindow(
    duration,
    isFiniteNumber(c.trimStart) ? c.trimStart : 0,
    isFiniteNumber(c.trimEnd) ? c.trimEnd : duration,
  );
  return {
    id: c.id,
    trackId: c.trackId,
    sourceUrl: c.sourceUrl,
    sourceDurationSeconds: duration,
    startOffset: isFiniteNumber(c.startOffset) ? Math.max(0, c.startOffset) : 0,
    trimStart,
    trimEnd,
    loopEnabled: c.loopEnabled === true,
    name: typeof c.name === 'string' && c.name ? c.name : c.sourceUrl,
  };
}

/** Validate one track from untrusted JSON, or drop it (return null). */
function parseTrack(raw: unknown): MusicTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string') return null;
  return {
    id: t.id,
    name: typeof t.name === 'string' && t.name ? t.name : 'Track',
    muted: t.muted === true,
  };
}

/**
 * Read a validated arrangement out of a project's `sceneData`, or `null` when
 * none is present or it is malformed. Every field is checked by name and
 * unknown keys are dropped — `sceneData` can originate from another user's
 * exported project, so it is untrusted input (same discipline as the scene
 * audio manifest).
 *
 * Clips whose `trackId` names no surviving track are dropped, so a partially
 * corrupt file cannot resurrect orphaned clips.
 */
export function readArrangementFromSceneData(sceneData: unknown): MusicArrangement | null {
  if (!sceneData || typeof sceneData !== 'object') return null;
  const raw = (sceneData as Record<string, unknown>)[ARRANGEMENT_SCENE_DATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const tracks = Array.isArray(obj.tracks)
    ? obj.tracks.map(parseTrack).filter((t): t is MusicTrack => t !== null)
    : [];
  const trackIds = new Set(tracks.map((t) => t.id));
  const clips = Array.isArray(obj.clips)
    ? obj.clips
        .map(parseClip)
        .filter((c): c is MusicClip => c !== null && trackIds.has(c.trackId))
    : [];

  if (tracks.length === 0 && clips.length === 0) return null;

  return {
    version: isFiniteNumber(obj.version) ? obj.version : ARRANGEMENT_VERSION,
    tempoBpm: isFiniteNumber(obj.tempoBpm) ? clampFinite(obj.tempoBpm, 20, 400, DEFAULT_TEMPO_BPM) : DEFAULT_TEMPO_BPM,
    tracks,
    clips,
  };
}
