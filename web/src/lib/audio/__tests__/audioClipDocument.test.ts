/**
 * @vitest-environment node
 *
 * Operation `audio.FR-1.OP-02` (#9903): native clip document with trim, fades,
 * gain and loop bounds, sample-accurate, reversible, source-preserving.
 *
 * The three acceptance scenarios from the issue are each covered below:
 *  - "Manual and AI success": sample-accurate 0.25–1.75s trim + 0.1s fades on a
 *    2s/48 kHz source; effective length 1.5s within one sample; source hash
 *    unchanged.
 *  - "Negative case": trim end <= start is rejected with the invalid field and
 *    the previous clip is left intact.
 *  - "Boundary and recovery": after a later gain-only edit, undo restores the
 *    prior gain and leaves trim/fade/loop and the source bytes untouched.
 */
import { describe, it, expect } from 'vitest';
import {
  AUDIO_CLIP_DOCUMENT_VERSION,
  AudioClipHistory,
  amplitudeAt,
  createAudioClipDocument,
  effectiveDurationSec,
  fadeGainAt,
  gainLinear,
  hashChannelData,
  secondsToSamples,
  setFade,
  setGain,
  setLoop,
  setTrim,
  snapSecondsToSample,
  sourceUnchanged,
  type AudioClipDocument,
  type ClipBounds,
} from '../audioClipDocument';

const SAMPLE_RATE = 48000;
const BOUNDS: ClipBounds = { durationSec: 2, sampleRate: SAMPLE_RATE };

/** A synthetic 2-second 48 kHz mono buffer (a 440 Hz sine — deterministic). */
function synthSource(): Float32Array {
  const frames = 2 * SAMPLE_RATE;
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    data[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
  }
  return data;
}

function freshDoc(hash: string): AudioClipDocument {
  return createAudioClipDocument({
    sourceAssetId: 'asset-wav',
    sourceHash: hash,
    durationSec: 2,
    sampleRate: SAMPLE_RATE,
  });
}

function ok(result: ReturnType<typeof setTrim>): AudioClipDocument {
  if (!result.ok) throw new Error(`expected ok, got errors: ${JSON.stringify(result.errors)}`);
  return result.data;
}

describe('audio.FR-1.OP-02 — sample-time conversion', () => {
  it('rounds seconds to the nearest whole sample and back', () => {
    expect(secondsToSamples(0.25, SAMPLE_RATE)).toBe(12000);
    expect(secondsToSamples(1.75, SAMPLE_RATE)).toBe(84000);
    // A time between samples snaps to the nearest grid point.
    const snapped = snapSecondsToSample(0.2500052, SAMPLE_RATE);
    expect(secondsToSamples(snapped, SAMPLE_RATE)).toBe(12000);
  });
});

describe('audio.FR-1.OP-02 — construction', () => {
  it('defaults to the whole clip, unity gain, no fades, full-window loop', () => {
    const doc = freshDoc('deadbeef');
    expect(doc.version).toBe(AUDIO_CLIP_DOCUMENT_VERSION);
    expect(doc.trimStartSec).toBe(0);
    expect(doc.trimEndSec).toBe(2);
    expect(doc.gainDb).toBe(0);
    expect(doc.fadeInSec).toBe(0);
    expect(doc.fadeOutSec).toBe(0);
    expect(doc.loopStartSec).toBe(0);
    expect(doc.loopEndSec).toBe(2);
    expect(gainLinear(doc)).toBeCloseTo(1, 10);
  });
});

