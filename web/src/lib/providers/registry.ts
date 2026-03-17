/**
 * Provider registry.
 *
 * Aggregates all backends and exposes resolution functions for routing AI
 * capability requests to the best available backend.
 *
 * Priority order (highest first):
 *   1. Vercel AI Gateway — lowest latency, OIDC auth, OpenAI-compatible
 *   2. OpenRouter       — widest model selection, 500+ models
 *   3. GitHub Models    — free tier, developer audience, core models only
 *   4. Direct           — catch-all for asset providers (Meshy, ElevenLabs, etc.)
 */

import type { ProviderBackend, ProviderCapability, BackendId, ResolvedRoute } from './types';
import { vercelGatewayBackend } from './backends/vercelGateway';
import { openrouterBackend } from './backends/openrouter';
import { githubModelsBackend } from './backends/githubModels';
import { directBackend, resolveDirectKey } from './backends/direct';
import { providerHealthMonitor } from '@/lib/ai/providerHealth';
import { getProviderBreaker, type ProviderName } from './circuitBreaker';

/** Backends ordered by preference — first configured backend wins */
const BACKENDS: ReadonlyArray<ProviderBackend> = [
  vercelGatewayBackend,
  openrouterBackend,
  githubModelsBackend,
  directBackend,
];

/** Index of backends by ID for fast lookup */
const BACKEND_BY_ID = new Map<BackendId, ProviderBackend>(
  BACKENDS.map((b) => [b.id, b])
);

/**
 * Resolve the best available backend for a capability.
 *
 * @param capability     - The AI capability needed (e.g. 'chat', 'model3d')
 * @param preferredModel - Optional canonical model name to route through
 * @param preferredBackend - Pin to a specific backend ID (skips priority order)
 * @returns ResolvedRoute or null if no backend can serve this capability
 */
export function resolveBackend(
  capability: ProviderCapability,
  preferredModel?: string,
  preferredBackend?: BackendId
): ResolvedRoute | null {
  // If a specific backend is requested, use it (if configured and capable)
  if (preferredBackend) {
    const pinned = BACKEND_BY_ID.get(preferredBackend);
    if (pinned && pinned.isConfigured() && (pinned.capabilities as ProviderCapability[]).includes(capability)) {
      return buildRoute(pinned, capability, preferredModel);
    }
    // Fall through to priority resolution if pinned backend isn't available
  }

  // Walk backends in priority order, preferring healthy ones
  let firstCapable: ProviderBackend | null = null;
  for (const backend of BACKENDS) {
    if (!backend.isConfigured()) continue;
    if (!(backend.capabilities as ProviderCapability[]).includes(capability)) continue;
    // Track first capable backend as fallback
    if (!firstCapable) firstCapable = backend;
    // Skip unhealthy backends — failover to next in priority order
    if (!providerHealthMonitor.isHealthy(backend.id)) continue;
    return buildRoute(backend, capability, preferredModel);
  }

  // All capable backends are unhealthy — use first capable as last resort
  if (firstCapable) {
    return buildRoute(firstCapable, capability, preferredModel);
  }

  return null;
}

/** Build a ResolvedRoute from a backend + capability */
function buildRoute(
  backend: ProviderBackend,
  capability: ProviderCapability,
  preferredModel?: string
): ResolvedRoute {
  const apiKey =
    backend.id === 'direct'
      ? resolveDirectKey(capability)
      : backend.getApiKey();

  const endpoint = backend.getEndpoint() || undefined;
  const modelId = preferredModel
    ? backend.resolveModelId(preferredModel)
    : undefined;

  return {
    backendId: backend.id,
    apiKey,
    endpoint,
    modelId,
    metered: true, // token cost is handled upstream; backends don't gate on this
  };
}

/**
 * Returns the set of capabilities that have at least one configured backend.
 */
export function getAvailableCapabilities(): Set<ProviderCapability> {
  const available = new Set<ProviderCapability>();
  for (const backend of BACKENDS) {
    if (!backend.isConfigured()) continue;
    for (const cap of backend.capabilities) {
      available.add(cap);
    }
  }
  return available;
}

/**
 * Returns true if at least one configured backend supports the capability.
 */
export function isCapabilityAvailable(capability: ProviderCapability): boolean {
  return BACKENDS.some(
    (b) => b.isConfigured() && (b.capabilities as ProviderCapability[]).includes(capability)
  );
}

/**
 * Returns all backends with their configuration status.
 */
export function getAllBackends(): Array<{ backend: ProviderBackend; configured: boolean }> {
  return BACKENDS.map((backend) => ({
    backend,
    configured: backend.isConfigured(),
  }));
}

/**
 * Returns only the backends that are currently configured.
 */
export function getConfiguredBackends(): ProviderBackend[] {
  return BACKENDS.filter((b) => b.isConfigured());
}

/**
 * Map backend IDs to circuit breaker provider names.
 * For the 'direct' backend, callers should use the specific provider name
 * (e.g. 'anthropic', 'meshy') rather than 'direct'.
 */
function backendIdToProviderName(backendId: BackendId): ProviderName | null {
  const map: Partial<Record<BackendId, ProviderName>> = {
    'vercel-gateway': 'vercel-gateway',
    'openrouter': 'openrouter',
    'github-models': 'github-models',
  };
  return map[backendId] ?? null;
}

/**
 * Resolve the best available backend for a capability, skipping any backends
 * whose circuit breaker is OPEN.
 *
 * This is the preferred resolution path for all AI operations. Falls back to
 * the next available backend if the preferred one is open-circuited.
 *
 * @param capability     - The AI capability needed (e.g. 'chat', 'model3d')
 * @param preferredModel - Optional canonical model name to route through
 * @param preferredBackend - Pin to a specific backend ID (skips priority order)
 * @returns ResolvedRoute with circuit breaker state, or null if no backend available
 */
export function resolveBackendWithCircuitBreaker(
  capability: ProviderCapability,
  preferredModel?: string,
  preferredBackend?: BackendId
): ResolvedRoute & { circuitBreakerWarning?: string } | null {
  // If a specific backend is requested, check its circuit breaker
  if (preferredBackend) {
    const pinned = BACKEND_BY_ID.get(preferredBackend);
    if (
      pinned &&
      pinned.isConfigured() &&
      (pinned.capabilities as ProviderCapability[]).includes(capability)
    ) {
      const providerName = backendIdToProviderName(preferredBackend);
      if (providerName) {
        const breaker = getProviderBreaker(providerName);
        const blocked = breaker.checkNonEssential();
        if (!blocked) {
          const route = buildRoute(pinned, capability, preferredModel);
          const warning = breaker.checkEssential();
          return warning ? { ...route, circuitBreakerWarning: warning } : route;
        }
        // Fall through to priority resolution
      } else {
        return buildRoute(pinned, capability, preferredModel);
      }
    }
  }

  // Walk backends in priority order, skipping open-circuited ones
  for (const backend of BACKENDS) {
    if (!backend.isConfigured()) continue;
    if (!(backend.capabilities as ProviderCapability[]).includes(capability)) continue;

    const providerName = backendIdToProviderName(backend.id);
    if (providerName) {
      const breaker = getProviderBreaker(providerName);
      const blocked = breaker.checkNonEssential();
      if (blocked) continue; // Skip this backend, try next
    }

    const route = buildRoute(backend, capability, preferredModel);
    const providerName2 = backendIdToProviderName(backend.id);
    if (providerName2) {
      const warning = getProviderBreaker(providerName2).checkEssential();
      return warning ? { ...route, circuitBreakerWarning: warning } : route;
    }
    return route;
  }

  return null;
}
