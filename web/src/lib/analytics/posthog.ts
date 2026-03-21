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

/** Type-safe analytics event names for funnel tracking. */
export enum AnalyticsEvent {
  GAME_CREATED = 'game_created',
  AI_GENERATION_STARTED = 'ai_generation_started',
  AI_GENERATION_COMPLETED = 'ai_generation_completed',
  GAME_PUBLISHED = 'game_published',
  GAME_EXPORTED = 'game_exported',
  TEMPLATE_USED = 'template_used',
  SUBSCRIPTION_STARTED = 'subscription_started',
}

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CONSENT_STORAGE_KEY = 'forge-cookie-consent';

let initialized = false;

/**
 * Returns true only when the user has explicitly accepted cookies.
 * Safe to call during SSR — returns false when window is unavailable.
 */
export function hasConsented(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(CONSENT_STORAGE_KEY) === 'true';
}

/**
 * Initialize PostHog client.
 * Only runs in production with a valid key AND when the user has consented.
 */
export function initPostHog(): void {
  if (initialized || !POSTHOG_KEY || !IS_PRODUCTION) return;
  if (!hasConsented()) return;

  posthog.init(POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false, // We handle page views manually via Next.js router
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
