/**
 * Jump calibration — what a player FEELS, not what a formula says.
 *
 * Every path that tunes a character controller from a physics preset used to
 * pass the preset's unitless `jumpForce` straight into the engine's
 * `jumpHeight`, which the kinematic controller reads as a real height in metres
 * and converts to a launch speed with `v = sqrt(2 * g * s * h)`. The snappy
 * platformer preset therefore asked for a 14-metre jump with a 3.4s hang time,
 * and nothing anywhere rejected it: a large height is a valid height (PF-1214,
 * review finding #1).
 *
 * These tests assert AIRTIME, in seconds, because that is the thing a creator
 * notices. Asserting the height back out of the height conversion would pass on
 * any monotonic function, including the identity that shipped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GRAVITY_ACCEL_MPS2,
  JUMP_FORCE_TO_LAUNCH_SPEED,
  MAX_JUMP_AIRTIME_SECONDS,
  PHYSICS_PRESETS,
  PRESET_KEYS,
  jumpAirtimeSeconds,
  jumpForceToApexHeight,
} from '../physicsFeel';

/**
 * The band a platformer jump has to live in to feel like a jump.
 *
 * Below ~0.5s the player cannot react mid-air and the jump reads as a twitch;
 * above ~1.5s they have handed over control for longer than most obstacles
 * take to cross. Both bounds are inclusive — `MAX_JUMP_AIRTIME_SECONDS` is a
 * deliberate landing spot for the two near-weightless presets, not a value to
 * be kept clear of.
 */
const MIN_PLAYABLE_AIRTIME = 0.5;
const MAX_PLAYABLE_AIRTIME = MAX_JUMP_AIRTIME_SECONDS;

/** The one preset with no jump at all — `jumpForce: 0` is intentional there. */
const NON_JUMPING_PRESETS = new Set(['racing']);

describe('jumpForceToApexHeight', () => {
  it.each(PRESET_KEYS.filter((k) => !NON_JUMPING_PRESETS.has(k)))(
    'gives %s an airtime a platformer can actually play',
    (key) => {
      const profile = PHYSICS_PRESETS[key];
      const gravityScale = profile.gravity / 10;
      const height = jumpForceToApexHeight(profile.jumpForce, gravityScale);
      const airtime = jumpAirtimeSeconds(height, gravityScale);

      expect(airtime).toBeGreaterThanOrEqual(MIN_PLAYABLE_AIRTIME);
      expect(airtime).toBeLessThanOrEqual(MAX_PLAYABLE_AIRTIME);
    },
  );

  it('leaves the one deliberately jumpless preset at zero', () => {
    const profile = PHYSICS_PRESETS.racing;
    expect(profile.jumpForce).toBe(0);
    expect(jumpForceToApexHeight(profile.jumpForce, profile.gravity / 10)).toBe(0);
  });

  /**
   * The regression this whole helper exists for. Every preset that jumps used
   * to ship its raw dial as a height; if any of them ever agrees with the dial
   * again, the conversion has been unwired.
   */
  it.each(PRESET_KEYS.filter((k) => !NON_JUMPING_PRESETS.has(k)))(
    'does not hand %s its raw jumpForce back as a height',
    (key) => {
      const profile = PHYSICS_PRESETS[key];
      const height = jumpForceToApexHeight(profile.jumpForce, profile.gravity / 10);
      expect(height).not.toBeCloseTo(profile.jumpForce, 3);
    },
  );

  /**
   * Pins the two presets that hit the cap, so a change to
   * `MAX_JUMP_AIRTIME_SECONDS` or to their gravity has to be a deliberate edit
   * rather than a silent drift out of the band above.
   */
  it.each([
    ['space_zero_g'],
    ['underwater'],
  ])('caps the near-weightless preset %s at the airtime ceiling', (key) => {
    const profile = PHYSICS_PRESETS[key];
    const gravityScale = profile.gravity / 10;
    const uncapped =
      (2 * JUMP_FORCE_TO_LAUNCH_SPEED * profile.jumpForce) /
      (GRAVITY_ACCEL_MPS2 * gravityScale);

    expect(uncapped).toBeGreaterThan(MAX_JUMP_AIRTIME_SECONDS);

    const height = jumpForceToApexHeight(profile.jumpForce, gravityScale);
    expect(jumpAirtimeSeconds(height, gravityScale)).toBeCloseTo(MAX_JUMP_AIRTIME_SECONDS, 6);
  });

  it('is monotonic in jumpForce at a fixed gravity', () => {
    const small = jumpForceToApexHeight(5, 1);
    const large = jumpForceToApexHeight(10, 1);
    expect(large).toBeGreaterThan(small);
  });

  it('gives the same jumpForce a lower apex under heavier gravity', () => {
    expect(jumpForceToApexHeight(10, 2)).toBeLessThan(jumpForceToApexHeight(10, 1));
  });

  /**
   * `gravityScale: 0` is reachable — `resolvePhysicsProfile` accepts a gravity
   * override, and a zero-gravity scene is a legitimate thing to author. The
   * naive formula divides by it, so the guard has to be here and not left to
   * the payload builder, which would only see a NaN with no idea where it came
   * from.
   */
  it.each([
    ['zero gravity', 10, 0],
    ['negative gravity', 10, -1],
    ['non-finite gravity', 10, Number.NaN],
    ['zero jump force', 0, 1],
    ['negative jump force', -5, 1],
    ['non-finite jump force', Number.POSITIVE_INFINITY, 1],
  ])('returns 0 rather than a NaN for %s', (_label, jumpForce, gravityScale) => {
    expect(jumpForceToApexHeight(jumpForce, gravityScale)).toBe(0);
  });
});

