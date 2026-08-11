import { z } from 'zod';
import { PHYSICS_PRESETS, type PhysicsProfile } from '@/lib/ai/physicsFeel';
import type { FeelDirective } from './types';

/**
 * The shape a step must supply for the feel directive to be usable.
 *
 * `physics_profile` requires it outright — a profile step with no directive has
 * nothing to do. `character_setup` treats it as optional and falls back to its
 * defaults, because a player that moves at default speed still beats a player
 * with no CharacterController at all.
 */
export const feelDirectiveSchema = z.object({
  mood: z.string(),
  pacing: z.enum(['slow', 'medium', 'fast']),
  weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
  referenceGames: z.array(z.string()),
  oneLiner: z.string(),
});

/**
 * The single source of the feel -> physics-preset mapping.
 *
 * This lives outside any one executor because TWO steps on the movement
 * pipeline need the same answer. `physics_profile` writes the profile onto the
 * world, and `character_setup` builds the player's CharacterController from it.
 * They run in that order (see `systems/movement.ts`), and `applyPhysicsProfile`
 * deliberately only tunes a controller that ALREADY exists — so at the moment
 * `physics_profile` runs, the player has none and the controller half of the
 * profile is a guaranteed no-op. If `character_setup` then resolved the profile
 * its own way (or, as it used to, hardcoded one), a floaty space game and a
 * weighty RPG would produce byte-identical player movement.
 *
 * Sharing the resolver is what makes the two steps agree by construction rather
 * than by two copies of a table staying in sync by luck.
 */
const FEEL_TO_PRESET: Record<string, Record<string, string>> = {
  floaty: {
    slow: 'space_zero_g',
    medium: 'platformer_floaty',
    fast: 'platformer_floaty',
  },
  light: {
    slow: 'underwater',
    medium: 'platformer_floaty',
    fast: 'platformer_snappy',
  },
  medium: {
    slow: 'puzzle_precise',
    medium: 'arcade_classic',
    fast: 'arcade_classic',
  },
  heavy: {
    slow: 'rpg_weighty',
    medium: 'rpg_weighty',
    fast: 'rpg_weighty',
  },
  weighty: {
    slow: 'rpg_weighty',
    medium: 'rpg_weighty',
    fast: 'platformer_snappy',
  },
};

export const DEFAULT_PRESET_KEY = 'arcade_classic';

/** [B3] Map a feel directive to the closest physics preset key. */
export function resolvePresetFromFeel(feel: FeelDirective): string {
  const byWeight = FEEL_TO_PRESET[feel.weight];
  if (byWeight) {
    return byWeight[feel.pacing] ?? DEFAULT_PRESET_KEY;
  }
  return DEFAULT_PRESET_KEY;
}

/**
 * Resolve the physics profile a step should apply.
 *
 * [S1] Preset values are the base. Only SAFE overrides from `config` are
 * applied — user-controlled config CANNOT override gravity, friction, or
 * terminal velocity, because those are what keep a generated game physically
 * coherent. `moveSpeed` and `jumpForce` are the two knobs a system config is
 * allowed to move.
 */
export function resolvePhysicsProfile(
  feel: FeelDirective,
  config?: Record<string, unknown>,
): PhysicsProfile {
  const presetKey = resolvePresetFromFeel(feel);
  const baseProfile = PHYSICS_PRESETS[presetKey] ?? PHYSICS_PRESETS[DEFAULT_PRESET_KEY];

  return {
    ...baseProfile,
    ...(usableOverride(config?.['moveSpeed'], ENGINE_SPEED_MAX)
      ? { moveSpeed: config!['moveSpeed'] as number }
      : {}),
    ...(usableOverride(config?.['jumpForce'], ENGINE_JUMP_HEIGHT_MAX)
      ? { jumpForce: config!['jumpForce'] as number }
      : {}),
  };
}

/**
 * The engine's own clamps on the fields these two overrides become
 * (`build_game_component`, `engine/src/core/game_components.rs`): `speed` is
 * clamped to `0.0..=1000.0` and `jumpHeight` to `0.0..=100.0`.
 */
const ENGINE_SPEED_MAX = 1000;
const ENGINE_JUMP_HEIGHT_MAX = 100;

/**
 * Whether a config override is a value the engine will actually honour.
 *
 * `Number.isFinite` alone was not enough. `systemConfig` is raw GDD config, i.e.
 * LLM-authored, and a plausible design phrase ("reverse controls", "moves
 * backward") is enough to produce `"moveSpeed": -8`. A negative speed passed
 * both guards, reached `add_game_component`, and was clamped by `prop_f32` to
 * `0.0` — reproducing exactly the immovable player this whole path exists to
 * fix, with no error raised anywhere. Zero is rejected for the same reason.
 *
 * Out-of-range is rejected rather than clamped here on purpose: silently
 * substituting a number nobody chose is what makes this defect class invisible.
 * Falling back to the preset value keeps the player playable AND keeps the
 * preset's coherent relationship between speed, jump and gravity intact.
 */
function usableOverride(value: unknown, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;
}

/**
 * The CharacterController values that correspond to a resolved profile.
 *
 * `gravityScale` must match what `applyPhysicsProfile` writes (`gravity / 10`)
 * or the two paths disagree the moment a controller happens to exist already.
 */
export function characterControllerFromProfile(profile: PhysicsProfile): {
  speed: number;
  jumpHeight: number;
  gravityScale: number;
} {
  return {
    speed: profile.moveSpeed,
    jumpHeight: profile.jumpForce,
    gravityScale: profile.gravity / 10,
  };
}
