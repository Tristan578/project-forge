/**
 * Unit tests for the shared camera resolution helpers.
 *
 * These were exercised only THROUGH `cameraSetupExecutor` and
 * `autoPolishExecutor`, which reach neither the non-string mode path, the
 * prototype-key guards, nor the entity-id emptiness check — a mutation run left
 * all three green. The executor tests assert what the engine receives; these
 * assert the translation rules that decide it.
 */

import { describe, it, expect } from 'vitest';
import {
  cameraModeNeedsTarget,
  classifyCameraConfigKeys,
  filterCameraNumerics,
  normalizeCameraMode,
  resolveCameraEntityId,
} from '../cameraResolution';
import { MODE_READS_DAMPING } from '@/lib/game/gameCameraPayload';
import type { GameCameraMode } from '@/stores/slices/types';

/**
 * The mode every value-level case below runs under. `followSmoothing` is the
 * only field judged by mode, and this mode reads it, so the mode never decides
 * these cases' outcome; the mode-level judgement has its own describe block.
 */
const FOLLOW: GameCameraMode = 'thirdPersonFollow';

describe('normalizeCameraMode', () => {
  it('passes an engine mode name through untouched', () => {
    // The mode check runs on the ORIGINAL string. Lowercasing first would reject
    // `sideScroller` — the engine's names are camelCase, the alias keys are not.
    expect(normalizeCameraMode('sideScroller')).toBe('sideScroller');
    expect(normalizeCameraMode('thirdPersonFollow')).toBe('thirdPersonFollow');
    expect(normalizeCameraMode('fixed')).toBe('fixed');
  });

  it.each([
    ['side-scroll', 'sideScroller'],
    ['SIDE_SCROLLER', 'sideScroller'],
    ['SideScroll', 'sideScroller'],
    ['third-person', 'thirdPersonFollow'],
    ['follow', 'thirdPersonFollow'],
    ['first_person', 'firstPerson'],
    ['Top-Down', 'topDown'],
    ['orbit', 'orbital'],
  ] as const)('resolves the GDD spelling %s to %s', (raw, expected) => {
    expect(normalizeCameraMode(raw)).toBe(expected);
  });

  it('falls back by project type for a mode the engine does not know', () => {
    // A third-person camera orbiting a flat scene is not a sane 2D default, and
    // `autoPolishExecutor` already branches this way when it repairs a missing
    // camera — the two disagreeing gave the same game two different cameras.
    expect(normalizeCameraMode('cinematic-dolly', '2d')).toBe('sideScroller');
    expect(normalizeCameraMode('cinematic-dolly', '3d')).toBe('thirdPersonFollow');
    expect(normalizeCameraMode('cinematic-dolly')).toBe('thirdPersonFollow');
  });

  it.each([[undefined], [null], [42], [{ mode: 'orbit' }], [['orbit']]])(
    'falls back for the non-string input %s',
    (raw) => {
      expect(normalizeCameraMode(raw)).toBe('thirdPersonFollow');
      expect(normalizeCameraMode(raw, '2d')).toBe('sideScroller');
    },
  );

  it('does not resolve a mode off Object.prototype', () => {
    // The alias table is indexed by a MODEL-CONTROLLED string, so a bare
    // `TABLE[key]` read reaches the prototype: `constructor` returns a function,
    // which is not nullish and so survives a `??` guard. It dies at the mode
    // narrowing either way, but by accident rather than by intent.
    expect(normalizeCameraMode('constructor')).toBe('thirdPersonFollow');
    expect(normalizeCameraMode('toString')).toBe('thirdPersonFollow');
    expect(normalizeCameraMode('__proto__', '2d')).toBe('sideScroller');
  });
});

describe('cameraModeNeedsTarget', () => {
  /**
   * Not a style preference — it is the engine's control flow. In
   * `engine/src/core/game_camera.rs` every arm but `Fixed` is wrapped in
   * `if let Some(target_t) = target_transform`, so a targetless camera in those
   * modes never has its transform touched.
   */
  it.each([
    ['thirdPersonFollow', true],
    ['firstPerson', true],
    ['sideScroller', true],
    ['topDown', true],
    ['orbital', true],
    ['fixed', false],
  ] as const)('%s needs a target: %s', (mode, needs) => {
    expect(cameraModeNeedsTarget(mode)).toBe(needs);
  });
});

