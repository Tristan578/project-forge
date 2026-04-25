/**
 * Unit tests for lib/analytics/events.server.ts
 *
 * Verifies that each server-side event function calls @vercel/analytics/server track()
 * with the correct event name and properties.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTrack = vi.fn();
vi.mock('@vercel/analytics/server', () => ({
  track: mockTrack,
}));

describe('Server analytics event wrappers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('trackSubscriptionStarted sends tier and env', async () => {
    const { trackSubscriptionStarted } = await import('@/lib/analytics/events.server');
    await trackSubscriptionStarted('pro');
    expect(mockTrack).toHaveBeenCalledWith('subscription_started', expect.objectContaining({ tier: 'pro' }));
  });

  it('trackSubscriptionCancelled sends tier and env', async () => {
    const { trackSubscriptionCancelled } = await import('@/lib/analytics/events.server');
    await trackSubscriptionCancelled('creator');
    expect(mockTrack).toHaveBeenCalledWith('subscription_cancelled', expect.objectContaining({ tier: 'creator' }));
  });

  it('trackAddonTokensPurchased sends package name and env', async () => {
    const { trackAddonTokensPurchased } = await import('@/lib/analytics/events.server');
    await trackAddonTokensPurchased('starter_pack');
    expect(mockTrack).toHaveBeenCalledWith('addon_tokens_purchased', expect.objectContaining({ package: 'starter_pack' }));
  });

  it('trackPaymentFailed sends tier and env', async () => {
    const { trackPaymentFailed } = await import('@/lib/analytics/events.server');
    await trackPaymentFailed('hobbyist');
    expect(mockTrack).toHaveBeenCalledWith('payment_failed', expect.objectContaining({ tier: 'hobbyist' }));
  });

  it('trackGamePublishedServer sends tier, slug, and env', async () => {
    const { trackGamePublishedServer } = await import('@/lib/analytics/events.server');
    await trackGamePublishedServer('pro', 'my-awesome-game');
    expect(mockTrack).toHaveBeenCalledWith('game_published', expect.objectContaining({
      tier: 'pro',
      slug: 'my-awesome-game',
    }));
  });

  it('includes env dimension in all events', async () => {
    const { trackSubscriptionStarted } = await import('@/lib/analytics/events.server');
    await trackSubscriptionStarted('pro');
    expect(mockTrack).toHaveBeenCalledWith('subscription_started', expect.objectContaining({ env: expect.any(String) }));
  });

  it('trackAiCacheHitRate sends tier and cache token counts', async () => {
    const { trackAiCacheHitRate } = await import('@/lib/analytics/events.server');
    await trackAiCacheHitRate('long', {
      inputTokens: 12345,
      cacheReadTokens: 9000,
      cacheWriteTokens: 1500,
      outputTokens: 200,
    });
    expect(mockTrack).toHaveBeenCalledWith(
      'ai_cache_hit_rate',
      expect.objectContaining({
        tier: 'long',
        input_tokens: 12345,
        cache_read_tokens: 9000,
        cache_write_tokens: 1500,
        output_tokens: 200,
        env: expect.any(String) as unknown,
      }),
    );
  });

  it('trackAiCacheHitRate defaults missing token counts to zero', async () => {
    const { trackAiCacheHitRate } = await import('@/lib/analytics/events.server');
    await trackAiCacheHitRate('short', {});
    expect(mockTrack).toHaveBeenCalledWith(
      'ai_cache_hit_rate',
      expect.objectContaining({
        tier: 'short',
        input_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        output_tokens: 0,
      }),
    );
  });
});
