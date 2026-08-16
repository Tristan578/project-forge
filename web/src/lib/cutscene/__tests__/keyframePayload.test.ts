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

    it('drops a negative volume', () => {
      expect(sanitizeKeyframePayload('audio', { volume: -1, pitch: 1 })).toEqual({ pitch: 1 });
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
      // The generator reads the track type out of `JSON.parse` output. A bare
      // index would resolve `constructor` to a function and hand the loop the
      // keys of `Object`; `toString` and `valueOf` do the same. The type
      // assertion is the point — this value cannot occur through the typed API,
      // only through the untyped one upstream.
      for (const name of ['constructor', 'toString', 'valueOf', '__proto__']) {
        expect(
          sanitizeKeyframePayload(name as CutsceneTrackType, { mode: 'orbital', volume: 1 }),
        ).toEqual({});
      }
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

    const result = sanitizeKeyframePayload('audio', raw);

    expect(Reflect.ownKeys(result)).toEqual(['volume']);
    expect({ entityId: 'sfx1', ...result }).toEqual({ entityId: 'sfx1', volume: 0.5 });
  });
});
