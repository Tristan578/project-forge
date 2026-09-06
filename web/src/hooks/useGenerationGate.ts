/**
 * Gate generation on the current user's platform/BYOK availability (#9724).
 * Loading, failed, degraded, and missing capability responses never block.
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
  /**
   * True when NO key — platform or BYOK — can ever enable this capability
   * (`UNAVAILABLE_CAPABILITIES`, e.g. music pending #9522). Entry points
   * hard-disable on this and nothing else: a capability that merely lacks a
   * key stays clickable so the dialog's notice, which names the provider and
   * links to Settings, is still reachable (#9725 p7).
   */
  unprovisionable: boolean;
  /** False when Settings cannot supply the missing provider. */
  byokConfigurable?: boolean;
}

export function useGenerationGate(featureId: FeatureId, provider?: 'openai' | 'replicate'): GenerationGateResult {
  const { capabilities, loading, error, degraded } = useCapabilities();

  return useMemo(() => {
    const open = { blocked: false, reason: undefined, loading, unprovisionable: false, byokConfigurable: false };
    if (loading || error) return open;

    const operation = capabilities.find((c) => c.capability === 'sprite');
    if (featureId === 'sprite-generation' && provider && !degraded &&
        operation?.unprovisionable !== true && operation?.providerAvailability?.[provider] === false) {
      return { ...open, loading: false, blocked: true,
        reason: `This sprite operation needs ${provider === 'openai' ? 'OpenAI' : 'Replicate'}, which only this deployment can configure.` };
    }

    const required = FEATURE_CAPABILITY_MAP[featureId] ?? [];
    const status = capabilities.find(
      (c) => required.includes(c.capability) && c.available === false,
    );
    if (!status) return { ...open, loading: false };

    // A degraded body could not read this caller's own keys, so its
    // `available: false` is a statement about the platform, not about the
    // user. Blocking on it turned the route's deliberate fail-open into a
    // client fail-closed and told BYOK users to configure the key they hold.
    // `unprovisionable` comes from a code constant and survives untouched.
    if (degraded && status.unprovisionable !== true) return { ...open, loading: false };

    return {
      blocked: true,
      reason: status.hint ?? `${status.label} is not available yet.`,
      loading: false,
      unprovisionable: status.unprovisionable === true,
      byokConfigurable: status.byokConfigurable === true,
    };
  }, [featureId, provider, capabilities, loading, error, degraded]);
}
