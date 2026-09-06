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
// BYOK (Bring Your Own Key) providers
// ---------------------------------------------------------------------------

/**
 * Providers that support user-supplied API keys.
 * Superset of PROVIDER_NAMES — includes providers like 'hyper3d' that are
 * valid DB `Provider` members but not monitored via circuit breakers.
 */
export const BYOK_PROVIDERS = [
  'anthropic',
  'meshy',
  'hyper3d',
  'elevenlabs',
  'suno',
] as const;

export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

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

type DbCapability = 'model3d' | 'texture' | 'sfx' | 'voice' | 'music' | 'sprite' | 'bg_removal' | 'image' | 'chat' | 'embedding' | 'pixel_art';

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
  // Pixel-art async polling resolves the platform Replicate key the same way
  // sprite does (SDXL on Replicate). OpenAI pixel-art returns inline base64 and
  // never polls, so the status route is Replicate-only.
  pixel_art: 'replicate',
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
// Provider -> platform API key environment variable
// ---------------------------------------------------------------------------

/**
 * The environment variable holding SpawnForge's own (non-BYOK) API key for
 * each provider. `lib/keys/resolver.ts` reads these to resolve a platform key,
 * and `lib/providers/backends/direct.ts` reads them to decide whether the
 * direct backend can serve a capability.
 *
 * The namespace is `PLATFORM_<PROVIDER>_KEY` for everything except Anthropic,
 * which predates the convention and stayed `ANTHROPIC_API_KEY`.
 *
 * This lived in three places before PF-1054, and the copy in
 * `lib/monitoring/healthChecks.ts` had drifted to a set of names
 * (`MESHY_API_KEY`, `ELEVENLABS_API_KEY`, `SUNO_API_KEY`) that nothing else in
 * the tree reads and no environment sets — so the public status page reported a
 * permanent "AI Assistant: outage" against a working install.
 */
export const PLATFORM_KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  meshy: 'PLATFORM_MESHY_KEY',
  hyper3d: 'PLATFORM_HYPER3D_KEY',
  elevenlabs: 'PLATFORM_ELEVENLABS_KEY',
  suno: 'PLATFORM_SUNO_KEY',
  openai: 'PLATFORM_OPENAI_KEY',
  replicate: 'PLATFORM_REPLICATE_KEY',
  removebg: 'PLATFORM_REMOVEBG_KEY',
} as const satisfies Record<string, string>;

export type PlatformKeyProvider = keyof typeof PLATFORM_KEY_ENV;

/**
 * Env-var name for a provider, or null when the provider has no platform key.
 * Callers that hold a plain `string` (rather than a narrowed provider union)
 * should use this instead of indexing PLATFORM_KEY_ENV directly.
 */
export function getPlatformKeyEnvVar(provider: string): string | null {
  return Object.prototype.hasOwnProperty.call(PLATFORM_KEY_ENV, provider)
    ? PLATFORM_KEY_ENV[provider as PlatformKeyProvider]
    : null;
}

/**
 * Where a human mints each provider's platform key. `null` means the provider
 * has NO self-serve console — its key cannot be obtained by anyone, so every
 * capability it serves must be declared in `UNAVAILABLE_CAPABILITIES` (pinned
 * by `capabilityAvailability.test.ts`, per #9522). Suno is the live case: no
 * public API as of 2026-08, so `PLATFORM_SUNO_KEY` can never exist.
 *
 * URLs were confirmed against each vendor's current documentation for #9117;
 * the OpenAI path is the standard console location (platform.openai.com
 * refuses automated fetches, so it was not machine-verified).
 */
export const PLATFORM_KEY_CONSOLE_URL: Record<PlatformKeyProvider, string | null> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  meshy: 'https://www.meshy.ai/settings/api',
  hyper3d: 'https://developer.hyper3d.ai/',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  suno: null,
  openai: 'https://platform.openai.com/api-keys',
  replicate: 'https://replicate.com/account/api-tokens',
  removebg: 'https://www.remove.bg/dashboard#api-key',
};

