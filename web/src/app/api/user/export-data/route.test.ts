vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

function makeMockDb(overrides: Record<string, unknown[]> = {}) {
  const defaults: Record<string, unknown[]> = {
    users: [{ id: 'user-uuid-1', email: 'test@example.com', displayName: 'Test', tier: 'starter' }],
    projects: [{ id: 'proj-1', name: 'My Game', entityCount: 5 }],
    tokenUsage: [],
    tokenPurchases: [],
    creditTransactions: [],
    costLog: [],
    publishedGames: [],
    generationJobs: [],
    feedback: [],
    providerKeys: [],
    apiKeys: [],
    gameComments: [],
    gameRatings: [],
    gameLikes: [],
    userFollows: [],
    gameForks: [],
    marketplaceAssets: [],
    assetPurchases: [],
    assetReviews: [],
    sellerProfiles: [],
    moderationAppeals: [],
  };

  const data = { ...defaults, ...overrides };
  // Track call order to map to the correct data set — MUST match the order of
  // the db.select(...) calls inside the route's Promise.all.
  let callIndex = 0;
  const dataOrder = [
    'users', 'projects', 'tokenUsage', 'tokenPurchases',
    'creditTransactions', 'costLog', 'publishedGames',
    'generationJobs', 'feedback', 'providerKeys', 'apiKeys',
    'gameComments', 'gameRatings', 'gameLikes', 'userFollows',
    'gameForks', 'marketplaceAssets', 'assetPurchases', 'assetReviews',
    'sellerProfiles', 'moderationAppeals',
  ];

  const mockSelect = vi.fn().mockImplementation(() => {
    const idx = callIndex++;
    const key = dataOrder[idx] ?? 'users';
    const result = data[key] ?? [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(result),
      }),
    };
  });

  return { select: mockSelect };
}

describe('/api/user/export-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET(new NextRequest('http://localhost/api/user/export-data'));
    expect(res.status).toBe(401);
  });

  it('returns JSON download with all user data tables', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'clerk_abc', user },
    });

    const mockDb = makeMockDb();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const res = await GET(new NextRequest('http://localhost/api/user/export-data'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="spawnforge-data-export.json"'
    );
    expect(res.headers.get('Content-Type')).toBe('application/json');

    const data = await res.json();
    expect(data.exportedAt).toBeDefined();
    expect(data.profile).toEqual(expect.objectContaining({ id: 'user-uuid-1' }));
    expect(data.projects).toEqual([expect.objectContaining({ id: 'proj-1' })]);
    expect(data.tokenUsage).toEqual([]);
    expect(data.tokenPurchases).toEqual([]);
    expect(data.creditTransactions).toEqual([]);
    expect(data.costLog).toEqual([]);
    expect(data.publishedGames).toEqual([]);
    expect(data.generationJobs).toEqual([]);
    expect(data.feedback).toEqual([]);
    expect(data.providerKeys).toEqual([]);
    expect(data.apiKeys).toEqual([]);
    // Community + marketplace + moderation data must be present in the export
    // (GDPR completeness — these user-owned tables were previously omitted, #8639).
    expect(data.gameComments).toEqual([]);
    expect(data.gameRatings).toEqual([]);
    expect(data.gameLikes).toEqual([]);
    expect(data.following).toEqual([]);
    expect(data.gameForks).toEqual([]);
    expect(data.marketplaceAssets).toEqual([]);
    expect(data.assetPurchases).toEqual([]);
    expect(data.assetReviews).toEqual([]);
    expect(data.sellerProfile).toBeNull();
    expect(data.moderationAppeals).toEqual([]);
  });

  it('includes populated community and marketplace rows the user owns', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'clerk_abc', user },
    });

    const mockDb = makeMockDb({
      gameComments: [{ id: 'gc-1', gameId: 'g-1', content: 'nice', parentId: null }],
      assetPurchases: [{ id: 'ap-1', assetId: 'a-1', priceTokens: 50 }],
      sellerProfiles: [{ id: 'sp-1', displayName: 'Seller', totalSales: 3 }],
      moderationAppeals: [{ id: 'ma-1', contentId: 'c-1', contentType: 'comment', reason: 'context', status: 'pending' }],
    });
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const res = await GET(new NextRequest('http://localhost/api/user/export-data'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.gameComments).toEqual([expect.objectContaining({ id: 'gc-1' })]);
    expect(data.assetPurchases).toEqual([expect.objectContaining({ id: 'ap-1' })]);
    // sellerProfile is a single object (the user has at most one), not an array.
    expect(data.sellerProfile).toEqual(expect.objectContaining({ id: 'sp-1' }));
    expect(data.moderationAppeals).toEqual([expect.objectContaining({ id: 'ma-1' })]);
  });

  it('returns 500 when database query fails', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'clerk_abc', user },
    });

    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('DB connection failed');
    });

    const res = await GET(new NextRequest('http://localhost/api/user/export-data'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Failed to export user data');
  });

  it('does not expose sensitive fields like encrypted keys or hashes', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'clerk_abc', user },
    });

    const mockDb = makeMockDb({
      providerKeys: [{ id: 'pk-1', provider: 'anthropic', createdAt: new Date().toISOString() }],
      apiKeys: [{ id: 'ak-1', name: 'My Key', keyPrefix: 'sf_abc', scopes: ['scene:read'], createdAt: new Date().toISOString() }],
    });
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const res = await GET(new NextRequest('http://localhost/api/user/export-data'));
    const data = await res.json();

    // Provider keys should not have encryptedKey or iv
    for (const pk of data.providerKeys) {
      expect(pk).not.toHaveProperty('encryptedKey');
      expect(pk).not.toHaveProperty('iv');
    }

    // API keys should not have keyHash
    for (const ak of data.apiKeys) {
      expect(ak).not.toHaveProperty('keyHash');
    }
  });

  it('returns null profile when user record not found', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { clerkId: 'clerk_abc', user },
    });

    const mockDb = makeMockDb({ users: [] });
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    const res = await GET(new NextRequest('http://localhost/api/user/export-data'));
    const data = await res.json();
    expect(data.profile).toBeNull();
  });
});
