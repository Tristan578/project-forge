/**
 * Deep-generation tier helpers.
 *
 * Gate the Opus 4.7 quality tier behind a feature flag so rollout can be
 * canaried without a deploy. When `NEXT_PUBLIC_USE_DEEP_GENERATION=true`,
 * deep-generation surfaces (GDD, world builder, cutscenes) route to
 * AI_MODEL_DEEP. Otherwise they fall back to AI_MODEL_PRIMARY.
 *
 * Every call emits `ai_deep_generation_eval` to PostHog so we can A/B the
 * tier against retention and publish-rate in a shared dashboard.
 */

import { AI_MODEL_DEEP, AI_MODEL_PRIMARY } from './models';
import { trackEvent } from '@/lib/analytics/posthog';

/** Surfaces eligible for the deep-generation tier. */
export type DeepGenSurface = 'gdd' | 'world_builder' | 'cutscene';

/**
 * True when the deep-generation tier is enabled via
 * `NEXT_PUBLIC_USE_DEEP_GENERATION`. Defaults to off.
 */
export function isDeepTierEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_DEEP_GENERATION === 'true';
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
