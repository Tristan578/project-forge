/**
 * Direct backend.
 *
 * Uses individual PLATFORM_*_KEY environment variables to call providers
 * directly. Supports ALL capabilities including asset generation providers
 * (Meshy, ElevenLabs, Suno, etc.) that are not available through gateways.
 * This is the catch-all fallback in the resolution priority chain.
 */

import type { ProviderBackend, ProviderCapability } from '../types';
import {
  PLATFORM_KEY_ENV,
  getPlatformKeyEnvVar,
  type PlatformKeyProvider,
} from '@/lib/config/providers';

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
 * Maps capability to the provider that serves it directly. For capabilities
 * that could use several providers, the primary one is listed.
 *
 * Keyed on provider rather than on the env-var name so the env names have a
 * single source (`PLATFORM_KEY_ENV`) and a typo here fails `tsc` instead of
 * silently reading an unset variable. Before PF-1054 this table held its own
 * hardcoded copy of the names, which is exactly the drift that put two
 * permanent false outages on the status page.
 */
const CAPABILITY_PROVIDER_MAP: Record<ProviderCapability, PlatformKeyProvider> = {
  chat: 'anthropic',
  embedding: 'openai',
  image: 'openai',
  model3d: 'meshy',
  texture: 'meshy',
  sfx: 'elevenlabs',
  voice: 'elevenlabs',
  music: 'suno',
  sprite: 'replicate',
  bg_removal: 'removebg',
};

/**
 * Get the platform key for a named provider.
 * Returns the key string or null if not configured.
 *
 * The provider -> env-var table lives in `@/lib/config/providers`; this file
 * carried a value-identical private copy until PF-1054.
 */
export function getDirectProviderKey(provider: string): string | null {
  const envVar = getPlatformKeyEnvVar(provider);
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
  const envVar = PLATFORM_KEY_ENV[CAPABILITY_PROVIDER_MAP[capability]];
  return process.env[envVar] ?? '';
}

export const directBackend: ProviderBackend = {
  id: 'direct',
  name: 'Direct (Platform Keys)',
  capabilities: ALL_CAPABILITIES,

  isConfigured(): boolean {
    // Configured if any platform key is set
    return Object.values(PLATFORM_KEY_ENV).some(
      (envVar) => Boolean(process.env[envVar])
    );
  },

  getApiKey(): string {
    // Return Anthropic key as the primary key for general use;
    // callers should use getDirectProviderKey() for specific providers
    return process.env[PLATFORM_KEY_ENV.anthropic] ?? '';
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
