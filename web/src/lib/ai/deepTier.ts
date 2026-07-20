/**
 * Deep-generation tier helpers.
 *
 * Gate the Opus 4.8 quality tier behind a feature flag so rollout can be
 * canaried without a deploy. When `NEXT_PUBLIC_USE_DEEP_GENERATION=true`,
 * deep-generation surfaces (GDD, world builder, cutscenes) route to
 * AI_MODEL_DEEP. Otherwise they fall back to AI_MODEL_PRIMARY.
 *
 * A PostHog flag (`deep-generation-tier`, PF-971 / #8952) can override this
 * decision when the flags evaluator has a confident cached read — see
 * `@/lib/flags/posthogFlags`. That evaluator is dormant unless
 * `POSTHOG_PERSONAL_API_KEY` + `NEXT_PUBLIC_POSTHOG_KEY` are both set, in
 * which case `getBooleanFlag()` returns the `fallback` argument unchanged
 * (zero behavior change from the env-only gate below).
 *
 * Every call emits `ai_deep_generation_eval` to PostHog so we can A/B the
 * tier against retention and publish-rate in a shared dashboard.
 */

import { AI_MODEL_DEEP, AI_MODEL_PRIMARY } from './models';
import { trackEvent } from '@/lib/analytics/posthog';
import { getBooleanFlag } from '@/lib/flags/posthogFlags';
import type { DeepGenSurface } from './surfaces';

export type { DeepGenSurface } from './surfaces';

/** PostHog flag key that can override the env-based deep-tier gate. */
const DEEP_TIER_FLAG_KEY = 'deep-generation-tier';

/**
 * True when the deep-generation tier is enabled — either via
 * `NEXT_PUBLIC_USE_DEEP_GENERATION` (the default, always-on gate) or a
 * PostHog override when local flag evaluation is active and has a
 * supported decision for `deep-generation-tier`. Synchronous: reads only
 * the in-memory flags cache, never blocks on network I/O.
 */
export function isDeepTierEnabled(): boolean {
  const envEnabled = process.env.NEXT_PUBLIC_USE_DEEP_GENERATION === 'true';
  return getBooleanFlag(DEEP_TIER_FLAG_KEY, envEnabled);
}

/**
 * Return the model to use for a deep-generation surface and emit an
 * analytics event tagging which tier handled the request.
 *
 * Call once per generation — the event pairs with downstream
 * `AI_GENERATION_COMPLETED` for token-cost and retention analysis.
 */
export function getDeepGenerationModel(surface: DeepGenSurface): string {
  const enabled = isDeepTierEnabled();
  const model = enabled ? AI_MODEL_DEEP : AI_MODEL_PRIMARY;

  trackEvent('ai_deep_generation_eval', {
    surface,
    model,
    deepTierEnabled: enabled,
  });

  return model;
}
