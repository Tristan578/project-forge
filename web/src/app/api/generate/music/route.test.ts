/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { SunoClient } from '@/lib/generate/sunoClient';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/monitoring/sentry-server');
vi.mock('@/lib/keys/resolver', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/keys/resolver')>();
  return { ...mod, resolveApiKey: vi.fn() };
});
vi.mock('@/lib/tokens/pricing');
vi.mock('@/lib/generate/sunoClient', () => ({
  SunoClient: vi.fn(() => ({
    createMusic: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
  })),
}));

function makeRequest(body: unknown) {
  return new Request('http://test/api/generate/music', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate/music', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 });
    vi.mocked(resolveApiKey).mockResolvedValue({ type: 'platform', key: 'test-key', metered: true, usageId: 'usage-1' });
    vi.mocked(getTokenCost).mockReturnValue(100);
    vi.mocked(SunoClient).mockImplementation(function () {
      return {
        createMusic: vi.fn().mockResolvedValue({ taskId: 'task-1' }),
      } as any;
    } as any);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new NextResponse('Unauthorized', { status: 401 }),
    });

    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 30 }) as any);
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 300000 });

    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 30 }) as any);
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://test/api/generate/music', {
      method: 'POST',
      body: 'not json',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid JSON');
  });

  it('returns 422 for short prompt', async () => {
    const res = await POST(makeRequest({ prompt: 'ab', durationSeconds: 30 }) as any);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('Prompt must be between 3 and 500');
  });

  it('returns 422 for invalid duration', async () => {
    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 5 }) as any);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('Duration must be between 15 and 120');
  });

  it('returns 402 when tokens insufficient', async () => {
    vi.mocked(resolveApiKey).mockRejectedValue(
      new ApiKeyError('INSUFFICIENT_TOKENS', 'Not enough tokens')
    );

    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 30 }) as any);
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe('INSUFFICIENT_TOKENS');
  });

  it('returns 500 when provider fails', async () => {
    vi.mocked(SunoClient).mockImplementation(function () {
      return {
        createMusic: vi.fn().mockRejectedValue(new Error('Suno API down')),
      } as any;
    } as any);

    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 30 }) as any);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Suno API down');
  });

  it('returns 201 on successful music generation', async () => {
    const res = await POST(makeRequest({ prompt: 'epic battle theme', durationSeconds: 30 }) as any);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.jobId).toBe('task-1');
    expect(data.provider).toBe('suno');
    expect(data.status).toBe('pending');
    expect(data.estimatedSeconds).toBe(60);
    expect(data.usageId).toBeUndefined(); // usageId removed to prevent double refund
  });
});
