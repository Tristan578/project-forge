/**
 * Native audio clip document — the one reusable, editable description of how a
 * source audio asset can be trimmed, gained, faded and looped.
 *
 * Operation coverage: `audio.FR-1.OP-02` (#9903, parent #9850, program #9773).
 *
 * WHY A DOCUMENT, NOT A MUTATED BUFFER. The source asset's bytes are never
 * touched. Every edit in the standalone ClipEditor prototype or, in a follow-up
 * slice, typed AI command — is expressed as a change to this small document,
 * so trim/fade/gain/loop are lossless, reversible, and identical whether they
 * arrive by drag handle or by AI. Playback/export integration is tracked by
 * #9936; these pure helpers describe the envelope without changing source bytes.
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
  /** Stored source identity hint captured at import; not proof of byte integrity. */
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

/** A rejected clip edit's field-scoped validation message. */
export interface ValidationError {
  /** The `AudioClipDocument` field the invalid value belongs to. */
  field: keyof AudioClipDocument;
  message: string;
}

/** A validated replacement document, or errors that leave the prior document intact. */
export type CommandResult =
  | { ok: true; data: AudioClipDocument }
  | { ok: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// Sample-time conversion
// ---------------------------------------------------------------------------

/**
 * Convert seconds to the nearest whole sample index.
 * @param sec Time in seconds.
 * @param sampleRate Source sample rate in samples per second.
 * @returns Rounded sample index.
 */
export function secondsToSamples(sec: number, sampleRate: number): number {
  return Math.round(sec * sampleRate);
}

/**
 * Convert a sample index back to seconds.
 * @param samples Sample index.
 * @param sampleRate Source sample rate in samples per second.
 * @returns Time in seconds.
 */
export function samplesToSeconds(samples: number, sampleRate: number): number {
  return samples / sampleRate;
}

/**
 * Snap a time to the nearest point on the source's sample grid.
 *
 * Storing snapped seconds (rather than raw floats) is what makes trim math
 * sample-exact: two snapped times differ by an integer number of samples, so
 * their difference converts back to a whole sample count with no drift.
 * @param sec Time in seconds to snap.
 * @param sampleRate Source sample rate in samples per second.
 * @returns Time on the nearest sample boundary.
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
 * @param params Source identity and decoded duration/sample rate.
 * @returns A new document spanning the source duration.
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
 * string. Large buffers are sampled at a fixed stride, making this an identity
 * hint. Unsampled changes and hash collisions can be missed; this is not a
 * byte-integrity check or a cryptographic digest.
 * @param channels Decoded channel sample arrays.
 * @returns A sampled 32-bit identity hint encoded as eight hexadecimal digits.
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
 * Compare the document's stored source identity hint with an expected hint.
 * This does not read or compare audio bytes and cannot prove byte integrity.
 * @param doc Clip document whose stored identity is checked.
 * @param expectedHash Previously stored source identity hint.
 * @returns Whether the two stored strings match.
 */
export function sourceUnchanged(doc: AudioClipDocument, expectedHash: string): boolean {
  return doc.sourceHash === expectedHash;
}

// ---------------------------------------------------------------------------
// Derived values (render/play/export read these)
// ---------------------------------------------------------------------------

/**
 * Effective clip length in seconds.
 * @param doc Validated clip document.
 * @returns Trim end minus trim start.
 */
export function effectiveDurationSec(doc: AudioClipDocument): number {
  return doc.trimEndSec - doc.trimStartSec;
}

/**
 * Convert clip gain in dB to a linear multiplier (0 dB → 1).
 * @param doc Clip document containing the gain.
 * @returns Linear amplitude multiplier.
 */
export function gainLinear(doc: AudioClipDocument): number {
  return Math.pow(10, doc.gainDb / 20);
}

/**
 * The fade envelope multiplier at `tSec`, where `tSec` is measured from the
 * trim-window start (0 = `trimStartSec`). Linear ramps: 0→1 across `fadeInSec`,
 * 1→0 across `fadeOutSec` ending at the window end, and 1 in between. Times
 * outside the window return 0.
 * @param doc Validated clip document containing fade lengths.
 * @param tSec Time relative to the trim start, in seconds.
 * @returns Fade multiplier between zero and one.
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

/**
 * Combine the fade envelope and constant gain.
 * @param doc Validated clip document.
 * @param tSec Time relative to the trim start, in seconds.
 * @returns Full amplitude multiplier at that time.
 */
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
  let loopStart = Math.min(Math.max(doc.loopStartSec, doc.trimStartSec), doc.trimEndSec);
  let loopEnd = Math.min(Math.max(doc.loopEndSec, doc.trimStartSec), doc.trimEndSec);
  if (loopEnd <= loopStart) {
    loopStart = doc.trimStartSec;
    loopEnd = doc.trimEndSec;
  }
  return { ...doc, fadeInSec: fadeIn, fadeOutSec: fadeOut, loopStartSec: loopStart, loopEndSec: loopEnd };
}

/**
 * Set the trim window, rejecting empty, reversed or off-source windows.
 * @param doc Current clip document, left unchanged.
 * @param patch Requested start and end in seconds.
 * @param bounds Decoded source duration and sample rate.
 * @returns A new document with adjusted fades/loop, or field validation errors.
 */
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

/**
 * Set output gain, rejecting non-finite or out-of-range values.
 * @param doc Current clip document, left unchanged.
 * @param patch Requested gain in decibels.
 * @returns A new document or field validation errors.
 */
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

/**
 * Set fade lengths, rejecting negatives or a combined length beyond the window.
 * @param doc Current clip document, left unchanged.
 * @param patch Requested fade lengths in seconds.
 * @param bounds Decoded source duration and sample rate.
 * @returns A new document with snapped fades, or field validation errors.
 */
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

/**
 * Set a loop region contained within the trim window.
 * @param doc Current clip document, left unchanged.
 * @param patch Requested loop boundaries in seconds.
 * @param bounds Decoded source duration and sample rate.
 * @returns A new document with a nonempty snapped loop, or validation errors.
 */
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

  /** @param maxSize Maximum number of undo or redo entries retained. */
  constructor(maxSize = 100) {
    this.maxSize = Math.max(1, maxSize);
  }

  /**
   * Record an edit, clearing redo and capping the undo stack.
   * @param before Document before the edit.
   * @param after Document after the edit.
   * @returns Nothing; updates the bounded history.
   */
  push(before: AudioClipDocument, after: AudioClipDocument): void {
    this.undoStack.push({ before, after });
    this.redoStack = [];
    this.dirty = true;
    while (this.undoStack.length > this.maxSize) this.undoStack.shift();
  }

  /** @returns Whether an earlier document can be restored. */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** @returns Whether an undone edit can be reapplied. */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** @returns The document before the most recent edit, or null if undo is unavailable. */
  undo(): AudioClipDocument | null {
    const edit = this.undoStack.pop();
    if (!edit) return null;
    this.redoStack.push(edit);
    this.dirty = true;
    while (this.redoStack.length > this.maxSize) this.redoStack.shift();
    return edit.before;
  }

  /** @returns The document after the most recently undone edit, or null if redo is unavailable. */
  redo(): AudioClipDocument | null {
    const edit = this.redoStack.pop();
    if (!edit) return null;
    this.undoStack.push(edit);
    this.dirty = true;
    while (this.undoStack.length > this.maxSize) this.undoStack.shift();
    return edit.after;
  }
}
