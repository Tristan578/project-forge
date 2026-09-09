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
  /**
   * True when the caller could actually flip this capability on from Settings
   * — every provider it still needs is in `BYOK_PROVIDERS` and accepted by
   * `/api/keys/[provider]`. False for `sprite` (Replicate + OpenAI), `image`
   * and `bg_removal` (OpenAI, remove.bg): Settings has no field for those, so
   * pointing there is a dead end, which is precisely what the notice exists to
   * avoid (#9725 p8). Never true while `unprovisionable` is.
   */
  byokConfigurable: boolean;
}

/**
 * Combine the gates of the capabilities ONE entry point can reach, for a
 * dialog that covers more than one: the Sound dialog runs `sfx` OR `voice`,
 * and its own type radios stay enabled on purpose so a user can switch to
 * whichever still works. Gating that entry on `sfx` alone would make voice
 * generation unreachable from the UI the moment `sfx` were declared
 * unavailable, and the in-dialog escape hatch impossible to exercise
 * (#9725 p8). Blocked only when EVERY capability is.
 */
export function combineGenerationGates(gates: GenerationGateResult[]): GenerationGateResult {
  if (gates.some((g) => g.loading)) {
    return { blocked: false, reason: undefined, loading: true, unprovisionable: false, byokConfigurable: false };
  }
  const usable = gates.find((g) => !g.blocked);
  if (usable) return usable;
  return {
    blocked: true,
    reason: gates[0]?.reason,
    loading: false,
    // Only "nothing can enable this" when that is true of every capability the
    // entry point reaches; likewise only offer Settings when every one of them
    // is actually fixable there.
    unprovisionable: gates.every((g) => g.unprovisionable),
    byokConfigurable: gates.every((g) => g.byokConfigurable),
  };
}

export function useGenerationGate(featureId: FeatureId): GenerationGateResult {
  const { capabilities, loading, error, degraded } = useCapabilities();

  return useMemo(() => {
    const open = {
      blocked: false,
      reason: undefined,
      loading,
      unprovisionable: false,
      byokConfigurable: false,
    };
    if (loading || error) return open;

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
      // The route decides this: it knows which providers are still missing and
      // which of them `/api/keys/[provider]` would accept. An older body
      // without the field is treated as NOT configurable — omitting the link
      // costs a click, offering a dead one costs trust.
      byokConfigurable: status.byokConfigurable === true,
    };
  }, [featureId, capabilities, loading, error, degraded]);
}
