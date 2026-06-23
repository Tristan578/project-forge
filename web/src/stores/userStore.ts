'use client';

import { create } from 'zustand';
import { hasCapability } from '@/lib/billing/entitlements';

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
  /** True once /api/user/profile has resolved. Until then, `tier` is the
   * default 'starter' placeholder and gating UI on it produces false negatives
   * for Pro users on first paint. */
  profileLoaded: boolean;
  displayName: string | null;
  email: string | null;
  createdAt: string | null;
  /** Active Stripe entitlement feature lookup_keys synced from the
   * entitlements.active_entitlement_summary.updated webhook (PF-911 / #8821).
   * `null` means no entitlement summary has been received — capability checks
   * then fall back to the legacy tier-derived defaults. */
  activeFeatures: string[] | null;
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
  profileLoaded: false,
  displayName: null,
  email: null,
  createdAt: null,
  activeFeatures: null,
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

  // Capability gating reads Stripe Entitlements when an active feature set has
  // been synced (PF-911 / #8821), and falls back to the legacy tier-derived
  // default otherwise. The fallback keeps behavior identical for users whose
  // entitlement summary hasn't arrived (or when Entitlements isn't configured
  // in the Stripe dashboard), so this is purely additive.
  canUseAI: () => {
    const { tier, activeFeatures } = get();
    return hasCapability('canUseAI', activeFeatures, tier !== 'starter');
  },

  canUseMCP: () => {
    const { tier, activeFeatures } = get();
    return hasCapability('canUseMCP', activeFeatures, tier === 'creator' || tier === 'pro');
  },

  canPublish: () => {
    const { tier, activeFeatures } = get();
    return hasCapability('canPublish', activeFeatures, tier !== 'starter');
  },

  canBuyTokens: () => {
    const { tier } = get();
    return tier !== 'starter';
  },

  fetchProfile: async () => {
    try {
      const res = await fetch('/api/user/profile');
      if (!res.ok) {
        // Mark loaded for every terminal failure (401 anonymous, 5xx, 403,
        // etc.) so the UI stops treating tier as "still resolving" and
        // consistently shows the starter/anonymous state. Without this,
        // transient errors leave premium options clickable in the UI even
        // though the server will reject.
        set({ profileLoaded: true });
        return;
      }
      const data = await res.json();
      set({
        displayName: data.displayName,
        email: data.email,
        tier: data.tier,
        createdAt: data.createdAt,
        // Array of feature lookup_keys, or null/absent → fall back to tier.
        activeFeatures: Array.isArray(data.activeFeatures) ? data.activeFeatures : null,
        profileLoaded: true,
      });
    } catch {
      // Network failure or fetch abort — same reasoning as the !res.ok
      // branch: mark loaded so the UI doesn't sit in an indeterminate state.
      set({ profileLoaded: true });
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
        set({ billingStatus: data, tier: data.tier, profileLoaded: true });
      }
    } catch {
      // Silently fail
    }
  },
}));