// ---------------------------------------------------------------------------
// Capabilities the platform cannot offer (#9117)
// ---------------------------------------------------------------------------

export interface CapabilityUnavailability {
  /**
   * User-facing sentence shown verbatim in the editor, in chat tool results
   * and in the 503 body. Plain product language only: no env-var names, no
   * vendor names, no issue numbers, and it should offer the nearest thing the
   * user CAN do instead.
   */
  reason: string;
  /**
   * GitHub issue tracking the fix. Machine-readable: exposed as a separate
   * `issue` field on `/api/capabilities` and in the 503 `details`, never
   * interpolated into `reason`.
   */
  issue: number;
}

/**
 * Capabilities the Vercel AI Gateway can serve with `AI_GATEWAY_API_KEY` (or
 * Vercel OIDC). Single source for `lib/providers/backends/vercelGateway.ts`
 * and `web/scripts/verify-platform-generation.ts`, which disagreed about
 * `image`/`embedding` until the #9725 review caught it.
 */
export const GATEWAY_CAPABILITIES = ['chat', 'embedding', 'image'] as const satisfies readonly ProviderCapability[];

/**
 * Capabilities that must be refused everywhere — `/api/capabilities`, the
 * generation dialogs, and `createGenerationHandler` — regardless of which
 * keys are set, because no key can make them work. Declared in code, not in
 * an env var, so the product cannot drift back to offering something that
 * 500s: a request for one of these is refused BEFORE any token is deducted.
 *
 * Remove an entry only when the capability has a provisionable provider and
 * one real artifact has been generated through it (the #9117 done-when).
 */
export const UNAVAILABLE_CAPABILITIES: Partial<Record<ProviderCapability, CapabilityUnavailability>> = {
  music: {
    reason:
      'Music generation is not available yet. Upload your own track from the Asset panel, or generate a sound effect instead.',
    issue: 9522,
  },
};

/** The unavailability record for a capability, or null when it is offered. */
export function getCapabilityUnavailability(
  capability: ProviderCapability,
): CapabilityUnavailability | null {
  return UNAVAILABLE_CAPABILITIES[capability] ?? null;
}

/**
 * User-facing feature name per capability — the vocabulary the Settings
 * panel, `/api/capabilities`, `useFeatureGating` and the public status page
 * all share. Anything that names a capability to a person reads from here (the
 * hook derives its `FEATURE_LABELS` from this table) so they cannot drift
 * (#9727 review: the health probe was emitting raw ids like `model3d` into the
 * public body while Settings said "3D Model Generation").
 */
