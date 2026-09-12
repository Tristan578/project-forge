/**
 * PostHog analytics client wrapper.
 *
 * Initializes with NEXT_PUBLIC_POSTHOG_KEY env var.
 * Graceful no-op when key is missing, in non-production environments,
 * or when the user has not granted cookie consent (GDPR compliance).
 *
 * Consent is stored in localStorage under the key 'forge-cookie-consent'.
 * PostHog only loads after the user explicitly clicks "Accept".
 * Default: opted out.
 */

import posthog from 'posthog-js';
import { safeGetItem } from '@/lib/storage/safeLocalStorage';
import { POSTHOG_API_ORIGIN, POSTHOG_ASSET_ORIGIN } from '@/lib/security/posthog-origins';

/** Type-safe analytics event names for funnel tracking. */
export enum AnalyticsEvent {
  GAME_CREATED = 'game_created',
  AI_GENERATION_STARTED = 'ai_generation_started',
  AI_GENERATION_COMPLETED = 'ai_generation_completed',
  GAME_PUBLISHED = 'game_published',
  GAME_EXPORTED = 'game_exported',
  TEMPLATE_USED = 'template_used',
  SUBSCRIPTION_STARTED = 'subscription_started',
  EDITOR_SESSION_STARTED = 'editor_session_started',
  FEATURE_FLAG_EVALUATED = 'feature_flag_evaluated',
  TIER_UPGRADE_PROMPTED = 'tier_upgrade_prompted',
  TEMPLATE_APPLIED = 'template_applied',
  WASM_CDN_FALLBACK = 'wasm_cdn_fallback',
  AI_DEEP_GENERATION_EVAL = 'ai_deep_generation_eval',
}

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CONSENT_STORAGE_KEY = 'forge-cookie-consent';

let initialized = false;

/**
 * Returns true only when the user has explicitly accepted cookies.
 * Safe to call during SSR or when localStorage is null/unavailable
 * (e.g. Android WebView with DOM storage disabled) — returns false in all such cases.
 */
export function hasConsented(): boolean {
  return safeGetItem(CONSENT_STORAGE_KEY) === 'true';
}

/**
 * Initialize PostHog client.
 * Only runs in production with a valid key AND when the user has consented.
 */
export function initPostHog(): void {
  if (initialized || !POSTHOG_KEY || !IS_PRODUCTION) return;
  if (!hasConsented()) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_API_ORIGIN,
    // Stated rather than derived. Without it posthog-js computes the assets
    // host from `api_host` internally, and the CSP's `script-src` would be
    // betting on that derivation instead of describing it — see
    // `lib/security/posthog-origins.ts`.
    asset_host: POSTHOG_ASSET_ORIGIN,
    person_profiles: 'identified_only',
    capture_pageview: false, // We handle page views manually via Next.js router

    // Session replay (#9973). Stated rather than left to the SDK default, for
    // the same reason `asset_host` is: a default is a bet on library internals,
    // and this one decides whether we record users at all.
    //
    // CONSENT IS ALREADY HANDLED. `initPostHog` returns above unless
    // `hasConsented()`, so recording cannot begin before the visitor accepts
    // cookies -- there is deliberately no second gate here that could drift out
    // of step with the first.
    disable_session_recording: false,
    session_recording: {
      // Defaults to true today. Stating it means a future default flip cannot
      // quietly start capturing keystrokes.
      maskAllInputs: true,
      // maskAllInputs does NOT cover a rendered secret. A freshly generated MCP
      // relay token is TEXT, not an input value, so it needs an explicit text
      // mask -- the same hazard that pinned `enableScreenshot: false` on the
      // Sentry feedback widget, where a screenshot could capture one.
      //
      // `.ph-no-capture` is posthog-js's own convention: the element is replaced
      // by a same-size block on playback. Add the class to any surface that
      // renders a credential.
      maskTextSelector: '.ph-no-capture, [data-ph-no-capture]',
    },
    loaded: () => {
      initialized = true;
    },
  });
  initialized = true;
}

/** Track an analytics event. No-op if PostHog is not initialized. */
export function trackEvent(
  name: AnalyticsEvent | string,
  properties?: Record<string, unknown>,
): void {
  if (!initialized) return;
  posthog.capture(name, properties);
}

/** Identify a user for analytics. No-op if PostHog is not initialized. */
export function identifyUser(
  userId: string,
  traits?: Record<string, unknown>,
): void {
  if (!initialized) return;
  posthog.identify(userId, traits);
}

/** Track a page view. No-op if PostHog is not initialized. */
export function trackPageView(url: string): void {
  if (!initialized) return;
  posthog.capture('$pageview', { $current_url: url });
}

/** Reset PostHog identity (on logout). No-op if not initialized. */
export function resetAnalytics(): void {
  if (!initialized) return;
  posthog.reset();
}
