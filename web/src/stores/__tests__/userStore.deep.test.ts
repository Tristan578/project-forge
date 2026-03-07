/**
 * Deep unit tests for userStore — all tier permutations, fetch actions,
 * error handling, and billing status.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUserStore } from '../userStore';
import type { Tier } from '../userStore';

describe('userStore deep tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    useUserStore.setState({
      tier: 'starter',
      displayName: null,
      email: null,
      createdAt: null,
      tokenBalance: null,
      isLoading: false,
      error: null,
      billingStatus: null,
    });
  });

  describe('tier gating — exhaustive permutations', () => {
    const tiers: Tier[] = ['starter', 'hobbyist', 'creator', 'pro'];

    describe('canUseAI', () => {
      it.each([
        ['starter', false],
        ['hobbyist', true],
        ['creator', true],
        ['pro', true],
      ] as [Tier, boolean][])('tier=%s → canUseAI=%s', (tier, expected) => {
        useUserStore.getState().setTier(tier);
        expect(useUserStore.getState().canUseAI()).toBe(expected);
      });
    });

    describe('canUseMCP', () => {
      it.each([
        ['starter', false],
        ['hobbyist', false],
        ['creator', true],
        ['pro', true],
      ] as [Tier, boolean][])('tier=%s → canUseMCP=%s', (tier, expected) => {
        useUserStore.getState().setTier(tier);
        expect(useUserStore.getState().canUseMCP()).toBe(expected);
      });
    });

    describe('canPublish', () => {
      it.each([
        ['starter', false],
        ['hobbyist', true],
        ['creator', true],
        ['pro', true],
      ] as [Tier, boolean][])('tier=%s → canPublish=%s', (tier, expected) => {
        useUserStore.getState().setTier(tier);
        expect(useUserStore.getState().canPublish()).toBe(expected);
      });
    });

    describe('canBuyTokens', () => {
      it.each([
        ['starter', false],
        ['hobbyist', true],
        ['creator', true],
        ['pro', true],
      ] as [Tier, boolean][])('tier=%s → canBuyTokens=%s', (tier, expected) => {
        useUserStore.getState().setTier(tier);
        expect(useUserStore.getState().canBuyTokens()).toBe(expected);
      });
    });

    it('all capability checks are consistent for each tier', () => {
      for (const tier of tiers) {
        useUserStore.getState().setTier(tier);
        const state = useUserStore.getState();

        if (tier === 'starter') {
          expect(state.canUseAI()).toBe(false);
          expect(state.canUseMCP()).toBe(false);
          expect(state.canPublish()).toBe(false);
          expect(state.canBuyTokens()).toBe(false);
        } else if (tier === 'hobbyist') {
          expect(state.canUseAI()).toBe(true);
          expect(state.canUseMCP()).toBe(false);
          expect(state.canPublish()).toBe(true);
          expect(state.canBuyTokens()).toBe(true);
        } else if (tier === 'creator') {
          expect(state.canUseAI()).toBe(true);
          expect(state.canUseMCP()).toBe(true);
          expect(state.canPublish()).toBe(true);
          expect(state.canBuyTokens()).toBe(true);
        } else if (tier === 'pro') {
          expect(state.canUseAI()).toBe(true);
          expect(state.canUseMCP()).toBe(true);
          expect(state.canPublish()).toBe(true);
          expect(state.canBuyTokens()).toBe(true);
        }
      }
    });
  });

  describe('fetchBalance', () => {
    it('sets token balance on success', async () => {
      const mockBalance = {
        monthlyRemaining: 800,
        monthlyTotal: 1000,
        addon: 500,
        total: 1300,
        nextRefillDate: '2026-04-01',
      };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockBalance),
      } as Response);

      await useUserStore.getState().fetchBalance();

      const state = useUserStore.getState();
      expect(state.tokenBalance).toEqual(mockBalance);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets isLoading during fetch', async () => {
      let resolvePromise: (value: Response) => void;
      const promise = new Promise<Response>((resolve) => { resolvePromise = resolve; });
      vi.mocked(fetch).mockReturnValue(promise);

      const fetchPromise = useUserStore.getState().fetchBalance();
      expect(useUserStore.getState().isLoading).toBe(true);

      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ monthlyRemaining: 0, monthlyTotal: 0, addon: 0, total: 0, nextRefillDate: null }),
      } as Response);

      await fetchPromise;
      expect(useUserStore.getState().isLoading).toBe(false);
    });

    it('silently handles 401 (not logged in)', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      } as Response);

      await useUserStore.getState().fetchBalance();

      const state = useUserStore.getState();
      expect(state.tokenBalance).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull(); // No error for 401
    });

    it('sets error for non-401 failures', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal Server Error' }),
      } as Response);

      await useUserStore.getState().fetchBalance();

      const state = useUserStore.getState();
      expect(state.error).toContain('500');
      expect(state.isLoading).toBe(false);
    });

    it('sets error on network failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      await useUserStore.getState().fetchBalance();

      const state = useUserStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('fetchProfile', () => {
    it('sets profile data on success', async () => {
      const profile = {
        displayName: 'Alice',
        email: 'alice@example.com',
        tier: 'creator',
        createdAt: '2026-01-15',
      };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(profile),
      } as Response);

      await useUserStore.getState().fetchProfile();

      const state = useUserStore.getState();
      expect(state.displayName).toBe('Alice');
      expect(state.email).toBe('alice@example.com');
      expect(state.tier).toBe('creator');
      expect(state.createdAt).toBe('2026-01-15');
    });

    it('silently fails on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      await useUserStore.getState().fetchProfile();

      // State unchanged
      expect(useUserStore.getState().displayName).toBeNull();
    });

    it('silently fails on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      // Should not throw
      await useUserStore.getState().fetchProfile();

      expect(useUserStore.getState().displayName).toBeNull();
    });

    it('updates tier from profile response', async () => {
      useUserStore.setState({ tier: 'starter' });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ displayName: 'Bob', email: 'bob@b.com', tier: 'pro', createdAt: '2025-12-01' }),
      } as Response);

      await useUserStore.getState().fetchProfile();

      expect(useUserStore.getState().tier).toBe('pro');
    });
  });

  describe('updateDisplayName', () => {
    it('returns true and updates state on success', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ displayName: 'New Name' }),
      } as Response);

      const result = await useUserStore.getState().updateDisplayName('New Name');

      expect(result).toBe(true);
      expect(useUserStore.getState().displayName).toBe('New Name');
      expect(useUserStore.getState().error).toBeNull();
    });

    it('returns false and sets error on API error response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Display name already taken' }),
      } as Response);

      const result = await useUserStore.getState().updateDisplayName('Taken Name');

      expect(result).toBe(false);
      expect(useUserStore.getState().error).toBe('Display name already taken');
    });

    it('returns false and sets generic error on API error without message', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      } as Response);

      const result = await useUserStore.getState().updateDisplayName('Test');

      expect(result).toBe(false);
      expect(useUserStore.getState().error).toBe('Failed to update display name');
    });

    it('returns false on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network failure'));

      const result = await useUserStore.getState().updateDisplayName('Test');

      expect(result).toBe(false);
      expect(useUserStore.getState().error).toBe('Failed to update display name');
    });

    it('sends correct request format', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ displayName: 'Alice' }),
      } as Response);

      await useUserStore.getState().updateDisplayName('Alice');

      expect(fetch).toHaveBeenCalledWith('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Alice' }),
      });
    });

    it('clears previous error on success', async () => {
      useUserStore.setState({ error: 'previous error' });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ displayName: 'New' }),
      } as Response);

      await useUserStore.getState().updateDisplayName('New');

      expect(useUserStore.getState().error).toBeNull();
    });
  });

  describe('fetchBillingStatus', () => {
    it('sets billing status and tier on success', async () => {
      const billingData = {
        tier: 'pro',
        stripeCustomerId: 'cus_123',
        billingCycleStart: '2026-03-01',
      };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(billingData),
      } as Response);

      await useUserStore.getState().fetchBillingStatus();

      const state = useUserStore.getState();
      expect(state.billingStatus).toEqual(billingData);
      expect(state.tier).toBe('pro');
    });

    it('does not update state on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await useUserStore.getState().fetchBillingStatus();

      expect(useUserStore.getState().billingStatus).toBeNull();
      expect(useUserStore.getState().tier).toBe('starter');
    });

    it('silently fails on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Offline'));

      await useUserStore.getState().fetchBillingStatus();

      expect(useUserStore.getState().billingStatus).toBeNull();
    });

    it('syncs tier from billing status', async () => {
      useUserStore.setState({ tier: 'starter' });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'creator', stripeCustomerId: null, billingCycleStart: null }),
      } as Response);

      await useUserStore.getState().fetchBillingStatus();

      expect(useUserStore.getState().tier).toBe('creator');
    });
  });

  describe('setTier', () => {
    it('updates tier value', () => {
      useUserStore.getState().setTier('pro');
      expect(useUserStore.getState().tier).toBe('pro');
    });

    it('immediately affects capability checks', () => {
      useUserStore.getState().setTier('starter');
      expect(useUserStore.getState().canUseAI()).toBe(false);

      useUserStore.getState().setTier('hobbyist');
      expect(useUserStore.getState().canUseAI()).toBe(true);
    });
  });

  describe('initial state', () => {
    it('starts with correct defaults', () => {
      const state = useUserStore.getState();
      expect(state.tier).toBe('starter');
      expect(state.displayName).toBeNull();
      expect(state.email).toBeNull();
      expect(state.createdAt).toBeNull();
      expect(state.tokenBalance).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.billingStatus).toBeNull();
    });
  });
});
