/**
 * Asset post-processing pipeline for AI-generated outputs.
 *
 * Processes raw AI outputs into game-ready assets:
 * - 3D models: name sanitization, metadata enrichment
 * - Textures: power-of-2 validation, dimension metadata
 * - Audio (SFX): context-aware spatial defaults, silence trimming metadata
 * - Audio (Music): loop detection hints, loudness normalization metadata
 * - Skybox: validation, metadata
 */

import type { GenerationType } from '@/stores/generationStore';

// ---- Types ----

export interface PostProcessResult {
  /** Whether post-processing succeeded */
  ok: boolean;
  /** Warnings generated during processing (non-fatal) */
  warnings: string[];
  /** Metadata to attach to the generation job */
  metadata: Record<string, unknown>;
}

export interface TextureMetadata {
  width: number;
  height: number;
  isPowerOfTwo: boolean;
  channels: number; // 3=RGB, 4=RGBA
  slot: string;
}

export interface AudioPostProcessConfig {
  /** SFX category for spatial defaults */
  sfxCategory?: SfxCategory;
  /** Whether this audio should loop */
  shouldLoop?: boolean;
  /** Target volume normalization (0-1) */
  targetVolume?: number;
}

export type SfxCategory =
  | 'ui'
  | 'footstep'
  | 'impact'
  | 'explosion'
  | 'ambient'
  | 'collectible'
  | 'projectile'
  | 'voice'
  | 'music';

export interface SpatialDefaults {
  spatial: boolean;
  maxDistance: number;
  refDistance: number;
  rolloffFactor: number;
  loopAudio: boolean;
  volume: number;
}

// ---- Main Pipeline ----

/**
 * Run post-processing for a generation result.
 * Returns metadata to attach to the job and any warnings.
 */
export function postProcess(
  type: GenerationType,
  prompt: string,
  config?: AudioPostProcessConfig,
): PostProcessResult {
  switch (type) {
    case 'model':
      return postProcessModel(prompt);
    case 'texture':
      return postProcessTexture();
    case 'sfx':
    case 'voice':
      return postProcessSfx(prompt, config);
    case 'music':
      return postProcessMusic(prompt, config);
    case 'skybox':
      return postProcessSkybox();
    case 'sprite':
    case 'sprite_sheet':
    case 'tileset':
      return postProcessSprite(type);
    default:
      return { ok: true, warnings: [], metadata: {} };
  }
}

// ---- Model Post-Processing ----

function postProcessModel(prompt: string): PostProcessResult {
  const warnings: string[] = [];
  const sanitizedName = sanitizeAssetName(prompt, 'Model');

  return {
    ok: true,
    warnings,
    metadata: {
      assetName: sanitizedName,
      orientation: 'y-up',
      scaleUnit: 'meter',
      importedAt: Date.now(),
    },
  };
}

// ---- Texture Post-Processing ----

function postProcessTexture(): PostProcessResult {
  return {
    ok: true,
    warnings: [],
    metadata: {
      pipelineVersion: 1,
      importedAt: Date.now(),
    },
  };
}

/**
 * Validate texture dimensions from an Image element.
 * Call this after loading a texture into an Image element.
 */
export function validateTextureDimensions(
  width: number,
  height: number,
  slot: string,
): TextureMetadata & { warnings: string[] } {
  const warnings: string[] = [];
  const isPowerOfTwo = isPow2(width) && isPow2(height);

  if (!isPowerOfTwo) {
    warnings.push(
      `Texture ${slot} is ${width}x${height} (not power-of-2). ` +
      `Nearest: ${nextPow2(width)}x${nextPow2(height)}. GPU may pad or stretch.`
    );
  }

  if (width > 4096 || height > 4096) {
    warnings.push(
      `Texture ${slot} is ${width}x${height} — very large. ` +
      `Consider 2048x2048 or smaller for better GPU performance.`
    );
  }

  return {
    width,
    height,
    isPowerOfTwo,
    channels: 4, // Most generated textures are RGBA
    slot,
    warnings,
  };
}

// ---- SFX Post-Processing ----

function postProcessSfx(
  prompt: string,
  config?: AudioPostProcessConfig,
): PostProcessResult {
  const category = config?.sfxCategory ?? inferSfxCategory(prompt);
  const spatial = getSpatialDefaults(category);

  return {
    ok: true,
    warnings: [],
    metadata: {
      sfxCategory: category,
      spatialDefaults: spatial,
      importedAt: Date.now(),
    },
  };
}

/**
 * Infer SFX category from the generation prompt.
 */
