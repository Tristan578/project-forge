import { describe, it, expect } from 'vitest';

import { sanitizeKeyframePayload } from '../keyframePayload';
import type { CutsceneTrackType } from '@/stores/cutsceneStore';

describe('sanitizeKeyframePayload', () => {
  describe('camera', () => {
    it('keeps the mode, the target and the authoring params', () => {
      expect(
        sanitizeKeyframePayload('camera', {
          mode: 'orbital',
          targetEntity: 'hero',
          orbitalDistance: 12,
          orbitalAutoRotateSpeed: 20,
        }),
      ).toEqual({
        mode: 'orbital',
        targetEntity: 'hero',
        orbitalDistance: 12,
        orbitalAutoRotateSpeed: 20,
      });
    });

    it('drops keys outside the camera vocabulary', () => {
      // Phantom parameters an earlier vocabulary advertised, plus the kind of
      // free-form key a model invents when it is unsure. `toEqual` on the whole
      // object rather than a per-key check: the point is what is NOT there.
      expect(
        sanitizeKeyframePayload('camera', {
          mode: 'topDown',
          topDownHeight: 20,
          topDownAngle: 45,
          followLookAhead: 2,
          note: 'sweeping shot',
        }),
      ).toEqual({ mode: 'topDown', topDownHeight: 20 });
    });

    it('drops a mode the engine has never had', () => {
      // The old PascalCase spelling. Dropping it rather than passing it through
      // is what makes `buildCommand` return null instead of dispatching it.
      expect(sanitizeKeyframePayload('camera', { mode: 'Orbital', topDownHeight: 3 })).toEqual({
        topDownHeight: 3,
      });
    });

    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['a numeric string', '20'],
      ['null', null],
    ])('drops a numeric param that is %s', (_case, value) => {
      expect(sanitizeKeyframePayload('camera', { mode: 'topDown', topDownHeight: value })).toEqual({
        mode: 'topDown',
      });
    });

    it('keeps an explicitly null targetEntity, because null is the no-target value', () => {
      expect(sanitizeKeyframePayload('camera', { mode: 'fixed', targetEntity: null })).toEqual({
        mode: 'fixed',
        targetEntity: null,
      });
    });

    it('drops an empty targetEntity, which addresses nothing', () => {
      expect(sanitizeKeyframePayload('camera', { mode: 'fixed', targetEntity: '' })).toEqual({
        mode: 'fixed',
      });
    });

    it('does not read params off the prototype chain', () => {
      // A `__proto__` entry in the response JSON produces exactly this object.
      const raw = Object.create({ topDownHeight: 999, mode: 'orbital' }) as Record<string, unknown>;
      raw.mode = 'topDown';
      expect(sanitizeKeyframePayload('camera', raw)).toEqual({ mode: 'topDown' });
    });
  });

  describe('animation', () => {
    it('keeps the clip and the crossfade', () => {
      expect(sanitizeKeyframePayload('animation', { clipName: 'run', crossfadeSecs: 0.25 })).toEqual(
        { clipName: 'run', crossfadeSecs: 0.25 },
      );
    });

    it('drops an empty clip name, which names no clip', () => {
      expect(sanitizeKeyframePayload('animation', { clipName: '' })).toEqual({});
    });

    it.each([
      ['negative', -1],
      ['a string', '0.5'],
      ['an object', { secs: 1 }],
      // `Infinity >= 0` is true, so the range check alone lets this through —
      // only `Number.isFinite` stops it, and an infinite crossfade is a clip
      // that never finishes blending.
      ['Infinity', Infinity],
      ['NaN', NaN],
    ])('drops a crossfade that is %s', (_case, value) => {
      expect(sanitizeKeyframePayload('animation', { clipName: 'run', crossfadeSecs: value })).toEqual(
        { clipName: 'run' },
      );
    });

    it('keeps a zero crossfade rather than treating it as absent', () => {
      // `0` is a legitimate value and the one `??` substitutes for a missing
      // field, so dropping it here would be invisible at the dispatch site.
      expect(sanitizeKeyframePayload('animation', { clipName: 'run', crossfadeSecs: 0 })).toEqual({
        clipName: 'run',
        crossfadeSecs: 0,
      });
    });
  });

  describe('dialogue', () => {
    it('keeps the tree and its display text', () => {
      expect(sanitizeKeyframePayload('dialogue', { treeId: 'greeting', text: 'Hello' })).toEqual({
        treeId: 'greeting',
        text: 'Hello',
      });
    });

    it('keeps empty display text, unlike an empty identifier', () => {
      expect(sanitizeKeyframePayload('dialogue', { treeId: 'greeting', text: '' })).toEqual({
        treeId: 'greeting',
        text: '',
      });
    });

    it('drops an empty tree id', () => {
      expect(sanitizeKeyframePayload('dialogue', { treeId: '', text: 'Hello' })).toEqual({
        text: 'Hello',
      });
    });

    it.each([
      ['a number', 42],
      ['an object', { value: 'Hello' }],
      ['a boolean', true],
      ['null', null],
    ])('drops display text that is %s', (_case, value) => {
      // `text` accepts the empty string, so its reader is the one whose only job
      // is the kind check — without a wrong-kind case here it could degrade to
      // an identity function and nothing would notice. This is the field that
      // gets persisted into the store, exported with the project and drawn in
      // the timeline, so a non-string reaching it is a render-time surprise
      // rather than a dispatch one.
      expect(sanitizeKeyframePayload('dialogue', { treeId: 'greeting', text: value })).toEqual({
        treeId: 'greeting',
      });
    });
  });

  describe('audio', () => {
    it('keeps volume and pitch', () => {
      expect(sanitizeKeyframePayload('audio', { volume: 0.8, pitch: 1.2 })).toEqual({
        volume: 0.8,
        pitch: 1.2,
      });
    });

    it('drops everything else', () => {
      // This is the payload the audio track used to spread straight into
      // `play_audio`, so every key here reached the engine.
      expect(
        sanitizeKeyframePayload('audio', {
          volume: 0.8,
          clipUrl: 'https://example.invalid/a.mp3',
          loop: true,
          entityId: 'someone-elses-entity',
        }),
      ).toEqual({ volume: 0.8 });
    });

    it.each([
      ['negative', -1],
      ['Infinity', Infinity],
      ['above the gain node maximum', 1.5],
      ['absurd', 1e308],
    ])('drops a volume that is %s', (_case, volume) => {
      expect(sanitizeKeyframePayload('audio', { volume, pitch: 1 })).toEqual({ pitch: 1 });
    });

    it.each([
      ['below the playbackRate minimum', 0.1],
      ['above the playbackRate maximum', 8],
      ['zero', 0],
      ['negative', -1],
    ])('drops a pitch that is %s', (_case, pitch) => {
      expect(sanitizeKeyframePayload('audio', { volume: 0.5, pitch })).toEqual({ volume: 0.5 });
    });

    it.each([
      ['volume', 'volume', 0],
      ['volume', 'volume', 1],
      ['pitch', 'pitch', 0.25],
      ['pitch', 'pitch', 4],
    ])('keeps %s at the %s bound %d', (_label, field, value) => {
      // The bounds are inclusive: they are the audio graph's own clamp limits
      // (`audioManager.ts:387` for volume, `:397` for pitch), so a keyframe
      // asking for silence, unity gain, or either end of the rate range is
      // asking for something the graph can actually produce.
      expect(sanitizeKeyframePayload('audio', { [field]: value })).toEqual({ [field]: value });
    });

    it('drops an out-of-range value rather than clamping it', () => {
      // Clamping would invent an opinion the keyframe never expressed and bury
      // the generator bug in a saved cutscene that reads as deliberate. Dropping
      // leaves the engine on its own default, which is how this codebase spells
      // "no opinion" (PF-1126).
      const result = sanitizeKeyframePayload('audio', { volume: 42 });
      expect(result).not.toHaveProperty('volume');
      expect(result).toEqual({});
    });
  });

  describe('wait', () => {
    it('keeps nothing — a timed pause carries no payload', () => {
      expect(sanitizeKeyframePayload('wait', { duration: 3, mode: 'orbital', volume: 1 })).toEqual({});
    });
  });

  describe('unusable input', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an array', [{ mode: 'orbital' }]],
      ['a string', 'mode=orbital'],
      ['a number', 3],
    ])('returns an empty payload when the raw value is %s', (_case, raw) => {
      expect(sanitizeKeyframePayload('camera', raw)).toEqual({});
    });

    it('returns an empty payload for a track type that only exists on Object.prototype', () => {
      // The generator reads the track type out of `JSON.parse` output, so a bare
      // index would resolve `constructor` to the `Object` function rather than
      // `undefined`. The type assertion is the point — this value cannot occur
      // through the typed API, only through the untyped one upstream.
      //
      // Documented rather than enforced: `Object.keys(Object)` is `[]`, because
      // every own property of a built-in constructor is non-enumerable, so this
      // case passes with the `Object.hasOwn` guard removed. The case below is
      // the one that actually fails without it.
      for (const name of ['constructor', 'toString', 'valueOf', '__proto__']) {
        expect(
          sanitizeKeyframePayload(name as CutsceneTrackType, { mode: 'orbital', volume: 1 }),
        ).toEqual({});
      }
    });

    it('returns an empty payload for an unknown track type rather than throwing', () => {
      // What the `Object.hasOwn` guard is really for. A cutscene loaded from a
      // saved project can name a track type this build no longer has; a bare
      // index yields `undefined` and `Object.keys(undefined)` throws, which
      // would take down playback of the whole timeline over one stale track.
      expect(() =>
        sanitizeKeyframePayload('cameraShake' as CutsceneTrackType, { intensity: 2 }),
      ).not.toThrow();
      expect(sanitizeKeyframePayload('cameraShake' as CutsceneTrackType, { intensity: 2 })).toEqual(
        {},
      );
    });
  });

  it('returns an object whose own keys are exactly the allowlisted ones', () => {
    // The audio dispatch spreads this result into an engine command, which is
    // only sound if the returned object carries nothing else. A filter applied
    // in place would leave the original prototype and any non-enumerable keys
    // attached; picking into a fresh object is what makes the spread safe.
    const raw = Object.create({ inherited: 'x' }) as Record<string, unknown>;
    raw.volume = 0.5;
    raw.invented = true;
    // `pitch` is allowlisted and PRESENT but unusable, so its reader returns
    // `undefined` and the write must be skipped. Feeding an absent `pitch`
    // instead would never reach that branch, and `toEqual` cannot see the
    // difference — it treats an own key holding `undefined` as absent, so a
    // sanitizer that wrote every field unconditionally would still pass every
    // "drops X" case above while handing this spread a `pitch: undefined`.
    raw.pitch = 'loud';

    const result = sanitizeKeyframePayload('audio', raw);

    expect(Reflect.ownKeys(result)).toEqual(['volume']);
    expect({ entityId: 'sfx1', ...result }).toStrictEqual({ entityId: 'sfx1', volume: 0.5 });
  });
});
