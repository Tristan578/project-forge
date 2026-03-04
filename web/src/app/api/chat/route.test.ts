import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock('@/lib/tokens/pricing', () => ({
  getTokenCost: vi.fn(() => 10),
}));
vi.mock('@/lib/tokens/service', () => ({
  refundTokens: vi.fn(),
}));
vi.mock('@/lib/chat/tools', () => ({
  getChatTools: vi.fn(() => []),
}));
vi.mock('@/lib/chat/sanitizer', () => ({
  sanitizeChatInput: vi.fn((s: string) => s),
  validateBodySize: vi.fn(() => true),
  detectPromptInjection: vi.fn(() => false),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
    vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('should return 413 when body too large', async () => {
    const { validateBodySize } = await import('@/lib/chat/sanitizer');
    vi.mocked(validateBodySize).mockReturnValue(false);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(413);
  });

  it('should return 400 for invalid JSON', async () => {
    const { validateBodySize } = await import('@/lib/chat/sanitizer');
    vi.mocked(validateBodySize).mockReturnValue(true);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      body: 'not json {{{',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('should return 400 when messages array missing', async () => {
    const { validateBodySize } = await import('@/lib/chat/sanitizer');
    vi.mocked(validateBodySize).mockReturnValue(true);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-3-opus' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('should return 402 when API key resolution fails', async () => {
    const { validateBodySize } = await import('@/lib/chat/sanitizer');
    vi.mocked(validateBodySize).mockReturnValue(true);

    const { resolveApiKey, ApiKeyError } = await import('@/lib/keys/resolver');
    vi.mocked(resolveApiKey).mockRejectedValue(new ApiKeyError('INSUFFICIENT_TOKENS', 'No tokens'));

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(402);
  });
});
