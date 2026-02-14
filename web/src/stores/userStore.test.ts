/**
 * Unit tests for the userStore Zustand store.
 *
 * Tests cover tier management, token balance, billing status,
 * and tier-based permission checks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useUserStore, type Tier } from './userStore';

describe('userStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useUserStore.setState({
      tier: 'free',
      tokenBalance: null,
      isLoading: false,
      error: null,
      billingStatus: null,
    });
  });

  describe('Initial State', () => {
    it('should initialize with free tier', () => {
      const state = useUserStore.getState();
      expect(state.tier).toBe('free');
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
    it('should update tier to starter', () => {
      const { setTier } = useUserStore.getState();
      setTier('starter');
      expect(useUserStore.getState().tier).toBe('starter');
    });

    it('should update tier to creator', () => {
      const { setTier } = useUserStore.getState();
      setTier('creator');
      expect(useUserStore.getState().tier).toBe('creator');
    });

    it('should update tier to studio', () => {
      const { setTier } = useUserStore.getState();
      setTier('studio');
      expect(useUserStore.getState().tier).toBe('studio');
    });

    it('should update tier back to free', () => {
      useUserStore.setState({ tier: 'creator' });
      const { setTier } = useUserStore.getState();
      setTier('free');
      expect(useUserStore.getState().tier).toBe('free');
    });
  });

  describe('Permission Checks - AI Access', () => {
    it('should deny AI access for free tier', () => {
      useUserStore.setState({ tier: 'free' });
      const { canUseAI } = useUserStore.getState();
      expect(canUseAI()).toBe(false);
    });

    it('should allow AI access for starter tier', () => {
      useUserStore.setState({ tier: 'starter' });
      const { canUseAI } = useUserStore.getState();
      expect(canUseAI()).toBe(true);
    });

    it('should allow AI access for creator tier', () => {
      useUserStore.setState({ tier: 'creator' });
      const { canUseAI } = useUserStore.getState();
      expect(canUseAI()).toBe(true);
    });

    it('should allow AI access for studio tier', () => {
      useUserStore.setState({ tier: 'studio' });
      const { canUseAI } = useUserStore.getState();
      expect(canUseAI()).toBe(true);
    });
  });

  describe('Permission Checks - MCP Access', () => {
    it('should deny MCP access for free tier', () => {
      useUserStore.setState({ tier: 'free' });
      const { canUseMCP } = useUserStore.getState();
      expect(canUseMCP()).toBe(false);
    });

    it('should deny MCP access for starter tier', () => {
      useUserStore.setState({ tier: 'starter' });
      const { canUseMCP } = useUserStore.getState();
      expect(canUseMCP()).toBe(false);
    });

    it('should allow MCP access for creator tier', () => {
      useUserStore.setState({ tier: 'creator' });
      const { canUseMCP } = useUserStore.getState();
      expect(canUseMCP()).toBe(true);
    });

    it('should allow MCP access for studio tier', () => {
      useUserStore.setState({ tier: 'studio' });
      const { canUseMCP } = useUserStore.getState();
      expect(canUseMCP()).toBe(true);
    });
  });

  describe('Permission Checks - Publishing', () => {
    it('should deny publishing for free tier', () => {
      useUserStore.setState({ tier: 'free' });
      const { canPublish } = useUserStore.getState();
      expect(canPublish()).toBe(false);
    });

    it('should allow publishing for starter tier', () => {
      useUserStore.setState({ tier: 'starter' });
      const { canPublish } = useUserStore.getState();
      expect(canPublish()).toBe(true);
    });

    it('should allow publishing for creator tier', () => {
      useUserStore.setState({ tier: 'creator' });
      const { canPublish } = useUserStore.getState();
      expect(canPublish()).toBe(true);
    });

    it('should allow publishing for studio tier', () => {
      useUserStore.setState({ tier: 'studio' });
      const { canPublish } = useUserStore.getState();
      expect(canPublish()).toBe(true);
    });
  });

  describe('Permission Checks - Token Purchases', () => {
    it('should deny token purchases for free tier', () => {
      useUserStore.setState({ tier: 'free' });
      const { canBuyTokens } = useUserStore.getState();
      expect(canBuyTokens()).toBe(false);
    });

    it('should allow token purchases for starter tier', () => {
      useUserStore.setState({ tier: 'starter' });
      const { canBuyTokens } = useUserStore.getState();
      expect(canBuyTokens()).toBe(true);
    });

    it('should allow token purchases for creator tier', () => {
      useUserStore.setState({ tier: 'creator' });
      const { canBuyTokens } = useUserStore.getState();
      expect(canBuyTokens()).toBe(true);
    });

    it('should allow token purchases for studio tier', () => {
      useUserStore.setState({ tier: 'studio' });
      const { canBuyTokens } = useUserStore.getState();
      expect(canBuyTokens()).toBe(true);
    });
  });

  describe('Tier Transitions', () => {
    const tiers: Tier[] = ['free', 'starter', 'creator', 'studio'];

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
});
