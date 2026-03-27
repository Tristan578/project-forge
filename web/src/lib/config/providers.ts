/**
 * Centralized AI provider constants.
 *
 * All provider name strings, capability mappings, and backend identifiers
 * MUST be imported from this module. Raw string literals like 'anthropic'
 * or 'openai' in source files are flagged by the pre-commit grep check.
 *
 * Model IDs remain in `@/lib/ai/models.ts` — this module covers provider
 * infrastructure, not model versioning.
 */

// ---------------------------------------------------------------------------
// Provider names (used by circuit breaker, analytics, monitoring)
// ---------------------------------------------------------------------------

/**
 * All known AI provider names that participate in circuit breaking
 * and health monitoring.
 */
export const PROVIDER_NAMES = [
  'anthropic',
  'openai',
  'meshy',
  'elevenlabs',
  'suno',
  'replicate',
  'removebg',
  'openrouter',
  'vercel-gateway',
  'github-models',
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

// ---------------------------------------------------------------------------
// Backend identifiers
// ---------------------------------------------------------------------------

export const BACKEND_IDS = [
  'direct',
  'vercel-gateway',
  'openrouter',
  'github-models',
  'cloudflare-ai',
  'byok',
] as const;

export type BackendId = (typeof BACKEND_IDS)[number];

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

export const PROVIDER_CAPABILITIES = [
  'chat',
  'embedding',
  'image',
  'model3d',
  'texture',
  'sfx',
  'voice',
  'music',
  'sprite',
  'bg_removal',
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

// ---------------------------------------------------------------------------
// Direct backend: capability -> upstream provider mapping
// ---------------------------------------------------------------------------

/**
 * When routing through the 'direct' backend, this map determines which
 * upstream provider handles each capability. This is the source of truth
 * for `backendIdToProviderName()` in registry.ts.
 */
export const DIRECT_CAPABILITY_PROVIDER: Record<ProviderCapability, ProviderName> = {
  chat: 'anthropic',
  embedding: 'openai',
  model3d: 'meshy',
  texture: 'meshy',
  sfx: 'elevenlabs',
  voice: 'elevenlabs',
  music: 'suno',
  image: 'openai',
  sprite: 'replicate',
  bg_removal: 'removebg',
};

// ---------------------------------------------------------------------------
// DB-safe provider subset (for routes that call resolveApiKey)
// ---------------------------------------------------------------------------

/**
 * Subset of DIRECT_CAPABILITY_PROVIDER values that are valid DB Provider
 * enum members. Use this in generate routes instead of casting
 * `DIRECT_CAPABILITY_PROVIDER.X as Provider`.
 *
 * Compile-time safe: if a capability's provider is changed to a non-DB
 * value (e.g. 'openrouter'), TypeScript will error here instead of
 * silently passing and crashing at runtime with a Postgres enum violation.
 */
import type { Provider } from '@/lib/db/schema';

type DbCapability = 'model3d' | 'texture' | 'sfx' | 'voice' | 'music' | 'sprite' | 'bg_removal' | 'image' | 'chat' | 'embedding';

export const DB_PROVIDER: Record<DbCapability, Provider> = {
  chat: 'anthropic',
  embedding: 'openai',
  model3d: 'meshy',
  texture: 'meshy',
  sfx: 'elevenlabs',
  voice: 'elevenlabs',
  music: 'suno',
  image: 'openai',
  sprite: 'replicate',
  bg_removal: 'removebg',
};

// ---------------------------------------------------------------------------
// Backend -> circuit breaker provider name mapping
// ---------------------------------------------------------------------------

export const BACKEND_TO_PROVIDER: Partial<Record<BackendId, ProviderName>> = {
  'vercel-gateway': 'vercel-gateway',
  'openrouter': 'openrouter',
  'github-models': 'github-models',
};

// ---------------------------------------------------------------------------
// Image generation constraints (per provider)
// ---------------------------------------------------------------------------

export interface ImageSizeConstraint {
  /** Allowed width x height combinations */
  allowedSizes: readonly string[];
  /** Default size if none specified */
  defaultSize: string;
  /** Maximum dimension in pixels */
  maxDimension: number;
}

export const IMAGE_SIZE_CONSTRAINTS: Record<string, ImageSizeConstraint> = {
  'dall-e-3': {
    allowedSizes: ['1024x1024', '1024x1792', '1792x1024'],
    defaultSize: '1024x1024',
    maxDimension: 1792,
  },
  'sdxl': {
    allowedSizes: ['512x512', '768x768', '1024x1024'],
    defaultSize: '1024x1024',
    maxDimension: 1024,
  },
};

// ---------------------------------------------------------------------------
// Sprite generation
// ---------------------------------------------------------------------------

export const SPRITE_PROVIDERS = ['auto', 'dalle3', 'sdxl'] as const;
export type SpriteProvider = (typeof SPRITE_PROVIDERS)[number];

export const SPRITE_SIZES = ['32x32', '64x64', '128x128', '256x256', '512x512', '1024x1024'] as const;
export type SpriteSize = (typeof SPRITE_SIZES)[number];

/** Token costs per sprite generation provider */
export const SPRITE_TOKEN_COST: Record<Exclude<SpriteProvider, 'auto'>, number> = {
  dalle3: 20,
  sdxl: 10,
};

/** Estimated generation time per provider (seconds) */
export const SPRITE_ESTIMATED_SECONDS: Record<Exclude<SpriteProvider, 'auto'>, number> = {
  dalle3: 15,
  sdxl: 30,
};

// ---------------------------------------------------------------------------
// Pixel art generation
// ---------------------------------------------------------------------------

export const PIXEL_ART_STYLES = ['character', 'prop', 'tile', 'icon', 'environment'] as const;
export type PixelArtStyle = (typeof PIXEL_ART_STYLES)[number];

export const PIXEL_ART_SIZES = [16, 32, 64, 128] as const;
export type PixelArtSize = (typeof PIXEL_ART_SIZES)[number];

export const PIXEL_ART_DITHERING_MODES = ['none', 'bayer4x4', 'bayer8x8'] as const;
export type DitheringMode = (typeof PIXEL_ART_DITHERING_MODES)[number];

// ---------------------------------------------------------------------------
// Circuit breaker defaults
// ---------------------------------------------------------------------------

export const CIRCUIT_BREAKER_DEFAULTS = {
  errorRateThreshold: 0.5,
  minRequestsToEvaluate: 3,
  costAnomalyMultiplier: 2,
} as const;
