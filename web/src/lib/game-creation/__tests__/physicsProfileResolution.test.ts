import { describe, it, expect } from 'vitest';
import { jumpForceToApexHeight, PHYSICS_PRESETS } from '@/lib/ai/physicsFeel';
import {
  resolvePhysicsProfile,
  resolvePresetFromFeel,
  characterControllerFromProfile,
  DEFAULT_PRESET_KEY,
} from '../physicsProfileResolution';
import type { FeelDirective } from '../types';

/**
 * The real `PHYSICS_PRESETS` is used here on purpose — no `vi.mock`.
 *
 * The whole point of this suite is that an override which the engine would
 * clamp to zero falls back to a value that keeps the player moving, and a
 * mocked preset table could satisfy every assertion while the real one shipped
 * a `moveSpeed` of `0`.
 */

function feel(overrides: Partial<FeelDirective> = {}): FeelDirective {
  return {
    mood: 'bright',
    pacing: 'medium',
    weight: 'medium',
    referenceGames: [],
    oneLiner: 'a test directive',
    ...overrides,
  } as FeelDirective;
}

/** `medium` / `medium` -> `arcade_classic`, asserted below rather than assumed. */
const BASE = PHYSICS_PRESETS.arcade_classic;

describe('resolvePhysicsProfile override guard', () => {
  it('resolves the baseline this suite compares against', () => {
    expect(resolvePresetFromFeel(feel())).toBe('arcade_classic');
    expect(DEFAULT_PRESET_KEY).toBe('arcade_classic');
  });

  describe('the engine ceilings', () => {
    /**
     * These two numbers are not free parameters. `build_game_component`
     * (`engine/src/core/game_components.rs`) clamps `speed` to `0.0..=1000.0`
     * and `jumpHeight` to `0.0..=100.0` via `prop_f32`, and an override above a
     * ceiling is what the guard exists to reject. If the engine clamps move,
     * these assertions are the thing that fails first.
     */
    it('accepts an override sitting exactly on the speed ceiling', () => {
      const profile = resolvePhysicsProfile(feel(), { moveSpeed: 1000 });
      expect(profile.moveSpeed).toBe(1000);
    });

    it('accepts an override sitting exactly on the jump ceiling', () => {
      const profile = resolvePhysicsProfile(feel(), { jumpForce: 100 });
      expect(profile.jumpForce).toBe(100);
    });

    it('rejects a speed one above the ceiling', () => {
      const profile = resolvePhysicsProfile(feel(), { moveSpeed: 1001 });
      expect(profile.moveSpeed).toBe(BASE.moveSpeed);
    });

    it('rejects a jump one above the ceiling', () => {
      const profile = resolvePhysicsProfile(feel(), { jumpForce: 101 });
      expect(profile.jumpForce).toBe(BASE.jumpForce);
    });

    /**
     * The constant-swap detector, and the reason it is a separate case.
     *
     * `150` is below the SPEED ceiling and above the JUMP ceiling, so it is the
     * one value that distinguishes "each override is checked against its own
     * engine limit" from "both are checked against whichever constant happens to
     * be in scope". Hand the jumpForce call the speed ceiling and this is the
     * only assertion in the file that notices.
     */
    it('rejects a jump of 150 — under the speed ceiling, over its own', () => {
      const profile = resolvePhysicsProfile(feel(), { jumpForce: 150 });
      expect(profile.jumpForce).toBe(BASE.jumpForce);
    });

    it('accepts a speed of 150 — the same number, its own ceiling is higher', () => {
      const profile = resolvePhysicsProfile(feel(), { moveSpeed: 150 });
      expect(profile.moveSpeed).toBe(150);
    });
  });

  describe('values the engine would clamp to an immovable player', () => {
    it.each([
      ['negative', -8],
      ['zero', 0],
    ])('rejects a %s speed', (_label, moveSpeed) => {
      const profile = resolvePhysicsProfile(feel(), { moveSpeed });
      expect(profile.moveSpeed).toBe(BASE.moveSpeed);
    });

    it.each([
      ['negative', -3],
      ['zero', 0],
    ])('rejects a %s jump', (_label, jumpForce) => {
      const profile = resolvePhysicsProfile(feel(), { jumpForce });
      expect(profile.jumpForce).toBe(BASE.jumpForce);
    });
  });

  describe('non-finite and non-numeric config', () => {
    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['a numeric string', '12'],
      ['null', null],
      ['an object', { value: 12 }],
    ])('rejects %s as a speed', (_label, moveSpeed) => {
      const profile = resolvePhysicsProfile(feel(), { moveSpeed });
      expect(profile.moveSpeed).toBe(BASE.moveSpeed);
    });

    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['a numeric string', '12'],
      ['null', null],
    ])('rejects %s as a jump', (_label, jumpForce) => {
      const profile = resolvePhysicsProfile(feel(), { jumpForce });
      expect(profile.jumpForce).toBe(BASE.jumpForce);
    });

    it('rejects an inherited property rather than reading the prototype chain', () => {
      const config = Object.create({ moveSpeed: 42 }) as Record<string, unknown>;
      const profile = resolvePhysicsProfile(feel(), config);
      expect(profile.moveSpeed).toBe(BASE.moveSpeed);
    });
  });

  describe('the fields config may never touch', () => {
    /**
     * Only `moveSpeed` and `jumpForce` are spread. A config key that names any
     * other profile field must not reach the returned profile — those are what
     * keep a generated game physically coherent.
     */
    it('ignores gravity, friction and terminal velocity', () => {
      const profile = resolvePhysicsProfile(feel(), {
        gravity: 999,
        friction: 0,
        terminalVelocity: 1e6,
        restitution: 1,
        airControl: 1,
      });
      expect(profile.gravity).toBe(BASE.gravity);
      expect(profile.friction).toBe(BASE.friction);
      expect(profile.terminalVelocity).toBe(BASE.terminalVelocity);
      expect(profile.restitution).toBe(BASE.restitution);
      expect(profile.airControl).toBe(BASE.airControl);
    });

    it('returns the preset untouched with no config at all', () => {
      expect(resolvePhysicsProfile(feel())).toEqual(BASE);
      expect(resolvePhysicsProfile(feel(), {})).toEqual(BASE);
    });
  });

  describe('preset selection', () => {
    it('maps each weight/pacing pair the table declares', () => {
      expect(resolvePresetFromFeel(feel({ weight: 'floaty', pacing: 'slow' }))).toBe(
        'space_zero_g',
      );
      expect(resolvePresetFromFeel(feel({ weight: 'floaty', pacing: 'fast' }))).toBe(
        'platformer_floaty',
      );
      expect(resolvePresetFromFeel(feel({ weight: 'light', pacing: 'slow' }))).toBe(
        'underwater',
      );
      expect(resolvePresetFromFeel(feel({ weight: 'light', pacing: 'fast' }))).toBe(
        'platformer_snappy',
      );
      expect(resolvePresetFromFeel(feel({ weight: 'medium', pacing: 'slow' }))).toBe(
        'puzzle_precise',
      );
      expect(resolvePresetFromFeel(feel({ weight: 'heavy', pacing: 'fast' }))).toBe(
        'rpg_weighty',
      );
      expect(resolvePresetFromFeel(feel({ weight: 'weighty', pacing: 'fast' }))).toBe(
        'platformer_snappy',
      );
    });

    /**
     * Unreachable through `physicsProfileExecutor` — `feelDirectiveSchema` gates
     * the executor on a `z.enum`, so an out-of-enum weight never gets this far
     * from there. It IS reachable here, and `character_setup` treats the
     * directive as optional, so the fallback is live code either way.
     */
    it('falls back to the default preset for a weight outside the enum', () => {
      const rogue = { ...feel(), weight: 'gaseous' } as unknown as FeelDirective;
      expect(resolvePresetFromFeel(rogue)).toBe(DEFAULT_PRESET_KEY);
      expect(resolvePhysicsProfile(rogue)).toEqual(PHYSICS_PRESETS.arcade_classic);
    });

    it('falls back to the default preset for a pacing outside the enum', () => {
      const rogue = { ...feel({ weight: 'heavy' }), pacing: 'glacial' } as unknown as FeelDirective;
      expect(resolvePresetFromFeel(rogue)).toBe(DEFAULT_PRESET_KEY);
    });

    it('still applies a usable override on top of the fallback preset', () => {
      const rogue = { ...feel(), weight: 'gaseous' } as unknown as FeelDirective;
      const profile = resolvePhysicsProfile(rogue, { moveSpeed: 9 });
      expect(profile.moveSpeed).toBe(9);
      expect(profile.gravity).toBe(PHYSICS_PRESETS.arcade_classic.gravity);
    });
  });
});

