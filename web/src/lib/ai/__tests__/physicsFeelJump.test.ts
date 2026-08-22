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
