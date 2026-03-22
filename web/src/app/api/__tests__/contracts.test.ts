/**
 * PF-687: API contract tests.
 *
 * Validates the response SHAPE (not business logic) of key API routes so
 * that breaking changes in route signatures are caught in CI before they
 * reach clients or the MCP server.
 *
 * Tested routes:
 *   GET  /api/health       — { status, services[], timestamp, ... }
 *   GET  /api/capabilities — { capabilities[], available[], unavailable[] }
 *   POST /api/chat         — invalid body → { error } with 400
 *
 * All external I/O (DB, fetch, Clerk, Redis) is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Global mocks (hoisted before any dynamic import)
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/monitoring/healthChecks', () => ({
  runAllHealthChecks: vi.fn().mockResolvedValue({
    overall: 'healthy',
    environment: 'test',
    version: '1.0.0',
    timestamp: '2026-01-01T00:00:00Z',
    services: [
      { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, error: null },
      { name: 'Auth (Clerk)', status: 'healthy', latencyMs: 3, error: null },
    ],
  }),
  computeCriticalStatus: vi.fn().mockReturnValue('healthy'),
  sanitizeForPublic: vi.fn().mockImplementation((services: unknown[]) => services),
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/auth/api-auth', () => ({
  // Use mockImplementation to return a fresh Response each call (body stream is single-read)
  authenticateRequest: vi.fn().mockImplementation(async () => ({
    ok: false,
    response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  })),
  authenticateClerkSession: vi.fn().mockImplementation(async () => ({
    ok: false,
    response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  })),
}));

vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: vi.fn().mockImplementation(async () => ({
    // Return a fresh Response each time so the body stream is not exhausted
    error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    authContext: null,
  })),
}));

vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn().mockRejectedValue(new Error('No key')),
  ApiKeyError: class ApiKeyError extends Error {},
}));

vi.mock('@/lib/tokens/pricing', () => ({
  getTokenCost: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/tokens/service', () => ({
  getTokenBalance: vi.fn().mockResolvedValue({ monthlyRemaining: 0, monthlyTotal: 0, addon: 0, total: 0 }),
  refundTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/chat/tools', () => ({
  getChatTools: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/chat/sanitizer', () => ({
  sanitizeChatInput: (s: string) => s,
  validateBodySize: vi.fn().mockReturnValue(null),
  detectPromptInjection: vi.fn().mockReturnValue({ safe: true }),
}));

vi.mock('@/lib/chat/docContext', () => ({
  buildDocContext: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/lib/providers/resolveChat', () => ({
  resolveChat: vi.fn(),
  resolveChatRoute: vi.fn(),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {},
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

function makePostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
  });
}

function makePostRequestRaw(url: string, rawBody: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/health — response shape contract
// ---------------------------------------------------------------------------

describe('GET /api/health — response shape contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns an object with status field (string)', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.status).toBe('string');
  });

  it('returns a services array', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(Array.isArray(body.services)).toBe(true);
  });

  it('returns a timestamp string', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.timestamp).toBe('string');
    expect(body.timestamp).not.toBe('');
  });

  it('returns environment, commit, branch, and version fields', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.environment).toBe('string');
    expect(typeof body.commit).toBe('string');
    expect(typeof body.branch).toBe('string');
    expect(typeof body.version).toBe('string');
  });

  it('each service entry has name and status fields', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    const services = body.services as Array<Record<string, unknown>>;
    for (const svc of services) {
      expect(typeof svc.name).toBe('string');
      expect(typeof svc.status).toBe('string');
    }
  });

  it('responds with 200 when all services are healthy', async () => {
    const { GET, resetHealthCache } = await import('@/app/api/health/route');
    resetHealthCache();
    const res = await GET(makeGetRequest('http://localhost/api/health'));

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/capabilities — response shape contract
// ---------------------------------------------------------------------------

describe('GET /api/capabilities — response shape contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns an object with capabilities array', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(Array.isArray(body.capabilities)).toBe(true);
    expect((body.capabilities as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns available and unavailable arrays', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    expect(Array.isArray(body.available)).toBe(true);
    expect(Array.isArray(body.unavailable)).toBe(true);
  });

  it('each capability entry has capability, available, and label fields', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    const caps = body.capabilities as Array<Record<string, unknown>>;
    for (const cap of caps) {
      expect(typeof cap.capability).toBe('string');
      expect(typeof cap.available).toBe('boolean');
      expect(typeof cap.label).toBe('string');
    }
  });

  it('available + unavailable covers all capability entries', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    const caps = body.capabilities as Array<{ capability: string }>;
    const available = new Set(body.available as string[]);
    const unavailable = new Set(body.unavailable as string[]);
    const union = new Set([...available, ...unavailable]);

    for (const cap of caps) {
      expect(union.has(cap.capability)).toBe(true);
    }
  });

  it('responds with 200', async () => {
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));

    expect(res.status).toBe(200);
  });

  it('unavailable capabilities include requiredProviders hint', async () => {
    // With no API keys set, all capabilities should be unavailable and have hints
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET(new NextRequest('http://localhost/api/health'));
    const body = await res.json() as Record<string, unknown>;

    const caps = body.capabilities as Array<Record<string, unknown>>;
    // Every unavailable capability must include requiredProviders
    for (const cap of caps) {
      if (!cap.available) {
        expect(Array.isArray(cap.requiredProviders)).toBe(true);
        expect((cap.requiredProviders as unknown[]).length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat — invalid body → { error } with 4xx
// ---------------------------------------------------------------------------

describe('POST /api/chat — invalid body contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Do NOT call vi.resetModules() here — the chat route reads its body
    // stream once, and resetting modules causes stale mock state that
    // triggers "Body has already been read" on subsequent tests.
  });

  it('returns { error } object with 4xx status for invalid JSON body', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const req = makePostRequestRaw(
      'http://localhost/api/chat',
      '{this is not valid json}',
    );
    const res = await POST(req);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns { error } object with 4xx for empty body', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const req = makePostRequestRaw('http://localhost/api/chat', '');
    const res = await POST(req);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns { error } object with 4xx for missing messages field', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const req = makePostRequest('http://localhost/api/chat', { model: 'claude-3-5-sonnet-20241022' });
    const res = await POST(req);

    // Auth or validation should reject — either way, shape must be { error }
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json() as Record<string, unknown>;
    expect('error' in body).toBe(true);
  });

  it('error field is a non-empty string in all 4xx responses', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const req = makePostRequestRaw('http://localhost/api/chat', 'bad json!!');
    const res = await POST(req);

    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect((body.error as string).length).toBeGreaterThan(0);
  });
});
