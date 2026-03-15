vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { listConfiguredProviders } from '@/lib/keys/resolver';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/keys/resolver');

describe('GET /api/keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 403 if tier is starter', async () => {
    const user = makeUser({ tier: 'starter' });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(assertTier).mockReturnValue(mockNextResponse({ error: 'Upgrade required' }, { status: 403 }));

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns configured providers for eligible tiers', async () => {
    const user = makeUser({ tier: 'pro' });
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(assertTier).mockReturnValue(null);

    const mockProviders = [
      { provider: 'openai', createdAt: new Date('2026-01-01T00:00:00Z') },
    ];
    vi.mocked(listConfiguredProviders).mockResolvedValue(mockProviders as Awaited<ReturnType<typeof listConfiguredProviders>>);

    const res = await GET();
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data.providers.length).toBe(1);
    expect(data.providers[0].provider).toBe('openai');
    expect(data.providers[0].configured).toBe(true);
    expect(listConfiguredProviders).toHaveBeenCalledWith(user.id);
  });
});
