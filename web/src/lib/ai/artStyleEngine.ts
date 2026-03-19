/**
 * Art Style Consistency Engine
 *
 * Provides art style presets, scene consistency analysis, prompt modifiers
 * for AI generation, and batch material application for coherent game visuals.
 */

import type { MaterialData } from '@/stores/slices/types';
import { hexToLinear, linearToHex } from '@/lib/colorUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColorHarmony = 'complementary' | 'analogous' | 'triadic' | 'monochromatic';

export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
  background: string;
  harmony: ColorHarmony;
}

export interface StyleMaterialPreset {
  roughnessRange: [number, number];
  metallicRange: [number, number];
  emissiveIntensity: number;
  transparency: boolean;
}

export interface ArtStyle {
  name: string;
  description: string;
  colorPalette: ColorPalette;
  materialProperties: StyleMaterialPreset;
  lightingMood: string;
  textureStyle: string;
  geometryStyle: string;
}

export interface EntitySummary {
  entityId: string;
  name: string;
  material: MaterialData | null;
}

export interface StyleDeviation {
  entityId: string;
  entityName: string;
  reasons: string[];
}

export interface StyleConsistencyReport {
  styleName: string;
  totalEntities: number;
  consistentCount: number;
  deviatingCount: number;
  score: number; // 0-100
  deviations: StyleDeviation[];
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const ART_STYLE_PRESETS: Record<string, ArtStyle> = {
  pixel_retro: {
    name: 'Pixel Retro',
    description: 'Limited palette, high saturation, no smoothing — classic 8/16-bit look',
    colorPalette: {
      primary: '#e64040',
      secondary: '#40b0e6',
      accent: '#ffe040',
      neutral: '#404040',
      background: '#1a1a2e',
      harmony: 'triadic',
    },
    materialProperties: {
      roughnessRange: [0.85, 1.0],
      metallicRange: [0.0, 0.05],
      emissiveIntensity: 0.0,
      transparency: false,
    },
    lightingMood: 'bright, flat, minimal shadows',
    textureStyle: 'pixelated, nearest-neighbor, low-res',
    geometryStyle: 'blocky, axis-aligned, sharp edges',
  },
  low_poly: {
    name: 'Low Poly',
    description: 'Flat shading, geometric shapes, bold colours',
    colorPalette: {
      primary: '#4ecdc4',
      secondary: '#ff6b6b',
      accent: '#ffe66d',
      neutral: '#95afc0',
      background: '#dfe6e9',
      harmony: 'triadic',
    },
    materialProperties: {
      roughnessRange: [0.6, 0.9],
      metallicRange: [0.0, 0.1],
      emissiveIntensity: 0.0,
      transparency: false,
    },
    lightingMood: 'soft directional, pastel tones, gentle shadows',
    textureStyle: 'flat colour per face, no textures, vertex colour',
    geometryStyle: 'low polygon count, faceted surfaces, angular',
  },
  realistic: {
    name: 'Realistic',
    description: 'PBR materials, natural lighting, detailed textures',
    colorPalette: {
      primary: '#8b7355',
      secondary: '#5b7a5e',
      accent: '#c4a35a',
      neutral: '#808080',
      background: '#b0c4de',
      harmony: 'analogous',
    },
    materialProperties: {
      roughnessRange: [0.1, 0.9],
      metallicRange: [0.0, 1.0],
      emissiveIntensity: 0.0,
      transparency: false,
    },
    lightingMood: 'natural, soft ambient, realistic shadows, global illumination feel',
    textureStyle: 'high-detail PBR textures, normal maps, roughness maps',
    geometryStyle: 'high polygon count, smooth surfaces, detailed meshes',
  },
  cel_shaded: {
    name: 'Cel Shaded',
    description: 'Black outlines, flat colours, anime-inspired',
    colorPalette: {
      primary: '#ff4757',
      secondary: '#3742fa',
      accent: '#2ed573',
      neutral: '#f1f2f6',
      background: '#ffffff',
      harmony: 'triadic',
    },
    materialProperties: {
      roughnessRange: [0.7, 1.0],
      metallicRange: [0.0, 0.0],
      emissiveIntensity: 0.1,
      transparency: false,
    },
    lightingMood: 'hard light, sharp shadows, two-tone shading',
    textureStyle: 'flat colour, hand-drawn outlines, minimal gradients',
    geometryStyle: 'smooth curves, stylised proportions, clean silhouettes',
  },
  watercolor: {
    name: 'Watercolor',
    description: 'Soft edges, muted colours, paper texture feel',
    colorPalette: {
      primary: '#7eb5a6',
      secondary: '#c9a9a6',
      accent: '#d4c5a9',
      neutral: '#e8dcc8',
      background: '#f5efe0',
      harmony: 'analogous',
    },
    materialProperties: {
      roughnessRange: [0.7, 0.95],
      metallicRange: [0.0, 0.0],
      emissiveIntensity: 0.0,
      transparency: true,
    },
    lightingMood: 'warm, diffused, no harsh shadows, soft ambient',
    textureStyle: 'blurred edges, wash effects, paper grain overlay',
    geometryStyle: 'organic shapes, soft curves, painterly forms',
  },
  neon_cyberpunk: {
    name: 'Neon Cyberpunk',
    description: 'Dark backgrounds, neon accents, high emissive glow',
    colorPalette: {
      primary: '#ff00ff',
      secondary: '#00ffff',
      accent: '#ff3366',
      neutral: '#1a1a2e',
      background: '#0a0a0f',
      harmony: 'complementary',
    },
    materialProperties: {
      roughnessRange: [0.05, 0.4],
      metallicRange: [0.5, 1.0],
      emissiveIntensity: 3.0,
      transparency: true,
    },
    lightingMood: 'dark ambient, neon glow, volumetric light, reflective surfaces',
    textureStyle: 'metallic, glossy, holographic, neon signs',
    geometryStyle: 'angular, industrial, hard-surface, sci-fi',
  },
  fantasy_painterly: {
    name: 'Fantasy Painterly',
    description: 'Warm colours, soft lighting, detailed fantasy world',
    colorPalette: {
      primary: '#8b4513',
      secondary: '#2e8b57',
      accent: '#daa520',
      neutral: '#d2b48c',
      background: '#87ceeb',
      harmony: 'analogous',
    },
    materialProperties: {
      roughnessRange: [0.4, 0.8],
      metallicRange: [0.0, 0.5],
      emissiveIntensity: 0.2,
      transparency: false,
    },
    lightingMood: 'warm golden hour, soft shadows, magical ambience',
    textureStyle: 'hand-painted, detailed, layered colour, warm tones',
    geometryStyle: 'organic shapes, ornate details, stylised realism',
  },
  minimalist: {
    name: 'Minimalist',
    description: 'Monochrome palette, clean geometry, lots of white space',
    colorPalette: {
      primary: '#2d2d2d',
      secondary: '#5a5a5a',
      accent: '#e74c3c',
      neutral: '#f0f0f0',
      background: '#ffffff',
      harmony: 'monochromatic',
    },
    materialProperties: {
      roughnessRange: [0.3, 0.7],
      metallicRange: [0.0, 0.2],
      emissiveIntensity: 0.0,
      transparency: false,
    },
    lightingMood: 'clean, even, soft shadows, bright ambient',
    textureStyle: 'solid colour, no texture, matte finish',
    geometryStyle: 'primitive shapes, clean lines, sparse composition',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Validate that a string is a proper 6-digit hex colour. */
export function isValidHex(hex: string): boolean {
  return HEX_RE.test(hex);
}

/** Euclidean distance between two linear-RGB colours (each in 0-1 range). */
export function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Check whether a value falls within an inclusive range. */
function inRange(value: number, range: [number, number]): boolean {
  return value >= range[0] && value <= range[1];
}

/** Find the nearest palette colour for a linear-RGB value; returns the distance. */
function nearestPaletteDistance(color: [number, number, number], palette: ColorPalette): number {
  const paletteColors = [
    palette.primary,
    palette.secondary,
    palette.accent,
    palette.neutral,
    palette.background,
  ].map((hex) => hexToLinear(hex));

  let minDist = Infinity;
  for (const pc of paletteColors) {
    const d = colorDistance(color, pc);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Analyse how well the entities in a scene conform to a given art style.
 * Returns a report with a 0-100 score and per-entity deviation details.
 */
export function analyzeStyleConsistency(
  entities: EntitySummary[],
  style: ArtStyle,
): StyleConsistencyReport {
  const deviations: StyleDeviation[] = [];
  const { materialProperties, colorPalette } = style;

  const COLOR_DISTANCE_THRESHOLD = 0.55;

  for (const entity of entities) {
    if (!entity.material) continue;

    const reasons: string[] = [];
    const mat = entity.material;

    // Check roughness
    if (!inRange(mat.perceptualRoughness, materialProperties.roughnessRange)) {
      reasons.push(
        `roughness ${mat.perceptualRoughness.toFixed(2)} outside range [${materialProperties.roughnessRange[0]}, ${materialProperties.roughnessRange[1]}]`,
      );
    }

    // Check metallic
    if (!inRange(mat.metallic, materialProperties.metallicRange)) {
      reasons.push(
        `metallic ${mat.metallic.toFixed(2)} outside range [${materialProperties.metallicRange[0]}, ${materialProperties.metallicRange[1]}]`,
      );
    }

    // Check colour proximity to palette
    const baseColor: [number, number, number] = [
      mat.baseColor[0],
      mat.baseColor[1],
      mat.baseColor[2],
    ];
    const dist = nearestPaletteDistance(baseColor, colorPalette);
    if (dist > COLOR_DISTANCE_THRESHOLD) {
      const hex = linearToHex(baseColor[0], baseColor[1], baseColor[2]);
      reasons.push(`base colour ${hex} is far from palette (distance ${dist.toFixed(2)})`);
    }

    // Check transparency expectation
    if (materialProperties.transparency && mat.alphaMode === 'opaque' && mat.baseColor[3] < 0.99) {
      reasons.push('style expects transparency but alpha mode is opaque');
    }

    if (reasons.length > 0) {
      deviations.push({
        entityId: entity.entityId,
        entityName: entity.name,
        reasons,
      });
    }
  }

  const entitiesWithMaterials = entities.filter((e) => e.material !== null).length;
  const consistentCount = entitiesWithMaterials - deviations.length;
  const score = entitiesWithMaterials > 0
    ? Math.round((consistentCount / entitiesWithMaterials) * 100)
    : 100;

  return {
    styleName: style.name,
    totalEntities: entities.length,
    consistentCount,
    deviatingCount: deviations.length,
    score,
    deviations,
  };
}

/**
 * Generate a text modifier to append to AI asset-generation prompts
 * so the generated content matches the chosen art style.
 */
export function generateStylePromptModifier(style: ArtStyle): string {
  const lines: string[] = [
    `Art style: ${style.name} — ${style.description}.`,
    `Colour palette: primary ${style.colorPalette.primary}, secondary ${style.colorPalette.secondary}, accent ${style.colorPalette.accent}, neutral ${style.colorPalette.neutral}, background ${style.colorPalette.background} (${style.colorPalette.harmony} harmony).`,
    `Materials: roughness ${style.materialProperties.roughnessRange[0]}-${style.materialProperties.roughnessRange[1]}, metallic ${style.materialProperties.metallicRange[0]}-${style.materialProperties.metallicRange[1]}.`,
    `Lighting: ${style.lightingMood}.`,
    `Texture: ${style.textureStyle}.`,
    `Geometry: ${style.geometryStyle}.`,
  ];
  if (style.materialProperties.emissiveIntensity > 0) {
    lines.push(`Emissive glow intensity: ${style.materialProperties.emissiveIntensity}.`);
  }
  return lines.join(' ');
}

/**
 * Build a MaterialData patch that nudges an entity's material toward the given style.
 * It clamps roughness/metallic to the style range and picks the nearest palette colour.
 */
export function buildStyleMaterial(
  style: ArtStyle,
  paletteKey: 'primary' | 'secondary' | 'accent' | 'neutral' | 'background' = 'primary',
): MaterialData {
  const { materialProperties, colorPalette } = style;
  const [r, g, b] = hexToLinear(colorPalette[paletteKey]);
  const roughness =
    (materialProperties.roughnessRange[0] + materialProperties.roughnessRange[1]) / 2;
  const metallic =
    (materialProperties.metallicRange[0] + materialProperties.metallicRange[1]) / 2;

  const emissive: [number, number, number, number] =
    materialProperties.emissiveIntensity > 0
      ? [r, g, b, materialProperties.emissiveIntensity]
      : [0, 0, 0, 0];

  return {
    baseColor: [r, g, b, 1.0],
    metallic,
    perceptualRoughness: roughness,
    reflectance: 0.5,
    emissive,
    emissiveExposureWeight: materialProperties.emissiveIntensity > 0 ? 0.5 : 0,
    alphaMode: materialProperties.transparency ? 'blend' : 'opaque',
    alphaCutoff: 0.5,
    doubleSided: false,
    unlit: false,
    uvOffset: [0, 0],
    uvScale: [1, 1],
    uvRotation: 0,
    parallaxDepthScale: 0.1,
    parallaxMappingMethod: 'occlusion',
    maxParallaxLayerCount: 16,
    parallaxReliefMaxSteps: 5,
    clearcoat: 0,
    clearcoatPerceptualRoughness: 0.5,
    specularTransmission: 0,
    diffuseTransmission: 0,
    ior: 1.5,
    thickness: 0,
    attenuationDistance: null,
    attenuationColor: [1, 1, 1],
  };
}

export type CommandDispatcher = (command: string, payload: unknown) => void;

/**
 * Apply an art style to all entities with materials in the scene by dispatching
 * material update commands for each entity.
 */
export function applyStyleToScene(
  style: ArtStyle,
  entityIds: string[],
  dispatch: CommandDispatcher,
): void {
  const paletteKeys: Array<'primary' | 'secondary' | 'accent' | 'neutral' | 'background'> = [
    'primary',
    'secondary',
    'accent',
    'neutral',
    'background',
  ];

  for (let i = 0; i < entityIds.length; i++) {
    const paletteKey = paletteKeys[i % paletteKeys.length];
    const mat = buildStyleMaterial(style, paletteKey);
    dispatch('update_material', { entityId: entityIds[i], ...mat });
  }
}

/**
 * List all available art style preset keys.
 */
export function getStylePresetKeys(): string[] {
  return Object.keys(ART_STYLE_PRESETS);
}

/**
 * Retrieve a specific art style preset by key, or undefined if not found.
 */
export function getStylePreset(key: string): ArtStyle | undefined {
  return ART_STYLE_PRESETS[key];
}

// ---------------------------------------------------------------------------
// Local storage persistence for style lock
// ---------------------------------------------------------------------------

const STYLE_LOCK_KEY = 'forge-art-style-lock';

export interface LockedStyle {
  presetKey: string;
  style: ArtStyle;
}

export function loadLockedStyle(): LockedStyle | null {
  try {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(STYLE_LOCK_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function saveLockedStyle(presetKey: string, style: ArtStyle): void {
  try {
    localStorage.setItem(STYLE_LOCK_KEY, JSON.stringify({ presetKey, style }));
  } catch {
    // localStorage may be unavailable
  }
}

export function clearLockedStyle(): void {
  try {
    localStorage.removeItem(STYLE_LOCK_KEY);
  } catch {
    // localStorage may be unavailable
  }
}
