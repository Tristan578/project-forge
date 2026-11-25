/**
 * Music arrangement data model (music.FR-2.OP-01 / OP-02, #9854).
 *
 * A `MusicArrangement` is the editable, persisted description of how imported
 * and generated audio material is laid out on a timeline: named tracks, and
 * clips placed on those tracks with a source reference, a timeline position
 * (`startOffset`), a trimmed source window (`trimStart` / `trimEnd`) and a loop
 * flag. It is deliberately provider-agnostic — a clip's `sourceUrl` may name an
 * imported asset, a generated asset, or a direct object URL, so the manual
 * editor and the future in-app AI path (#9855) operate on one schema.
 *
 * WHAT THIS SLICE OWNS. Track/clip arrangement, move, trim and loop points.
 * Tempo-grid editing, fades, stem mixing, note/pattern composition and the
 * selected-measure AI edit are OUT of scope here and tracked on the child
 * issue; `tempoBpm` is carried on the model (so persistence and the future grid
 * share one field) but no grid snapping is applied yet.
 *
 * All mutation helpers in this module are PURE — the Zustand store in
 * `arrangementStore.ts` composes them so the same functions can back both the
 * manual controls and the later AI command path.
 */

/** Schema version stamped into persisted arrangements, for forward migration. */
export const ARRANGEMENT_VERSION = 1 as const;

/** Default tempo when an arrangement is created without one. */
export const DEFAULT_TEMPO_BPM = 120;

/**
 * The smallest window a trimmed clip may keep, in seconds. Trimming can never
 * collapse a clip to zero (or negative) length — a boundary the manual controls
 * and the AI path must both respect, so it lives on the model, not the UI.
 */
export const MIN_CLIP_LENGTH_SECONDS = 0.05;

/** A single placed clip on a track. */
export interface MusicClip {
  id: string;
  /** The track this clip belongs to. */
  trackId: string;
  /**
   * Where the source material comes from. An imported/generated asset's name
   * (the id used by `assetRegistry` / `attachGeneratedAudio`) or a direct URL.
   * Opaque to the arrangement — it is resolved to bytes only at playback time.
   */
  sourceUrl: string;
  /** Full length of the source material in seconds (the trim ceiling). */
  sourceDurationSeconds: number;
  /** Seconds along the timeline where this clip begins. */
  startOffset: number;
  /** Seconds into the source where playback starts (>= 0). */
  trimStart: number;
  /** Seconds into the source where playback ends (<= sourceDurationSeconds). */
  trimEnd: number;
  /** When true, the trimmed window repeats to fill its scheduled duration. */
  loopEnabled: boolean;
  /** Human label, defaults to the source name. */
  name: string;
}

/** A named lane holding clips. */
export interface MusicTrack {
  id: string;
  name: string;
  muted: boolean;
}

/** The whole arrangement, persisted alongside the scene/project. */
export interface MusicArrangement {
  version: number;
  tempoBpm: number;
  tracks: MusicTrack[];
  clips: MusicClip[];
}

/** The key an arrangement is stored under inside a project's `sceneData`. */
export const ARRANGEMENT_SCENE_DATA_KEY = 'musicArrangement';

/** A fresh, empty arrangement. */
export function createEmptyArrangement(tempoBpm: number = DEFAULT_TEMPO_BPM): MusicArrangement {
  return {
    version: ARRANGEMENT_VERSION,
    tempoBpm,
    tracks: [],
    clips: [],
  };
}

/** True when the arrangement has no tracks and no clips. */
export function isArrangementEmpty(arrangement: MusicArrangement): boolean {
  return arrangement.tracks.length === 0 && arrangement.clips.length === 0;
}

/**
 * Clamp a numeric input to a finite value in `[min, max]`, falling back to
 * `fallback` when the input is not a finite number. Centralised so a `NaN`
 * from `parseFloat('')` in the UI can never reach the model (the `Number(...)`
 * / `??` gotcha class).
 */
export function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Return a trim window clamped to legal bounds for a clip of the given source
 * duration. Guarantees `0 <= start < end <= duration` and
 * `end - start >= MIN_CLIP_LENGTH_SECONDS` whenever the source is long enough.
 *
 * This is the single boundary rule for "trim beyond clip bounds": dragging a
 * handle past either edge, or crossing the two handles, resolves here rather
 * than in every caller.
 */
export function clampTrimWindow(
  sourceDurationSeconds: number,
  desiredStart: number,
  desiredEnd: number,
): { trimStart: number; trimEnd: number } {
  const duration = Number.isFinite(sourceDurationSeconds) && sourceDurationSeconds > 0
    ? sourceDurationSeconds
    : MIN_CLIP_LENGTH_SECONDS;

  let start = clampFinite(desiredStart, 0, duration, 0);
  let end = clampFinite(desiredEnd, 0, duration, duration);

  // Enforce ordering and the minimum length. Prefer to keep `start` put and
  // push `end` out; only pull `start` back when `end` has hit the ceiling.
  if (end < start + MIN_CLIP_LENGTH_SECONDS) {
    end = Math.min(duration, start + MIN_CLIP_LENGTH_SECONDS);
    if (end - start < MIN_CLIP_LENGTH_SECONDS) {
      start = Math.max(0, end - MIN_CLIP_LENGTH_SECONDS);
    }
  }
  return { trimStart: start, trimEnd: end };
}

/** The scheduled (trimmed) length of a clip, in seconds. */
export function clipLength(clip: Pick<MusicClip, 'trimStart' | 'trimEnd'>): number {
  return Math.max(0, clip.trimEnd - clip.trimStart);
}

/**
 * True when two clips on the SAME track overlap in timeline space. Clips on
 * different tracks never conflict. Overlap is permitted by the model (layering
 * is legitimate) — this is a detector the UI can surface, not a guard.
 */
export function clipsOverlap(a: MusicClip, b: MusicClip): boolean {
  if (a.trackId !== b.trackId || a.id === b.id) return false;
  const aStart = a.startOffset;
  const aEnd = a.startOffset + clipLength(a);
  const bStart = b.startOffset;
  const bEnd = b.startOffset + clipLength(b);
  return aStart < bEnd && bStart < aEnd;
}

/** Every other clip on `clip`'s track that overlaps it. */
export function overlappingClips(clip: MusicClip, all: MusicClip[]): MusicClip[] {
  return all.filter((other) => clipsOverlap(clip, other));
}
