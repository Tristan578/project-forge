/**
 * Dialog-facing capability gate (#9117).
 *
 * Blocks a generation dialog ONLY when `/api/capabilities` reports the feature
 * `unprovisionable` — declared unavailable in code, so no key anywhere can
 * make it work. It deliberately does NOT block on plain `available: false`:
 * that state means "no platform key here", which a user's own (BYOK) key may
 * override, and which a stale or anonymous cached body could misreport. The
 * server refuses an unprovisionable capability before any token is deducted
 * (`createGenerationHandler` 1a), so failing open on every other state costs
 * the user nothing; the notice is what stops them composing a request that
 * cannot succeed.
 *
 * Never blocked while the capabilities fetch is loading or has failed.
 */

import { useMemo } from 'react';
import { useCapabilities, FEATURE_CAPABILITY_MAP, type FeatureId } from './useFeatureGating';

export interface GenerationGateResult {
  /** True only when the server has reported the feature unprovisionable. */
  blocked: boolean;
  /** The server's user-facing reason for the first unprovisionable capability, when blocked. */
  reason: string | undefined;
  /** Capability data still loading — never blocked while true. */
  loading: boolean;
}

export function useGenerationGate(featureId: FeatureId): GenerationGateResult {
  const { capabilities, loading, error } = useCapabilities();

  return useMemo(() => {
    if (loading || error) {
      return { blocked: false, reason: undefined, loading };
    }
    const required = FEATURE_CAPABILITY_MAP[featureId] ?? [];
    const status = capabilities.find(
      (c) => required.includes(c.capability) && c.unprovisionable === true,
    );
    if (!status) {
      return { blocked: false, reason: undefined, loading: false };
    }
    return {
      blocked: true,
      reason: status.hint ?? `${status.label} is not available yet.`,
      loading: false,
    };
  }, [featureId, capabilities, loading, error]);
}
