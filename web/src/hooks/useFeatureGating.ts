/**
 * Feature gating hook.
 *
 * Checks which AI capabilities are available based on configured API keys.
 * Fetches capability status from /api/capabilities (server-side env check)
 * and provides per-feature availability with helpful tooltips.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ProviderCapability } from '@/lib/providers/types';
import type { CapabilitiesResponse, CapabilityStatus } from '@/app/api/capabilities/route';
import { ERROR_TTL_MS } from '@/lib/config/timeouts';

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
const FEATURE_CAPABILITY_MAP: Record<FeatureId, ProviderCapability[]> = {
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

/** Human-readable feature labels for tooltips */
const FEATURE_LABELS: Record<FeatureId, string> = {
  'ai-chat': 'AI Chat',
  'image-generation': 'Image Generation',
  'model-generation': '3D Model Generation',
  'texture-generation': 'Texture Generation',
  'sfx-generation': 'Sound Effect Generation',
  'voice-generation': 'Voice Generation',
  'music-generation': 'Music Generation',
  'sprite-generation': 'Sprite Generation',
  'bg-removal': 'Background Removal',
  'semantic-search': 'Semantic Search',
};

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
}

/** Module-level cache so multiple hook instances share one fetch */
let cachedState: CapabilitiesState | null = null;
let fetchPromise: Promise<void> | null = null;
let subscribers: Array<() => void> = [];

/** TTL for error states — allows retry after 30 seconds (PF-508). Re-exported from @/lib/config/timeouts */
export { ERROR_TTL_MS } from '@/lib/config/timeouts';
let errorCachedAt: number | null = null;

function notifySubscribers(): void {
  for (const cb of subscribers) {
    cb();
  }
}

/** Check if the cached error state has expired and should be retried. */
function isErrorExpired(): boolean {
  if (!cachedState?.error || errorCachedAt === null) return false;
  return Date.now() - errorCachedAt >= ERROR_TTL_MS;
}

function fetchCapabilities(): Promise<void> {
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetch('/api/capabilities')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<CapabilitiesResponse>;
    })
    .then((data) => {
      cachedState = {
        capabilities: data.capabilities,
        available: new Set(data.available),
        loading: false,
        error: null,
      };
      errorCachedAt = null;
      notifySubscribers();
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      cachedState = {
        capabilities: [],
        available: new Set(),
        loading: false,
        error: message,
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
  cachedState = null;
  fetchPromise = null;
  subscribers = [];
  errorCachedAt = null;
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

    // Trigger fetch if not started, or retry if error TTL expired (PF-508)
    if ((!cachedState && !fetchPromise) || isErrorExpired()) {
      cachedState = {
        capabilities: [],
        available: new Set(),
        loading: true,
        error: null,
      };
      errorCachedAt = null;
      fetchPromise = null;
      fetchCapabilities();
    }

    return () => {
      subscribers = subscribers.filter((s) => s !== cb);
    };
  }, []);

  const state = cachedState ?? {
    capabilities: [],
    available: new Set<ProviderCapability>(),
    loading: true,
    error: null,
  };

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

    // Trigger fetch if not started, or retry if error TTL expired (PF-508)
    if ((!cachedState && !fetchPromise) || isErrorExpired()) {
      cachedState = {
        capabilities: [],
        available: new Set(),
        loading: true,
        error: null,
      };
      errorCachedAt = null;
      fetchPromise = null;
      fetchCapabilities();
    }

    return () => {
      subscribers = subscribers.filter((s) => s !== cb);
    };
  }, []);

  const state = cachedState ?? {
    capabilities: [],
    available: new Set<ProviderCapability>(),
    loading: true,
    error: null,
  };

  const refresh = useCallback(() => {
    fetchPromise = null;
    cachedState = {
      capabilities: [],
      available: new Set(),
      loading: true,
      error: null,
    };
    errorCachedAt = null;
    notifySubscribers();
    fetchCapabilities();
  }, []);

  return {
    capabilities: state.capabilities,
    available: state.available,
    loading: state.loading,
    error: state.error,
    refresh,
  };
}
