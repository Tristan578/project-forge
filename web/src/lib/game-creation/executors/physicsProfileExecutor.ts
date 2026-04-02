import { z } from 'zod';
import { PHYSICS_PRESETS, applyPhysicsProfile } from '@/lib/ai/physicsFeel';
import type { FeelDirective, ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';

// [B3] Map feel directive to closest physics preset
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

function resolvePresetFromFeel(feel: FeelDirective): string {
  const byWeight = FEEL_TO_PRESET[feel.weight];
  if (byWeight) {
    return byWeight[feel.pacing] ?? 'arcade_classic';
  }
  return 'arcade_classic';
}

const inputSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  feelDirective: z.object({
    mood: z.string(),
    pacing: z.enum(['slow', 'medium', 'fast']),
    weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
    referenceGames: z.array(z.string()),
    oneLiner: z.string(),
  }),
  projectType: z.enum(['2d', '3d']),
  entityIds: z.array(z.string()).optional(),
});

export const physicsProfileExecutor: ExecutorDefinition = {
  name: 'physics_profile',
  inputSchema,
  userFacingErrorMessage:
    'Could not configure physics. Your game will use default physics.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      );
    }

    const { feelDirective, config, entityIds } = parsed.data;

    // [B3] Resolve preset from feel directive
    const presetKey = resolvePresetFromFeel(feelDirective as FeelDirective);
    const baseProfile = PHYSICS_PRESETS[presetKey] ?? PHYSICS_PRESETS['arcade_classic'];

    // [S1] Preset values are the base. Only SAFE overrides from config are applied.
    // User-controlled config CANNOT override gravity, friction, or terminal velocity.
    const finalProfile = {
      ...baseProfile,
      ...(typeof config?.['moveSpeed'] === 'number'
        ? { moveSpeed: config['moveSpeed'] as number }
        : {}),
      ...(typeof config?.['jumpForce'] === 'number'
        ? { jumpForce: config['jumpForce'] as number }
        : {}),
    };

    const ids = entityIds ?? [];

    // When called from movement system registry without entityIds, apply the
    // physics profile globally via update_physics_config (scene-level settings).
    // Per-entity physics is applied when entityIds are provided.
    if (ids.length === 0) {
      // No physics entities to configure. The engine has no global
      // physics config command — per-entity update_physics is the only
      // option. Return success so downstream steps aren't blocked.
      return successResult({ presetUsed: presetKey, entityCount: 0, appliedGlobally: false });
    }

    applyPhysicsProfile(finalProfile, ctx.dispatchCommand, ids);

    return successResult({ presetUsed: presetKey, entityCount: ids.length, appliedGlobally: false });
  },
};