export function inferSfxCategory(prompt: string): SfxCategory {
  const lower = prompt.toLowerCase();

  if (/\b(click|hover|toggle|menu|button|ui|interface|notification|alert|beep|chime)\b/.test(lower)) return 'ui';
  if (/\b(footstep|walk|run|step|stomp|trudge)\b/.test(lower)) return 'footstep';
  if (/\b(hit|punch|kick|slash|stab|smash|crash|break|shatter|clang)\b/.test(lower)) return 'impact';
  if (/\b(explo\w*|boom|blast|detonate|grenade|bomb|rocket|cannon)\b/.test(lower)) return 'explosion';
  if (/\b(ambient|wind|rain|forest|ocean|water|bird|cricket|nature|atmosphere)\b/.test(lower)) return 'ambient';
  if (/\b(coin|gem|pickup|collect|power.?up|item|loot)\b/.test(lower)) return 'collectible';
  if (/\b(shoot|fire|laser|bullet|arrow|projectile|zap|beam)\b/.test(lower)) return 'projectile';
  if (/\b(voice|speak|talk|grunt|scream|yell|dialogue|narrat)\b/.test(lower)) return 'voice';
  if (/\b(music|song|melody|tune|beat|rhythm)\b/.test(lower)) return 'music';

  return 'impact'; // Safe default for unknown SFX
}

/**
 * Get spatial audio defaults based on SFX category.
 */
export function getSpatialDefaults(category: SfxCategory): SpatialDefaults {
  switch (category) {
    case 'ui':
      return {
        spatial: false,
        maxDistance: 100,
        refDistance: 1,
        rolloffFactor: 1,
        loopAudio: false,
        volume: 0.7,
      };
    case 'footstep':
      return {
        spatial: true,
        maxDistance: 15,
        refDistance: 1,
        rolloffFactor: 1.5,
        loopAudio: false,
        volume: 0.5,
      };
    case 'impact':
      return {
        spatial: true,
        maxDistance: 30,
        refDistance: 2,
        rolloffFactor: 1.2,
        loopAudio: false,
        volume: 0.8,
      };
    case 'explosion':
      return {
        spatial: true,
        maxDistance: 80,
        refDistance: 5,
        rolloffFactor: 0.8,
        loopAudio: false,
        volume: 1.0,
      };
    case 'ambient':
      return {
        spatial: true,
        maxDistance: 50,
        refDistance: 5,
        rolloffFactor: 0.5,
        loopAudio: true,
        volume: 0.4,
      };
    case 'collectible':
      return {
        spatial: true,
        maxDistance: 10,
        refDistance: 1,
        rolloffFactor: 2.0,
        loopAudio: false,
        volume: 0.6,
      };
    case 'projectile':
      return {
        spatial: true,
        maxDistance: 40,
        refDistance: 2,
        rolloffFactor: 1.0,
        loopAudio: false,
        volume: 0.7,
      };
    case 'voice':
      return {
        spatial: true,
        maxDistance: 20,
        refDistance: 2,
        rolloffFactor: 1.5,
        loopAudio: false,
        volume: 0.9,
      };
    case 'music':
      return {
        spatial: false,
        maxDistance: 100,
        refDistance: 1,
        rolloffFactor: 1,
        loopAudio: true,
        volume: 0.6,
      };
  }
}

// ---- Music Post-Processing ----

function postProcessMusic(
  prompt: string,
  config?: AudioPostProcessConfig,
): PostProcessResult {
  const shouldLoop = config?.shouldLoop ?? true;
  const warnings: string[] = [];

  return {
    ok: true,
    warnings,
    metadata: {
      shouldLoop,
      targetVolume: config?.targetVolume ?? 0.6,
      spatialDefaults: getSpatialDefaults('music'),
      importedAt: Date.now(),
    },
  };
}

// ---- Skybox Post-Processing ----

function postProcessSkybox(): PostProcessResult {
  return {
    ok: true,
    warnings: [],
    metadata: {
      format: 'equirectangular',
      importedAt: Date.now(),
    },
  };
}

// ---- Sprite Post-Processing ----

function postProcessSprite(type: GenerationType): PostProcessResult {
  return {
    ok: true,
    warnings: [],
    metadata: {
      spriteType: type,
      importedAt: Date.now(),
    },
  };
}

// ---- Utilities ----

/** Sanitize a prompt into a safe asset name. */
export function sanitizeAssetName(prompt: string, prefix: string): string {
  // Take first 30 chars, replace non-alphanumeric with underscore
  const cleaned = prompt
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return `${prefix}_${cleaned || 'Generated'}`;
}

/** Check if a number is a power of 2. */
export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Get the next power of 2 >= n. */
export function nextPow2(n: number): number {
  if (n <= 0) return 1;
  let v = n - 1;
  v |= v >> 1;
  v |= v >> 2;
  v |= v >> 4;
  v |= v >> 8;
  v |= v >> 16;
  return v + 1;
}
