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
vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'ApiKeyError';
    }
  },
}));

import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { resolveApiKey } from '@/lib/keys/resolver';
import { NextResponse } from 'next/server';

const mockAuth = authenticateRequest as ReturnType<typeof vi.fn>;
const mockRateLimit = rateLimit as ReturnType<typeof vi.fn>;
const mockRateLimitResponse = rateLimitResponse as ReturnType<typeof vi.fn>;
const mockResolveKey = resolveApiKey as ReturnType<typeof vi.fn>;

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
    mockRateLimit.mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 300000 });
    mockRateLimitResponse.mockReturnValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );
    mockResolveKey.mockResolvedValue({ type: 'byok', key: 'sk-test-key', metered: false });
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
    mockRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 300000 });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
  });

  it('should return 400 for short prompt', async () => {
    const res = await POST(makeRequest({ ...validBody, prompt: 'ab' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('3 characters');
  });

  it('should return 400 for invalid size', async () => {
    const res = await POST(makeRequest({ ...validBody, targetSize: 50 }));
    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid palette', async () => {
    const res = await POST(makeRequest({ ...validBody, palette: 'invalid' }));
    expect(res.status).toBe(400);
  });

  it('should return 400 for custom palette without colors', async () => {
    const res = await POST(makeRequest({ ...validBody, palette: 'custom' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Custom palette');
  });

  it('should return 400 for invalid dithering intensity', async () => {
    const res = await POST(makeRequest({ ...validBody, ditheringIntensity: 2 }));
    expect(res.status).toBe(400);
  });

  it('should return 402 when no API key', async () => {
    const { ApiKeyError: MockApiKeyError } = await import('@/lib/keys/resolver');
    mockResolveKey.mockRejectedValue(new MockApiKeyError('NO_KEY_CONFIGURED', 'No API key configured for replicate'));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.error).toContain('API key');
  });

  it('should return 201 with valid request', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe('pending');
    expect(data.provider).toBe('replicate');
    expect(data.tokenCost).toBe(10);
  });

  it('should use openai provider when specified', async () => {
    const res = await POST(makeRequest({ ...validBody, provider: 'openai' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.provider).toBe('openai');
    expect(data.tokenCost).toBe(20);
  });
});
