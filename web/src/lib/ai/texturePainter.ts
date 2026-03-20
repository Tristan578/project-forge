/**
 * AI Texture Painter — generates texture modification prompts and applies
 * material adjustments based on natural-language style descriptions.
 *
 * This module is purely functional: it builds prompts and computes material
 * deltas.  Actual image generation is handled by external AI providers.
 */

import type { MaterialData } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which texture map slot to target. */
export type TextureSlot =
  | 'base_color'
  | 'normal'
  | 'metallic_roughness'
  | 'emissive'
  | 'occlusion';

/** How the generated texture is composited with the existing one. */
export type BlendMode = 'replace' | 'overlay' | 'multiply' | 'add';

/** A user-requested texture modification. */
export interface TextureModification {
  description: string;
  targetSlot: TextureSlot;
  intensity: number; // 0-1
  blendMode: BlendMode;
}

/** Scalar material properties a style may adjust. */
export interface MaterialProperties {
  roughness: number;
  metallic: number;
  emissive: number;
  opacity: number;
}

/** A named, reusable texture style with prompt and material hints. */
export interface TextureStyle {
  name: string;
  description: string;
  promptModifier: string;
  materialAdjustments: Partial<MaterialProperties>;
}

/** Dispatcher function matching the editor store pattern. */
export type CommandDispatcher = (command: string, payload: unknown) => void;

// ---------------------------------------------------------------------------
// Pre-built texture styles (10+)
// ---------------------------------------------------------------------------

export const TEXTURE_STYLES: TextureStyle[] = [
  {
    name: 'weathered',
    description: 'Worn surface with faded color and rough edges',
    promptModifier: 'weathered, worn, faded paint, rough edges, aging patina',
    materialAdjustments: { roughness: 0.85, metallic: 0.1, opacity: 1.0 },
  },
  {
    name: 'rusty',
    description: 'Corroded metal with orange-brown rust patches',
    promptModifier: 'rusty metal, iron oxide, corroded, orange-brown rust patches, flaking paint',
    materialAdjustments: { roughness: 0.95, metallic: 0.2, opacity: 1.0 },
  },
  {
    name: 'mossy',
    description: 'Organic surface overgrown with green moss and lichen',
    promptModifier: 'moss covered, green lichen, organic growth, damp stone, overgrown',
    materialAdjustments: { roughness: 0.9, metallic: 0.0, opacity: 1.0 },
  },
  {
    name: 'frozen',
    description: 'Ice-encrusted surface with frost crystals',
    promptModifier: 'frozen, ice crystals, frost covered, blue ice, frozen surface, rime ice',
    materialAdjustments: { roughness: 0.15, metallic: 0.6, opacity: 0.9 },
  },
  {
    name: 'burning',
    description: 'Charred surface with glowing embers',
    promptModifier: 'burning, charred wood, glowing embers, fire-damaged, smoldering',
    materialAdjustments: { roughness: 0.8, metallic: 0.0, emissive: 0.7, opacity: 1.0 },
  },
  {
    name: 'ancient',
    description: 'Old cracked surface with worn-away detail',
    promptModifier: 'ancient, cracked stone, worn edges, archaeological relic, time-worn',
    materialAdjustments: { roughness: 0.85, metallic: 0.05, opacity: 1.0 },
  },
  {
    name: 'neon_glow',
    description: 'Bright neon-lit surface with vivid emissive glow',
    promptModifier: 'neon glow, cyberpunk, bright fluorescent, emissive light strips',
    materialAdjustments: { roughness: 0.3, metallic: 0.4, emissive: 0.9, opacity: 1.0 },
  },
  {
    name: 'holographic',
    description: 'Iridescent rainbow shimmer on a smooth surface',
    promptModifier: 'holographic, iridescent, rainbow shimmer, chrome-like, reflective',
    materialAdjustments: { roughness: 0.1, metallic: 0.95, opacity: 1.0 },
  },
  {
    name: 'hand_painted',
    description: 'Stylized hand-painted texture with visible brush strokes',
    promptModifier: 'hand painted, stylized, visible brush strokes, soft color banding, art style',
    materialAdjustments: { roughness: 0.7, metallic: 0.0, opacity: 1.0 },
  },
  {
    name: 'pixel_art',
    description: 'Low-resolution retro pixel art style',
    promptModifier: 'pixel art, 16-bit retro, posterized colors, no anti-aliasing, blocky',
    materialAdjustments: { roughness: 0.5, metallic: 0.0, opacity: 1.0 },
  },
  {
    name: 'metallic_polished',
    description: 'Clean polished metal with high reflectivity',
    promptModifier: 'polished metal, chrome finish, mirror-like surface, clean reflective',
    materialAdjustments: { roughness: 0.05, metallic: 1.0, opacity: 1.0 },
  },
  {
    name: 'sandy',
    description: 'Dry sandy surface with fine grain texture',
    promptModifier: 'sandy surface, desert sand, fine grain, dry arid, sandstone',
    materialAdjustments: { roughness: 0.8, metallic: 0.0, opacity: 1.0 },
  },
];

// ---------------------------------------------------------------------------
// Prompt generation
// ---------------------------------------------------------------------------

