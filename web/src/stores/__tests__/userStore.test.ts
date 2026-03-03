import { describe, it, expect, beforeEach } from 'vitest';
import { useUserStore } from '../userStore';

describe('userStore', () => {
  beforeEach(() => {
    useUserStore.setState({
      tier: 'starter',
      displayName: null,
      email: null,
      createdAt: null,
      tokenBalance: null,
      isLoading: false,
      error: null,
    });
  });

  it('initializes with starter tier', () => {
    expect(useUserStore.getState().tier).toBe('starter');
  });

  it('sets tier correctly', () => {
    useUserStore.getState().setTier('pro');
    expect(useUserStore.getState().tier).toBe('pro');
  });

  it('canUseAI returns false for starter tier', () => {
    useUserStore.getState().setTier('starter');
    expect(useUserStore.getState().canUseAI()).toBe(false);
  });

  it('canUseAI returns true for higher tiers', () => {
    useUserStore.getState().setTier('pro');
    expect(useUserStore.getState().canUseAI()).toBe(true);
  });

  it('canUseMCP returns true only for creator and pro', () => {
    useUserStore.getState().setTier('hobbyist');
    expect(useUserStore.getState().canUseMCP()).toBe(false);
    
    useUserStore.getState().setTier('creator');
    expect(useUserStore.getState().canUseMCP()).toBe(true);
  });
});
