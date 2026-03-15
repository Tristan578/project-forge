/**
 * Server-side Vercel Web Analytics event tracking.
 *
 * Use for billing, subscription, and other server-only events
 * that shouldn't depend on client-side JS.
 */

import { track } from '@vercel/analytics/server';

const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';

export async function trackSubscriptionStarted(tier: string) {
  await track('subscription_started', { tier, env });
}

export async function trackSubscriptionCancelled(tier: string) {
  await track('subscription_cancelled', { tier, env });
}

export async function trackAddonTokensPurchased(packageName: string) {
  await track('addon_tokens_purchased', { package: packageName, env });
}

export async function trackPaymentFailed(tier: string) {
  await track('payment_failed', { tier, env });
}

export async function trackGamePublishedServer(tier: string, slug: string) {
  await track('game_published', { tier, slug, env });
}
