vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

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
  };

  const data = { ...defaults, ...overrides };
  // Track call order to map to the correct data set
  let callIndex = 0;
  const dataOrder = [
    'users', 'projects', 'tokenUsage', 'tokenPurchases',
    'creditTransactions', 'costLog', 'publishedGames',
    'generationJobs', 'feedback', 'providerKeys', 'apiKeys',
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

    const res = await GET();
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

    const res = await GET();
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

    const res = await GET();
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

    const res = await GET();
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

    const res = await GET();
    const data = await res.json();
    expect(data.profile).toBeNull();
  });
});
