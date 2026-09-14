/**
 * Native audio clip document — the one reusable, editable description of how a
 * source audio asset is trimmed, gained, faded and looped.
 *
 * Operation coverage: `audio.FR-1.OP-02` (#9903, parent #9850, program #9773).
 *
 * WHY A DOCUMENT, NOT A MUTATED BUFFER. The source asset's bytes are never
 * touched. Every creator edit — manual (AudioInspector) or, in a follow-up
 * slice, typed AI command — is expressed as a change to this small document,
 * so trim/fade/gain/loop are lossless, reversible, and identical whether they
 * arrive by drag handle or by AI. The decoded source is rendered THROUGH the
 * document at play/export time; the file on disk is read-only.
 *
 * SAMPLE-ACCURATE. All times are stored in seconds but are snapped to the
 * source's sample grid on every edit, so a "0.25s" trim on a 48 kHz clip is
 * exactly sample 12000, and effective duration is exact to within one sample.
 *
 * VALIDATED, PURE COMMANDS. `setTrim` / `setGain` / `setFade` / `setLoop` never
 * mutate their input: they return a NEW document on success or a list of
 * field-scoped errors on failure, leaving the previous (still-playable) clip
 * intact. Undo/redo is layered on top via {@link AudioClipHistory}, which
 * mirrors the engine `HistoryStack` discipline (bounded, dirty-tracked).
 */

/** Bumped when the persisted shape changes in a non-backward-compatible way. */
export const AUDIO_CLIP_DOCUMENT_VERSION = 1 as const;

/** Gain range, in decibels, a clip may be pushed to. */
export const MIN_GAIN_DB = -60;
export const MAX_GAIN_DB = 24;

/**
 * The editable clip document. `sourceAssetId` and `sourceHash` identify the
 * immutable source; every other field is an edit expressed against it.
 */
export interface AudioClipDocument {
  version: number;
  /** Asset id of the immutable decoded source this clip reads. */
  sourceAssetId: string;
  /** Hash of the decoded source captured at import; asserted unchanged after edits. */
  sourceHash: string;
  /** Playback window start, in seconds from the source origin. */
  trimStartSec: number;
  /** Playback window end, in seconds from the source origin. */
  trimEndSec: number;
  /** Output gain applied to the whole clip, in decibels (0 = unity). */
  gainDb: number;
  /** Linear fade-in length in seconds, measured from `trimStartSec`. */
  fadeInSec: number;
  /** Linear fade-out length in seconds, ending at `trimEndSec`. */
  fadeOutSec: number;
  /** Loop region start, in seconds; always within the trim window. */
  loopStartSec: number;
  /** Loop region end, in seconds; always within the trim window. */
  loopEndSec: number;
}

/** Source facts a command needs to validate and snap an edit. */
export interface ClipBounds {
  /** Full decoded duration of the source, in seconds. */
  durationSec: number;
  /** Decoded sample rate; the grid every time snaps to. */
  sampleRate: number;
}

export interface ValidationError {
  /** The `AudioClipDocument` field the invalid value belongs to. */
  field: keyof AudioClipDocument;
  message: string;
}

