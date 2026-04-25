/**
 * Server-side Vercel Web Analytics event tracking.
 *
 * Use for billing, subscription, and other server-only events
 * that shouldn't depend on client-side JS.
 */

import { track } from '@vercel/analytics/server';

const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';

export async function trackSubscriptionStarted(tier: string): Promise<void> {
  await track('subscription_started', { tier, env });
}

export async function trackSubscriptionCancelled(tier: string): Promise<void> {
  await track('subscription_cancelled', { tier, env });
}

export async function trackAddonTokensPurchased(packageName: string): Promise<void> {
  await track('addon_tokens_purchased', { package: packageName, env });
}

export async function trackPaymentFailed(tier: string): Promise<void> {
  await track('payment_failed', { tier, env });
}

export async function trackGamePublishedServer(tier: string, slug: string): Promise<void> {
  await track('game_published', { tier, slug, env });
}

/**
 * Track Anthropic prompt-cache hit metrics for an LLM step.
 *
 * Emitted once per agent step in `/api/chat`. Powers a PostHog dashboard that
 * compares 5-minute vs 1-hour ephemeral TTLs and tracks the cost reduction
 * from the extended-cache-ttl-2025-04-11 beta.
 *
 * @param tier - 'long' when any block in the request used 1h TTL; 'short' otherwise.
 * @param usage - Token counts pulled from `step.usage.inputTokenDetails`.
 */
export async function trackAiCacheHitRate(
  tier: 'short' | 'long',
  usage: {
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    outputTokens?: number;
  },
): Promise<void> {
  await track('ai_cache_hit_rate', {
    tier,
    input_tokens: usage.inputTokens ?? 0,
    cache_read_tokens: usage.cacheReadTokens ?? 0,
    cache_write_tokens: usage.cacheWriteTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    env,
  });
}
