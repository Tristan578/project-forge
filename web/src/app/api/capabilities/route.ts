import { NextRequest, NextResponse } from 'next/server';
import type { ProviderCapability } from '@/lib/providers/types';
import { rateLimitPublicRoute } from '@/lib/rateLimit';

/**
 * Maps each provider capability to the environment variable(s) that must be set.
 * Mirrors the direct backend's CAPABILITY_ENV_MAP but also includes gateway/router
 * env vars that can provide certain capabilities.
 */
const CAPABILITY_KEY_MAP: Record<ProviderCapability, string[]> = {
  chat: [
    'ANTHROPIC_API_KEY',
    'AI_GATEWAY_API_KEY',
    'OPENROUTER_API_KEY',
    'GITHUB_MODELS_PAT',
  ],
  embedding: [
    'PLATFORM_OPENAI_KEY',
    'AI_GATEWAY_API_KEY',
    'OPENROUTER_API_KEY',
    'GITHUB_MODELS_PAT',
  ],
  image: [
    'PLATFORM_OPENAI_KEY',
    'AI_GATEWAY_API_KEY',
    'OPENROUTER_API_KEY',
  ],
  model3d: ['PLATFORM_MESHY_KEY'],
  texture: ['PLATFORM_MESHY_KEY'],
  sfx: ['PLATFORM_ELEVENLABS_KEY'],
  voice: ['PLATFORM_ELEVENLABS_KEY'],
  music: ['PLATFORM_SUNO_KEY'],
  sprite: ['PLATFORM_REPLICATE_KEY'],
  bg_removal: ['PLATFORM_REMOVEBG_KEY'],
};

/** Human-readable provider names for each env var */
const ENV_VAR_PROVIDER_NAMES: Record<string, string> = {
  ANTHROPIC_API_KEY: 'Anthropic',
  PLATFORM_OPENAI_KEY: 'OpenAI',
  PLATFORM_MESHY_KEY: 'Meshy',
  PLATFORM_ELEVENLABS_KEY: 'ElevenLabs',
  PLATFORM_SUNO_KEY: 'Suno',
  PLATFORM_REPLICATE_KEY: 'Replicate',
  PLATFORM_REMOVEBG_KEY: 'remove.bg',
  AI_GATEWAY_API_KEY: 'Vercel AI Gateway',
  OPENROUTER_API_KEY: 'OpenRouter',
  GITHUB_MODELS_PAT: 'GitHub Models',
};

/** User-facing feature names mapped to capabilities */
const FEATURE_LABELS: Record<ProviderCapability, string> = {
  chat: 'AI Chat',
  embedding: 'Semantic Search',
  image: 'Image Generation',
  model3d: '3D Model Generation',
  texture: 'Texture Generation',
  sfx: 'Sound Effect Generation',
  voice: 'Voice Generation',
  music: 'Music Generation',
  sprite: 'Sprite Generation',
  bg_removal: 'Background Removal',
};

export interface CapabilityStatus {
  capability: ProviderCapability;
  available: boolean;
  label: string;
  /** Which providers could enable this capability (only shown if unavailable) */
  requiredProviders?: string[];
  /** Helpful setup hint */
  hint?: string;
}

export interface CapabilitiesResponse {
  capabilities: CapabilityStatus[];
  /** Quick lookup: which capabilities are available */
  available: ProviderCapability[];
  /** Quick lookup: which capabilities are unavailable */
  unavailable: ProviderCapability[];
}

/**
 * GET /api/capabilities
 *
 * Returns which AI capabilities are available based on configured API keys.
 * Checks env vars server-side so secrets are never exposed to the client.
 */
export async function GET(req: NextRequest): Promise<NextResponse<CapabilitiesResponse>> {
  const limited = await rateLimitPublicRoute(req, 'capabilities', 30, 60_000);
  if (limited) return limited as NextResponse<CapabilitiesResponse>;
  const allCapabilities: ProviderCapability[] = [
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

  const capabilities: CapabilityStatus[] = allCapabilities.map((cap) => {
    const envVars = CAPABILITY_KEY_MAP[cap];
    // On Vercel, AI Gateway uses OIDC auto-auth (no explicit key needed for chat/embedding)
    const vercelOidc = Boolean(process.env.VERCEL) && envVars.includes('AI_GATEWAY_API_KEY');
    const isAvailable = vercelOidc || envVars.some((envVar) => Boolean(process.env[envVar]));

    const status: CapabilityStatus = {
      capability: cap,
      available: isAvailable,
      label: FEATURE_LABELS[cap],
    };

    if (!isAvailable) {
      // Tell the user which providers they could configure
      const providerNames = envVars.map(
        (envVar) => ENV_VAR_PROVIDER_NAMES[envVar] || 'Unknown Provider'
      );
      const uniqueProviders = [...new Set(providerNames)];
      status.requiredProviders = uniqueProviders;
      status.hint = `Configure ${uniqueProviders[0]} API key in Settings to enable ${FEATURE_LABELS[cap]}.`;
    }

    return status;
  });

  const available = capabilities
    .filter((c) => c.available)
    .map((c) => c.capability);
  const unavailable = capabilities
    .filter((c) => !c.available)
    .map((c) => c.capability);

  const response = NextResponse.json({ capabilities, available, unavailable });
  response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  return response;
}

export const dynamic = 'force-dynamic';