export type CommandResult =
  | { ok: true; data: AudioClipDocument }
  | { ok: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// Sample-time conversion
// ---------------------------------------------------------------------------

/** Convert seconds to a whole sample index at `sampleRate` (nearest sample). */
export function secondsToSamples(sec: number, sampleRate: number): number {
  return Math.round(sec * sampleRate);
}

/** Convert a whole sample index back to seconds. */
export function samplesToSeconds(samples: number, sampleRate: number): number {
  return samples / sampleRate;
}

/**
 * Snap a time to the nearest point on the source's sample grid.
 *
 * Storing snapped seconds (rather than raw floats) is what makes trim math
 * sample-exact: two snapped times differ by an integer number of samples, so
 * their difference converts back to a whole sample count with no drift.
 */
export function snapSecondsToSample(sec: number, sampleRate: number): number {
  return samplesToSeconds(secondsToSamples(sec, sampleRate), sampleRate);
}

// ---------------------------------------------------------------------------
// Construction & source integrity
// ---------------------------------------------------------------------------

/**
 * Build the default document for a freshly imported/decoded source: the whole
 * clip, unity gain, no fades, loop spanning the full trim window.
 */
export function createAudioClipDocument(params: {
  sourceAssetId: string;
  sourceHash: string;
  durationSec: number;
  sampleRate: number;
}): AudioClipDocument {
  const end = snapSecondsToSample(Math.max(0, params.durationSec), params.sampleRate);
  return {
    version: AUDIO_CLIP_DOCUMENT_VERSION,
    sourceAssetId: params.sourceAssetId,
    sourceHash: params.sourceHash,
    trimStartSec: 0,
    trimEndSec: end,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    loopStartSec: 0,
    loopEndSec: end,
  };
}

/**
 * Deterministic 32-bit FNV-1a hash of decoded channel data, as an 8-char hex
 * string. Used to capture the source's identity at import and prove later that
 * no edit rewrote the bytes. Large buffers are sampled at a fixed stride so the
 * hash is cheap yet sensitive to any change in shape.
 */
export function hashChannelData(channels: Float32Array[]): string {
  let hash = 0x811c9dc5;
  const stride = Math.max(1, Math.floor((channels[0]?.length ?? 0) / 4096));
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += stride) {
      // Fold each float's 32-bit representation in.
      const bits = Float32Array.of(channel[i]);
      const bytes = new Uint8Array(bits.buffer);
      for (let b = 0; b < 4; b++) {
        hash ^= bytes[b];
        hash = Math.imul(hash, 0x01000193);
      }
    }
  }
  // `>>> 0` normalizes to unsigned before hex.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * True iff `doc` still points at the same immutable source bytes as `expected`.
 * A command that ever changed this would be corrupting, not editing.
 */
export function sourceUnchanged(doc: AudioClipDocument, expectedHash: string): boolean {
  return doc.sourceHash === expectedHash;
}

// ---------------------------------------------------------------------------
// Derived values (render/play/export read these)
// ---------------------------------------------------------------------------

/** Effective clip length, sample-exact, in seconds. */
export function effectiveDurationSec(doc: AudioClipDocument): number {
  return doc.trimEndSec - doc.trimStartSec;
}

/** Linear multiplier for the clip's gain in dB (0 dB → 1, +6 dB → ~2). */
export function gainLinear(doc: AudioClipDocument): number {
  return Math.pow(10, doc.gainDb / 20);
}

/**
 * The fade envelope multiplier at `tSec`, where `tSec` is measured from the
 * trim-window start (0 = `trimStartSec`). Linear ramps: 0→1 across `fadeInSec`,
 * 1→0 across `fadeOutSec` ending at the window end, and 1 in between. Times
 * outside the window return 0.
 */
export function fadeGainAt(doc: AudioClipDocument, tSec: number): number {
  const windowLen = effectiveDurationSec(doc);
  if (tSec < 0 || tSec > windowLen) return 0;

  let gain = 1;
  if (doc.fadeInSec > 0 && tSec < doc.fadeInSec) {
    gain = Math.min(gain, tSec / doc.fadeInSec);
  }
  if (doc.fadeOutSec > 0 && tSec > windowLen - doc.fadeOutSec) {
    gain = Math.min(gain, (windowLen - tSec) / doc.fadeOutSec);
  }
  return Math.max(0, gain);
}

/** Full amplitude multiplier at `tSec`: fade envelope × constant gain. */
export function amplitudeAt(doc: AudioClipDocument, tSec: number): number {
  return fadeGainAt(doc, tSec) * gainLinear(doc);
}

// ---------------------------------------------------------------------------
// Validated commands (pure — never mutate their input)
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * After a trim change, keep the fade and loop fields inside the new window.
 * This is a derived adjustment, not source mutation: shrinking the window can
 * never leave a fade longer than the clip or a loop pointing outside it.
 */
