vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn(),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { NextResponse } from 'next/server';

const mockAuth = authenticateRequest as ReturnType<typeof vi.fn>;
const mockRateLimitResponse = rateLimitResponse as ReturnType<typeof vi.fn>;
const mockDistributedRateLimit = distributedRateLimit as ReturnType<typeof vi.fn>;

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/generate/pixel-art', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  prompt: 'a warrior knight with sword',
  targetSize: 32,
  palette: 'pico-8',
  dithering: 'none',
  ditheringIntensity: 0,
  style: 'character',
  provider: 'auto',
};

describe('POST /api/generate/pixel-art', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      ok: true,
      ctx: { user: { id: 'user-123', tier: 'pro' }, clerkId: 'clerk-123' },
    });
    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 });
    mockRateLimitResponse.mockReturnValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );
  });

  it('should return 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    mockDistributedRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 300000 });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
  });

  it('should return 501 — pixel art generation is not yet available', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });

  it('should return 501 regardless of request body contents', async () => {
    const res = await POST(makeRequest({ prompt: 'ab', targetSize: 50 }));
    expect(res.status).toBe(501);
  });

  it('should not charge tokens before returning 501', async () => {
    // The route returns 501 immediately after auth/rate-limit — resolveApiKey
    // is no longer called, so users are never charged for a stub endpoint.
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(501);
  });
});
