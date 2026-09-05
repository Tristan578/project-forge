/**
 * Gate generation on the current user's platform/BYOK availability (#9724).
 * Loading, failed, and missing capability responses never block.
 */

import { useMemo } from 'react';
import { useCapabilities, FEATURE_CAPABILITY_MAP, type FeatureId } from './useFeatureGating';

export interface GenerationGateResult {
  /** True only when the server has reported the feature unavailable. */
  blocked: boolean;
  /** The server's user-facing reason for the first unavailable capability, when blocked. */
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
      (c) => required.includes(c.capability) && c.available === false,
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
