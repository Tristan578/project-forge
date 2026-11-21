/**
 * Persisted music arrangement authoring metadata (#9854).
 *
 * Tracks and clips describe source references, timeline offsets, trim windows,
 * and loop/mute intent. This slice does not schedule playback or export audio;
 * tempo grids, mixing, composition, and AI editing remain future work.
 */

/** Schema version stamped into persisted arrangements. */
export const ARRANGEMENT_VERSION = 1 as const;
export const DEFAULT_TEMPO_BPM = 120;
export const MIN_CLIP_LENGTH_SECONDS = 0.05;

/** Bounds keep imported documents and their editable history manageable. */
export const MAX_ARRANGEMENT_TRACKS = 64;
export const MAX_ARRANGEMENT_CLIPS = 2048;
export const MAX_AUDIO_DURATION_SECONDS = 86400;
export const MAX_TIMELINE_OFFSET_SECONDS = 86400;
export const ARRANGEMENT_HISTORY_LIMIT = 50;
export const MAX_ARRANGEMENT_ID_LENGTH = 128;
export const MAX_ARRANGEMENT_NAME_LENGTH = 256;
export const MAX_AUDIO_SOURCE_LENGTH = 2048;

/** A placed clip. Times are seconds; source duration must be positive and finite. */
export interface MusicClip {
  id: string;
  trackId: string;
  /** Persisted audio asset reference; this metadata does not fetch or play it. */
  sourceUrl: string;
  /** Full source duration, at most MAX_AUDIO_DURATION_SECONDS. */
  sourceDurationSeconds: number;
  /** Nonnegative timeline position, at most MAX_TIMELINE_OFFSET_SECONDS. */
  startOffset: number;
  /** Start of the authored source window, inclusive. */
  trimStart: number;
  /** End of the authored source window, no later than the source duration. */
  trimEnd: number;
  /** Loop intent for a future playback scheduler; no playback is applied here. */
  loopEnabled: boolean;
  name: string;
}

/** A named lane holding clips; mute is stored intent until playback exists. */
export interface MusicTrack {
  id: string;
  name: string;
  muted: boolean;
}

/** The arrangement stored with one scene. */
export interface MusicArrangement {
  version: number;
  tempoBpm: number;
  tracks: MusicTrack[];
  clips: MusicClip[];
}

export const ARRANGEMENT_SCENE_DATA_KEY = 'musicArrangement';

/** A fresh arrangement with a finite tempo in the supported metadata range. */
export function createEmptyArrangement(tempoBpm: number = DEFAULT_TEMPO_BPM): MusicArrangement {
  return {
    version: ARRANGEMENT_VERSION,
    tempoBpm: clampFinite(tempoBpm, 20, 400, DEFAULT_TEMPO_BPM),
    tracks: [],
    clips: [],
  };
}

/** True when no authored tracks, clips, or nondefault tempo need persistence. */
export function isArrangementEmpty(arrangement: MusicArrangement): boolean {
  return arrangement.tracks.length === 0 && arrangement.clips.length === 0
    && arrangement.tempoBpm === DEFAULT_TEMPO_BPM;
}

/** Clamp a numeric input, using fallback for nonfinite values. */
export function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Clamp a trim window within a positive, finite source duration. Clips shorter
 * than MIN_CLIP_LENGTH_SECONDS retain the entire source. Invalid standalone
 * helper inputs use the minimum duration; store/import boundaries reject those
 * sources before they can become clips.
 */
export function clampTrimWindow(
  sourceDurationSeconds: number,
  desiredStart: number,
  desiredEnd: number,
): { trimStart: number; trimEnd: number } {
  const duration = Number.isFinite(sourceDurationSeconds) && sourceDurationSeconds > 0
    ? Math.min(sourceDurationSeconds, MAX_AUDIO_DURATION_SECONDS)
    : MIN_CLIP_LENGTH_SECONDS;
  const minimumLength = Math.min(duration, MIN_CLIP_LENGTH_SECONDS);
  let start = clampFinite(desiredStart, 0, duration, 0);
  let end = clampFinite(desiredEnd, 0, duration, duration);
  if (end < start + minimumLength) {
    end = Math.min(duration, start + minimumLength);
    if (end - start < minimumLength) start = Math.max(0, end - minimumLength);
  }
  return { trimStart: start, trimEnd: end };
}

/** Authored source-window length; loop intent does not extend this interval. */
export function clipLength(clip: Pick<MusicClip, 'trimStart' | 'trimEnd'>): number {
  return Math.max(0, clip.trimEnd - clip.trimStart);
}

/** True for positive-length, intersecting windows on the same track. */
export function clipsOverlap(a: MusicClip, b: MusicClip): boolean {
  if (a.trackId !== b.trackId || a.id === b.id) return false;
  const aLength = clipLength(a);
  const bLength = clipLength(b);
  return aLength > 0 && bLength > 0
    && a.startOffset < b.startOffset + bLength
    && b.startOffset < a.startOffset + aLength;
}

/** Every other clip whose authored window overlaps this clip. */
export function overlappingClips(clip: MusicClip, all: MusicClip[]): MusicClip[] {
  return all.filter((other) => clipsOverlap(clip, other));
}

/**
 * IDs of all clips with overlapping authored windows, grouped by track in
 * O(n log n) time. A sorted sweep only needs the prior interval with the furthest
 * end: every intersecting interval is marked as it joins that interval's group.
 * Map keys safely support arbitrary persisted track IDs such as "__proto__".
 */
export function overlappingClipIds(clips: readonly MusicClip[]): Set<string> {
  const tracks = new Map<string, MusicClip[]>();
  for (const clip of clips) {
    if (clipLength(clip) <= 0) continue;
    const track = tracks.get(clip.trackId);
    if (track) track.push(clip);
    else tracks.set(clip.trackId, [clip]);
  }
  const overlapping = new Set<string>();
  for (const track of tracks.values()) {
    track.sort((a, b) => a.startOffset - b.startOffset);
    let furthest: MusicClip | undefined;
    let furthestEnd = -Infinity;
    for (const clip of track) {
      const end = clip.startOffset + clipLength(clip);
      if (furthest && clip.startOffset < furthestEnd) {
        overlapping.add(furthest.id);
        overlapping.add(clip.id);
      }
      if (end > furthestEnd) {
        furthest = clip;
        furthestEnd = end;
      }
    }
  }
  return overlapping;
}
