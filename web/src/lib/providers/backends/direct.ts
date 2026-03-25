/**
 * Direct backend.
 *
 * Uses individual PLATFORM_*_KEY environment variables to call providers
 * directly. Supports ALL capabilities including asset generation providers
 * (Meshy, ElevenLabs, Suno, etc.) that are not available through gateways.
 * This is the catch-all fallback in the resolution priority chain.
 */

import type { ProviderBackend, ProviderCapability } from '../types';

/** All capabilities — direct backend is the universal catch-all */
const ALL_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
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
];

/**
 * Maps capability to the environment variable holding the platform key.
 * For capabilities that need multiple providers, the primary one is listed.
 */
const CAPABILITY_ENV_MAP: Record<ProviderCapability, string> = {
  chat: 'ANTHROPIC_API_KEY',
  embedding: 'PLATFORM_OPENAI_KEY',
  image: 'PLATFORM_OPENAI_KEY',
  model3d: 'PLATFORM_MESHY_KEY',
  texture: 'PLATFORM_MESHY_KEY',
  sfx: 'PLATFORM_ELEVENLABS_KEY',
  voice: 'PLATFORM_ELEVENLABS_KEY',
  music: 'PLATFORM_SUNO_KEY',
  sprite: 'PLATFORM_REPLICATE_KEY',
  bg_removal: 'PLATFORM_REMOVEBG_KEY',
};

/** Maps a named direct provider to its environment variable */
const DIRECT_PROVIDER_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'PLATFORM_OPENAI_KEY',
  meshy: 'PLATFORM_MESHY_KEY',
  hyper3d: 'PLATFORM_HYPER3D_KEY',
  elevenlabs: 'PLATFORM_ELEVENLABS_KEY',
  suno: 'PLATFORM_SUNO_KEY',
  replicate: 'PLATFORM_REPLICATE_KEY',
  removebg: 'PLATFORM_REMOVEBG_KEY',
};

/**
 * Get the platform key for a named provider.
 * Returns the key string or null if not configured.
 */
export function getDirectProviderKey(provider: string): string | null {
  const envVar = DIRECT_PROVIDER_ENV[provider];
  if (!envVar) return null;
  return process.env[envVar] ?? null;
}

/**
 * Check whether a named direct provider is configured.
 */
export function isDirectProviderConfigured(provider: string): boolean {
  return getDirectProviderKey(provider) !== null;
}

/** Get the primary API key for a capability via the direct path */
function getKeyForCapability(capability: ProviderCapability): string {
  const envVar = CAPABILITY_ENV_MAP[capability];
  return process.env[envVar] ?? '';
}

export const directBackend: ProviderBackend = {
  id: 'direct',
  name: 'Direct (Platform Keys)',
  capabilities: ALL_CAPABILITIES,

  isConfigured(): boolean {
    // Configured if any platform key is set
    return Object.values(DIRECT_PROVIDER_ENV).some(
      (envVar) => Boolean(process.env[envVar])
    );
  },

  getApiKey(): string {
    // Return Anthropic key as the primary key for general use;
    // callers should use getDirectProviderKey() for specific providers
    return process.env.ANTHROPIC_API_KEY ?? '';
  },

  getEndpoint(): string {
    // Direct calls go to each provider's native endpoint
    return '';
  },

  resolveModelId(canonicalModel: string): string {
    // Pass through — each provider's client handles model naming
    return canonicalModel;
  },
};

/**
 * Resolve the API key for a specific capability via the direct backend.
 * Used internally by the registry when building ResolvedRoute objects.
 */
export function resolveDirectKey(capability: ProviderCapability): string {
  return getKeyForCapability(capability);
}
