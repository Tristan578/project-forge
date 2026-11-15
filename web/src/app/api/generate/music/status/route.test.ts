vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { MUSIC_SYNC_TERMINAL_MESSAGE } from '@/lib/generate/pollProviderStatus';
import type { User } from '@/lib/db/schema';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() + 60000 }),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() + 60000 }),
  aggregateGenerationRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 }),
}));

function makeRequest(jobId?: string): NextRequest {
  const url = jobId
    ? `http://test/api/generate/music/status?jobId=${jobId}`
    : 'http://test/api/generate/music/status';
  return new NextRequest(url);
}

// #9522: music routes to ElevenLabs `/v1/music`, which returns audio inline, so
// there is no async task to poll. This endpoint is retained for the client
// contract and reports a single terminal state on the first poll.
describe('GET /api/generate/music/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as unknown as User },
    });
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new NextResponse('Unauthorized', { status: 401 }),
    });

    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when jobId is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('jobId query parameter required');
  });

  it('returns a terminal failed state (matching pollProviderStatus) on the first poll', async () => {
    const res = await GET(makeRequest('job-123'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jobId).toBe('job-123');
    expect(data.status).toBe('failed');
    expect(data.progress).toBe(0);
    expect(data.resultUrl).toBeUndefined();
    expect(data.error).toBe(MUSIC_SYNC_TERMINAL_MESSAGE);
    // No provider name leaks in the terminal message.
    expect(JSON.stringify(data)).not.toMatch(/suno/i);
  });

  // Per-panel tier gate, POLL variant (#7715). 'generate-music' is
  // hobbyist-gated. The terminal `failed` state is what makes the client
  // refund, so a trial starter whose one music generation spent the grant must
  // still get it, not a 403 that leaves the job hanging until timeout. A
  // starter that never held tokens could not have created a music job, so it
  // is refused like any other hobbyist status route.
  describe('panel tier gate (generate-music, hobbyist)', () => {
    function authAs(user: Record<string, unknown>) {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: true as const,
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', ...user } as unknown as User },
      });
    }

    it('admits a starter whose trial balance is spent: it is reading the job it paid for', async () => {
      authAs({ tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 50, addonTokens: 0 });

      const res = await GET(makeRequest('job-123'));
      expect(res.status).toBe(200);
      expect((await res.json()).error).toBe(MUSIC_SYNC_TERMINAL_MESSAGE);
    });

    it('refuses a never-granted starter (no tokens ever held) with 403 TIER_REQUIRED', async () => {
      authAs({ tier: 'starter', monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0 });

      const res = await GET(makeRequest('job-123'));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'TIER_REQUIRED', currentTier: 'starter', requiredTier: 'hobbyist' });
    });
  });
});
