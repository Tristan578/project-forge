vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '../route';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { resetAllBreakers, getProviderBreaker } from '@/lib/providers/circuitBreaker';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitAdminRoute: vi.fn().mockResolvedValue(null),
}));

function mockAuthAdmin() {
  const user = makeUser();
  vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'admin_123', user } });
  vi.mocked(assertAdmin).mockReturnValue(null);
}

function mockAuthUnauthorized() {
  vi.mocked(authenticateRequest).mockResolvedValue({
    ok: false,
    response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
  });
}

function mockAuthForbidden() {
  const user = makeUser();
  vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: 'user_123', user } });
  vi.mocked(assertAdmin).mockReturnValue(mockNextResponse({ error: 'Forbidden' }, { status: 403 }));
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/circuit-breaker', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/admin/circuit-breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllBreakers();
  });

  it('returns 401 if unauthenticated', async () => {
    mockAuthUnauthorized();
    const res = await GET(new NextRequest('http://localhost/api/admin/circuit-breaker'));
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    mockAuthForbidden();
    const res = await GET(new NextRequest('http://localhost/api/admin/circuit-breaker'));
    expect(res.status).toBe(403);
  });

  it('returns circuit breaker summary for admin', async () => {
    mockAuthAdmin();
    const res = await GET(new NextRequest('http://localhost/api/admin/circuit-breaker'));
    expect(res.status).toBe(200);

    const data = await res.json() as {
      summary: { total: number; healthy: number; open: number; halfOpen: number };
      providers: Array<{ provider: string; state: string }>;
    };
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('providers');
    expect(data.summary.total).toBeGreaterThan(0);
    expect(Array.isArray(data.providers)).toBe(true);
  });

  it('summary counts reflect actual state', async () => {
    mockAuthAdmin();

    // Trip the anthropic breaker
    const cb = getProviderBreaker('anthropic');
    cb.recordSuccess(100, 10); // cost anomaly — trips immediately

    const res = await GET(new NextRequest('http://localhost/api/admin/circuit-breaker'));
    const data = await res.json() as {
      summary: { open: number; healthy: number };
    };
    expect(data.summary.open).toBeGreaterThanOrEqual(1);
    expect(data.summary.healthy).toBeLessThan(10); // at least one is open
  });

  it('all providers appear in the response', async () => {
    mockAuthAdmin();
    const res = await GET(new NextRequest('http://localhost/api/admin/circuit-breaker'));
    const data = await res.json() as {
      providers: Array<{ provider: string }>;
    };
    const providerNames = data.providers.map((p) => p.provider);
    expect(providerNames).toContain('anthropic');
    expect(providerNames).toContain('meshy');
    expect(providerNames).toContain('elevenlabs');
    expect(providerNames).toContain('suno');
    expect(providerNames).toContain('openrouter');
  });
});

describe('POST /api/admin/circuit-breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllBreakers();
  });

  it('returns 401 if unauthenticated', async () => {
    mockAuthUnauthorized();
    const res = await POST(makePostRequest({ action: 'reset_all' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 if not admin', async () => {
    mockAuthForbidden();
    const res = await POST(makePostRequest({ action: 'reset_all' }));
    expect(res.status).toBe(403);
  });

  it('reset_all resets all circuit breakers', async () => {
    mockAuthAdmin();

    // Trip a breaker
    const cb = getProviderBreaker('anthropic');
    cb.recordSuccess(100, 10);
    expect(getProviderBreaker('anthropic').getState()).toBe('OPEN');

    const res = await POST(makePostRequest({ action: 'reset_all' }));
    expect(res.status).toBe(200);
    const data = await res.json() as { success: boolean };
    expect(data.success).toBe(true);

    // All should be closed now
    const getRes = await GET(new NextRequest('http://localhost/api/admin/circuit-breaker'));
    const getBody = await getRes.json() as { summary: { open: number } };
    expect(getBody.summary.open).toBe(0);
  });

  it('reset_provider resets only the specified provider', async () => {
    mockAuthAdmin();

    // Trip both anthropic and meshy
    getProviderBreaker('anthropic').recordSuccess(100, 10);
    getProviderBreaker('meshy').recordSuccess(100, 10);

    const res = await POST(makePostRequest({ action: 'reset_provider', provider: 'anthropic' }));
    expect(res.status).toBe(200);
    const data = await res.json() as { success: boolean };
    expect(data.success).toBe(true);

    // Anthropic should be closed, meshy still open
    expect(getProviderBreaker('anthropic').getState()).toBe('CLOSED');
    expect(getProviderBreaker('meshy').getState()).toBe('OPEN');
  });

  it('returns 400 for unknown action', async () => {
    mockAuthAdmin();
    const res = await POST(makePostRequest({ action: 'invalid_action' }));
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('Unknown action');
  });

  it('returns 400 for reset_provider with missing provider', async () => {
    mockAuthAdmin();
    const res = await POST(makePostRequest({ action: 'reset_provider' }));
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('Missing provider');
  });

  it('returns 400 for reset_provider with unknown provider name', async () => {
    mockAuthAdmin();
    const res = await POST(makePostRequest({ action: 'reset_provider', provider: 'unknown-xyz' }));
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('Unknown provider');
  });

  it('returns 400 for invalid JSON body', async () => {
    mockAuthAdmin();
    const req = new NextRequest('http://localhost/api/admin/circuit-breaker', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-object body', async () => {
    mockAuthAdmin();
    const req = new NextRequest('http://localhost/api/admin/circuit-breaker', {
      method: 'POST',
      body: '"just a string"',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
