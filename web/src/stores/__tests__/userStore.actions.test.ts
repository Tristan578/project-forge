import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useUserStore } from '../userStore';

describe('userStore actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('canPublish returns true for non-starter tiers', () => {
    useUserStore.getState().setTier('starter');
    expect(useUserStore.getState().canPublish()).toBe(false);
    
    useUserStore.getState().setTier('hobbyist');
    expect(useUserStore.getState().canPublish()).toBe(true);
  });

  it('canBuyTokens returns true for non-starter tiers', () => {
    useUserStore.getState().setTier('starter');
    expect(useUserStore.getState().canBuyTokens()).toBe(false);
    
    useUserStore.getState().setTier('pro');
    expect(useUserStore.getState().canBuyTokens()).toBe(true);
  });

  it('fetchProfile sets user data on success', async () => {
    const mockProfile = { displayName: 'John', email: 'john@me.com', tier: 'pro', createdAt: '2026-01-01' };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockProfile),
    } as Response);

    await useUserStore.getState().fetchProfile();

    const state = useUserStore.getState();
    expect(state.displayName).toBe('John');
    expect(state.tier).toBe('pro');
  });

  it('updateDisplayName updates state on success', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ displayName: 'New Name' }),
    } as Response);

    const result = await useUserStore.getState().updateDisplayName('New Name');

    expect(result).toBe(true);
    expect(useUserStore.getState().displayName).toBe('New Name');
  });
});