describe('audio.FR-1.OP-02 — Scenario: Manual and AI success', () => {
  it('trims to 0.25–1.75s sample-accurately, giving a 1.5s clip within one sample', () => {
    const source = synthSource();
    const hash = hashChannelData([source]);
    const doc = freshDoc(hash);

    const trimmed = ok(setTrim(doc, { startSec: 0.25, endSec: 1.75 }, BOUNDS));

    // Effective length is exact to within one sample.
    const oneSample = 1 / SAMPLE_RATE;
    expect(Math.abs(effectiveDurationSec(trimmed) - 1.5)).toBeLessThanOrEqual(oneSample);
    expect(secondsToSamples(trimmed.trimStartSec, SAMPLE_RATE)).toBe(12000);
    expect(secondsToSamples(trimmed.trimEndSec, SAMPLE_RATE)).toBe(84000);
    // Source bytes were never touched.
    expect(sourceUnchanged(trimmed, hash)).toBe(true);
    expect(hashChannelData([source])).toBe(hash);
  });

  it('applies 0.1s fades whose envelope ramps 0→1 and 1→0 at the edges', () => {
    const doc = ok(setTrim(freshDoc('h'), { startSec: 0.25, endSec: 1.75 }, BOUNDS));
    const faded = ok(setFade(doc, { fadeInSec: 0.1, fadeOutSec: 0.1 }, BOUNDS));
    const windowLen = effectiveDurationSec(faded); // 1.5s

    // Fade-in: silent at the very start, unity by the fade-in point, linear halfway.
    expect(fadeGainAt(faded, 0)).toBeCloseTo(0, 6);
    expect(fadeGainAt(faded, 0.05)).toBeCloseTo(0.5, 4);
    expect(fadeGainAt(faded, 0.1)).toBeCloseTo(1, 6);
    // Sustain in the middle.
    expect(fadeGainAt(faded, windowLen / 2)).toBeCloseTo(1, 6);
    // Fade-out: unity at the fade-out point, silent at the end, linear halfway.
    expect(fadeGainAt(faded, windowLen - 0.1)).toBeCloseTo(1, 6);
    expect(fadeGainAt(faded, windowLen - 0.05)).toBeCloseTo(0.5, 4);
    expect(fadeGainAt(faded, windowLen)).toBeCloseTo(0, 6);
  });

  it('folds constant gain into the amplitude envelope', () => {
    const doc = ok(setGain(freshDoc('h'), { gainDb: 6.0206 })); // ~2x linear
    expect(gainLinear(doc)).toBeCloseTo(2, 3);
    // No fades, so amplitude in the body is exactly the linear gain.
    expect(amplitudeAt(doc, 1)).toBeCloseTo(2, 3);
  });

  it('reaches the same document by manual value and by AI-supplied value (parity)', () => {
    // The manual control and the (follow-up) AI command call the SAME pure
    // function with the same arguments, so their results are identical.
    const base = freshDoc('h');
    const manual = ok(setTrim(base, { startSec: 0.25, endSec: 1.75 }, BOUNDS));
    const ai = ok(setTrim(base, { startSec: 0.25, endSec: 1.75 }, BOUNDS));
    expect(ai).toEqual(manual);
  });
});

describe('audio.FR-1.OP-02 — Scenario: Negative case', () => {
  it('rejects trim end <= start, naming the field and leaving the prior clip intact', () => {
    const prior = ok(setGain(freshDoc('h'), { gainDb: 3 }));
    const result = setTrim(prior, { startSec: 1.0, endSec: 1.0 }, BOUNDS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.some((e) => e.field === 'trimEndSec')).toBe(true);
    // The previous clip is untouched and still playable.
    expect(prior.gainDb).toBe(3);
    expect(prior.trimStartSec).toBe(0);
    expect(prior.trimEndSec).toBe(2);
  });

  it('rejects a trim window that runs past the source length', () => {
    const result = setTrim(freshDoc('h'), { startSec: 0, endSec: 3 }, BOUNDS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0].field).toBe('trimEndSec');
  });

  it('rejects gain outside the allowed decibel range', () => {
    expect(setGain(freshDoc('h'), { gainDb: 99 }).ok).toBe(false);
    expect(setGain(freshDoc('h'), { gainDb: -120 }).ok).toBe(false);
    expect(setGain(freshDoc('h'), { gainDb: Number.NaN }).ok).toBe(false);
  });

  it('rejects fades longer than the trimmed clip', () => {
    const doc = ok(setTrim(freshDoc('h'), { startSec: 0, endSec: 0.5 }, BOUNDS));
    const result = setFade(doc, { fadeInSec: 0.4, fadeOutSec: 0.4 }, BOUNDS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0].field).toBe('fadeInSec');
  });

  it('rejects a loop region outside the trim window', () => {
    const doc = ok(setTrim(freshDoc('h'), { startSec: 0.5, endSec: 1.5 }, BOUNDS));
    expect(setLoop(doc, { loopStartSec: 0.2, loopEndSec: 1.0 }, BOUNDS).ok).toBe(false);
    expect(setLoop(doc, { loopStartSec: 0.6, loopEndSec: 2.0 }, BOUNDS).ok).toBe(false);
    expect(setLoop(doc, { loopStartSec: 1.0, loopEndSec: 0.9 }, BOUNDS).ok).toBe(false);
  });
});