const SLOT_PROMPT_HINTS: Record<TextureSlot, string> = {
  base_color: 'diffuse albedo color map',
  normal: 'tangent-space normal map, blue-tinted',
  metallic_roughness: 'metallic-roughness PBR map, grayscale',
  emissive: 'emissive glow map, black background with colored emission',
  occlusion: 'ambient occlusion map, grayscale cavity detail',
};

const BLEND_DESCRIPTIONS: Record<BlendMode, string> = {
  replace: 'fully replacing the existing texture',
  overlay: 'overlaid on top of the existing texture',
  multiply: 'multiplied with the existing texture for darkening',
  add: 'additively blended with the existing texture for brightening',
};

/**
 * Build an AI image-generation prompt from a modification request and optional
 * style.  The returned string is suitable for providers like Meshy or
 * Stable Diffusion.
 */
export function generateTexturePrompt(
  modification: TextureModification,
  style?: TextureStyle,
): string {
  const parts: string[] = [];

  // Core description
  parts.push(`Generate a seamless tileable PBR ${SLOT_PROMPT_HINTS[modification.targetSlot]}.`);

  // User description
  parts.push(`Style: ${modification.description}.`);

  // Style modifier
  if (style) {
    parts.push(`Aesthetic: ${style.promptModifier}.`);
  }

  // Intensity hint
  if (modification.intensity < 0.3) {
    parts.push('Apply the effect subtly.');
  } else if (modification.intensity > 0.7) {
    parts.push('Apply the effect strongly and prominently.');
  }

  // Blend context
  parts.push(`This texture will be ${BLEND_DESCRIPTIONS[modification.blendMode]}.`);

  // Quality boilerplate
  parts.push('High resolution, 1024x1024, seamless tiling, game-ready PBR texture.');

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Material adjustment
// ---------------------------------------------------------------------------

/**
 * Dispatch engine commands to adjust an entity's material properties so they
 * match the given style.  Intensity (0-1) is used to lerp from the entity's
 * current values toward the style's target values.
 */
export function applyMaterialChanges(
  style: TextureStyle,
  entityId: string,
  dispatch: CommandDispatcher,
  intensity: number = 1.0,
  currentBaseColor?: [number, number, number, number],
): void {
  const adj = style.materialAdjustments;
  const payload: Record<string, unknown> = { entityId };

  // Lerp toward target values using intensity (0 = keep current, 1 = full target)
  // For roughness/metallic we assume a neutral default of 0.5 when current is unknown
  if (adj.roughness !== undefined) {
    const current = 0.5; // TODO: read from entity when available
    payload.perceptualRoughness = current + (adj.roughness - current) * intensity;
  }
  if (adj.metallic !== undefined) {
    const current = 0.0;
    payload.metallic = current + (adj.metallic - current) * intensity;
  }
  if (adj.emissive !== undefined) {
    const e = adj.emissive * intensity;
    payload.emissive = [e, e, e, 1.0];
  }
  if (adj.opacity !== undefined && adj.opacity < 1.0) {
    const a = 1.0 - (1.0 - adj.opacity) * intensity;
    const rgb = currentBaseColor ?? [1, 1, 1, 1];
    payload.baseColor = [rgb[0], rgb[1], rgb[2], a];
    payload.alphaMode = 'blend';
  }

  dispatch('update_material', payload);
}

// ---------------------------------------------------------------------------
// Style detection
// ---------------------------------------------------------------------------

/**
 * Heuristic: inspect a MaterialData object and return the closest matching
 * built-in style, or null if nothing matches closely.
 */
export function detectCurrentStyle(materialData: MaterialData): TextureStyle | null {
  let bestMatch: TextureStyle | null = null;
  let bestScore = Infinity;

  for (const style of TEXTURE_STYLES) {
    const adj = style.materialAdjustments;
    let score = 0;

    if (adj.roughness !== undefined) {
      score += Math.abs(materialData.perceptualRoughness - adj.roughness);
    }
    if (adj.metallic !== undefined) {
      score += Math.abs(materialData.metallic - adj.metallic);
    }
    if (adj.emissive !== undefined) {
      // Average the RGB channels of the emissive color
      const avgEmissive =
        (materialData.emissive[0] + materialData.emissive[1] + materialData.emissive[2]) / 3;
      score += Math.abs(avgEmissive - adj.emissive);
    }

    if (score < bestScore) {
      bestScore = score;
      bestMatch = style;
    }
  }

  // Only return a match if the score is reasonably close (threshold)
  if (bestScore > 0.5) return null;
  return bestMatch;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export const VALID_TEXTURE_SLOTS: TextureSlot[] = [
  'base_color',
  'normal',
  'metallic_roughness',
  'emissive',
  'occlusion',
];

export const VALID_BLEND_MODES: BlendMode[] = ['replace', 'overlay', 'multiply', 'add'];

/** Clamp a number to [min, max]. */
export function clampIntensity(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Look up a style by name (case-insensitive). Returns undefined if not found. */
export function findStyleByName(name: string): TextureStyle | undefined {
  const lower = name.toLowerCase();
  return TEXTURE_STYLES.find((s) => s.name.toLowerCase() === lower);
}