describe('resolveCameraEntityId', () => {
  it('matches on a name suffix, case-insensitively', () => {
    expect(
      resolveCameraEntityId([
        { name: 'Ground', entityId: 'e-1' },
        { name: 'Main Camera', entityId: 'e-2' },
      ]),
    ).toBe('e-2');
    expect(resolveCameraEntityId([{ name: 'player_cam', entityId: 'e-3' }])).toBe('e-3');
    expect(resolveCameraEntityId([{ name: 'camera', entityId: 'e-4' }])).toBe('e-4');
  });

  it('returns null when nothing in the scene looks like a camera', () => {
    expect(resolveCameraEntityId([])).toBeNull();
    expect(resolveCameraEntityId([{ name: 'Cameraman', entityId: 'e-1' }])).toBeNull();
  });

  it('treats a blank entity id as no camera at all', () => {
    // An id of `''` or `'   '` is not a handle the engine can match, and
    // `set_game_camera` against an id it does not have is a silent no-op — the
    // failure mode this whole module exists to prevent (PF-1118).
    expect(resolveCameraEntityId([{ name: 'Main Camera', entityId: '' }])).toBeNull();
    expect(resolveCameraEntityId([{ name: 'Main Camera', entityId: '   ' }])).toBeNull();
  });
});

describe('filterCameraNumerics', () => {
  it('keeps only finite numbers under known field names', () => {
    expect(
      filterCameraNumerics({
        followDistance: 7,
        followHeight: 0,
        topDownHeight: Number.NaN,
        orbitalDistance: Number.POSITIVE_INFINITY,
        firstPersonHeight: '1.8',
        arbitraryKey: 3,
      }, FOLLOW),
    ).toEqual({ followDistance: 7, followHeight: 0 });
  });

  it.each([[undefined], [null], ['nope'], [42]])('returns {} for the non-object %s', (raw) => {
    expect(filterCameraNumerics(raw, FOLLOW)).toEqual({});
  });

  it('does not read fields off the prototype chain', () => {
    const proto = { followDistance: 99 };
    expect(filterCameraNumerics(Object.create(proto), FOLLOW)).toEqual({});
  });

  describe('GDD spellings', () => {
    it('maps altitude onto topDownHeight', () => {
      expect(filterCameraNumerics({ altitude: 18 }, FOLLOW)).toEqual({ topDownHeight: 18 });
    });

    it('lets an explicit engine field win over the alias', () => {
      expect(filterCameraNumerics({ altitude: 18, topDownHeight: 25 }, FOLLOW)).toEqual({
        topDownHeight: 25,
      });
    });

    it('applies the alias when the explicit field is unsendable', () => {
      // The direct key is dropped by the finite check, so the field is still
      // unset when the alias pass runs — matching what a user would expect from
      // "I gave you one number that works and one that does not".
      expect(filterCameraNumerics({ altitude: 18, topDownHeight: Number.NaN }, FOLLOW)).toEqual({
        topDownHeight: 18,
      });
    });

    it('drops an unsendable alias value', () => {
      expect(filterCameraNumerics({ altitude: 'high' }, FOLLOW)).toEqual({});
    });
  });

  describe('range policy', () => {
    /**
     * The engine follows with `t = follow_lerp_factor(damping, delta)` — the
     * product clamped to [0, 1] — and then `translation.lerp(target, t)`. A
     * negative damping is floored to a frozen camera (before the floor, when
     * `t` was only capped above, it extrapolated AWAY from the target ~16x per
     * second at 60fps with -3), and the engine's `flat_damping` refuses it at
     * the wire, failing the whole command. Nothing downstream can tell that
     * from a rate the author meant, and `dispatchCommand` returns void, so
     * refusing it here is the only signal.
     */
    it('refuses a negative followSmoothing', () => {
      expect(filterCameraNumerics({ followSmoothing: -3 }, FOLLOW)).toEqual({});
    });

    it('keeps an exact 0 followSmoothing', () => {
      // A frozen follow is a legitimate thing to ask for, and the engine has a
      // test pinning that it survives `from_flat`.
      expect(filterCameraNumerics({ followSmoothing: 0 }, FOLLOW)).toEqual({ followSmoothing: 0 });
    });

    it('keeps a very large followSmoothing', () => {
      // The engine clamps the lerp factor at 1.0, so this saturates into "snap
      // to the target", a coherent outcome — refusing it would be this
      // module's taste, not a bug.
      expect(filterCameraNumerics({ followSmoothing: 10_000 }, FOLLOW)).toEqual({
        followSmoothing: 10_000,
      });
    });

    it.each([
      ['followDistance', -5],
      ['followHeight', -2],
      ['followOffsetX', -3],
      ['firstPersonHeight', -1.7],
      ['firstPersonMouseSensitivity', -0.1],
      ['sideScrollerDistance', -10],
      ['topDownHeight', -15],
      ['orbitalDistance', -8],
      ['orbitalAutoRotateSpeed', -15],
    ])('keeps a negative %s, which is a framing and not a fault', (field, value) => {
      // A negative distance frames from the front (`offset[2] = -distance`), a
      // negative sensitivity is inverted look, a negative orbital radius is a
      // 180-degree phase shift, a negative rotate speed orbits the other way.
      // Refusing these would substitute this module's taste for the author's —
      // the same silent substitution the policy exists to prevent.
      expect(filterCameraNumerics({ [field]: value }, FOLLOW)).toEqual({ [field]: value });
    });

    it('applies the policy to the field an alias maps ONTO, not to the alias name', () => {
      // `altitude` maps to `topDownHeight`, which carries no policy, so the
      // negative survives. The assertion that matters is which side the lookup
      // happens on: keying the policy by the written name would let any future
      // aliased field be set past its own guard by spelling it the GDD's way.
      expect(filterCameraNumerics({ altitude: -18 }, FOLLOW)).toEqual({ topDownHeight: -18 });
    });
  });

  describe('GDD smoothing -> damping conversion (PF-1134)', () => {
    /**
     * The conversion is `damping = smoothing / (1/60)`, i.e. `smoothing * 60`.
     * These three are this module's own real fixtures
     * (`cozy-farming.json`, `narrative-adventure.json`, and the rest at 0.1),
     * and all three land near the engine's own default follow damping of 5 —
     * the sanity check that the reference frame rate is the right one, not
     * merely a self-consistent one.
     */
    it.each([
      [0.05, 3],
      [0.08, 4.8],
      [0.1, 6],
    ])('scales smoothing %s to damping %s', (smoothing, damping) => {
      expect(filterCameraNumerics({ smoothing }, FOLLOW)).toEqual({ followSmoothing: damping });
    });

    it('lets an explicit followSmoothing win over the smoothing alias', () => {
      // Same precedence rule as `altitude`/`topDownHeight`: an explicit
      // spelling of the real field is authoritative over any GDD alias.
      expect(filterCameraNumerics({ smoothing: 0.1, followSmoothing: 2 }, FOLLOW)).toEqual({
        followSmoothing: 2,
      });
    });

    it('applies the alias when the explicit field is unsendable', () => {
      expect(filterCameraNumerics({ smoothing: 0.1, followSmoothing: Number.NaN }, FOLLOW)).toEqual({
        followSmoothing: 6,
      });
    });

    it('rejects a negative smoothing exactly like a negative followSmoothing', () => {
      // -0.1 converts to damping -6, which is still negative — the conversion
      // is a pure positive rescale, so it cannot launder a bad sign into a
      // good one. Reusing `cameraValueRejection` is what guarantees that.
      expect(filterCameraNumerics({ smoothing: -0.1 }, FOLLOW)).toEqual({});
      expect(classifyCameraConfigKeys({ smoothing: -0.1 }, FOLLOW)).toEqual({
        unknown: [],
        unusable: [{ key: 'smoothing', reason: 'must not be negative' }],
        unusedByMode: [],
        overridden: [],
      });
    });

    /**
     * The conversion's domain is checked on the GDD side, before scaling. A
     * per-frame lerp fraction above 1 has no meaning, but scaled it becomes a
     * damping the engine happily accepts (5 -> 300, an exact snap under the
     * engine's 1.0 ceiling on the lerp factor), so without this the step
     * reported `applied: true` for a value that was nonsense where it was
     * written (review-board finding on #10295). Nothing on the producer side
     * pins the unit — the decomposer types `config` as
     * `z.record(z.string(), z.unknown())` — so this is the contract.
     */
    describe('refuses a smoothing outside the (0, 1] per-frame fraction', () => {
      // One reason for every refused value: it names the domain and that the
      // engine default stands, never a single cause — a 5 freezes nothing.
      const REASON =
        'must be above 0 and at most 1 — the share of the gap closed each frame; the engine default is kept unless followSmoothing is set';

      it.each([1.001, 1.5, 5, 60])('drops and reports smoothing %s', (smoothing) => {
        expect(filterCameraNumerics({ smoothing }, FOLLOW)).toEqual({});
        expect(classifyCameraConfigKeys({ smoothing }, FOLLOW)).toEqual({
          unknown: [],
          unusable: [{ key: 'smoothing', reason: REASON }],
          unusedByMode: [],
          overridden: [],
        });
      });

      /**
       * Converted, 0 is damping 0 — a frozen follow the engine accepts — so the
       * step used to report `applied: true` for a camera that never moves. Read
       * as plain English, `smoothing: 0` means the opposite ("no smoothing", a
       * rigid follow), and nothing tells the producer which reading is meant.
       * `-0` is listed because `Object.is` would separate it from `0` and a
       * `value > 0` style rewrite must not let it through as damping `-0`.
       */
      it.each([0, -0])('drops and reports smoothing %s instead of freezing the camera', (smoothing) => {
        expect(filterCameraNumerics({ smoothing }, FOLLOW)).toEqual({});
        expect(classifyCameraConfigKeys({ smoothing }, FOLLOW)).toEqual({
          unknown: [],
          unusable: [{ key: 'smoothing', reason: REASON }],
          unusedByMode: [],
          overridden: [],
        });
      });

      it('keeps the smallest positive smoothing — only exact 0 is the frozen case', () => {
        // 0.001 * 60 is 0.060000000000000005 in binary floating point.
        expect(filterCameraNumerics({ smoothing: 0.001 }, FOLLOW).followSmoothing).toBeCloseTo(0.06, 12);
        expect(classifyCameraConfigKeys({ smoothing: 0.001 }, FOLLOW).unusable).toEqual([]);
      });

      it('keeps exactly 1 — "close the whole gap each frame" is the top of the range', () => {
        expect(filterCameraNumerics({ smoothing: 1 }, FOLLOW)).toEqual({ followSmoothing: 60 });
        expect(classifyCameraConfigKeys({ smoothing: 1 }, FOLLOW)).toEqual({
          unknown: [],
          unusable: [],
          unusedByMode: [],
          overridden: [],
        });
      });

      it('reports the domain, not the converted value, even when an explicit followSmoothing also applies', () => {
        // Out of domain is "wrong", not "lost to a better spelling": the author
        // needs to fix the number, not delete a duplicate.
        expect(filterCameraNumerics({ smoothing: 5, followSmoothing: 2 }, FOLLOW)).toEqual({
          followSmoothing: 2,
        });
        expect(classifyCameraConfigKeys({ smoothing: 5, followSmoothing: 2 }, FOLLOW)).toEqual({
          unknown: [],
          unusable: [{ key: 'smoothing', reason: REASON }],
          unusedByMode: [],
          overridden: [],
        });
      });

      it('does not apply to the engine-unit followSmoothing field itself', () => {
        // 300 is a legal (snappy) rate in the ENGINE's unit; only the GDD
        // spelling carries the 0..1 domain.
        expect(filterCameraNumerics({ followSmoothing: 300 }, FOLLOW)).toEqual({ followSmoothing: 300 });
        expect(classifyCameraConfigKeys({ followSmoothing: 300 }, FOLLOW).unusable).toEqual([]);
      });
    });

    it('drops a non-numeric smoothing value with the ordinary reason', () => {
      // The conversion function is never called on a non-number: the shared
      // finite check runs first, so the report reads "not a finite number"
      // rather than something conversion-specific and misleading.
      expect(filterCameraNumerics({ smoothing: 'slow' }, FOLLOW)).toEqual({});
      expect(classifyCameraConfigKeys({ smoothing: 'slow' }, FOLLOW)).toEqual({
        unknown: [],
        unusable: [{ key: 'smoothing', reason: 'not a finite number' }],
        unusedByMode: [],
        overridden: [],
      });
    });

    it('does not let a boolean masquerade as a convertible number', () => {
      // `true / (1/60)` is a finite 60 in plain JS arithmetic — coercion would
      // let this slip through as a "sendable" damping if the guard in
      // `convertAliasedValue` called `convert` on anything besides an actual
      // `number`, silently accepting a value the field-name check above
      // already refuses for every OTHER numeric field.
      expect(filterCameraNumerics({ smoothing: true }, FOLLOW)).toEqual({});
      expect(classifyCameraConfigKeys({ smoothing: true }, FOLLOW)).toEqual({
        unknown: [],
        unusable: [{ key: 'smoothing', reason: 'not a finite number' }],
        unusedByMode: [],
        overridden: [],
      });
    });

    it('reports smoothing as overridden when it lost to an explicit followSmoothing', () => {
      expect(classifyCameraConfigKeys({ smoothing: 0.1, followSmoothing: 2 }, FOLLOW)).toEqual({
        unknown: [],
        unusable: [],
        unusedByMode: [],
        overridden: [{ key: 'smoothing', field: 'followSmoothing' }],
      });
    });
  });
});