describe('characterControllerFromProfile', () => {
  /**
   * `applyPhysicsProfile` writes `gravityScale: profile.gravity / 10`. If these
   * two disagree, a controller that already exists gets tuned one way by
   * `physics_profile` and another by `character_setup`, and the last writer wins
   * silently.
   */
  it('divides gravity by ten to reach the engine gravityScale', () => {
    expect(characterControllerFromProfile(PHYSICS_PRESETS.arcade_classic)).toEqual({
      speed: 7,
      // Not the preset's `jumpForce` of 10 — that is a unitless dial, and
      // `jumpHeight` is a height in metres (PF-1214, finding #1).
      jumpHeight: jumpForceToApexHeight(10, 1),
      gravityScale: 1,
    });
  });

  it('carries a fractional gravity through without rounding', () => {
    expect(characterControllerFromProfile(PHYSICS_PRESETS.space_zero_g).gravityScale).toBe(
      0.05,
    );
  });

  it('reads the overridden fields, not the preset ones', () => {
    const profile = resolvePhysicsProfile(feel(), { moveSpeed: 11, jumpForce: 22 });
    expect(characterControllerFromProfile(profile)).toEqual({
      speed: 11,
      jumpHeight: jumpForceToApexHeight(22, BASE.gravity / 10),
      gravityScale: BASE.gravity / 10,
    });
  });
});
