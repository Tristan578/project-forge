/**
 * Scene-scoped music arrangement authoring state (#9854).
 *
 * The editor explicitly overlays this metadata on exported scene JSON and
 * hydrates it on scene transitions. Rust ignores this key during loading and
 * does not retain it for a subsequent engine export.
 *
 * User edits have bounded undo/redo history. editRevision changes only for
 * accepted edits, undo, and redo, allowing the editor to schedule persistence
 * without importing editorStore here. Hydration/reset starts a new history.
 */
import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import {
  ARRANGEMENT_VERSION,
  ARRANGEMENT_SCENE_DATA_KEY,
  ARRANGEMENT_HISTORY_LIMIT,
  DEFAULT_TEMPO_BPM,
  MAX_ARRANGEMENT_TRACKS,
  MAX_ARRANGEMENT_CLIPS,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_TIMELINE_OFFSET_SECONDS,
  MAX_ARRANGEMENT_ID_LENGTH,
  MAX_ARRANGEMENT_NAME_LENGTH,
  MAX_AUDIO_SOURCE_LENGTH,
  clampFinite,
  clampTrimWindow,
  createEmptyArrangement,
  isArrangementEmpty,
  type MusicArrangement,
  type MusicClip,
  type MusicTrack,
} from './arrangementTypes';

