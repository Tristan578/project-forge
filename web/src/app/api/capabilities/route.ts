import { NextRequest, NextResponse } from 'next/server';
import type { ProviderCapability } from '@/lib/providers/types';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { safeAuth } from '@/lib/auth/safe-auth';
import { captureException } from '@/lib/monitoring/sentry-server';
import {
  PLATFORM_KEY_ENV,
  GATEWAY_KEY_ENV,
  CHAT_BACKEND_ENV_VARS,
  CAPABILITY_REQUIRED_PROVIDERS,
  DIRECT_CAPABILITY_PROVIDER,
  PROVIDER_CAPABILITIES,
  getCapabilityUnavailability,
  isByokProvider,
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
  // Derived from CAPABILITY_REQUIRED_PROVIDERS: sprite spends BOTH keys (the
  // default path is DALL-E 3, pixel-art is Replicate SDXL), and this entry
  // once listed Replicate alone — so a Replicate-only environment was told to
  // configure the key it already had and never heard of OpenAI.
  sprite: CAPABILITY_REQUIRED_PROVIDERS.sprite?.map((p) => PLATFORM_KEY_ENV[p]) ?? [PLATFORM_KEY_ENV.replicate],
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
   * disable the entry point rather than suggest configuring a key. `hint`
   * then carries the user-facing reason and `issue` the tracking issue.
   */
  unprovisionable?: boolean;
  /**
   * True when the caller could turn this capability on themselves: every
   * provider it still needs is in `BYOK_PROVIDERS`, so `/api/keys/[provider]`
   * accepts it and Settings renders a field for it. False for `sprite`
   * (Replicate + OpenAI), `image` and `bg_removal` (OpenAI, remove.bg) — the
   * key those need can only be set on the deployment, so the client must not
   * send the user to Settings for them (#9725 p8). Never set on an available
   * or unprovisionable capability.
   */
  byokConfigurable?: boolean;
  /** GitHub issue tracking an unprovisionable capability (machine-readable). */
  issue?: number;
}

export interface CapabilitiesResponse {
  capabilities: CapabilityStatus[];
  /** Quick lookup: which capabilities are available */
  available: ProviderCapability[];
  /** Quick lookup: which capabilities are unavailable */
  unavailable: ProviderCapability[];
  /**
   * True when the per-user half of the answer could not be read (auth threw,
   * the user row was unreachable, or the BYOK lookup failed). The route still
   * answers 200 with platform-only availability, but an `available: false` is
   * then NOT a claim about this caller's own keys, and a client must not
   * disable anything on the strength of it (#9725 p7). `unprovisionable` is
   * unaffected -- it depends on no lookup at all.
   */
  degraded: boolean;
}

/** A BYOK lookup result: the providers found, and whether the lookup failed. */
interface ByokLookup {
  providers: Set<string>;
  /** True when the lookup could not run — see `CapabilitiesResponse.degraded`. */
  degraded: boolean;
}

/**
 * The signed-in user's BYOK providers, or an empty set when anonymous, when
 * the Clerk identity has no local user row yet, or when the lookup fails.
 *
 * `safeAuth()` yields the CLERK id; `providerKeys.userId` is the INTERNAL
 * `users.id` uuid (keys are stored under it by `/api/keys/[provider]`), so the
 * Clerk id is resolved through `getUserByClerkId` first — passing it straight
 * through would fail uuid parsing on every signed-in call (#9725 review).
 *
 * Fails open to platform-only availability: a DB hiccup here must not turn
 * the editor's generation UI off, and the generate routes re-resolve the key
 * authoritatively anyway. Failing open on the SERVER is only half of it — the
 * body carries `degraded: true` so the client does not read the resulting
 * `available: false` as "this user holds no key" and disable the UI anyway
 * (#9725 p7). Production runs zero PLATFORM_* keys today, so BYOK is the only
 * working generation path, and one `CircuitBreakerOpenError` would otherwise
 * lock every paying generation user out for the client cache's whole TTL.
 */
async function resolveByokProviders(clerkId: string | null): Promise<ByokLookup> {
  if (!clerkId) return { providers: new Set(), degraded: false };
  try {
    // Imported lazily, and only for a signed-in caller: these modules pull in
    // the DB client and key encryption, whose configuration an anonymous
    // (E2E, preview, status-page) request has no business depending on.
    const [{ getUserByClerkId }, { listConfiguredProviders }] = await Promise.all([
      import('@/lib/auth/user-service'),
      import('@/lib/keys/resolver'),
    ]);
    const user = await getUserByClerkId(clerkId);
    // No local row is a real answer, not a failure: the user holds no keys.
    if (!user) return { providers: new Set(), degraded: false };
    const rows = await listConfiguredProviders(user.id);
    return { providers: new Set(rows.map((r) => r.provider)), degraded: false };
  } catch (err) {
    captureException(err, { route: '/api/capabilities', action: 'byok_lookup' });
    return { providers: new Set(), degraded: true };
  }
}

/**
 * The caller's Clerk id, or null. `safeAuth()` already returns null when Clerk
 * is not configured; this additionally survives Clerk being configured but
 * this route being reached outside `clerkMiddleware` (the E2E server), where
 * `auth()` throws. Availability must never 500 on an auth hiccup — the body
 * degrades to platform-only, which is what an anonymous caller gets anyway.
 */
