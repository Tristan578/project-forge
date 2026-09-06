/**
 * Feature gating hook.
 *
 * Checks which AI capabilities are available based on configured API keys.
 * Fetches capability status from /api/capabilities (server-side env check)
 * and provides per-feature availability with helpful tooltips.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ProviderCapability } from '@/lib/providers/types';
import { CAPABILITY_LABELS } from '@/lib/config/providers';
import type { CapabilitiesResponse, CapabilityStatus } from '@/app/api/capabilities/route';
import { ERROR_TTL_MS, CAPABILITIES_TTL_MS } from '@/lib/config/timeouts';

/** High-level feature identifiers that map to one or more provider capabilities */
export type FeatureId =
  | 'ai-chat'
  | 'image-generation'
  | 'model-generation'
  | 'texture-generation'
  | 'sfx-generation'
  | 'voice-generation'
  | 'music-generation'
  | 'sprite-generation'
  | 'bg-removal'
  | 'semantic-search';

/** Maps feature IDs to the provider capabilities they require */
export const FEATURE_CAPABILITY_MAP: Record<FeatureId, ProviderCapability[]> = {
  'ai-chat': ['chat'],
  'image-generation': ['image'],
  'model-generation': ['model3d'],
  'texture-generation': ['texture'],
  'sfx-generation': ['sfx'],
  'voice-generation': ['voice'],
  'music-generation': ['music'],
  'sprite-generation': ['sprite'],
  'bg-removal': ['bg_removal'],
  'semantic-search': ['embedding'],
};

/**
 * Human-readable feature labels for tooltips, DERIVED from the one shared
 * table (`CAPABILITY_LABELS`) rather than restated here. A second copy is the
 * drift `CAPABILITY_LABELS` exists to prevent: it read identically until
 * someone renamed a capability on one side (#9727 review). Exported so a test
 * can pin the derivation.
 */
export const FEATURE_LABELS: Record<FeatureId, string> = Object.fromEntries(
  (Object.entries(FEATURE_CAPABILITY_MAP) as [FeatureId, ProviderCapability[]][]).map(
    ([featureId, caps]) => [featureId, caps.map((cap) => CAPABILITY_LABELS[cap]).join(' + ')],
  ),
) as Record<FeatureId, string>;

export interface FeatureGateResult {
  /** Whether the feature is available (all required capabilities configured) */
  isAvailable: boolean;
  /** Human-readable reason why the feature is unavailable, or undefined if available */
  reason: string | undefined;
  /** Whether the capability data is still loading */
  loading: boolean;
}

interface CapabilitiesState {
  capabilities: CapabilityStatus[];
  available: Set<ProviderCapability>;
  loading: boolean;
  error: string | null;
  /**
   * The route could not read the caller's own (BYOK) keys, so `available:
   * false` in this body is not a claim about this user (#9725 p7). Consumers
   * that DISABLE something must not act on it.
   */
  degraded: boolean;
}

/** The empty body served before the first fetch settles. */
function loadingState(): CapabilitiesState {
  return { capabilities: [], available: new Set(), loading: true, error: null, degraded: false };
}

/** Module-level cache so multiple hook instances share one fetch */
let cachedState: CapabilitiesState | null = null;
let fetchPromise: Promise<void> | null = null;
let subscribers: Array<() => void> = [];

/** TTL for error states — allows retry after 30 seconds (PF-508). Re-exported from @/lib/config/timeouts */
export { ERROR_TTL_MS, CAPABILITIES_TTL_MS } from '@/lib/config/timeouts';
let errorCachedAt: number | null = null;
/** When the current successful body was fetched; it ages out after CAPABILITIES_TTL_MS (#9725). */
let fetchedAt: number | null = null;
let cacheVersion = 0;
/**
 * An invalidation happened while nothing was mounted, so the body currently
 * held is known-stale even though its TTL has not expired. Cleared the moment
 * a replacement request is issued.
 */
let revalidationPending = false;

function notifySubscribers(): void {
  for (const cb of subscribers) {
    cb();
  }
}

/**
 * Whether the cached state should be refetched on the next mount: an error
 * older than ERROR_TTL_MS (retry), or a successful body older than
 * CAPABILITIES_TTL_MS (the body is per-user, so it must not outlive a
 * sign-out/sign-in by more than the route's own max-age — #9725).
 */
function isCacheStale(): boolean {
  if (!cachedState || cachedState.loading) return false;
  // `fetchPromise` is nulled when a request settles, so a non-null one means a
  // revalidation is already in flight: never start a second.
  if (fetchPromise) return false;
  if (revalidationPending) return true;
  if (cachedState.error) {
    return errorCachedAt !== null && Date.now() - errorCachedAt >= ERROR_TTL_MS;
  }
  return fetchedAt !== null && Date.now() - fetchedAt >= CAPABILITIES_TTL_MS;
}

/**
 * Start a fetch if one is needed, WITHOUT discarding a usable body first
 * (stale-while-revalidate). Resetting to the loading fallback flipped every
 * mounted consumer to `loading: true` for the whole round trip, which
 * un-blocked `useGenerationGate`: the unavailable notice unmounted, disabled
 * inputs and the Generate button re-enabled, the pills vanished, and a user
 * mid-flow could submit into the gap — on every sign-in/out and every BYOK
 * save (#9725 p7). Only an errored body is worth throwing away.
 */