function clampDerivedToWindow(doc: AudioClipDocument, sampleRate: number): AudioClipDocument {
  const windowLen = effectiveDurationSec(doc);
  let fadeIn = Math.min(doc.fadeInSec, windowLen);
  let fadeOut = Math.min(doc.fadeOutSec, windowLen);
  if (fadeIn + fadeOut > windowLen) {
    // Split the window proportionally so both fades still fit.
    const total = fadeIn + fadeOut;
    fadeIn = snapSecondsToSample((fadeIn / total) * windowLen, sampleRate);
    fadeOut = snapSecondsToSample(windowLen - fadeIn, sampleRate);
  }
  const loopStart = Math.min(Math.max(doc.loopStartSec, doc.trimStartSec), doc.trimEndSec);
  let loopEnd = Math.min(Math.max(doc.loopEndSec, doc.trimStartSec), doc.trimEndSec);
  if (loopEnd <= loopStart) loopEnd = doc.trimEndSec;
  return { ...doc, fadeInSec: fadeIn, fadeOutSec: fadeOut, loopStartSec: loopStart, loopEndSec: loopEnd };
}

/** Set the trim window. Rejects a window that is empty, reversed or off the source. */
export function setTrim(
  doc: AudioClipDocument,
  patch: { startSec: number; endSec: number },
  bounds: ClipBounds,
): CommandResult {
  const errors: ValidationError[] = [];
  if (!isFiniteNumber(patch.startSec)) {
    errors.push({ field: 'trimStartSec', message: 'Trim start must be a finite number.' });
  }
  if (!isFiniteNumber(patch.endSec)) {
    errors.push({ field: 'trimEndSec', message: 'Trim end must be a finite number.' });
  }
  if (errors.length > 0) return { ok: false, errors };

  const start = snapSecondsToSample(patch.startSec, bounds.sampleRate);
  const end = snapSecondsToSample(patch.endSec, bounds.sampleRate);
  const durationSnapped = snapSecondsToSample(bounds.durationSec, bounds.sampleRate);

  if (start < 0) {
    errors.push({ field: 'trimStartSec', message: 'Trim start cannot be negative.' });
  }
  if (end > durationSnapped) {
    errors.push({ field: 'trimEndSec', message: 'Trim end cannot exceed the clip length.' });
  }
  if (secondsToSamples(end, bounds.sampleRate) <= secondsToSamples(start, bounds.sampleRate)) {
    errors.push({ field: 'trimEndSec', message: 'Trim end must be after trim start.' });
  }
  if (errors.length > 0) return { ok: false, errors };

  const trimmed: AudioClipDocument = { ...doc, trimStartSec: start, trimEndSec: end };
  return { ok: true, data: clampDerivedToWindow(trimmed, bounds.sampleRate) };
}

/** Set the output gain in decibels. Rejects non-finite or out-of-range values. */
export function setGain(doc: AudioClipDocument, patch: { gainDb: number }): CommandResult {
  if (!isFiniteNumber(patch.gainDb)) {
    return { ok: false, errors: [{ field: 'gainDb', message: 'Gain must be a finite number.' }] };
  }
  if (patch.gainDb < MIN_GAIN_DB || patch.gainDb > MAX_GAIN_DB) {
    return {
      ok: false,
      errors: [{ field: 'gainDb', message: `Gain must be between ${MIN_GAIN_DB} and ${MAX_GAIN_DB} dB.` }],
    };
  }
  return { ok: true, data: { ...doc, gainDb: patch.gainDb } };
}

/** Set fade-in and fade-out lengths. Rejects negatives or fades longer than the window. */
export function setFade(
  doc: AudioClipDocument,
  patch: { fadeInSec: number; fadeOutSec: number },
  bounds: ClipBounds,
): CommandResult {
  const errors: ValidationError[] = [];
  if (!isFiniteNumber(patch.fadeInSec) || patch.fadeInSec < 0) {
    errors.push({ field: 'fadeInSec', message: 'Fade in must be zero or a positive number.' });
  }
  if (!isFiniteNumber(patch.fadeOutSec) || patch.fadeOutSec < 0) {
    errors.push({ field: 'fadeOutSec', message: 'Fade out must be zero or a positive number.' });
  }
  if (errors.length > 0) return { ok: false, errors };

  const fadeIn = snapSecondsToSample(patch.fadeInSec, bounds.sampleRate);
  const fadeOut = snapSecondsToSample(patch.fadeOutSec, bounds.sampleRate);
  const windowLen = effectiveDurationSec(doc);
  if (fadeIn + fadeOut > windowLen + 1e-9) {
    errors.push({
      field: 'fadeInSec',
      message: 'Fade in and fade out together cannot exceed the trimmed clip length.',
    });
    return { ok: false, errors };
  }
  return { ok: true, data: { ...doc, fadeInSec: fadeIn, fadeOutSec: fadeOut } };
}

