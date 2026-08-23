import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultCharacterController,
  jumpHeightSliderMax,
  jumpHeightUnit,
  JUMP_RATE_SLIDER_MAX_2D,
} from '../characterControllerDefaults';
import {
  jumpAirtimeSeconds,
  maxApexHeightForAirtime,
  MAX_JUMP_AIRTIME_SECONDS,
} from '@/lib/ai/physicsFeel';

/**
 * What a manually-added CharacterController starts with, and how far its Jump
 * Height slider goes (PF-1228).
 *
 * The manual path shipped `jumpHeight: 8` into every project. On the 2D legacy
 * path that number is a rise rate and 8 is the value it was tuned against; on
 * the 3D kinematic path it is an apex height in metres, so the same literal
 * asked for an eight-metre jump with a 2.6-second hang time. Nothing could
 * report it — `dispatchCommand` returns void, and a large height is a perfectly
 * valid height.
 */
describe('defaultCharacterController', () => {
  it('gives 3D a jump the engine can actually land, derived from the default preset', () => {
    const d = defaultCharacterController('3d');

    // Full key set, not `objectContaining`: an invented key sitting alongside
    // the asserted ones is exactly what this defect class hides behind.
    expect(Object.keys(d).sort()).toEqual([
      'canDoubleJump',
      'gravityScale',
      'jumpHeight',
      'speed',
    ]);
    expect(d.speed).toBe(7);
    expect(d.gravityScale).toBe(1);
    expect(d.canDoubleJump).toBe(false);

    // 4.5 m/s launch (jumpForce 10 x 0.45) against 9.81 m/s^2 puts the apex at
    // v^2/2g = 1.032 m. Computed here by hand rather than by calling the same
    // helper the module calls, so this is a pin and not a restatement.
    expect(d.jumpHeight).toBeCloseTo(1.03, 2);
  });

  it('keeps the 3D jump inside the airtime cap the generated path enforces', () => {
    const d = defaultCharacterController('3d');
    expect(jumpAirtimeSeconds(d.jumpHeight, d.gravityScale)).toBeLessThanOrEqual(
      MAX_JUMP_AIRTIME_SECONDS,
    );
    // The regression itself: 8 metres is 2.55s of hang time, well past the cap.
    expect(jumpAirtimeSeconds(8, 1)).toBeGreaterThan(MAX_JUMP_AIRTIME_SECONDS);
    expect(d.jumpHeight).not.toBe(8);
  });

  it('leaves 2D on the engine default, because there the number is a rise rate', () => {
    // Lowering this to fix 3D would divide every 2D jump by eight: the legacy
    // path nudges the transform by `jump_height * 0.5 * dt` with no integrator,
    // so the number is a speed and 1.03 is a crawl.
    expect(defaultCharacterController('2d')).toEqual({
      speed: 5,
      jumpHeight: 8,
      gravityScale: 1,
      canDoubleJump: false,
    });
  });
});

