import { describe, it, expect } from 'vitest';
import {
  buildSetGameCameraPayload,
  parseGameCameraWire,
  TRANSLATED_CAMERA_FIELDS,
  type SetGameCameraPayload,
} from '../gameCameraPayload';
import type { GameCameraData, GameCameraMode } from '@/stores/slices/types';

/**
 * Tests for the JS<->engine game-camera wire contract (PF-1126).
 *
 * `buildSetGameCameraPayload` and `parseGameCameraWire` are the ONLY place the
 * authoring vocabulary (`followDistance`, `followHeight`, ...) and the engine's
 * flat wire vocabulary (`offset`, `damping`, ...) meet. Every assertion here is
 * an exact `toEqual` on the full payload/data shape — `objectContaining` is
 * blind to invented keys sitting alongside the asserted ones, and that
 * blindness is exactly what let the PF-1097/PF-1109/PF-1111/PF-1115/PF-1118
 * defect class ship undetected.
 */
describe('gameCameraPayload', () => {
  describe('buildSetGameCameraPayload', () => {
    it('builds the full thirdPersonFollow payload', () => {
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'thirdPersonFollow',
        targetEntity: 'player-1',
        followDistance: 8,
        followHeight: 3,
        followSmoothing: 0.9,
      });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'thirdPersonFollow',
        targetEntity: 'player-1',
        offset: [0, 3, -8],
        damping: 0.9,
      });
    });

    it('builds the full firstPerson payload', () => {
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'firstPerson',
        targetEntity: 'player-1',
        firstPersonHeight: 1.7,
        firstPersonMouseSensitivity: 0.3,
      });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'firstPerson',
        targetEntity: 'player-1',
        eyeHeight: 1.7,
        mouseSensitivity: 0.3,
      });
    });

    it('builds the full sideScroller payload', () => {
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'sideScroller',
        targetEntity: 'player-1',
        sideScrollerDistance: 15,
      });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'sideScroller',
        targetEntity: 'player-1',
        zOffset: 15,
      });
    });

    it('builds the full topDown payload', () => {
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'topDown',
        targetEntity: 'player-1',
        topDownHeight: 20,
      });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'topDown',
        targetEntity: 'player-1',
        height: 20,
      });
    });

    it('builds the full orbital payload', () => {
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'orbital',
        targetEntity: 'showcase-item',
        orbitalDistance: 5,
        orbitalAutoRotateSpeed: 0.5,
      });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'orbital',
        targetEntity: 'showcase-item',
        radius: 5,
        autoRotateSpeed: 0.5,
      });
    });

    it('builds the full fixed payload — position comes from the camera entity transform, not this payload', () => {
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'fixed',
        targetEntity: null,
      });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'fixed',
        targetEntity: null,
      });
    });

    describe('cross-mode authoring fields never leak onto the wire', () => {
      // Every optional field GameCameraData can carry, regardless of the
      // active mode — the way a UI might leave stale fields around after a
      // mode switch. Only the fields the active mode's engine variant reads
      // may end up on the built payload.
      const everyOptionalField = {
        followDistance: 8,
        followHeight: 3,
        followSmoothing: 0.9,
        firstPersonHeight: 1.7,
        firstPersonMouseSensitivity: 0.3,
        sideScrollerDistance: 15,
        topDownHeight: 20,
        orbitalDistance: 5,
        orbitalAutoRotateSpeed: 0.5,
      } satisfies Partial<GameCameraData>;

      const cases: Array<{ mode: GameCameraMode; expectedKeys: (keyof SetGameCameraPayload)[] }> = [
        { mode: 'thirdPersonFollow', expectedKeys: ['entityId', 'mode', 'targetEntity', 'offset', 'damping'] },
        { mode: 'firstPerson', expectedKeys: ['entityId', 'mode', 'targetEntity', 'eyeHeight', 'mouseSensitivity'] },
        { mode: 'sideScroller', expectedKeys: ['entityId', 'mode', 'targetEntity', 'zOffset'] },
        { mode: 'topDown', expectedKeys: ['entityId', 'mode', 'targetEntity', 'height'] },
        { mode: 'orbital', expectedKeys: ['entityId', 'mode', 'targetEntity', 'radius', 'autoRotateSpeed'] },
        { mode: 'fixed', expectedKeys: ['entityId', 'mode', 'targetEntity'] },
      ];

      for (const { mode, expectedKeys } of cases) {
        it(`${mode}: only the variant's own wire fields appear`, () => {
          const payload = buildSetGameCameraPayload('cam-1', {
            mode,
            targetEntity: 'target-1',
            ...everyOptionalField,
          });

          expect(Object.keys(payload).sort()).toEqual([...expectedKeys].sort());
        });
      }
    });

    describe('thirdPersonFollow offset is all-or-nothing', () => {
      it('both followDistance and followHeight present -> both encoded, distance negated onto z', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: 8,
          followHeight: 3,
        });

        expect(payload).toEqual({
          entityId: 'cam-1',
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [0, 3, -8],
        });
      });

      it('neither present -> offset key is omitted entirely, letting the engine take its own default', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'thirdPersonFollow',
          targetEntity: null,
        });

        expect(payload).toEqual({
          entityId: 'cam-1',
          mode: 'thirdPersonFollow',
          targetEntity: null,
        });
        expect(payload).not.toHaveProperty('offset');
      });

      it('only followHeight present -> offset sent with the engine default distance (5) filled in', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followHeight: 3,
        });

        expect(payload).toEqual({
          entityId: 'cam-1',
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [0, 3, -5],
        });
      });

      it('only followDistance present -> offset sent with the engine default height (2) filled in', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: 8,
        });

        expect(payload).toEqual({
          entityId: 'cam-1',
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [0, 2, -8],
        });
      });

      it('followDistance becomes a NEGATIVE z — a sign regression here puts the camera in front of the player', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: 12,
          followHeight: 4,
        });

        expect(payload.offset).toEqual([0, 4, -12]);
      });
    });

    it('preserves zero values instead of dropping them as falsy (orbitalAutoRotateSpeed: 0 is an exact no-op orbit)', () => {
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'orbital',
        targetEntity: null,
        orbitalDistance: 5,
        orbitalAutoRotateSpeed: 0,
      });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'orbital',
        targetEntity: null,
        radius: 5,
        autoRotateSpeed: 0,
      });
    });

    it('preserves zero followSmoothing (instant snap) instead of dropping it as falsy', () => {
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'thirdPersonFollow',
        targetEntity: null,
        followDistance: 5,
        followHeight: 2,
        followSmoothing: 0,
      });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'thirdPersonFollow',
        targetEntity: null,
        offset: [0, 2, -5],
        damping: 0,
      });
    });

    describe('non-finite input is omitted, never forwarded', () => {
      // `JSON.stringify` turns NaN/Infinity into `null`, which `from_flat` reads
      // as "absent, take the default" — so forwarding a non-finite value would
      // be a silent wrong-value bug rather than a visible one.
      it('NaN and Infinity on both offset components -> offset key omitted entirely', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: NaN,
          followHeight: Infinity,
        });

        expect(payload).toEqual({
          entityId: 'cam-1',
          mode: 'thirdPersonFollow',
          targetEntity: null,
        });
      });

      it('NaN followDistance alongside a valid followHeight -> distance falls back to the engine default, not NaN', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: NaN,
          followHeight: 4,
        });

        expect(payload).toEqual({
          entityId: 'cam-1',
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [0, 4, -5],
        });
      });

      it('non-finite followSmoothing is dropped, not sent as damping', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: 5,
          followHeight: 2,
          followSmoothing: -Infinity,
        });

        expect(payload).toEqual({
          entityId: 'cam-1',
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [0, 2, -5],
        });
        expect(payload).not.toHaveProperty('damping');
      });

      it('non-finite firstPersonMouseSensitivity is dropped', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'firstPerson',
          targetEntity: null,
          firstPersonHeight: 1.7,
          firstPersonMouseSensitivity: NaN,
        });

        expect(payload).toEqual({
          entityId: 'cam-1',
          mode: 'firstPerson',
          targetEntity: null,
          eyeHeight: 1.7,
        });
      });

      it('non-finite orbitalAutoRotateSpeed is dropped while a valid orbitalDistance is kept', () => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'orbital',
          targetEntity: null,
          orbitalDistance: 5,
          orbitalAutoRotateSpeed: Infinity,
        });

        expect(payload).toEqual({
          entityId: 'cam-1',
          mode: 'orbital',
          targetEntity: null,
          radius: 5,
        });
      });
    });

    it('does not read values off the prototype chain (Object.hasOwn guard)', () => {
      // A field on the prototype, not an own property. If `num()` ever
      // regressed to a bare `data[key]` read, this value would leak through.
      const proto: Partial<GameCameraData> = { followHeight: 999 };
      const data = Object.create(proto) as Partial<GameCameraData> & { mode: GameCameraMode };
      data.mode = 'thirdPersonFollow';
      data.targetEntity = null;
      data.followDistance = 8;

      const payload = buildSetGameCameraPayload('cam-1', data);

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'thirdPersonFollow',
        targetEntity: null,
        // height falls back to the engine default (2), NOT the inherited 999.
        offset: [0, 2, -8],
      });
    });

    it('defaults a missing targetEntity to null', () => {
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'fixed',
      } as Partial<GameCameraData> & { mode: GameCameraMode });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'fixed',
        targetEntity: null,
      });
    });
  });

  describe('parseGameCameraWire', () => {
    // Round-tripping the output of buildSetGameCameraPayload back through
    // parseGameCameraWire is the single most valuable test in this file: it
    // proves the two directions of the translation genuinely agree with each
    // other, not just with their own separate expectations.
    describe('round-trips buildSetGameCameraPayload output back to the original authoring data', () => {
      const authoringByMode: Record<GameCameraMode, GameCameraData> = {
        thirdPersonFollow: {
          mode: 'thirdPersonFollow',
          targetEntity: 'player-1',
          followDistance: 8,
          followHeight: 3,
          followSmoothing: 0.9,
        },
        firstPerson: {
          mode: 'firstPerson',
          targetEntity: 'player-1',
          firstPersonHeight: 1.7,
          firstPersonMouseSensitivity: 0.3,
        },
        sideScroller: {
          mode: 'sideScroller',
          targetEntity: 'player-1',
          sideScrollerDistance: 15,
        },
        topDown: {
          mode: 'topDown',
          targetEntity: 'player-1',
          topDownHeight: 20,
        },
        fixed: {
          mode: 'fixed',
          targetEntity: null,
        },
        orbital: {
          mode: 'orbital',
          targetEntity: 'showcase-item',
          orbitalDistance: 5,
          orbitalAutoRotateSpeed: 0.5,
        },
      };

      for (const [mode, authoring] of Object.entries(authoringByMode) as [GameCameraMode, GameCameraData][]) {
        it(`${mode}`, () => {
          const wire = buildSetGameCameraPayload('cam-1', authoring);
          // parseGameCameraWire's real caller (hooks/events/gameEvents.ts) always
          // hands it a plain `Record<string, unknown>` decoded off the wire, never
          // the strictly-typed SetGameCameraPayload — this cast mirrors that.
          const parsed = parseGameCameraWire(wire as unknown as Record<string, unknown>);
          expect(parsed).toEqual(authoring);
        });
      }
    });

    it('returns null for an unrecognized mode string (e.g. the old PascalCase spelling)', () => {
      expect(parseGameCameraWire({ mode: 'ThirdPerson', targetEntity: null })).toBeNull();
    });

    it('returns null for a non-string mode', () => {
      expect(parseGameCameraWire({ mode: 123, targetEntity: null })).toBeNull();
    });

    it('returns null when mode is entirely absent', () => {
      expect(parseGameCameraWire({ targetEntity: null })).toBeNull();
    });

    // null from parseGameCameraWire means "this payload's mode is unrecognized",
    // NOT "clear the active camera". A future reader tempted to treat a null
    // return as a delete/clear signal would be wrong — callers must not act on
    // it as a valid camera state.
    it('a null return must not be mistaken for "clear the camera" (documented above; regression guard for the mode-recognition path only)', () => {
      expect(parseGameCameraWire({ mode: 'not-a-real-mode', targetEntity: 'player-1' })).toBeNull();
    });

    it('normalizes an empty-string targetEntity to null', () => {
      const parsed = parseGameCameraWire({ mode: 'fixed', targetEntity: '' });
      expect(parsed).toEqual({ mode: 'fixed', targetEntity: null });
    });

    it('autoRotate: false on an orbital camera collapses orbitalAutoRotateSpeed to 0, even if autoRotateSpeed is nonzero', () => {
      const parsed = parseGameCameraWire({
        mode: 'orbital',
        targetEntity: null,
        radius: 5,
        autoRotate: false,
        autoRotateSpeed: 15,
      });

      expect(parsed).toEqual({
        mode: 'orbital',
        targetEntity: null,
        orbitalDistance: 5,
        orbitalAutoRotateSpeed: 0,
      });
    });

    describe('malformed offset is ignored without throwing', () => {
      it('offset that is not an array is ignored entirely', () => {
        const parsed = parseGameCameraWire({
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: 'not-an-array',
        });

        expect(parsed).toEqual({ mode: 'thirdPersonFollow', targetEntity: null });
      });

      it('offset of the wrong length is ignored entirely, even if every present member is a valid number', () => {
        const parsed = parseGameCameraWire({
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [0, 3],
        });

        expect(parsed).toEqual({ mode: 'thirdPersonFollow', targetEntity: null });
      });

      it('a non-numeric member of a length-3 offset is dropped independently — the sibling numeric member still comes through', () => {
        const parsed = parseGameCameraWire({
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [0, 'not-a-number', -5],
        });

        // y (followHeight) is invalid and dropped; z (followDistance, negated) is
        // still a valid number and is kept. This is the module's actual,
        // documented per-component behaviour, not an invented expectation.
        expect(parsed).toEqual({
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: 5,
        });
      });

      it('a non-finite member of a length-3 offset is dropped, not forwarded as NaN', () => {
        const parsed = parseGameCameraWire({
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [0, NaN, -5],
        });

        expect(parsed).toEqual({
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followDistance: 5,
        });
      });
    });
  });

  describe('TRANSLATED_CAMERA_FIELDS completeness guard', () => {
    // Every authoring field the module claims to translate. If a field is
    // added to GameCameraData without being wired into a switch case in
    // buildSetGameCameraPayload, TRANSLATED_FIELDS' `satisfies` constraint in
    // the source module already fails the build — this test additionally
    // proves each field is not just LISTED but actually READ and forwarded.
    it('lists exactly the fields GameCameraData declares', () => {
      expect(TRANSLATED_CAMERA_FIELDS).toEqual([
        'mode',
        'targetEntity',
        'followDistance',
        'followHeight',
        'followSmoothing',
        'firstPersonHeight',
        'firstPersonMouseSensitivity',
        'sideScrollerDistance',
        'topDownHeight',
        'orbitalDistance',
        'orbitalAutoRotateSpeed',
      ]);
    });

    // `mode` and `targetEntity` are generic — set on every payload regardless
    // of mode — so they are documented here as authoring-only with respect to
    // this per-mode completeness check, not translated by a switch case.
    const GENERIC_FIELDS: readonly (keyof GameCameraData)[] = ['mode', 'targetEntity'];

    // Every remaining field, paired with the one mode whose engine variant
    // reads it. Read straight from the switch statement in the module.
    const FIELD_MODE: Record<Exclude<keyof GameCameraData, 'mode' | 'targetEntity'>, GameCameraMode> = {
      followDistance: 'thirdPersonFollow',
      followHeight: 'thirdPersonFollow',
      followSmoothing: 'thirdPersonFollow',
      firstPersonHeight: 'firstPerson',
      firstPersonMouseSensitivity: 'firstPerson',
      sideScrollerDistance: 'sideScroller',
      topDownHeight: 'topDown',
      orbitalDistance: 'orbital',
      orbitalAutoRotateSpeed: 'orbital',
    };

    it('every mode-specific field is accounted for by FIELD_MODE (no field silently uncovered by this guard)', () => {
      const modeSpecificFields = TRANSLATED_CAMERA_FIELDS.filter(
        field => !GENERIC_FIELDS.includes(field),
      );
      expect(modeSpecificFields.sort()).toEqual(Object.keys(FIELD_MODE).sort());
    });

    it('every mode-specific field actually changes the built payload for its mode — proves it is read, not merely declared', () => {
      for (const [field, mode] of Object.entries(FIELD_MODE) as [keyof GameCameraData, GameCameraMode][]) {
        const withoutField = buildSetGameCameraPayload('cam-1', { mode, targetEntity: null });
        const withField = buildSetGameCameraPayload('cam-1', {
          mode,
          targetEntity: null,
          [field]: 7,
        } as Partial<GameCameraData> & { mode: GameCameraMode });

        expect(withField, `field "${field}" did not change the built payload for mode "${mode}"`).not.toEqual(
          withoutField,
        );
      }
    });
  });
});