describe('jumpAirtimeSeconds', () => {
  /**
   * The round trip the preset tests above rely on. If these two drift apart,
   * every airtime assertion in this file becomes an assertion about nothing.
   */
  it('inverts the height conversion', () => {
    const gravityScale = 1.5;
    const height = jumpForceToApexHeight(12, gravityScale);
    const airtime = jumpAirtimeSeconds(height, gravityScale);
    const expectedLaunchSpeed = JUMP_FORCE_TO_LAUNCH_SPEED * 12;

    expect(airtime).toBeCloseTo(
      (2 * expectedLaunchSpeed) / (GRAVITY_ACCEL_MPS2 * gravityScale),
      6,
    );
  });

  it.each([
    ['a zero height', 0, 1],
    ['a negative height', -2, 1],
    ['zero gravity', 2, 0],
  ])('returns 0 for %s', (_label, height, gravityScale) => {
    expect(jumpAirtimeSeconds(height, gravityScale)).toBe(0);
  });
});

/**
 * `GRAVITY_ACCEL_MPS2` is a hand-mirrored copy of a number that lives in Rust,
 * and every figure in this file is derived from it. Nothing checked it, and the
 * drift would be invisible from both sides: a native `cargo test` cannot see the
 * TS constant, and this suite cannot call into the engine. Reading the Rust
 * source is the only check available.
 *
 * Deliberately textual, and it fails closed — an unreadable file, a missing
 * declaration, or a literal it cannot parse is a failure, never a skip.
 */
describe('GRAVITY_ACCEL_MPS2 mirrors the engine constant', () => {
  const RUST = join(
    __dirname, '..', '..', '..', '..', '..',
    'engine', 'src', 'core', 'character_controller.rs',
  );

  /**
   * A Rust `f32` literal as written in source.
   *
   * Wider than `-?\d+(\.\d+)?` on purpose: `-9.81_f32`, `-9.81f32` and `-9.81e0`
   * are all the same value to rustc, so a narrower pattern would report a
   * re-spelled constant as a MISSING one — a failure that points at the wrong
   * problem entirely.
   */
  const RUST_F32 = String.raw`-?\d[\d_]*(?:\.(?:\d[\d_]*)?)?(?:[eE][+-]?\d+)?(?:_?f32)?`;

  it('carries the same magnitude as GRAVITY_ACCEL', () => {
    let source: string;
    try {
      source = readFileSync(RUST, 'utf8');
    } catch (err) {
      throw new Error(`cannot read ${RUST}: ${String(err)}`);
    }

    const match = source.match(
      new RegExp(String.raw`const\s+GRAVITY_ACCEL\s*:\s*f32\s*=\s*(${RUST_F32})\s*;`),
    );
    if (match === null) {
      throw new Error(`no \`const GRAVITY_ACCEL: f32 = …;\` declaration found in ${RUST}`);
    }

    const literal = match[1]!;
    const parsed = Number(literal.replace(/_?f32$/, '').replace(/_/g, ''));
    if (!Number.isFinite(parsed)) {
      throw new Error(`unparseable Rust f32 literal for GRAVITY_ACCEL: "${literal}"`);
    }

    // The engine's constant is signed — it is an acceleration, and it points
    // down. Every formula on the TS side uses the magnitude, so the sign is
    // dropped here and pinned separately: a constant that stopped being
    // negative would leave the magnitude assertion green while the engine
    // launched characters into the floor.
    expect(Math.abs(parsed)).toBe(GRAVITY_ACCEL_MPS2);
    expect(parsed).toBeLessThan(0);
  });
});

/**
 * The exact apex height, in metres, each preset ships today.
 *
 * Every other assertion in this file recomputes its expectation from the same
 * constants the code under test uses, so a drift in
 * `JUMP_FORCE_TO_LAUNCH_SPEED` (0.45 -> 0.5, say) moves the code and the
 * expectation together and the whole suite stays green on a jump that got 23%
 * higher. These literals were derived once, by hand, from
 * `h = (k * jumpForce)^2 / (2 * g * s)` — capped presets from
 * `h = t^2 * g * s / 8` — and are the only numbers in this file that do not
 * move when the implementation does.
 */
const EXPECTED_APEX_METRES: Record<(typeof PRESET_KEYS)[number], number> = {
  platformer_floaty: 1.321101,
  platformer_snappy: 1.348624,
  rpg_weighty: 0.743119,
  arcade_classic: 1.032110,
  space_zero_g: 0.137953, // airtime-capped
  underwater: 0.827719, // airtime-capped
  racing: 0, // jumpForce 0 — deliberately jumpless
  puzzle_precise: 0.660550,
};

describe('per-preset apex heights', () => {
  it('pins every preset, so a new one cannot ship unmeasured', () => {
    expect(Object.keys(EXPECTED_APEX_METRES).sort()).toEqual([...PRESET_KEYS].sort());
  });

  it.each(PRESET_KEYS)('gives %s the height a creator was measured against', (key) => {
    const profile = PHYSICS_PRESETS[key];
    const height = jumpForceToApexHeight(profile.jumpForce, profile.gravity / 10);

    expect(height).toBeCloseTo(EXPECTED_APEX_METRES[key], 5);
  });
});