let idCounter = 0;
function makeId(prefix: string, existing: readonly { id: string }[]): string {
  const ids = new Set(existing.map((item) => item.id));
  let id: string;
  do {
    idCounter += 1;
    id = `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
  } while (ids.has(id));
  return id;
}

/** Input for a clip on an existing track. Invalid sources are rejected. */
export interface AddClipInput {
  trackId: string;
  sourceUrl: string;
  sourceDurationSeconds: number;
  startOffset?: number;
  name?: string;
}

/** Source metadata from a generated or imported audio asset. */
export interface AddGeneratedClipInput {
  sourceUrl: string;
  durationSeconds: number;
  /** Existing track ID; omit to create a Music track in the same undo step. */
  trackId?: string;
  name?: string;
}

export interface ArrangementSlice {
  arrangement: MusicArrangement;
  /** Increments only on actual user edits, undo, and redo; never on hydration. */
  editRevision: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Add a track, or return null when the track limit has been reached. */
  addTrack: (name?: string) => string | null;
  /** Remove a track and its clips as one undoable edit. */
  deleteTrack: (trackId: string) => void;
  renameTrack: (trackId: string, name: string) => void;
  setTrackMuted: (trackId: string, muted: boolean) => void;
  /** Return null for an unknown track, invalid source, or collection limit. */
  addClip: (input: AddClipInput) => string | null;
  moveClip: (clipId: string, startOffset: number, trackId?: string) => void;
  /** Clamp the authored trim window within the source duration. */
  trimClip: (clipId: string, trim: { trimStart?: number; trimEnd?: number }) => void;
  /** Store loop intent and an optional trim window; this does not play audio. */
  setLoopPoints: (
    clipId: string,
    loop: { loopEnabled: boolean; trimStart?: number; trimEnd?: number },
  ) => void;
  deleteClip: (clipId: string) => void;
  /** Add a source and optional new track atomically; rejection changes nothing. */
  addGeneratedClip: (input: AddGeneratedClipInput) => string | null;
  setTempoBpm: (bpm: number) => void;
  /** Undoable user action. Scene transitions should use reset/hydrate instead. */
  clearArrangement: () => void;
  undo: () => void;
  redo: () => void;
  /** Detached persistence snapshot; null when no authored metadata remains. */
  serialize: () => MusicArrangement | null;
  /** Validate and adopt scene metadata, clearing history without marking dirty. */
  hydrate: (arrangement: MusicArrangement | null) => void;
  /** Start an empty scene and clear history without marking dirty. */
  reset: () => void;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validDuration(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0 && value <= MAX_AUDIO_DURATION_SECONDS;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
    && value.length <= MAX_ARRANGEMENT_ID_LENGTH && value.trim() === value;
}

function validSource(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && value.length <= MAX_AUDIO_SOURCE_LENGTH;
}

function label(value: unknown, fallback: string): string {
  return (typeof value === 'string' && value.trim() ? value.trim() : fallback)
    .slice(0, MAX_ARRANGEMENT_NAME_LENGTH);
}

function cloneArrangement(arrangement: MusicArrangement): MusicArrangement {
  return {
    ...arrangement,
    tracks: arrangement.tracks.map((track) => ({ ...track })),
    clips: arrangement.clips.map((clip) => ({ ...clip })),
  };
}

/** Preserve object identity when the requested clip edit changes no fields. */
function mapClip(
  arrangement: MusicArrangement,
  clipId: string,
  update: (clip: MusicClip) => MusicClip,
): MusicArrangement {
  const index = arrangement.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return arrangement;
  const previous = arrangement.clips[index];
  const next = update(previous);
  if (next.trackId === previous.trackId && next.startOffset === previous.startOffset
    && next.trimStart === previous.trimStart && next.trimEnd === previous.trimEnd
    && next.loopEnabled === previous.loopEnabled) return arrangement;
  const clips = [...arrangement.clips];
  clips[index] = next;
  return { ...arrangement, clips };
}

function newClip(input: AddClipInput, existing: readonly MusicClip[]): MusicClip | null {
  if (!validSource(input.sourceUrl) || !validDuration(input.sourceDurationSeconds)) return null;
  return {
    id: makeId('clip', existing),
    trackId: input.trackId,
    sourceUrl: input.sourceUrl,
    sourceDurationSeconds: input.sourceDurationSeconds,
    startOffset: clampFinite(input.startOffset, 0, MAX_TIMELINE_OFFSET_SECONDS, 0),
    ...clampTrimWindow(input.sourceDurationSeconds, 0, input.sourceDurationSeconds),
    loopEnabled: false,
    name: label(input.name, input.sourceUrl),
  };
}

export const createArrangementSlice: StateCreator<ArrangementSlice, [], [], ArrangementSlice> = (set, get) => {
  let past: MusicArrangement[] = [];
  let future: MusicArrangement[] = [];

  const commit = (next: MusicArrangement) => {
    const current = get();
    if (next === current.arrangement) return;
    past = [...past, current.arrangement].slice(-ARRANGEMENT_HISTORY_LIMIT);
    future = [];
    set({ arrangement: next, canUndo: true, canRedo: false, editRevision: current.editRevision + 1 });
  };
  const hydrate = (value: MusicArrangement | null) => {
    past = [];
    future = [];
    set({
      arrangement: parseArrangement(value) ?? createEmptyArrangement(),
      canUndo: false,
      canRedo: false,
    });
  };

  return {
    arrangement: createEmptyArrangement(),
    editRevision: 0,
    canUndo: false,
    canRedo: false,
    addTrack: (name) => {
      const current = get().arrangement;
      if (current.tracks.length >= MAX_ARRANGEMENT_TRACKS) return null;
      const track = {
        id: makeId('track', current.tracks),
        name: label(name, `Track ${current.tracks.length + 1}`),
        muted: false,
      };
      commit({ ...current, tracks: [...current.tracks, track] });
      return track.id;
    },
    deleteTrack: (trackId) => {
      const current = get().arrangement;
      if (!current.tracks.some((track) => track.id === trackId)) return;
      commit({
        ...current,
        tracks: current.tracks.filter((track) => track.id !== trackId),
        clips: current.clips.filter((clip) => clip.trackId !== trackId),
      });
    },
    renameTrack: (trackId, name) => {
      const current = get().arrangement;
      const trimmed = label(name, '');
      if (!trimmed || !current.tracks.some((track) => track.id === trackId && track.name !== trimmed)) return;
      commit({ ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, name: trimmed } : track) });
    },
    setTrackMuted: (trackId, muted) => {
      const current = get().arrangement;
      if (typeof muted !== 'boolean'
        || !current.tracks.some((track) => track.id === trackId && track.muted !== muted)) return;
      commit({ ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, muted } : track) });
    },
    addClip: (input) => {
      const current = get().arrangement;
      if (current.clips.length >= MAX_ARRANGEMENT_CLIPS
        || !current.tracks.some((track) => track.id === input.trackId)) return null;
      const clip = newClip(input, current.clips);
      if (!clip) return null;
      commit({ ...current, clips: [...current.clips, clip] });
      return clip.id;
    },
    moveClip: (clipId, startOffset, trackId) => {
      const current = get().arrangement;
      const targetValid = trackId !== undefined && current.tracks.some((track) => track.id === trackId);
      commit(mapClip(current, clipId, (clip) => ({
        ...clip,
        startOffset: clampFinite(startOffset, 0, MAX_TIMELINE_OFFSET_SECONDS, clip.startOffset),
        trackId: targetValid ? trackId : clip.trackId,
      })));
    },
    trimClip: (clipId, trim) => {
      commit(mapClip(get().arrangement, clipId, (clip) => ({
        ...clip,
        ...clampTrimWindow(clip.sourceDurationSeconds, trim.trimStart ?? clip.trimStart, trim.trimEnd ?? clip.trimEnd),
      })));
    },
    setLoopPoints: (clipId, loop) => {
      if (typeof loop.loopEnabled !== 'boolean') return;
      commit(mapClip(get().arrangement, clipId, (clip) => ({
        ...clip,
        ...clampTrimWindow(clip.sourceDurationSeconds, loop.trimStart ?? clip.trimStart, loop.trimEnd ?? clip.trimEnd),
        loopEnabled: loop.loopEnabled,
      })));
    },
    deleteClip: (clipId) => {
      const current = get().arrangement;
      if (!current.clips.some((clip) => clip.id === clipId)) return;
      commit({ ...current, clips: current.clips.filter((clip) => clip.id !== clipId) });
    },
    addGeneratedClip: (input) => {
      const current = get().arrangement;
      if (!validSource(input.sourceUrl) || !validDuration(input.durationSeconds)
        || current.clips.length >= MAX_ARRANGEMENT_CLIPS) return null;
      let track = input.trackId === undefined ? undefined : current.tracks.find((item) => item.id === input.trackId);
      if (input.trackId !== undefined && !track) return null;
      if (!track && current.tracks.length >= MAX_ARRANGEMENT_TRACKS) return null;
      const needsTrack = !track;
      track ??= { id: makeId('track', current.tracks), name: 'Music', muted: false };
      const clip = newClip({
        trackId: track.id,
        sourceUrl: input.sourceUrl,
        sourceDurationSeconds: input.durationSeconds,
        name: input.name,
      }, current.clips);
      if (!clip) return null;
      commit({
        ...current,
        tracks: needsTrack ? [...current.tracks, track] : current.tracks,
        clips: [...current.clips, clip],
      });
      return clip.id;
    },
    setTempoBpm: (bpm) => {
      const current = get().arrangement;
      const tempoBpm = clampFinite(bpm, 20, 400, current.tempoBpm);
      if (tempoBpm !== current.tempoBpm) commit({ ...current, tempoBpm });
    },
    clearArrangement: () => {
      if (!isArrangementEmpty(get().arrangement)) commit(createEmptyArrangement());
    },
    undo: () => {
      const previous = past.pop();
      if (!previous) return;
      const current = get();
      future.push(current.arrangement);
      set({ arrangement: previous, canUndo: past.length > 0, canRedo: true, editRevision: current.editRevision + 1 });
    },
    redo: () => {
      const next = future.pop();
      if (!next) return;
      const current = get();
      past.push(current.arrangement);
      set({ arrangement: next, canUndo: true, canRedo: future.length > 0, editRevision: current.editRevision + 1 });
    },
    serialize: () => isArrangementEmpty(get().arrangement) ? null : cloneArrangement(get().arrangement),
    hydrate,
    reset: () => hydrate(null),
  };
};

/** The editor's arrangement store; editor lifecycle code owns scene adoption. */
export const useMusicArrangementStore = create<ArrangementSlice>()(createArrangementSlice);

/**
 * Overlay a detached arrangement snapshot on scene JSON. This must be applied
 * after engine export because Rust does not preserve the metadata itself.
 * Null/default-empty arrangements remove a previously persisted value.
 */
export function applyArrangementToSceneData(
  sceneData: Record<string, unknown>,
  arrangement: MusicArrangement | null,
): Record<string, unknown> {
  const next = { ...sceneData };
  if (!arrangement || isArrangementEmpty(arrangement)) delete next[ARRANGEMENT_SCENE_DATA_KEY];
  else next[ARRANGEMENT_SCENE_DATA_KEY] = cloneArrangement(arrangement);
  return next;
}

function parseTrack(raw: unknown): MusicTrack | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const track = raw as Record<string, unknown>;
  if (!validId(track.id)) return null;
  return { id: track.id, name: label(track.name, 'Track'), muted: track.muted === true };
}

function parseClip(raw: unknown): MusicClip | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clip = raw as Record<string, unknown>;
  if (!validId(clip.id) || !validId(clip.trackId) || !validSource(clip.sourceUrl)
    || !validDuration(clip.sourceDurationSeconds)) return null;
  return {
    id: clip.id,
    trackId: clip.trackId,
    sourceUrl: clip.sourceUrl,
    sourceDurationSeconds: clip.sourceDurationSeconds,
    startOffset: clampFinite(clip.startOffset, 0, MAX_TIMELINE_OFFSET_SECONDS, 0),
    ...clampTrimWindow(
      clip.sourceDurationSeconds,
      isFiniteNumber(clip.trimStart) ? clip.trimStart : 0,
      isFiniteNumber(clip.trimEnd) ? clip.trimEnd : clip.sourceDurationSeconds,
    ),
    loopEnabled: clip.loopEnabled === true,
    name: label(clip.name, clip.sourceUrl),
  };
}

/** Validate untrusted metadata before allocating or adopting bounded collections. */
function parseArrangement(raw: unknown): MusicArrangement | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== undefined && obj.version !== ARRANGEMENT_VERSION) return null;
  if (!Array.isArray(obj.tracks) || !Array.isArray(obj.clips)
    || obj.tracks.length > MAX_ARRANGEMENT_TRACKS || obj.clips.length > MAX_ARRANGEMENT_CLIPS) return null;
  const tracks: MusicTrack[] = [];
  const trackIds = new Set<string>();
  for (const rawTrack of obj.tracks) {
    const track = parseTrack(rawTrack);
    if (!track || trackIds.has(track.id)) continue;
    tracks.push(track);
    trackIds.add(track.id);
  }
  const clips: MusicClip[] = [];
  const clipIds = new Set<string>();
  for (const rawClip of obj.clips) {
    const clip = parseClip(rawClip);
    if (!clip || !trackIds.has(clip.trackId) || clipIds.has(clip.id)) continue;
    clips.push(clip);
    clipIds.add(clip.id);
  }
  const arrangement = {
    version: ARRANGEMENT_VERSION,
    tempoBpm: clampFinite(obj.tempoBpm, 20, 400, DEFAULT_TEMPO_BPM),
    tracks,
    clips,
  };
  return isArrangementEmpty(arrangement) ? null : arrangement;
}

/**
 * Read bounded, current-version metadata, dropping invalid/duplicate entries
 * and orphaned clips. Unsupported schemas or oversized collections are rejected
 * as a whole. No untrusted objects are shared with the mutable editor state.
 */
export function readArrangementFromSceneData(sceneData: unknown): MusicArrangement | null {
  if (!sceneData || typeof sceneData !== 'object' || Array.isArray(sceneData)) return null;
  return parseArrangement((sceneData as Record<string, unknown>)[ARRANGEMENT_SCENE_DATA_KEY]);
}
