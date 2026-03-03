import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getTokenBalance } from '@/lib/tokens/service';
import { makeUser } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/tokens/service');

describe('GET /api/tokens/balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns token balance', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(getTokenBalance).mockResolvedValue({
      monthlyRemaining: 40,
      monthlyTotal: 50,
      addon: 60,
      total: 100,
      nextRefillDate: null,
    });

    const res = await GET();
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data.total).toBe(100);
    expect(getTokenBalance).toHaveBeenCalledWith(user.id);
  });
});