/** Set the loop region. Rejects a region that is empty, reversed or outside the trim window. */
export function setLoop(
  doc: AudioClipDocument,
  patch: { loopStartSec: number; loopEndSec: number },
  bounds: ClipBounds,
): CommandResult {
  const errors: ValidationError[] = [];
  if (!isFiniteNumber(patch.loopStartSec)) {
    errors.push({ field: 'loopStartSec', message: 'Loop start must be a finite number.' });
  }
  if (!isFiniteNumber(patch.loopEndSec)) {
    errors.push({ field: 'loopEndSec', message: 'Loop end must be a finite number.' });
  }
  if (errors.length > 0) return { ok: false, errors };

  const loopStart = snapSecondsToSample(patch.loopStartSec, bounds.sampleRate);
  const loopEnd = snapSecondsToSample(patch.loopEndSec, bounds.sampleRate);

  if (loopStart < doc.trimStartSec) {
    errors.push({ field: 'loopStartSec', message: 'Loop start cannot be before the trim start.' });
  }
  if (loopEnd > doc.trimEndSec) {
    errors.push({ field: 'loopEndSec', message: 'Loop end cannot be after the trim end.' });
  }
  if (secondsToSamples(loopEnd, bounds.sampleRate) <= secondsToSamples(loopStart, bounds.sampleRate)) {
    errors.push({ field: 'loopEndSec', message: 'Loop end must be after loop start.' });
  }
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, data: { ...doc, loopStartSec: loopStart, loopEndSec: loopEnd } };
}

// ---------------------------------------------------------------------------
// Undo / redo — mirrors engine HistoryStack discipline
// ---------------------------------------------------------------------------

interface ClipEdit {
  before: AudioClipDocument;
  after: AudioClipDocument;
}

/**
 * A bounded, dirty-tracked undo/redo stack for clip edits, mirroring the engine
 * `HistoryStack` (`engine/src/core/history.rs`): `push` clears redo and marks
 * dirty; `undo` moves the top edit to the redo stack and yields its `before`;
 * `redo` moves it back and yields its `after`. Every mutating call caps both
 * stacks at `maxSize` and sets `dirty`.
 *
 * Each entry is a whole-document snapshot pair, so an edit only ever restores
 * clip fields — it can never resurrect an unrelated flag, the failure mode the
 * engine's data-restore arms hit (MEMORY: feedback_undo_arm_inserts_enablement_marker).
 */
export class AudioClipHistory {
  private undoStack: ClipEdit[] = [];
  private redoStack: ClipEdit[] = [];
  private readonly maxSize: number;
  /** Set whenever the stacks change, for UI enable/disable of undo/redo. */
  dirty = false;

  constructor(maxSize = 100) {
    this.maxSize = Math.max(1, maxSize);
  }

  /** Record an edit. Clears redo (a new branch) and caps the undo stack. */
  push(before: AudioClipDocument, after: AudioClipDocument): void {
    this.undoStack.push({ before, after });
    this.redoStack = [];
    this.dirty = true;
    while (this.undoStack.length > this.maxSize) this.undoStack.shift();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Undo the most recent edit, returning the document to restore, or null. */
  undo(): AudioClipDocument | null {
    const edit = this.undoStack.pop();
    if (!edit) return null;
    this.redoStack.push(edit);
    this.dirty = true;
    while (this.redoStack.length > this.maxSize) this.redoStack.shift();
    return edit.before;
  }

  /** Redo the most recently undone edit, returning the document to restore, or null. */
  redo(): AudioClipDocument | null {
    const edit = this.redoStack.pop();
    if (!edit) return null;
    this.undoStack.push(edit);
    this.dirty = true;
    while (this.undoStack.length > this.maxSize) this.undoStack.shift();
    return edit.after;
  }
}