describe('jumpHeightSliderMax', () => {
  it('bounds 3D by the airtime cap at the current gravity', () => {
    expect(jumpHeightSliderMax('3d', 1, 1)).toBeCloseTo(maxApexHeightForAirtime(1), 10);
    // h = t^2 * g / 8 = 2.25 * 9.81 / 8, computed by hand.
    expect(jumpHeightSliderMax('3d', 1, 1)).toBeCloseTo(2.76, 2);
  });

  it('tracks gravity rather than pinning a constant', () => {
    const light = jumpHeightSliderMax('3d', 0.5, 0);
    const heavy = jumpHeightSliderMax('3d', 4, 0);
    // The apex reachable in a fixed airtime is linear in gravity: a heavier
    // world needs a taller number for the same hang time, so a constant ceiling
    // would cut it short.
    expect(heavy).toBeGreaterThan(light);
    expect(heavy / light).toBeCloseTo(8, 6);
  });

  it('falls back to scale 1 when gravity is zero, matching the engine', () => {
    // `jump_speed_for_height` treats a non-positive scale as 1.0. A 0-wide
    // slider would be the alternative, which is not a control.
    expect(jumpHeightSliderMax('3d', 0, 0)).toBeCloseTo(maxApexHeightForAirtime(1), 10);
    expect(jumpHeightSliderMax('3d', Number.NaN, 0)).toBeCloseTo(
      maxApexHeightForAirtime(1),
      10,
    );
  });

  it('raises the ceiling for a value already above it', () => {
    // An imported scene, or a number typed before this bound existed. Without
    // this the thumb sits pinned at the end of the track while the readout
    // shows something larger, and the first drag silently discards the value.
    expect(jumpHeightSliderMax('3d', 1, 40)).toBe(40);
    expect(jumpHeightSliderMax('2d', 1, 40)).toBe(40);
  });

  it('ignores a non-finite current value', () => {
    expect(jumpHeightSliderMax('2d', 1, Number.NaN)).toBe(JUMP_RATE_SLIDER_MAX_2D);
    expect(jumpHeightSliderMax('3d', 1, Number.POSITIVE_INFINITY)).toBeCloseTo(
      maxApexHeightForAirtime(1),
      10,
    );
  });

  it('keeps the 2D range as an authoring range, unmoved by gravity', () => {
    // No airtime exists on the legacy path, so there is no physical ceiling to
    // derive and pretending otherwise would be a calculation dressing up a
    // guess.
    expect(jumpHeightSliderMax('2d', 1, 0)).toBe(JUMP_RATE_SLIDER_MAX_2D);
    expect(jumpHeightSliderMax('2d', 9, 0)).toBe(JUMP_RATE_SLIDER_MAX_2D);
  });
});

describe('jumpHeightUnit', () => {
  it('labels 3D in metres and 2D not at all', () => {
    expect(jumpHeightUnit('3d')).toBe('m');
    expect(jumpHeightUnit('2d')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The 2D branch is a hand-mirrored copy of `CharacterControllerData::default()`
// in Rust. A native `cargo test` cannot see the TS constant and this suite
// cannot construct the Rust struct, so reading the source is the only check
// available — the same idiom `gameCameraPayload.test.ts` uses for
// `ENGINE_CAMERA_DEFAULTS`. Fails closed: an unreadable file, a missing impl,
// or a literal it cannot parse is a failure, never a skip.
// ---------------------------------------------------------------------------

describe('the 2D default mirrors CharacterControllerData::default()', () => {
  const RUST = join(
    __dirname, '..', '..', '..', '..', '..',
    'engine', 'src', 'core', 'game_components.rs',
  );

  /** The body of `impl Default for CharacterControllerData`. */
  function defaultImplBody(): string {
    const source = readFileSync(RUST, 'utf8');
    const start = source.indexOf('impl Default for CharacterControllerData');
    expect(start, `no CharacterControllerData Default impl in ${RUST}`).toBeGreaterThan(-1);
    const body = source.slice(start, start + 400);
    const end = body.indexOf('\n}');
    expect(end, 'unterminated Default impl').toBeGreaterThan(-1);
    return body.slice(0, end);
  }

  /**
   * A Rust numeric literal as written in source. Deliberately wider than
   * `\d+(\.\d+)?` — `5.0_f32`, `5f32`, `1_000.0` and `1e3` are all the same
   * value to rustc, and because the caller asserts on a null match a narrow
   * pattern reads as "the field is missing" and points at the wrong thing.
   */
  const NUM = String.raw`-?[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][-+]?[0-9]+)?(?:_?f(?:32|64))?`;

  function rustNumber(body: string, field: string): number {
    const m = body.match(new RegExp(String.raw`\b${field}:\s*(${NUM})`));
    expect(m, `no ${field} literal in CharacterControllerData::default()`).not.toBeNull();
    const parsed = Number(m![1]!.replace(/_/g, '').replace(/f(32|64)$/, ''));
    expect(Number.isFinite(parsed), `unparseable ${field}: ${m![1]}`).toBe(true);
    return parsed;
  }

  it('matches speed, jump_height and gravity_scale field for field', () => {
    const body = defaultImplBody();
    const d = defaultCharacterController('2d');
    expect(d.speed).toBe(rustNumber(body, 'speed'));
    expect(d.jumpHeight).toBe(rustNumber(body, 'jump_height'));
    expect(d.gravityScale).toBe(rustNumber(body, 'gravity_scale'));
    expect(body).toContain('can_double_jump: false');
    expect(d.canDoubleJump).toBe(false);
  });
});