describe('audio.FR-1.OP-02 — Scenario: Boundary and recovery', () => {
  it('undo restores the prior gain and leaves trim/fade/loop and source bytes untouched', () => {
    const source = synthSource();
    const hash = hashChannelData([source]);
    const history = new AudioClipHistory();

    // Manual edits: trim, fades, loop.
    let doc = freshDoc(hash);
    doc = ok(setTrim(doc, { startSec: 0.25, endSec: 1.75 }, BOUNDS));
    doc = ok(setFade(doc, { fadeInSec: 0.1, fadeOutSec: 0.1 }, BOUNDS));
    doc = ok(setLoop(doc, { loopStartSec: 0.5, loopEndSec: 1.5 }, BOUNDS));
    const savedGainDb = doc.gainDb; // 0 dB

    // A later AI-style edit changes ONLY the gain, recorded on the history.
    const before = doc;
    const after = ok(setGain(before, { gainDb: -6 }));
    history.push(before, after);
    doc = after;

    expect(history.canUndo()).toBe(true);
    expect(doc.gainDb).toBe(-6);

    // Undo: prior gain restored, everything else survives.
    const restored = history.undo();
    expect(restored).not.toBeNull();
    doc = restored!;
    expect(doc.gainDb).toBe(savedGainDb);
    expect(doc.trimStartSec).toBe(0.25);
    expect(doc.trimEndSec).toBe(1.75);
    expect(doc.fadeInSec).toBeCloseTo(0.1, 6);
    expect(doc.fadeOutSec).toBeCloseTo(0.1, 6);
    expect(doc.loopStartSec).toBe(0.5);
    expect(doc.loopEndSec).toBe(1.5);
    // Source bytes never changed across the whole sequence.
    expect(sourceUnchanged(doc, hash)).toBe(true);
    expect(hashChannelData([source])).toBe(hash);

    // Redo re-applies the gain change.
    const redone = history.redo();
    expect(redone!.gainDb).toBe(-6);
  });
});

describe('audio.FR-1.OP-02 — AudioClipHistory discipline', () => {
  it('push sets dirty and clears the redo branch', () => {
    const h = new AudioClipHistory();
    const a = freshDoc('h');
    const b = ok(setGain(a, { gainDb: 1 }));
    h.push(a, b);
    h.undo();
    expect(h.canRedo()).toBe(true);
    // A fresh push discards the redo branch, exactly like HistoryStack::push.
    h.dirty = false;
    h.push(a, b);
    expect(h.dirty).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('caps both stacks at maxSize', () => {
    const h = new AudioClipHistory(3);
    const a = freshDoc('h');
    for (let i = 0; i < 10; i++) h.push(a, ok(setGain(a, { gainDb: i })));
    // Only the last 3 are undoable.
    let count = 0;
    while (h.undo() !== null) count++;
    expect(count).toBe(3);
  });

  it('undo/redo on an empty stack yields null without throwing', () => {
    const h = new AudioClipHistory();
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });
});
