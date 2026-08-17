import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSetGameCameraPayload,
  parseGameCameraWire,
  ENGINE_CAMERA_DEFAULTS,
  TRANSLATED_CAMERA_FIELDS,
  GAME_CAMERA_WIRE_KEYS,
  type SetGameCameraPayload,
  type NumericCameraField,
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
        // Derived from the speed rather than left unwritten: an unowned wire key
        // is one the round-trip preservation keeps verbatim, so a stale
        // `autoRotate: false` would otherwise outlive the speed that replaced it.
        autoRotate: true,
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
        { mode: 'orbital', expectedKeys: ['entityId', 'mode', 'targetEntity', 'radius', 'autoRotateSpeed', 'autoRotate'] },
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
        // Speed 0 and `autoRotate: false` are the same behaviour — the update is
        // `angle += speed.to_radians() * dt` — so the flag is emitted to match,
        // making this vocabulary the owner of it rather than leaving it to be
        // preserved from whatever the engine last reported.
        autoRotate: false,
      });
    });

    // `damping` is a rate per second, not a 0..1 blend factor — the engine
    // computes `t = (damping * delta).min(1.0)` — so 0 freezes the camera where
    // it stands rather than snapping it to the target. Either way it is a real
    // value the author asked for, and dropping it as falsy would substitute the
    // engine's 5.0 default for it.
    it('preserves zero followSmoothing (frozen follow) instead of dropping it as falsy', () => {
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
          // No inspector control writes this, but the round trip has to carry it:
          // it is the X slot of the same `offset` vector as the two above, and
          // the builder used to hardcode a `0` there (PF-1125).
          followOffsetX: 1.5,
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
          // `fov` has no authoring field, so it exercises the preservation bag:
          // it survives the round trip only because `parseGameCameraWire` keeps
          // it and `buildSetGameCameraPayload` re-emits it.
          mode: 'fixed',
          targetEntity: null,
          engineParams: { fov: 100 },
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

      // The fixtures above are hand-written, so a field added to `GameCameraData`
      // would be forced into `TRANSLATED_FIELDS` by the `satisfies` check — the
      // build breaks until its engine mapping is decided — and then sit here
      // permanently un-round-tripped, which is the half nothing enforces. A round
      // trip is the only check that the two directions AGREE; a field mapped in
      // one direction only would pass every other test in this file.
      it('exercises every field in TRANSLATED_CAMERA_FIELDS', () => {
        const exercised = new Set(Object.values(authoringByMode).flatMap((a) => Object.keys(a)));

        expect([...TRANSLATED_CAMERA_FIELDS].sort()).toEqual([...exercised].sort());
      });
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
          offset: [1, 'not-a-number', -5],
        });

        // y (followHeight) is invalid and dropped; x (followOffsetX) and z
        // (followDistance, negated) are still valid numbers and are kept. This is
        // the module's actual, documented per-component behaviour, not an invented
        // expectation. x is deliberately non-zero: a `0` there would pass whether
        // it was read from the wire or defaulted.
        expect(parsed).toEqual({
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followOffsetX: 1,
          followDistance: 5,
        });
      });

      it('a non-finite member of a length-3 offset is dropped, not forwarded as NaN', () => {
        const parsed = parseGameCameraWire({
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [1, NaN, -5],
        });

        expect(parsed).toEqual({
          mode: 'thirdPersonFollow',
          targetEntity: null,
          followOffsetX: 1,
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
        'followOffsetX',
        'followSmoothing',
        'firstPersonHeight',
        'firstPersonMouseSensitivity',
        'sideScrollerDistance',
        'topDownHeight',
        'orbitalDistance',
        'orbitalAutoRotateSpeed',
        'engineParams',
      ]);
    });

    // `mode` and `targetEntity` are generic — set on every payload regardless
    // of mode — and `engineParams` is an overlay applied after the switch, for
    // every mode. All three are documented here as outside this per-mode
    // completeness check, not translated by a switch case.
    const GENERIC_FIELDS: readonly (keyof GameCameraData)[] = ['mode', 'targetEntity', 'engineParams'];

    // Every remaining field, paired with the one mode whose engine variant
    // reads it. Read straight from the switch statement in the module.
    const FIELD_MODE: Record<NumericCameraField, GameCameraMode> = {
      followDistance: 'thirdPersonFollow',
      followHeight: 'thirdPersonFollow',
      followOffsetX: 'thirdPersonFollow',
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

  // -------------------------------------------------------------------------
  // Round-trip preservation.
  //
  // The engine reads twenty-one camera parameters; this authoring vocabulary
  // names nine. `set_game_camera` REPLACES the whole component, so the twelve
  // with no authoring field are not merely "not shown" — before `engineParams`
  // they were reset to `from_flat`'s defaults by the next dispatch from any
  // surface at all. An MCP client sets `fov: 100`, the user nudges Eye Height,
  // the rebuilt payload omits `fov`, and the field of view silently returns to
  // 75. That is the destructive-full-replace shape of PF-1123, on the surface
  // the published manifest advertises.
  // -------------------------------------------------------------------------
  describe('engineParams round-trip preservation', () => {
    it('keeps a wire parameter the authoring vocabulary has no field for', () => {
      const parsed = parseGameCameraWire({
        mode: 'firstPerson',
        targetEntity: 'player-1',
        eyeHeight: 1.7,
        fov: 100,
      });

      expect(parsed).toEqual({
        mode: 'firstPerson',
        targetEntity: 'player-1',
        firstPersonHeight: 1.7,
        engineParams: { fov: 100 },
      });
    });

    it('re-emits the preserved parameter on the next dispatch, so a full-replace does not reset it', () => {
      const parsed = parseGameCameraWire({
        mode: 'firstPerson',
        targetEntity: 'player-1',
        eyeHeight: 1.7,
        fov: 100,
      })!;

      // The user nudges eye height. Everything else must survive.
      const payload = buildSetGameCameraPayload('cam-1', { ...parsed, firstPersonHeight: 2 });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'firstPerson',
        targetEntity: 'player-1',
        eyeHeight: 2,
        fov: 100,
      });
    });

    it('does not capture a parameter the authoring path already owns — no second copy to go stale', () => {
      const parsed = parseGameCameraWire({
        mode: 'thirdPersonFollow',
        targetEntity: null,
        offset: [1.5, 3, -8],
        damping: 0.9,
      });

      // `offset` and `damping` map onto followOffsetX/followHeight/
      // followDistance/followSmoothing, so they must NOT also appear in the bag.
      // `offset` is the reason `followOffsetX` exists: the bag cannot preserve one
      // component of a vector the authoring path already owns, so X had to become
      // an authoring field or be lost (PF-1125).
      expect(parsed).toEqual({
        mode: 'thirdPersonFollow',
        targetEntity: null,
        followDistance: 8,
        followHeight: 3,
        followOffsetX: 1.5,
        followSmoothing: 0.9,
      });
    });

    it('a shoulder offset survives a nudge of an unrelated follow control', () => {
      // The user-visible shape of PF-1125: an MCP client or a scene file sets a
      // sideways offset, the user then drags the height slider, and the camera
      // snaps to dead-centre behind the player. `offset` is one vector, so the
      // builder must re-emit X from the parsed data rather than a literal 0.
      const parsed = parseGameCameraWire({
        mode: 'thirdPersonFollow',
        targetEntity: 'player-1',
        offset: [1.5, 3, -8],
      })!;

      const payload = buildSetGameCameraPayload('cam-1', { ...parsed, followHeight: 4 });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'thirdPersonFollow',
        targetEntity: 'player-1',
        offset: [1.5, 4, -8],
      });
    });

    it('authoring wins over a preserved key of the same name', () => {
      // A stale bag naming a key the current mode DOES translate must not
      // override the live authoring value — otherwise a user edit would be
      // silently reverted to the last value the engine reported.
      const payload = buildSetGameCameraPayload('cam-1', {
        mode: 'firstPerson',
        targetEntity: null,
        firstPersonHeight: 2,
        engineParams: { eyeHeight: 99, fov: 100 },
      });

      expect(payload).toEqual({
        entityId: 'cam-1',
        mode: 'firstPerson',
        targetEntity: null,
        eyeHeight: 2,
        fov: 100,
      });
    });

    describe('values are validated by shape, never spread', () => {
      // The bag reaches the builder through the store, and the store is written
      // by things this module does not control — the inbound event path casts
      // with `castPayload`, which is an unchecked `as T`.
      it.each([
        ['wrong primitive type', { fov: 'wide' }],
        ['non-finite number', { fov: Infinity }],
        ['boolean where a number belongs', { fov: true }],
        ['number where a boolean belongs', { autoRotate: 1 }],
        ['pair of the wrong length', { pitchClamp: [1] }],
        ['vec3 with a non-numeric member', { lookAt: [0, 'x', 0] }],
        ['unknown key the engine never reads', { notAWireKey: 5 }],
      ])('drops a %s on capture', (_label, bad) => {
        const parsed = parseGameCameraWire({ mode: 'fixed', targetEntity: null, ...bad });
        expect(parsed).toEqual({ mode: 'fixed', targetEntity: null });
      });

      it.each([
        ['wrong primitive type', { fov: 'wide' }],
        ['non-finite number', { fov: Infinity }],
        ['pair of the wrong length', { pitchClamp: [1, 2, 3] }],
        ['unknown key the engine never reads', { notAWireKey: 5 }],
      ])('drops a %s on re-emit', (_label, bad) => {
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'fixed',
          targetEntity: null,
          engineParams: bad,
        });
        expect(payload).toEqual({ entityId: 'cam-1', mode: 'fixed', targetEntity: null });
      });

      it('reads own properties only — an inherited key is not re-emitted', () => {
        const inherited = Object.create({ fov: 100 }) as Record<string, unknown>;
        const payload = buildSetGameCameraPayload('cam-1', {
          mode: 'fixed',
          targetEntity: null,
          engineParams: inherited,
        });

        expect(payload).toEqual({ entityId: 'cam-1', mode: 'fixed', targetEntity: null });
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-language pin.
//
// `ENGINE_CAMERA_DEFAULTS` is a hand-mirrored copy of numbers that live in
// Rust. Nothing checked it, and it had already drifted on two of the eight
// (orbital distance 5 vs 8, auto-rotate 0 vs 15) before this landed. The drift
// is invisible by construction: the inspector dispatches these values, so the
// number in effect and the number displayed are the same wrong number, and
// `dispatchCommand` returns `void` so neither is ever contradicted.
//
// Reading the Rust source is the only check available here — a native `cargo
// test` cannot see the TS constant, and the TS suite cannot call `from_flat`.
// Deliberately textual, and it fails closed: an unreadable file, a missing
// match arm, or a default it cannot parse is a failure, never a skip.
// ---------------------------------------------------------------------------

describe('ENGINE_CAMERA_DEFAULTS matches GameCameraMode::from_flat', () => {
  const RUST = join(
    __dirname, '..', '..', '..', '..', '..',
    'engine', 'src', 'core', 'game_camera.rs',
  );

  /** The body of each `"<mode>" => …` match arm, by mode name. */
  function fromFlatArms(): Record<string, string> {
    const source = readFileSync(RUST, 'utf8');
    const start = source.indexOf('pub fn from_flat');
    expect(start, `no from_flat in ${RUST}`).toBeGreaterThan(-1);
    const body = source.slice(start);

    // Delimit each arm by the NEXT arm head rather than by a closing-brace
    // shape. An arm may be a bare `Ok(Self::V { … })` expression or a `{ … }`
    // block that validates before constructing, and the earlier
    // `Ok\(Self::\w+ \{ … \n {12}\}\)` pattern matched only the first form —
    // so the day `thirdPersonFollow` grew a range check, its arm vanished from
    // this map entirely. It failed loudly, as intended, but a head-to-head cut
    // does not care what the arm body looks like.
    const heads = [...body.matchAll(/^ {12}(?:"(\w+)"|other) =>/gm)];
    expect(heads.length, 'no from_flat match arms found').toBeGreaterThan(0);

    const arms: Record<string, string> = {};
    heads.forEach((head, i) => {
      const mode = head[1];
      if (!mode) return; // the `other =>` fallback — a bound, not an arm
      const from = head.index! + head[0].length;
      const to = i + 1 < heads.length ? heads[i + 1]!.index! : body.length;
      arms[mode] = body.slice(from, to);
    });
    return arms;
  }

  /**
   * A Rust `f32` literal, as written in source.
   *
   * Deliberately wider than `-?[0-9]+(\.[0-9]+)?`, which was the pattern here
   * first: Rust spells this number four interchangeable ways and that one
   * accepted only the plainest. `5.0_f32`, `5f32`, `1_000.0` and `1e3` are all
   * the same value to rustc, so the day someone annotates a default for
   * readability the regex stops matching — and because {@link rustDefault}
   * asserts on a null match, that reads as "the default is missing", pointing at
   * the wrong file entirely. Matching the whole literal keeps the failure mode
   * honest: a genuinely absent default still fails, a re-spelled one does not.
   */
  const RUST_F32 = String.raw`-?\d[\d_]*(?:\.(?:\d[\d_]*)?)?(?:[eE][+-]?\d+)?(?:_?f32)?`;

  /** Read a captured Rust literal as a number, rejecting anything unparseable. */
  function parseRustF32(literal: string, what: string): number {
    const value = Number(literal.replace(/_?f32$/, '').replace(/_/g, ''));
    expect(
      Number.isFinite(value),
      `unparseable Rust f32 literal for ${what}: "${literal}"`,
    ).toBe(true);
    return value;
  }

  /** The literal default in `flat_f32(params, "<wireKey>", <default>)`. */
  function rustDefault(arm: string, wireKey: string): number {
    const m = new RegExp(
      `flat_f32\\(params, "${wireKey}", (${RUST_F32})\\)`,
    ).exec(arm);
    expect(m, `no flat_f32 default for "${wireKey}"`).not.toBeNull();
    return parseRustF32(m![1]!, `flat_f32 "${wireKey}"`);
  }

  const arms = fromFlatArms();

  // Every completeness check elsewhere in this file runs TS->TS: the `satisfies`
  // constraints prove the TypeScript tables agree with each other, and nothing
  // required a `flat_f32(params, "newKey", …)` added to a Rust arm to have any
  // TypeScript counterpart at all. That is the direction the drift actually
  // travels — the engine grows a parameter, the wire table never hears about it,
  // and `parseGameCameraWire` silently drops it on every round trip, which under
  // a full-replace command means resetting it.
  describe('GAME_CAMERA_WIRE_KEYS matches the keys from_flat reads', () => {
    /** Every `"<key>"` passed to a `flat_*` reader inside a from_flat arm. */
    const rustKeys = new Set(
      [...Object.values(arms).join('\n').matchAll(
        /flat_(?:f32|bool|range|numbers::<\d+>)\(params, "(\w+)"/g,
      )].map(m => m[1]!),
    );

    it('finds the readers at all (guards against a silently vacuous scan)', () => {
      expect(rustKeys.size).toBeGreaterThan(0);
    });

    it('declares every key the engine reads', () => {
      expect([...rustKeys].filter(k => !GAME_CAMERA_WIRE_KEYS.includes(k as never)))
        .toEqual([]);
    });

    it('declares no key the engine does not read', () => {
      expect(GAME_CAMERA_WIRE_KEYS.filter(k => !rustKeys.has(k))).toEqual([]);
    });
  });

  /** Authoring field -> the mode arm and wire key it takes its default from. */
  const SCALAR_SOURCES = {
    followSmoothing: ['thirdPersonFollow', 'damping'],
    firstPersonHeight: ['firstPerson', 'eyeHeight'],
    firstPersonMouseSensitivity: ['firstPerson', 'mouseSensitivity'],
    sideScrollerDistance: ['sideScroller', 'zOffset'],
    topDownHeight: ['topDown', 'height'],
    orbitalDistance: ['orbital', 'radius'],
    orbitalAutoRotateSpeed: ['orbital', 'autoRotateSpeed'],
  } as const satisfies Partial<Record<keyof typeof ENGINE_CAMERA_DEFAULTS, [string, string]>>;

  it.each(Object.entries(SCALAR_SOURCES))(
    '%s equals the engine default',
    (field, [mode, wireKey]) => {
      const arm = arms[mode];
      expect(arm, `no "${mode}" arm in from_flat`).toBeDefined();
      expect(ENGINE_CAMERA_DEFAULTS[field as keyof typeof ENGINE_CAMERA_DEFAULTS])
        .toBe(rustDefault(arm!, wireKey));
    },
  );

  // `followOffsetX`/`followHeight`/`followDistance` are not scalars engine-side:
  // they are the three components of one `offset` vector, so they need the Vec3
  // literal.
  it('the follow offset fields equal the thirdPersonFollow offset default', () => {
    const arm = arms['thirdPersonFollow'];
    expect(arm, 'no "thirdPersonFollow" arm in from_flat').toBeDefined();

    const m = new RegExp(
      `unwrap_or\\(Vec3::new\\((${RUST_F32}), (${RUST_F32}), (${RUST_F32})\\)\\)`,
    ).exec(arm!);
    expect(m, 'no Vec3 default for `offset`').not.toBeNull();

    expect(ENGINE_CAMERA_DEFAULTS.followOffsetX).toBe(parseRustF32(m![1]!, 'offset.x'));
    expect(ENGINE_CAMERA_DEFAULTS.followHeight).toBe(parseRustF32(m![2]!, 'offset.y'));
    // The payload builder emits `offset: [offsetX, height, -distance]`, so the
    // engine's Z is the negated authoring distance.
    expect(ENGINE_CAMERA_DEFAULTS.followDistance).toBe(-parseRustF32(m![3]!, 'offset.z'));
  });

  // Every default must be covered by one of the two checks above, or a newly
  // added field could sit here permanently unpinned.
  it('pins every field in ENGINE_CAMERA_DEFAULTS', () => {
    expect(Object.keys(ENGINE_CAMERA_DEFAULTS).sort()).toEqual(
      [
        ...Object.keys(SCALAR_SOURCES),
        'followOffsetX',
        'followHeight',
        'followDistance',
      ].sort(),
    );
  });
});
