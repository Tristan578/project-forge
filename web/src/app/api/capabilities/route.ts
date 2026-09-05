import { NextRequest, NextResponse } from 'next/server';
import type { ProviderCapability } from '@/lib/providers/types';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { safeAuth } from '@/lib/auth/safe-auth';
import { listConfiguredProviders } from '@/lib/keys/resolver';
import { captureException } from '@/lib/monitoring/sentry-server';
import {
  PLATFORM_KEY_ENV,
  GATEWAY_KEY_ENV,
  CHAT_BACKEND_ENV_VARS,
  DIRECT_CAPABILITY_PROVIDER,
  PROVIDER_CAPABILITIES,
  getCapabilityUnavailability,
  isVercelRuntime,
} from '@/lib/config/providers';

/**
 * Maps each provider capability to the environment variable(s) that must be set.
 * Mirrors the direct backend's CAPABILITY_PROVIDER_MAP but also includes the
 * gateway/router env vars that can serve certain capabilities.
 *
 * Every name comes from `lib/config/providers` — this table held its own
 * hardcoded copy until PF-1054, which is exactly the drift that put two
 * permanent false outages on the status page.
 */
const CAPABILITY_KEY_MAP: Record<ProviderCapability, string[]> = {
  // Any chat backend serves chat, so this is precisely the backend table.
  chat: [...CHAT_BACKEND_ENV_VARS],
  embedding: [
    PLATFORM_KEY_ENV.openai,
    GATEWAY_KEY_ENV.vercelGateway,
    GATEWAY_KEY_ENV.openrouter,
    GATEWAY_KEY_ENV.githubModels,
  ],
  image: [
    PLATFORM_KEY_ENV.openai,
    GATEWAY_KEY_ENV.vercelGateway,
    GATEWAY_KEY_ENV.openrouter,
  ],
  model3d: [PLATFORM_KEY_ENV.meshy],
  texture: [PLATFORM_KEY_ENV.meshy],
  sfx: [PLATFORM_KEY_ENV.elevenlabs],
  voice: [PLATFORM_KEY_ENV.elevenlabs],
  music: [PLATFORM_KEY_ENV.suno],
  sprite: [PLATFORM_KEY_ENV.replicate],
  bg_removal: [PLATFORM_KEY_ENV.removebg],
};

/** Human-readable provider names for each env var */
const ENV_VAR_PROVIDER_NAMES: Record<string, string> = {
  [PLATFORM_KEY_ENV.anthropic]: 'Anthropic',
  [PLATFORM_KEY_ENV.openai]: 'OpenAI',
  [PLATFORM_KEY_ENV.meshy]: 'Meshy',
  [PLATFORM_KEY_ENV.elevenlabs]: 'ElevenLabs',
  [PLATFORM_KEY_ENV.suno]: 'Suno',
  [PLATFORM_KEY_ENV.replicate]: 'Replicate',
  [PLATFORM_KEY_ENV.removebg]: 'remove.bg',
  [PLATFORM_KEY_ENV.hyper3d]: 'Hyper3D',
  [GATEWAY_KEY_ENV.vercelGateway]: 'Vercel AI Gateway',
  [GATEWAY_KEY_ENV.openrouter]: 'OpenRouter',
  [GATEWAY_KEY_ENV.githubModels]: 'GitHub Models',
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
  /**
   * True when no key — platform or BYOK — can make this capability work
   * (`UNAVAILABLE_CAPABILITIES`, #9117). Clients should hide or explicitly
   * disable the entry point rather than suggest configuring a key.
   */
  unprovisionable?: boolean;
}

export interface CapabilitiesResponse {
  capabilities: CapabilityStatus[];
  /** Quick lookup: which capabilities are available */
  available: ProviderCapability[];
  /** Quick lookup: which capabilities are unavailable */
  unavailable: ProviderCapability[];
}

/**
 * The signed-in user's BYOK providers, or an empty set when anonymous or when
 * the lookup fails. Fails open to platform-only availability: a DB hiccup
 * here must not turn the whole editor's generation UI off, and the generate
 * routes re-resolve the key authoritatively anyway.
 */
async function resolveByokProviders(userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
  try {
    const rows = await listConfiguredProviders(userId);
    return new Set(rows.map((r) => r.provider));
  } catch (err) {
    captureException(err, { route: '/api/capabilities', action: 'byok_lookup' });
    return new Set();
  }
}

/**
 * GET /api/capabilities
 *
 * Returns which AI capabilities are available. A capability is available when
 * a platform key (or gateway route) is configured server-side, OR when the
 * signed-in user holds their own key for its provider — the same precedence
 * `resolveApiKey` applies. Capabilities in `UNAVAILABLE_CAPABILITIES` are
 * never available. Secrets are checked server-side and never exposed.
 */
export async function GET(req: NextRequest): Promise<NextResponse<CapabilitiesResponse>> {
  const limited = await rateLimitPublicRoute(req, 'capabilities', 30, 60_000);
  if (limited) return limited as NextResponse<CapabilitiesResponse>;

  const { userId } = await safeAuth();
  const byokProviders = await resolveByokProviders(userId);

  const capabilities: CapabilityStatus[] = PROVIDER_CAPABILITIES.map((cap) => {
    const unavailability = getCapabilityUnavailability(cap);
    if (unavailability) {
      return {
        capability: cap,
        available: false,
        label: FEATURE_LABELS[cap],
        unprovisionable: true,
        hint: `${unavailability.reason} (#${unavailability.issue})`,
      };
    }

    const envVars = CAPABILITY_KEY_MAP[cap];
    // On Vercel, AI Gateway uses OIDC auto-auth (no explicit key needed for chat/embedding)
    const vercelOidc = isVercelRuntime() && envVars.includes(GATEWAY_KEY_ENV.vercelGateway);
    const platformAvailable = vercelOidc || envVars.some((envVar) => Boolean(process.env[envVar]));
    const byokAvailable = byokProviders.has(DIRECT_CAPABILITY_PROVIDER[cap]);
    const isAvailable = platformAvailable || byokAvailable;

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
  // A BYOK-aware body is per-user and must never be served from a shared cache.
  response.headers.set(
    'Cache-Control',
    userId ? 'private, max-age=60' : 'public, max-age=60, s-maxage=300',
  );
  return response;
}

export const dynamic = 'force-dynamic';
