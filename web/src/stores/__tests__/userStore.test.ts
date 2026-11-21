/**
 * Unit tests for the userStore Zustand store.
 *
 * Tests cover tier management, token balance, billing status,
 * and tier-based permission checks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useUserStore, type Tier } from '../userStore';

describe('userStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useUserStore.setState({
      tier: 'starter',
      activeFeatures: null,
      tokenBalance: null,
      isLoading: false,
      error: null,
      billingStatus: null,
    });
  });

  describe('Initial State', () => {
    it('should initialize with starter tier', () => {
      const state = useUserStore.getState();
      expect(state.tier).toBe('starter');
    });

    it('should initialize with null token balance', () => {
      const state = useUserStore.getState();
      expect(state.tokenBalance).toBeNull();
    });

    it('should initialize with not loading', () => {
      const state = useUserStore.getState();
      expect(state.isLoading).toBe(false);
    });

    it('should initialize with no error', () => {
      const state = useUserStore.getState();
      expect(state.error).toBeNull();
    });

    it('should initialize with null billing status', () => {
      const state = useUserStore.getState();
      expect(state.billingStatus).toBeNull();
    });
  });

  describe('Tier Management', () => {
    it('should update tier to hobbyist', () => {
      const { setTier } = useUserStore.getState();
      setTier('hobbyist');
      expect(useUserStore.getState().tier).toBe('hobbyist');
    });

    it('should update tier to creator', () => {
      const { setTier } = useUserStore.getState();
      setTier('creator');
      expect(useUserStore.getState().tier).toBe('creator');
    });

    it('should update tier to pro', () => {
      const { setTier } = useUserStore.getState();
      setTier('pro');
      expect(useUserStore.getState().tier).toBe('pro');
    });

    it('should update tier back to starter', () => {
      useUserStore.setState({ tier: 'creator' });
      const { setTier } = useUserStore.getState();
      setTier('starter');
      expect(useUserStore.getState().tier).toBe('starter');
    });
  });

  describe('Permission Checks - AI Access', () => {
    it('should deny AI access for starter tier', () => {
      useUserStore.setState({ tier: 'starter' });
      const { canUseAI } = useUserStore.getState();
      expect(canUseAI()).toBe(false);
    });

    it('should allow AI access for hobbyist tier', () => {
      useUserStore.setState({ tier: 'hobbyist' });
      const { canUseAI } = useUserStore.getState();
      expect(canUseAI()).toBe(true);
    });

    it('should allow AI access for creator tier', () => {
      useUserStore.setState({ tier: 'creator' });
      const { canUseAI } = useUserStore.getState();
      expect(canUseAI()).toBe(true);
    });

    it('should allow AI access for pro tier', () => {
      useUserStore.setState({ tier: 'pro' });
      const { canUseAI } = useUserStore.getState();
      expect(canUseAI()).toBe(true);
    });
  });

  describe('Permission Checks - MCP Access', () => {
    it('should deny MCP access for starter tier', () => {
      useUserStore.setState({ tier: 'starter' });
      const { canUseMCP } = useUserStore.getState();
      expect(canUseMCP()).toBe(false);
    });

    it('should deny MCP access for hobbyist tier', () => {
      useUserStore.setState({ tier: 'hobbyist' });
      const { canUseMCP } = useUserStore.getState();
      expect(canUseMCP()).toBe(false);
    });

    it('should allow MCP access for creator tier', () => {
      useUserStore.setState({ tier: 'creator' });
      const { canUseMCP } = useUserStore.getState();
      expect(canUseMCP()).toBe(true);
    });

    it('should allow MCP access for pro tier', () => {
      useUserStore.setState({ tier: 'pro' });
      const { canUseMCP } = useUserStore.getState();
      expect(canUseMCP()).toBe(true);
    });
  });

  describe('Permission Checks - Publishing', () => {
    it('should deny publishing for starter tier', () => {
      useUserStore.setState({ tier: 'starter' });
      const { canPublish } = useUserStore.getState();
      expect(canPublish()).toBe(false);
    });

    it('should allow publishing for hobbyist tier', () => {
      useUserStore.setState({ tier: 'hobbyist' });
      const { canPublish } = useUserStore.getState();
      expect(canPublish()).toBe(true);
    });

    it('should allow publishing for creator tier', () => {
      useUserStore.setState({ tier: 'creator' });
      const { canPublish } = useUserStore.getState();
      expect(canPublish()).toBe(true);
    });

    it('should allow publishing for pro tier', () => {
      useUserStore.setState({ tier: 'pro' });
      const { canPublish } = useUserStore.getState();
      expect(canPublish()).toBe(true);
    });
  });

  describe('Permission Checks - Token Purchases', () => {
    it('should deny token purchases for starter tier', () => {
      useUserStore.setState({ tier: 'starter' });
      const { canBuyTokens } = useUserStore.getState();
      expect(canBuyTokens()).toBe(false);
    });

    it('should allow token purchases for hobbyist tier', () => {
      useUserStore.setState({ tier: 'hobbyist' });
      const { canBuyTokens } = useUserStore.getState();
      expect(canBuyTokens()).toBe(true);
    });

    it('should allow token purchases for creator tier', () => {
      useUserStore.setState({ tier: 'creator' });
      const { canBuyTokens } = useUserStore.getState();
      expect(canBuyTokens()).toBe(true);
    });

    it('should allow token purchases for pro tier', () => {
      useUserStore.setState({ tier: 'pro' });
      const { canBuyTokens } = useUserStore.getState();
      expect(canBuyTokens()).toBe(true);
    });
  });

  describe('Tier Transitions', () => {
    const tiers: Tier[] = ['starter', 'hobbyist', 'creator', 'pro'];

    it('should handle all tier transitions', () => {
      const { setTier } = useUserStore.getState();

      for (const from of tiers) {
        for (const to of tiers) {
          setTier(from);
          expect(useUserStore.getState().tier).toBe(from);
          setTier(to);
          expect(useUserStore.getState().tier).toBe(to);
        }
      }
    });
  });

  describe('Token Balance', () => {
    it('should update token balance', () => {
      const balance = {
        monthlyRemaining: 500,
        monthlyTotal: 1000,
        addon: 200,
        total: 700,
        nextRefillDate: '2026-03-01T00:00:00Z',
      };
      useUserStore.setState({ tokenBalance: balance });
      expect(useUserStore.getState().tokenBalance).toEqual(balance);
    });

    it('should handle null token balance', () => {
      useUserStore.setState({ tokenBalance: null });
      expect(useUserStore.getState().tokenBalance).toBeNull();
    });
  });

  describe('Billing Status', () => {
    it('should update billing status', () => {
      const status = {
        tier: 'creator',
        stripeCustomerId: 'cus_123',
        billingCycleStart: '2026-02-01T00:00:00Z',
        subscriptionStatus: 'active' as string | null,
      };
      useUserStore.setState({ billingStatus: status });
      expect(useUserStore.getState().billingStatus).toEqual(status);
    });

    it('should handle null billing status', () => {
      useUserStore.setState({ billingStatus: null });
      expect(useUserStore.getState().billingStatus).toBeNull();
    });
  });

  describe('Loading and Error States', () => {
    it('should update loading state', () => {
      useUserStore.setState({ isLoading: true });
      expect(useUserStore.getState().isLoading).toBe(true);
      useUserStore.setState({ isLoading: false });
      expect(useUserStore.getState().isLoading).toBe(false);
    });

    it('should update error state', () => {
      useUserStore.setState({ error: 'Network error' });
      expect(useUserStore.getState().error).toBe('Network error');
      useUserStore.setState({ error: null });
      expect(useUserStore.getState().error).toBeNull();
    });
  });

  describe('Entitlement-based gating (PF-911 / #8821)', () => {
    it('falls back to tier defaults when activeFeatures is null', () => {
      useUserStore.setState({ tier: 'pro', activeFeatures: null });
      const { canUseAI, canUseMCP, canPublish } = useUserStore.getState();
      expect(canUseAI()).toBe(true);
      expect(canUseMCP()).toBe(true);
      expect(canPublish()).toBe(true);
    });

    it('grants strictly from the active feature set when present, overriding tier', () => {
      // starter tier would normally deny everything; entitlements grant AI + MCP
      useUserStore.setState({
        tier: 'starter',
        activeFeatures: ['ai_generation', 'mcp_access'],
      });
      const { canUseAI, canUseMCP, canPublish } = useUserStore.getState();
      expect(canUseAI()).toBe(true);
      expect(canUseMCP()).toBe(true);
      // publish_games not in the set → denied despite no tier grant
      expect(canPublish()).toBe(false);
    });

    it('treats an empty active feature set as "no summary" and falls back to tier (#8831)', () => {
      // An empty array normalizes to null (no usable feature set), so capability
      // checks fall back to the tier default rather than asserting deny-all. This
      // is the guard against a transient/out-of-order empty summary stripping a
      // paying customer's access — see normalizeFeatures in entitlements.ts.
      useUserStore.setState({ tier: 'pro', activeFeatures: [] });
      const { canUseAI, canUseMCP, canPublish } = useUserStore.getState();
      expect(canUseAI()).toBe(true);
      expect(canUseMCP()).toBe(true);
      expect(canPublish()).toBe(true);
    });
  });

  describe('fetchBillingStatus syncs activeFeatures with tier (#8831)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('clears a stale non-empty activeFeatures array on downgrade so capabilities follow the new tier', async () => {
      // Seed the store as a paying user whose entitlement set was synced.
      useUserStore.setState({
        tier: 'pro',
        activeFeatures: ['ai_generation', 'mcp_access', 'publish_games'],
      });
      // Sanity: stale set currently grants paid capabilities.
      expect(useUserStore.getState().canUseAI()).toBe(true);

      // Subscription cancelled: webhook nullified active_features and dropped the
      // tier. The status route now echoes the cleared set as null.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ tier: 'starter', activeFeatures: null }),
        })
      );

      await useUserStore.getState().fetchBillingStatus();

      const state = useUserStore.getState();
      expect(state.tier).toBe('starter');
      // The stale array must be cleared so hasCapability falls back to the
      // downgraded tier rather than honoring the dead entitlements.
      expect(state.activeFeatures).toBeNull();
      expect(state.canUseAI()).toBe(false);
      expect(state.canUseMCP()).toBe(false);
      expect(state.canPublish()).toBe(false);
    });

    it('syncs an active feature array from the response', async () => {
      useUserStore.setState({ tier: 'starter', activeFeatures: null });

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({ tier: 'creator', activeFeatures: ['ai_generation', 'mcp_access'] }),
        })
      );

      await useUserStore.getState().fetchBillingStatus();

      const state = useUserStore.getState();
      expect(state.tier).toBe('creator');
      expect(state.activeFeatures).toEqual(['ai_generation', 'mcp_access']);
      // Granted strictly from the synced set, overriding the tier default.
      expect(state.canUseAI()).toBe(true);
      expect(state.canUseMCP()).toBe(true);
      expect(state.canPublish()).toBe(false);
    });
  });
});
