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
  filterCameraNumerics,
  normalizeCameraMode,
  resolveCameraEntityId,
  unmappedCameraConfigKeys,
} from '../cameraResolution';

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
      }),
    ).toEqual({ followDistance: 7, followHeight: 0 });
  });

  it.each([[undefined], [null], ['nope'], [42]])('returns {} for the non-object %s', (raw) => {
    expect(filterCameraNumerics(raw)).toEqual({});
  });

  it('does not read fields off the prototype chain', () => {
    const proto = { followDistance: 99 };
    expect(filterCameraNumerics(Object.create(proto))).toEqual({});
  });

  describe('GDD spellings', () => {
    it('maps altitude onto topDownHeight', () => {
      expect(filterCameraNumerics({ altitude: 18 })).toEqual({ topDownHeight: 18 });
    });

    it('lets an explicit engine field win over the alias', () => {
      expect(filterCameraNumerics({ altitude: 18, topDownHeight: 25 })).toEqual({
        topDownHeight: 25,
      });
    });

    it('applies the alias when the explicit field is unsendable', () => {
      // The direct key is dropped by the finite check, so the field is still
      // unset when the alias pass runs — matching what a user would expect from
      // "I gave you one number that works and one that does not".
      expect(filterCameraNumerics({ altitude: 18, topDownHeight: Number.NaN })).toEqual({
        topDownHeight: 18,
      });
    });

    it('drops an unsendable alias value', () => {
      expect(filterCameraNumerics({ altitude: 'high' })).toEqual({});
    });
  });
});

describe('unmappedCameraConfigKeys', () => {
  /**
   * The GDD's camera vocabulary and the engine's parameter list were authored
   * independently and their intersection was EMPTY, so `filterCameraNumerics`
   * returned `{}` for 100% of real input while the step reported `applied: true`.
   * Mapping what translates cleanly is half the fix; reporting the rest is the
   * other half, because the silent drop is the PF-1125 defect itself.
   */
  it('reports the real GDD config vocabulary as ignored', () => {
    expect(
      unmappedCameraConfigKeys({
        smoothing: 0.1,
        tilt: 30,
        offset: [0, 5, -10],
        leadAhead: 3,
        locked: true,
      }).sort(),
    ).toEqual(['leadAhead', 'locked', 'offset', 'smoothing', 'tilt']);
  });

  it('reports a real field carrying a value that cannot be sent', () => {
    // Naming a real parameter is not the same as setting it.
    expect(unmappedCameraConfigKeys({ topDownHeight: '25' })).toEqual(['topDownHeight']);
    expect(unmappedCameraConfigKeys({ followDistance: Number.NaN })).toEqual(['followDistance']);
  });

  it('says nothing about keys that reached the engine', () => {
    expect(unmappedCameraConfigKeys({ followDistance: 7, altitude: 18 })).toEqual([]);
    expect(unmappedCameraConfigKeys({ followHeight: 0 })).toEqual([]);
  });

  it('reports an alias that lost to an explicit spelling of the same field', () => {
    // Accepted-then-overridden is still "this key did nothing" from the user's
    // side. It only loses to a SENDABLE value, mirroring `filterCameraNumerics`.
    expect(unmappedCameraConfigKeys({ altitude: 18, topDownHeight: 25 })).toEqual(['altitude']);
    expect(unmappedCameraConfigKeys({ altitude: 18, topDownHeight: Number.NaN })).toEqual([
      'topDownHeight',
    ]);
  });

  it.each([[undefined], [null], ['nope'], [7]])('returns [] for the non-object %s', (raw) => {
    expect(unmappedCameraConfigKeys(raw)).toEqual([]);
  });

  it('ignores inherited keys', () => {
    expect(unmappedCameraConfigKeys(Object.create({ smoothing: 0.1 }))).toEqual([]);
  });
});
