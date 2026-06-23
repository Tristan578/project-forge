vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { eq, and } from 'drizzle-orm';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
// Spy on the comparison builders so we can assert the unflag UPDATE is scoped
// to the appellant's own comment (defense-in-depth, #8613). The .where() mock
// is a passthrough, so the filter is only observable on eq/and call args.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual, eq: vi.fn(actual.eq), and: vi.fn(actual.and) };
});

function makeReviewRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/moderation/appeals/appeal-1/review', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const makeParams = () => Promise.resolve({ id: 'appeal-1' });

function makeMockDb(selectResults: unknown[]) {
  const updateSetWhere = vi.fn().mockResolvedValue(true);
  const updateSet = vi.fn().mockReturnValue({ where: updateSetWhere });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });

  const selectLimit = vi.fn().mockResolvedValue(selectResults);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

  return { select: selectFn, update: updateFn };
}

describe('/api/admin/moderation/appeals/[id]/review POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 if not admin', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params: makeParams() });
    expect(res.status).toBe(403);
  });

  it('returns 422 for invalid decision', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const res = await POST(makeReviewRequest({ decision: 'maybe' }), { params: makeParams() });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('decision');
  });

  it('returns 404 if appeal not found', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    vi.mocked(getDb).mockReturnValue(makeMockDb([]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params: makeParams() });
    expect(res.status).toBe(404);
  });

  it('returns 409 if appeal already reviewed', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    vi.mocked(getDb).mockReturnValue(makeMockDb([
      { id: 'appeal-1', status: 'approved', contentType: 'comment', contentId: 'c1' },
    ]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params: makeParams() });
    expect(res.status).toBe(409);
  });

  it('approves appeal and unflags comment, scoped to the appellant', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    vi.mocked(getDb).mockReturnValue(makeMockDb([
      { id: 'appeal-1', userId: 'author-1', status: 'pending', contentType: 'comment', contentId: 'comment-1' },
    ]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'approve', note: 'Content is fine' }), { params: makeParams() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe('approved');
    // The unflag UPDATE must re-confirm the appellant authored the comment, so
    // a forged/stale appeal cannot unflag a comment its filer never owned.
    expect(vi.mocked(and)).toHaveBeenCalled();
    expect(vi.mocked(eq)).toHaveBeenCalledWith(expect.anything(), 'author-1');
  });

  it('rejects appeal without unflagging content', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    vi.mocked(getDb).mockReturnValue(makeMockDb([
      { id: 'appeal-1', status: 'pending', contentType: 'comment', contentId: 'comment-1' },
    ]) as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'reject' }), { params: makeParams() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe('rejected');
  });
});
