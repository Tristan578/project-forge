vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

function makeReviewRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/moderation/appeals/appeal-1/review', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: 'appeal-1' });

describe('/api/admin/moderation/appeals/[id]/review POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 if not admin', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid decision', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const res = await POST(makeReviewRequest({ decision: 'maybe' }), { params });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('decision');
  });

  it('returns 404 if appeal not found', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params });
    expect(res.status).toBe(404);
  });

  it('returns 409 if appeal already reviewed', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'appeal-1', status: 'approved', contentType: 'comment', contentId: 'c1' }]),
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(selectChain) } as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'approve' }), { params });
    expect(res.status).toBe(409);
  });

  it('approves appeal and unflag comment', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'appeal-1', status: 'pending', contentType: 'comment', contentId: 'comment-1' }]),
    };

    const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(true) }) };

    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'approve', note: 'Content is fine' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe('approved');
  });

  it('rejects appeal', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_1', user } });
    vi.mocked(assertAdmin).mockReturnValue(null);

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'appeal-1', status: 'pending', contentType: 'comment', contentId: 'comment-1' }]),
    };

    const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(true) }) };

    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    } as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeReviewRequest({ decision: 'reject' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe('rejected');
  });
});
