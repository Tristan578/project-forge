import { z } from 'zod';
import { jumpForceToApexHeight, PHYSICS_PRESETS, type PhysicsProfile } from '@/lib/ai/physicsFeel';
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
 * pipeline need the same answer. `character_setup` builds the player's
 * CharacterController from it, and `physics_profile` writes the profile onto
 * the world. Since planBuilder's Phase 3a deferral they run in THAT order —
 * `physics_profile` is re-planned after every `physics_enable`, which puts it
 * after `character_setup` — so `applyPhysicsProfile`, which only tunes a
 * controller that ALREADY exists, finds the player's and merges the same
 * speed/jumpForce/gravity onto it. Agreement is therefore load-bearing, not
 * cosmetic: if `character_setup` resolved the profile its own way (or, as it
 * used to, hardcoded one), the two steps would fight over the player's
 * controller and a floaty space game and a weighty RPG would still produce
 * byte-identical player movement.
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

  // Hoisted into locals so `usableOverride`'s type predicate narrows them for
  // real. Reading `config!['moveSpeed'] as number` inside the spread needed a
  // non-null assertion AND a cast to compile, and both of those launder exactly
  // the check this guard exists to enforce — a later edit to the guard would go
  // on compiling while forwarding `undefined` or a string to the engine.
  //
  // Read behind `Object.hasOwn`: a bare `config?.['moveSpeed']` walks the
  // prototype chain, so an inherited value the GDD never set would be forwarded
  // to the engine as though a designer had chosen it.
  const rawSpeed = own(config, 'moveSpeed');
  const rawJump = own(config, 'jumpForce');

  return {
    ...baseProfile,
    ...(usableOverride(rawSpeed, ENGINE_SPEED_MAX) ? { moveSpeed: rawSpeed } : {}),
    ...(usableOverride(rawJump, ENGINE_JUMP_HEIGHT_MAX) ? { jumpForce: rawJump } : {}),
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
/** An OWN property of `config`, or `undefined` — never anything inherited. */
function own(config: Record<string, unknown> | undefined, key: string): unknown {
  return config && Object.hasOwn(config, key) ? config[key] : undefined;
}

function usableOverride(value: unknown, max: number): value is number {
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
  const gravityScale = profile.gravity / 10;
  return {
    speed: profile.moveSpeed,
    // The engine reads `jumpHeight` as a real height in metres and derives the
    // launch speed itself, so the preset's unitless dial has to be converted —
    // passing it through asked for a 14-metre jump (PF-1214, finding #1).
    jumpHeight: jumpForceToApexHeight(profile.jumpForce, gravityScale),
    gravityScale,
  };
}
