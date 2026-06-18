vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { publishedGames, marketplaceAssets } from '@/lib/db/schema';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
// Don't let the per-IP appeal rate limiter (5/10min) trip across test cases —
// every case shares the same localhost IP, so the 6th call would 429.
vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(undefined),
}));

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/moderation/appeal', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('/api/moderation/appeal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST(makeRequest({ contentId: '1', contentType: 'comment', reason: 'Not offensive content' }));
    expect(res.status).toBe(401);
  });

  it('returns 422 if contentId is missing', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });

    const res = await POST(makeRequest({ contentType: 'comment', reason: 'Not offensive content' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('contentId');
  });

  it('returns 422 if contentType is invalid', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });

    const res = await POST(makeRequest({ contentId: '1', contentType: 'invalid', reason: 'Not offensive content' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('contentType');
  });

  it('returns 422 if reason is too short', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });

    const res = await POST(makeRequest({ contentId: '1', contentType: 'comment', reason: 'short' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('reason');
  });

  const VALID_UUID = '11111111-1111-4111-8111-111111111111';

  // Build a db mock whose ownership lookup returns `ownerRows` and whose insert
  // returns the created appeal. resolveContentOwner runs select().from().where().limit().
  function mockOwnershipDb(ownerRows: Array<{ ownerId: string }>) {
    const limit = vi.fn().mockResolvedValue(ownerRows);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const returning = vi.fn().mockResolvedValue([{ id: 'appeal-1', status: 'pending' }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    return { select, insert };
  }

  it('returns 422 if contentId is not a uuid', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });

    const res = await POST(makeRequest({ contentId: 'comment-1', contentType: 'comment', reason: 'Not offensive content here' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('contentId');
  });

  it('returns 404 when the content does not exist', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });
    vi.mocked(getDb).mockReturnValue(mockOwnershipDb([]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeRequest({
      contentId: VALID_UUID,
      contentType: 'comment',
      reason: 'This content was not offensive, it was taken out of context',
    }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when the caller does not own the content (no leak via 403)', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });
    // Content owned by a DIFFERENT user.
    vi.mocked(getDb).mockReturnValue(mockOwnershipDb([{ ownerId: 'someone-else' }]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeRequest({
      contentId: VALID_UUID,
      contentType: 'comment',
      reason: 'This content was not offensive, it was taken out of context',
    }));
    expect(res.status).toBe(404);
  });

  it('creates appeal and returns 201 when the caller owns the content', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });
    // Content owned by the authenticated user (makeUser().id === 'user-uuid-1').
    vi.mocked(getDb).mockReturnValue(mockOwnershipDb([{ ownerId: user.id }]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeRequest({
      contentId: VALID_UUID,
      contentType: 'comment',
      reason: 'This content was not offensive, it was taken out of context',
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.id).toBe('appeal-1');
    expect(data.status).toBe('pending');
  });

  // The ownership check (resolveContentOwner) has three branches that each query a
  // DIFFERENT table+column. The comment branch is covered above; exercise the game
  // and asset branches directly so a regression in either — wrong column, missing
  // WHERE, or copy-paste of the userId column onto assets (which own via sellerId)
  // — can't silently re-open the IDOR (#8638). For each branch we assert both the
  // ownership gate (foreign owner → 404, owner → 201) AND that the lookup targeted
  // that content type's real owner column.
  const OWNERSHIP_BRANCHES: Array<{
    contentType: 'game' | 'asset';
    ownerColumn: unknown;
  }> = [
    { contentType: 'game', ownerColumn: publishedGames.userId },
    { contentType: 'asset', ownerColumn: marketplaceAssets.sellerId },
  ];

  for (const { contentType, ownerColumn } of OWNERSHIP_BRANCHES) {
    it(`returns 404 when the caller does not own the ${contentType} (IDOR guard)`, async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });
      const db = mockOwnershipDb([{ ownerId: 'someone-else' }]);
      vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);

      const res = await POST(makeRequest({
        contentId: VALID_UUID,
        contentType,
        reason: 'This content was not offensive, it was taken out of context',
      }));

      expect(res.status).toBe(404);
      // Ownership lookup must target this content type's owner column.
      expect(db.select.mock.calls[0][0].ownerId).toBe(ownerColumn);
    });

    it(`creates appeal and returns 201 when the caller owns the ${contentType}`, async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });
      const db = mockOwnershipDb([{ ownerId: user.id }]);
      vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);

      const res = await POST(makeRequest({
        contentId: VALID_UUID,
        contentType,
        reason: 'This content was not offensive, it was taken out of context',
      }));
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.id).toBe('appeal-1');
      expect(db.select.mock.calls[0][0].ownerId).toBe(ownerColumn);
    });
  }
});