async function resolveCallerId(): Promise<{ userId: string | null; degraded: boolean }> {
  try {
    return { userId: (await safeAuth()).userId, degraded: false };
  } catch (err) {
    captureException(err, { route: '/api/capabilities', action: 'auth' });
    // A signed-in caller whose identity we could not read is not an anonymous
    // caller: the per-user half of the body is missing, so say so.
    return { userId: null, degraded: true };
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
  // 120/min per IP, up from 30 (#9725): the generation dialogs and the Asset
  // panel / Audio inspector entry points read this route, so every editor page
  // load costs one request and a shared-egress classroom would 429 on the old
  // ceiling. The body is cheap, cached client-side for CAPABILITIES_TTL_MS,
  // and carries no secrets.
  //
  // This raise did NOT fix the E2E 429s, and the comment that claimed it did
  // was a wrong diagnosis: run 33987394245 at head 1942fe4b already had the
  // ceiling at 120 and still failed misc-routes.spec.ts with 429. `next start`
  // on localhost sets no forwarded-for header, so every browser page load from
  // 3 shards x 4 workers, plus every other concurrent CI job, keys the SAME
  // `public:capabilities:unknown` bucket in the shared CI Upstash DB. The fix
  // is client isolation, not a bigger number — see the per-process
  // `x-forwarded-for` in `playwright.ci.config.ts` and the shared probe helper
  // in `e2e/helpers/capabilities.ts`.
  const limited = await rateLimitPublicRoute(req, 'capabilities', 120, 60_000);
  if (limited) return limited as NextResponse<CapabilitiesResponse>;

  const caller = await resolveCallerId();
  const byok = await resolveByokProviders(caller.userId);
  const byokProviders = byok.providers;
  const degraded = caller.degraded || byok.degraded;

  const capabilities: CapabilityStatus[] = PROVIDER_CAPABILITIES.map((cap) => {
    const unavailability = getCapabilityUnavailability(cap);
    if (unavailability) {
      return {
        capability: cap,
        available: false,
        label: FEATURE_LABELS[cap],
        unprovisionable: true,
        hint: unavailability.reason,
        issue: unavailability.issue,
      };
    }

    const envVars = CAPABILITY_KEY_MAP[cap];
    const required = CAPABILITY_REQUIRED_PROVIDERS[cap];
    let isAvailable: boolean;
    /** The env vars whose providers the user could still configure. */
    let missingEnvVars: string[];
    /**
     * Whether a key the user could add in Settings would actually flip this
     * capability on. For a multi-key capability that means EVERY still-missing
     * provider is a BYOK one; for a single-key one it is the provider the BYOK
     * branch of `isAvailable` below actually consults.
     */
    let byokConfigurable: boolean;
    if (required) {
      // A capability that spends more than one key is available only when
      // EVERY one of them is present, otherwise its default request 500s.
      // `resolveApiKey` resolves each provider on its own, BYOK first, so the
      // sources OR per provider: a user's own OpenAI key on a Replicate-only
      // deployment can run both sprite paths. Naming only what is missing
      // is what keeps the hint from telling a Replicate-only environment to
      // "Configure Replicate" (the key it already has).
      const missing = required.filter(
        (provider) => !process.env[PLATFORM_KEY_ENV[provider]] && !byokProviders.has(provider),
      );
      isAvailable = missing.length === 0;
      missingEnvVars = missing.map((provider) => PLATFORM_KEY_ENV[provider]);
      byokConfigurable = missing.every((provider) => isByokProvider(provider));
    } else {
      // On Vercel, AI Gateway uses OIDC auto-auth (no explicit key needed for chat/embedding)
      const vercelOidc = isVercelRuntime() && envVars.includes(GATEWAY_KEY_ENV.vercelGateway);
      const platformAvailable = vercelOidc || envVars.some((envVar) => Boolean(process.env[envVar]));
      isAvailable = platformAvailable || byokProviders.has(DIRECT_CAPABILITY_PROVIDER[cap]);
      missingEnvVars = envVars;
      byokConfigurable = isByokProvider(DIRECT_CAPABILITY_PROVIDER[cap]);
    }

    const status: CapabilityStatus = {
      capability: cap,
      available: isAvailable,
      label: FEATURE_LABELS[cap],
    };

    if (!isAvailable) {
      // Tell the user which providers they could configure. For a single-key
      // capability every listed provider is an alternative (name the first);
      // for a multi-key one every listed provider is still missing (name all).
      const providerNames = missingEnvVars.map(
        (envVar) => ENV_VAR_PROVIDER_NAMES[envVar] || 'Unknown Provider'
      );
      const uniqueProviders = [...new Set(providerNames)];
      status.requiredProviders = uniqueProviders;
      status.byokConfigurable = byokConfigurable;
      const named = required ? uniqueProviders.join(' and ') : uniqueProviders[0];
      const plural = required && uniqueProviders.length > 1 ? 'keys' : 'key';
      // Only say "in Settings" when Settings can actually take the key. It
      // cannot for Replicate, OpenAI or remove.bg — `/api/keys/[provider]`
      // rejects them and ApiKeyManager renders no field — so the old sentence
      // sent sprite/image/bg_removal users to a page where the named key does
      // not exist, the dead end this notice was added to remove (#9725 p8).
      status.hint = byokConfigurable
        ? `Configure ${named} API ${plural} in Settings to enable ${FEATURE_LABELS[cap]}.`
        : `${FEATURE_LABELS[cap]} needs ${named} API ${plural}, which only this deployment can configure.`;
    }

    return status;
  });

  const available = capabilities
    .filter((c) => c.available)
    .map((c) => c.capability);
  const unavailable = capabilities
    .filter((c) => !c.available)
    .map((c) => c.capability);

  const response = NextResponse.json({ capabilities, available, unavailable, degraded });
  // The body can differ per session (BYOK), and a shared cache keys on the URL
  // — not on the Clerk cookie — so a shared directive on the anonymous branch
  // would hand the platform-only body to signed-in users for its whole TTL.
  // Unconditionally private: the browser may keep it briefly, no CDN may.
  response.headers.set('Cache-Control', 'private, max-age=60');
  return response;
}

export const dynamic = 'force-dynamic';