function ensureCapabilities(): void {
  const uninitialized = !cachedState && !fetchPromise;
  if (!uninitialized && !isCacheStale()) return;
  if (!cachedState || cachedState.error) {
    cachedState = loadingState();
    errorCachedAt = null;
  }
  void fetchCapabilities();
}

/**
 * Drop the cached body and immediately refresh mounted consumers. Call from whatever reacts
 * to an auth change (sign-in, sign-out, BYOK key saved) so a per-user
 * availability body never outlives the user it was fetched for.
 */
export function invalidateCapabilitiesCache(): void {
  cacheVersion += 1;
  fetchPromise = null;
  fetchedAt = null;
  errorCachedAt = null;
  revalidationPending = true;
  // The previous body is kept and keeps being served until the replacement
  // lands (see `ensureCapabilities`); only an errored one is dropped, since
  // serving a stale error would suppress nothing but the retry's own result.
  if (cachedState?.error) cachedState = null;
  if (subscribers.length > 0) void fetchCapabilities();
  notifySubscribers();
}

function fetchCapabilities(): Promise<void> {
  if (fetchPromise) return fetchPromise;

  // `no-store`: the route answers `Cache-Control: private, max-age=60`, and a
  // default-mode fetch right after invalidateCapabilitiesCache() would be
  // served the PRE-change body from the browser's HTTP cache — then held here
  // for another CAPABILITIES_TTL_MS. This module is the only cache; the
  // network request must always reach the route.
  const version = cacheVersion;
  revalidationPending = false;
  fetchPromise = fetch('/api/capabilities', { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<CapabilitiesResponse>;
    })
    .then((data) => {
      if (version !== cacheVersion) return;
      cachedState = {
        capabilities: data.capabilities,
        available: new Set(data.available),
        loading: false,
        error: null,
        degraded: data.degraded === true,
      };
      errorCachedAt = null;
      fetchedAt = Date.now();
      fetchPromise = null;
      notifySubscribers();
    })
    .catch((err: unknown) => {
      if (version !== cacheVersion) return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      cachedState = {
        capabilities: [],
        available: new Set(),
        loading: false,
        error: message,
        degraded: false,
      };
      // Allow retry on next mount or after TTL expires
      fetchPromise = null;
      errorCachedAt = Date.now();
      notifySubscribers();
    });

  return fetchPromise;
}

/**
 * Reset internal cache — for testing only.
 */
export function _resetCapabilitiesCache(): void {
  cacheVersion += 1;
  cachedState = null;
  fetchPromise = null;
  subscribers = [];
  errorCachedAt = null;
  fetchedAt = null;
  revalidationPending = false;
}

/**
 * Hook to check if a specific feature is available.
 *
 * @param featureId - The feature to check (e.g. 'ai-chat', 'model-generation')
 * @returns { isAvailable, reason, loading }
 *
 * @example
 * ```tsx
 * const { isAvailable, reason } = useFeatureGating('ai-chat');
 * return (
 *   <button disabled={!isAvailable} title={reason}>
 *     Open AI Chat
 *   </button>
 * );
 * ```
 */
export function useFeatureGating(featureId: FeatureId): FeatureGateResult {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const cb = () => forceUpdate((n) => n + 1);
    subscribers.push(cb);

    ensureCapabilities();

    return () => {
      subscribers = subscribers.filter((s) => s !== cb);
    };
  }, []);

  const state = cachedState ?? loadingState();

  return useMemo(() => {
    if (state.loading) {
      return { isAvailable: false, reason: undefined, loading: true };
    }

    const requiredCaps = FEATURE_CAPABILITY_MAP[featureId];
    if (!requiredCaps) {
      return { isAvailable: false, reason: `Unknown feature: ${featureId}`, loading: false };
    }

    const allAvailable = requiredCaps.every((cap) => state.available.has(cap));

    if (allAvailable) {
      return { isAvailable: true, reason: undefined, loading: false };
    }

    // Build helpful reason from capability statuses
    const missingCaps = requiredCaps.filter((cap) => !state.available.has(cap));
    const capStatus = state.capabilities.find(
      (c) => c.capability === missingCaps[0]
    );

    const reason =
      capStatus?.hint ??
      `Configure an API key in Settings to enable ${FEATURE_LABELS[featureId]}.`;

    return { isAvailable: false, reason, loading: false };
  }, [featureId, state.loading, state.available, state.capabilities]);
}

/**
 * Hook to get all capability statuses at once.
 *
 * @returns { capabilities, available, loading, error, refresh }
 */
export function useCapabilities() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const cb = () => forceUpdate((n) => n + 1);
    subscribers.push(cb);

    ensureCapabilities();

    return () => {
      subscribers = subscribers.filter((s) => s !== cb);
    };
  }, []);

  const state = cachedState ?? loadingState();

  const refresh = useCallback(() => invalidateCapabilitiesCache(), []);

  return {
    capabilities: state.capabilities,
    available: state.available,
    loading: state.loading,
    error: state.error,
    degraded: state.degraded,
    refresh,
  };
}