export const CAPABILITY_LABELS: Record<ProviderCapability, string> = {
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

/**
 * The generation capability each MCP/chat command spends, for commands that
 * spend one. Used to withhold a command from the model's tool set (and from
 * the system prompt) while its capability is declared unavailable — a tool the
 * model is told to call and that can only fail is a guaranteed red card and
 * wasted tokens on every orchestrated build (#9725 review).
 */
export const COMMAND_CAPABILITY: Readonly<Record<string, ProviderCapability>> = {
  generate_3d_model: 'model3d',
  generate_3d_from_image: 'model3d',
  generate_character: 'sprite',
  generate_texture: 'texture',
  generate_pbr_maps: 'texture',
  generate_skybox: 'texture',
  generate_sfx: 'sfx',
  generate_voice: 'voice',
  generate_music: 'music',
  generate_sprite: 'sprite',
  generate_sprite_sheet: 'sprite',
  generate_tileset: 'sprite',
  generate_pixel_art: 'sprite',
  remove_background: 'bg_removal',
};

/**
 * The capability each generate route spends, keyed by the `route:` string its
 * `createGenerationHandler` config declares. The handler's refuse-before-charge
 * gate (step 1a) reads this table when a route does not declare `capability`
 * itself, so a route cannot be left ungated by omission — a test walks every
 * `web/src/app/api/generate/*\/route.ts` and fails on a route missing here.
 * `localize` and `pacing` are LLM calls on the chat path.
 */
export const ROUTE_CAPABILITY: Readonly<Record<string, ProviderCapability>> = {
  '/api/generate/localize': 'chat',
  '/api/generate/model': 'model3d',
  '/api/generate/music': 'music',
  '/api/generate/pacing': 'chat',
  '/api/generate/pixel-art': 'sprite',
  '/api/generate/sfx': 'sfx',
  '/api/generate/skybox': 'texture',
  '/api/generate/sprite': 'sprite',
  '/api/generate/sprite-sheet': 'sprite',
  '/api/generate/texture': 'texture',
  '/api/generate/tileset-gen': 'sprite',
  '/api/generate/voice': 'voice',
};

/** Alternative providers for operation-dependent capabilities. Each request
 * uses one provider; aggregate availability means at least one path works.
 * The capabilities response exposes each option so dialogs gate the chosen path.
 */
export const CAPABILITY_PROVIDER_OPTIONS: Partial<Record<ProviderCapability, readonly PlatformKeyProvider[]>> = {
  sprite: ['replicate', 'openai'],
};

/**
 * Whether a command may be offered to the model: true for every command that
 * spends no capability, and for capability commands whose capability is not
 * declared unavailable. Static, so safe in module-load tool tables.
 */
export function isCommandAvailable(commandName: string): boolean {
  const capability = COMMAND_CAPABILITY[commandName];
  return capability === undefined || getCapabilityUnavailability(capability) === null;
}

/**
 * Env-var names for the multi-model routers, which front several providers at
 * once rather than mapping 1:1 to one. Kept beside `PLATFORM_KEY_ENV` so every
 * consumer — the chat-backend table below, `/api/capabilities`, the health
 * check — names them from one place.
 */
export const GATEWAY_KEY_ENV = {
  vercelGateway: 'AI_GATEWAY_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  githubModels: 'GITHUB_MODELS_PAT',
} as const satisfies Record<string, string>;

// ---------------------------------------------------------------------------
// Chat backends
// ---------------------------------------------------------------------------

export interface ChatBackendDescriptor {
  id: BackendId;
  /** Human-readable name, used in health reporting */
  name: string;
  /** Any one of these being present means the backend is configured */
  envVars: readonly string[];
  /** Host to probe for reachability — never a billable endpoint */
  probeUrl: string;
  /** Vercel's OIDC auto-auth can stand in for an explicit key */
  vercelOidc?: boolean;
}

/**
 * Chat backends in the same priority order `lib/providers/registry.ts` tries
 * them, so `resolveConfiguredChatBackend()` names the backend that would
 * actually serve a request.
 *
 * Deliberately a static table rather than a call into the registry: the
 * registry consults live circuit-breaker and provider-health state, which makes
 * it unsafe to call from a health check (the check would grade recent traffic
 * rather than configuration, and would feed its own verdict back into that
 * state).
 */
export const CHAT_BACKENDS: readonly ChatBackendDescriptor[] = [
  {
    id: 'vercel-gateway',
    name: 'Vercel AI Gateway',
    envVars: [GATEWAY_KEY_ENV.vercelGateway],
    probeUrl: 'https://ai-gateway.vercel.sh/v1',
    vercelOidc: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envVars: [GATEWAY_KEY_ENV.openrouter],
    probeUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'github-models',
    name: 'GitHub Models',
    envVars: [GATEWAY_KEY_ENV.githubModels],
    probeUrl: 'https://models.inference.ai.azure.com',
  },
  {
    id: 'direct',
    name: 'Anthropic (direct)',
    envVars: [PLATFORM_KEY_ENV.anthropic],
    probeUrl: 'https://api.anthropic.com',
  },
];

export const CHAT_BACKEND_ENV_VARS: readonly string[] = CHAT_BACKENDS.flatMap((b) => b.envVars);

/**
 * Whether this process is running on a Vercel runtime, and can therefore rely
 * on OIDC auto-auth instead of an explicit gateway key.
 *
 * Vercel sets BOTH `VERCEL=1` and `VERCEL_ENV=<production|preview|development>`,
 * but they are not interchangeable in practice: `vercel env pull` writes only
 * `VERCEL_ENV` into `.env.local`, so a local or CI process can legitimately
 * carry one without the other. Either alone means the runtime is Vercel's.
 *
 * This exists because three call sites answered the question independently and
 * two of them accepted only `VERCEL`, while the backend that actually serves
 * the traffic (`lib/providers/backends/vercelGateway.ts`) accepted either. In a
 * `VERCEL_ENV`-only environment the gateway served chat while the health check
 * and `/api/capabilities` reported no configured backend — a false "AI is
 * down", which is the exact class of drift this module exists to prevent. Add
 * no fourth literal: import this.
 */
export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

/**
 * The highest-priority chat backend that is configured in this environment, or
 * null when none is. On Vercel, OIDC auto-auth means the AI Gateway needs no
 * explicit key — mirroring `app/api/capabilities/route.ts`.
 */
export function resolveConfiguredChatBackend(): ChatBackendDescriptor | null {
  const onVercel = isVercelRuntime();
  for (const backend of CHAT_BACKENDS) {
    if (backend.vercelOidc && onVercel) return backend;
    if (backend.envVars.some((envVar) => Boolean(process.env[envVar]))) return backend;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Capability -> env vars that can serve it (#9719)
// ---------------------------------------------------------------------------

/**
 * Every environment variable that can serve each capability on the platform
 * path. Read by `/api/capabilities` (feature gating) and by the AI Providers
 * health probe, so "configured" means the same thing to both — the probe
 * reported "up" with zero generation keys precisely because it graded a
 * different property than the endpoint users depend on (#9719, lesson 1).
 *
 * Chat is any chat backend; embedding and image can also come from the
 * multi-model routers. Everything else needs its direct provider's key.
 */
export const CAPABILITY_ENV_VARS: Record<ProviderCapability, readonly string[]> = {
  chat: CHAT_BACKEND_ENV_VARS,
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
  // Independent sprite paths: OpenAI or Replicate.
  sprite: CAPABILITY_PROVIDER_OPTIONS.sprite!.map((p) => PLATFORM_KEY_ENV[p]),
  bg_removal: [PLATFORM_KEY_ENV.removebg],
};

/**
 * Whether the platform path can serve a capability in this environment: one
 * of its env vars is set, or it is gateway-served and the process runs on
 * Vercel (OIDC auto-auth needs no explicit key).
 */
export function isCapabilityConfigured(capability: ProviderCapability): boolean {
  // Operation-dependent capabilities need any one supported provider.
  const required = CAPABILITY_PROVIDER_OPTIONS[capability];
  if (required) {
    return required.some((provider) => Boolean(process.env[PLATFORM_KEY_ENV[provider]]));
  }
  const envVars = CAPABILITY_ENV_VARS[capability];
  const vercelOidc = isVercelRuntime() && envVars.includes(GATEWAY_KEY_ENV.vercelGateway);
  return vercelOidc || envVars.some((envVar) => Boolean(process.env[envVar]));
}

/**
 * Capabilities the platform path cannot serve here, in declaration order.
 *
 * A capability declared in `UNAVAILABLE_CAPABILITIES` is excluded: no key
 * could configure it, so listing it would read as an operator omission and
 * keep the AI Providers probe degraded for as long as the product decision
 * stands (#9727 review).
 */
export function listUnconfiguredCapabilities(): ProviderCapability[] {
  return PROVIDER_CAPABILITIES.filter(
    (cap) => getCapabilityUnavailability(cap) === null && !isCapabilityConfigured(cap),
  );
}

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

/** Shared by the sprite route and dialog so provider selection cannot drift. */
export function resolveSpriteProvider(provider: SpriteProvider = 'auto', style?: string): Exclude<SpriteProvider, 'auto'> {
  return provider === 'auto' ? (style === 'pixel-art' ? 'sdxl' : 'dalle3') : provider;
}

export const SPRITE_PROVIDER_KEY = { dalle3: 'openai', sdxl: 'replicate' } as const;
