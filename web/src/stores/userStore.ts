'use client';

import { create } from 'zustand';

export type Tier = 'starter' | 'hobbyist' | 'creator' | 'pro';

export interface TokenBalance {
  monthlyRemaining: number;
  monthlyTotal: number;
  addon: number;
  total: number;
  nextRefillDate: string | null;
}

interface UserState {
  // User data (populated after auth)
  tier: Tier;
  displayName: string | null;
  email: string | null;
  createdAt: string | null;
  tokenBalance: TokenBalance | null;
  isLoading: boolean;
  error: string | null;
  billingStatus: {
    tier: string;
    stripeCustomerId: string | null;
    billingCycleStart: string | null;
    subscriptionStatus: string | null;
  } | null;

  // Actions
  fetchBalance: () => Promise<void>;
  setTier: (tier: Tier) => void;
  fetchBillingStatus: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<boolean>;

  // Derived checks
  canUseAI: () => boolean;
  canUseMCP: () => boolean;
  canPublish: () => boolean;
  canBuyTokens: () => boolean;
}

export const useUserStore = create<UserState>((set, get) => ({
  tier: 'starter',
  displayName: null,
  email: null,
  createdAt: null,
  tokenBalance: null,
  isLoading: false,
  error: null,
  billingStatus: null,

  fetchBalance: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/tokens/balance');
      if (!res.ok) {
        if (res.status === 401) {
          set({ isLoading: false });
          return; // Not logged in — that's fine
        }
        throw new Error(`Failed to fetch balance: ${res.status}`);
      }
      const balance = await res.json();
      set({ tokenBalance: balance, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  setTier: (tier: Tier) => set({ tier }),

  canUseAI: () => {
    const { tier } = get();
    return tier !== 'starter';
  },

  canUseMCP: () => {
    const { tier } = get();
    return tier === 'creator' || tier === 'pro';
  },

  canPublish: () => {
    const { tier } = get();
    return tier !== 'starter';
  },

  canBuyTokens: () => {
    const { tier } = get();
    return tier !== 'starter';
  },

  fetchProfile: async () => {
    try {
      const res = await fetch('/api/user/profile');
      if (!res.ok) return;
      const data = await res.json();
      set({
        displayName: data.displayName,
        email: data.email,
        tier: data.tier,
        createdAt: data.createdAt,
      });
    } catch {
      // Silently fail — user may not be logged in
    }
  },

  updateDisplayName: async (name: string) => {
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      if (!res.ok) {
        const err = await res.json();
        set({ error: err.error ?? 'Failed to update display name' });
        return false;
      }
      const data = await res.json();
      set({ displayName: data.displayName, error: null });
      return true;
    } catch {
      set({ error: 'Failed to update display name' });
      return false;
    }
  },

  fetchBillingStatus: async () => {
    try {
      const res = await fetch('/api/billing/status');
      if (res.ok) {
        const data = await res.json();
        set({ billingStatus: data, tier: data.tier });
      }
    } catch {
      // Silently fail
    }
  },
}));
