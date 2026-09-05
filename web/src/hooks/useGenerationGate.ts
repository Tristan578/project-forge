/**
 * Dialog-facing capability gate (#9117).
 *
 * `useFeatureGating` answers "is this feature available?" and treats an
 * in-flight or failed `/api/capabilities` fetch as "no". That is the right
 * answer for a tooltip and the wrong one for blocking a submit button: a
 * transient error there would switch off every generation dialog at once.
 *
 * This hook blocks ONLY on a positive report from the server that the feature
 * is unavailable. The server refuses an unavailable capability before any
 * token is deducted (`createGenerationHandler` 6a), so failing open here costs
 * the user nothing; the notice is what stops them composing a request that
 * cannot succeed.
 */

import { useMemo } from 'react';
import { useCapabilities, FEATURE_CAPABILITY_MAP, type FeatureId } from './useFeatureGating';

export interface GenerationGateResult {
  /** True only when the server has reported the feature unavailable. */
  blocked: boolean;
  /** The server's hint for the first unavailable capability, when blocked. */
  reason: string | undefined;
  /** Capability data still loading — never blocked while true. */
  loading: boolean;
}

export function useGenerationGate(featureId: FeatureId): GenerationGateResult {
  const { capabilities, available, loading, error } = useCapabilities();

  return useMemo(() => {
    if (loading || error) {
      return { blocked: false, reason: undefined, loading };
    }
    const required = FEATURE_CAPABILITY_MAP[featureId] ?? [];
    const missing = required.find((cap) => !available.has(cap));
    if (!missing) {
      return { blocked: false, reason: undefined, loading: false };
    }
    const status = capabilities.find((c) => c.capability === missing);
    return {
      blocked: true,
      reason: status?.hint ?? `${status?.label ?? 'This feature'} is currently unavailable.`,
      loading: false,
    };
  }, [featureId, capabilities, available, loading, error]);
}
