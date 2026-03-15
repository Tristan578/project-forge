vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { rateLimit } from '@/lib/rateLimit';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';
import { moderateContent } from '@/lib/moderation/contentFilter';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/db/client');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn().mockReturnValue(new Response('Rate Limited', { status: 429 })),
}));
vi.mock('@/lib/moderation/contentFilter');

describe('POST /api/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
    vi.mocked(moderateContent).mockReturnValue({ severity: 'pass', reasons: [], cleaned: '' });
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: false, response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }) });
    const req = new NextRequest('http://localhost/api/publish', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing fields', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user: makeUser() } });
    const req = new NextRequest('http://localhost/api/publish', { method: 'POST', body: JSON.stringify({ title: 'A' }) });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 422 for blocked content in title', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user: makeUser() } });
    vi.mocked(moderateContent).mockReturnValueOnce({ severity: 'block', reasons: ['bad'], cleaned: '' });

    const req = new NextRequest('http://localhost/api/publish', { 
      method: 'POST', 
      body: JSON.stringify({ projectId: 'p1', title: 'bad game', slug: 'bad-game' }) 
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('returns 400 for invalid slug', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user: makeUser() } });
    
    const req = new NextRequest('http://localhost/api/publish', { 
      method: 'POST', 
      body: JSON.stringify({ projectId: 'p1', title: 'Good Game', slug: 'a' }) // too short
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 403 if tier limit reached', async () => {
    const user = makeUser({ tier: 'starter' }); // max 1
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    
    const chainMock = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'existing_1' }]), // Already has 1 published
    };
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chainMock) } as unknown as ReturnType<typeof getDb>);

    const req = new NextRequest('http://localhost/api/publish', { 
      method: 'POST', 
      body: JSON.stringify({ projectId: 'p1', title: 'Game', slug: 'my-game' }) 
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