describe('classifyCameraConfigKeys', () => {
  const EMPTY = { unknown: [], unusable: [], unusedByMode: [], overridden: [] };

  /**
   * The GDD's camera vocabulary and the engine's parameter list were authored
   * independently and their intersection was EMPTY, so `filterCameraNumerics`
   * returned `{}` for 100% of real input while the step reported `applied: true`.
   * Mapping what translates cleanly is half the fix; reporting the rest is the
   * other half, because the silent drop is the PF-1125 defect itself.
   */
  it('reports the real GDD config vocabulary as unknown', () => {
    // `smoothing` is excluded here on purpose — PF-1134 gave it a conversion
    // onto `followSmoothing`, so it is exercised in its own describe block
    // below rather than asserted unknown here.
    expect(
      classifyCameraConfigKeys({
        tilt: 30,
        offset: [0, 5, -10],
        leadAhead: 3,
        locked: true,
      }, FOLLOW),
    ).toEqual({
      unknown: ['tilt', 'offset', 'leadAhead', 'locked'],
      unusable: [],
      unusedByMode: [],
      overridden: [],
    });
  });

  /**
   * These three used to share one list under one sentence — "camera settings the
   * engine has no parameter for were ignored" — which is true only of the first.
   * `topDownHeight` is a parameter the engine very much has, and a rejected
   * range is a number it understands and refuses. An author told the wrong
   * reason looks for the wrong fix.
   */
  it('separates a real field carrying a value that cannot be sent', () => {
    expect(classifyCameraConfigKeys({ topDownHeight: '25' }, FOLLOW)).toEqual({
      unknown: [],
      unusable: [{ key: 'topDownHeight', reason: 'not a finite number' }],
      unusedByMode: [],
      overridden: [],
    });
    expect(classifyCameraConfigKeys({ followDistance: Number.NaN }, FOLLOW).unusable).toEqual([
      { key: 'followDistance', reason: 'not a finite number' },
    ]);
  });

  it('names the range policy as the reason, not "no such parameter"', () => {
    // The gap this closes: before the shared predicate, a value the filter
    // refused was reported by NEITHER helper — dropped by one, and seen as a
    // finite number under a real field name by the other.
    expect(classifyCameraConfigKeys({ followSmoothing: -3 }, FOLLOW)).toEqual({
      unknown: [],
      unusable: [{ key: 'followSmoothing', reason: 'must not be negative' }],
      unusedByMode: [],
      overridden: [],
    });
  });

  it('says nothing about keys that reached the engine', () => {
    expect(classifyCameraConfigKeys({ followDistance: 7, altitude: 18 }, FOLLOW)).toEqual(EMPTY);
    expect(classifyCameraConfigKeys({ followHeight: 0 }, FOLLOW)).toEqual(EMPTY);
    expect(classifyCameraConfigKeys({ followSmoothing: 0 }, FOLLOW)).toEqual(EMPTY);
  });

  it('reports an alias that lost to an explicit spelling as overridden, not ignored', () => {
    // Accepted-then-overridden is still "this key did nothing" from the user's
    // side, but the fix is to delete one of the two spellings — a different act
    // from correcting a name or a value, so it gets its own bucket.
    expect(classifyCameraConfigKeys({ altitude: 18, topDownHeight: 25 }, FOLLOW)).toEqual({
      unknown: [],
      unusable: [],
      unusedByMode: [],
      overridden: [{ key: 'altitude', field: 'topDownHeight' }],
    });
    // It only loses to a SENDABLE value, mirroring `filterCameraNumerics`: the
    // explicit NaN is dropped, so the alias is what actually applied.
    expect(classifyCameraConfigKeys({ altitude: 18, topDownHeight: Number.NaN }, FOLLOW)).toEqual({
      unknown: [],
      unusable: [{ key: 'topDownHeight', reason: 'not a finite number' }],
      unusedByMode: [],
      overridden: [],
    });
  });

  it('sorts a mixed config into all three buckets at once', () => {
    expect(
      classifyCameraConfigKeys({
        tilt: 30,
        followSmoothing: -1,
        altitude: 18,
        topDownHeight: 25,
        followDistance: 7,
      }, FOLLOW),
    ).toEqual({
      unknown: ['tilt'],
      unusable: [{ key: 'followSmoothing', reason: 'must not be negative' }],
      unusedByMode: [],
      overridden: [{ key: 'altitude', field: 'topDownHeight' }],
    });
  });

  it.each([[undefined], [null], ['nope'], [7]])('returns empty for the non-object %s', (raw) => {
    expect(classifyCameraConfigKeys(raw, FOLLOW)).toEqual(EMPTY);
  });

  it('ignores inherited keys', () => {
    expect(classifyCameraConfigKeys(Object.create({ smoothing: 0.1 }), FOLLOW)).toEqual(EMPTY);
  });

  // Every mode, not just FOLLOW: the filter also drops by mode now, so the
  // property has to hold on the modes where that happens.
  const DROPPED_KEY_CASES: [GameCameraMode, Record<string, number>][] = [
    [FOLLOW, { followSmoothing: -3 }],
    ...(Object.keys(MODE_READS_DAMPING) as GameCameraMode[]).map(
      (mode): [GameCameraMode, Record<string, number>] => [
        mode,
        { smoothing: 0.1, followSmoothing: 3 },
      ],
    ),
  ];
  it.each(DROPPED_KEY_CASES)('names every key the filter dropped (%s, %o)', (mode, smoothingKeys) => {
    // The two used to duplicate the finite/alias logic and could drift apart,
    // which is exactly how a refused value ended up reported by neither. This
    // asserts the property directly rather than trusting the shared helper.
    const config: Record<string, unknown> = {
      followDistance: 7,
      ...smoothingKeys,
      topDownHeight: '25',
      altitude: 18,
      tilt: 30,
    };
    const applied = filterCameraNumerics(config, mode);
    const report = classifyCameraConfigKeys(config, mode);
    const reported = new Set([
      ...report.unknown,
      ...report.unusable.map((u) => u.key),
      ...report.unusedByMode.map((u) => u.key),
      ...report.overridden.map((o) => o.key),
    ]);
    for (const key of Object.keys(config)) {
      // Membership by VALUE, not by key: an alias lands under the field it maps
      // onto (`altitude: 18` becomes `topDownHeight: 18`), so a key-name lookup
      // would score every alias as dropped. The values here are distinct, so
      // this says what it means — "this key changed something, or it was named".
      const landed = Object.values(applied).includes(config[key] as number);
      expect(landed || reported.has(key)).toBe(true);
    }
  });
});

