vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');

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

  it('creates appeal and returns 201 on success', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'c1', user } });

    const mockReturning = vi.fn().mockResolvedValue([{ id: 'appeal-1', status: 'pending' }]);
    const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    vi.mocked(getDb).mockReturnValue({ insert: mockInsert } as unknown as ReturnType<typeof getDb>);

    const res = await POST(makeRequest({
      contentId: 'comment-1',
      contentType: 'comment',
      reason: 'This content was not offensive, it was taken out of context',
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.id).toBe('appeal-1');
    expect(data.status).toBe('pending');
  });
});