/**
 * `buildSetGameCameraPayload` sends `damping` only for the modes in
 * `MODE_READS_DAMPING`, so on any other mode a `followSmoothing`, or a GDD
 * `smoothing` converted into one, reaches the engine as nothing. The filter
 * drops it and the classifier names it, with the mode, not the value, as the
 * reason (Devin finding on #10295).
 */
describe('smoothing on a mode that does not ease toward its target', () => {
  const MODES = Object.keys(MODE_READS_DAMPING) as GameCameraMode[];
  const EASING = MODES.filter((mode) => MODE_READS_DAMPING[mode]);
  const NOT_EASING = MODES.filter((mode) => !MODE_READS_DAMPING[mode]);
  const easingList = `${EASING.slice(0, -1).join(', ')} and ${EASING[EASING.length - 1]}`;
  const reasonFor = (mode: GameCameraMode) =>
    `a ${mode} camera does not ease toward its target, so smoothing has no effect — only ${easingList} do`;

  it('has modes of both kinds, so neither sweep below is vacuous', () => {
    expect(EASING.length).toBeGreaterThan(0);
    expect(NOT_EASING.length).toBeGreaterThan(0);
  });

  it.each(NOT_EASING)('drops and names both spellings on a %s camera', (mode) => {
    const config = { smoothing: 0.1, followSmoothing: 3, tilt: 30 };
    expect(filterCameraNumerics(config, mode)).toEqual({});
    expect(classifyCameraConfigKeys(config, mode)).toEqual({
      unknown: ['tilt'],
      unusable: [],
      unusedByMode: [
        { key: 'smoothing', reason: reasonFor(mode) },
        { key: 'followSmoothing', reason: reasonFor(mode) },
      ],
      overridden: [],
    });
  });

  it.each(NOT_EASING)('names the mode, not the range, for an out-of-range value on a %s camera', (mode) => {
    // On a mode that never reads the field, the value cannot matter, so the
    // fix is to drop the key. A range reason would send the author to correct
    // a number instead.
    expect(classifyCameraConfigKeys({ smoothing: 5, followSmoothing: -3 }, mode)).toEqual({
      unknown: [],
      unusable: [],
      unusedByMode: [
        { key: 'smoothing', reason: reasonFor(mode) },
        { key: 'followSmoothing', reason: reasonFor(mode) },
      ],
      overridden: [],
    });
  });

  it.each([
    ['firstPerson', { firstPersonHeight: 1.8 }],
    ['orbital', { orbitalDistance: 12 }],
  ] as const)('still passes the fields a %s camera does read', (mode, own) => {
    // The mode check is scoped to `followSmoothing`: the field beside it that
    // this mode reads must survive the same call.
    expect(MODE_READS_DAMPING[mode]).toBe(false);
    expect(filterCameraNumerics({ ...own, smoothing: 0.1 }, mode)).toEqual(own);
  });

  it.each(EASING)('keeps both spellings in play on a %s camera', (mode) => {
    const config = { smoothing: 0.1, followSmoothing: 3 };
    expect(filterCameraNumerics(config, mode)).toEqual({ followSmoothing: 3 });
    expect(filterCameraNumerics({ smoothing: 0.1 }, mode)).toEqual({ followSmoothing: 6 });
    expect(classifyCameraConfigKeys(config, mode)).toEqual({
      unknown: [],
      unusable: [],
      unusedByMode: [],
      overridden: [{ key: 'smoothing', field: 'followSmoothing' }],
    });
  });
});
