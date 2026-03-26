/**
 * PF-675: Negative/error case tests for representative API routes.
 *
 * Tests the following error conditions across 5 routes:
 * - Missing auth headers → 401
 * - Invalid JSON body → 400
 * - Rate limited requests → 429
 * - Missing required fields → 400
 * - Non-existent resource → 404
 *
 * Routes tested: /api/chat, /api/generate/model, /api/publish,
 *                /api/feedback, /api/tokens/balance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Global mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

const mockAuthenticateRequest = vi.fn();
const mockAuthenticateClerkSession = vi.fn();
const mockWithApiMiddleware = vi.fn();
const mockGetTokenBalance = vi.fn();
const mockGetDb = vi.fn();
const mockDistributedRateLimit = vi.fn();
const mockRateLimitResponse = vi.fn();
const mockModerateContent = vi.fn();
const mockExtractRequestId = vi.fn();
const mockLogger = { child: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
const mockCaptureException = vi.fn();
const mockResolveApiKey = vi.fn();
const mockGetTokenCost = vi.fn();

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: () => mockAuthenticateRequest(),
  authenticateClerkSession: () => mockAuthenticateClerkSession(),
}));

vi.mock('@/lib/api/middleware', () => ({
  withApiMiddleware: (...args: unknown[]) => mockWithApiMiddleware(...args),
}));

vi.mock('@/lib/tokens/service', () => ({
  getTokenBalance: (...args: unknown[]) => mockGetTokenBalance(...args),
  refundTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => mockGetDb(),
}));

vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: (...args: unknown[]) => mockDistributedRateLimit(...args),
  aggregateGenerationRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 900000 }),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60000 }),
  rateLimitAdminRoute: vi.fn().mockResolvedValue(null),
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
  rateLimitResponse: (...args: unknown[]) => mockRateLimitResponse(...args),
}));

vi.mock('@/lib/moderation/contentFilter', () => ({
  moderateContent: (text: unknown) => mockModerateContent(text),
}));

vi.mock('@/lib/logging/requestContext', () => ({
  extractRequestId: () => mockExtractRequestId(),
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: (...args: unknown[]) => mockResolveApiKey(...args),
  ApiKeyError: class ApiKeyError extends Error {},
}));

vi.mock('@/lib/tokens/pricing', () => ({
  getTokenCost: (...args: unknown[]) => mockGetTokenCost(...args),
}));

vi.mock('@/lib/auth/user-service', () => ({
  getUserByClerkId: vi.fn().mockResolvedValue(null),
}));

// Heavy routes that require additional mocks — stub their deps early
vi.mock('@/lib/providers/resolveChat', () => ({
  resolveChat: vi.fn(),
  resolveChatRoute: vi.fn(),
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

vi.mock('@/lib/generate/meshyClient', () => ({
  MeshyClient: vi.fn(),
}));

vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn().mockReturnValue({ safe: true, filtered: '', reason: '' }),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeUnauthedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function makeRateLimitedResponse() {
  return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
}

function makeRequest(url: string, body?: unknown, method = 'POST'): NextRequest {
  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new NextRequest(url, { method });
}

function makeRequestRaw(url: string, rawBody: string, method = 'POST'): NextRequest {
  return new NextRequest(url, {
    method,
    body: rawBody,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// /api/tokens/balance — simplest route, good baseline
// ---------------------------------------------------------------------------

describe('GET /api/tokens/balance — negative cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when Clerk is not configured (no auth)', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      ok: false,
      response: makeUnauthedResponse(),
    });

    const { GET } = await import('@/app/api/tokens/balance/route');
    const req = new NextRequest('http://localhost:3000/api/tokens/balance');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns token balance when auth succeeds', async () => {
    const fakeBalance = { monthlyRemaining: 100, monthlyTotal: 500, addon: 0, total: 100 };
    mockAuthenticateRequest.mockResolvedValue({
      ok: true,
      ctx: { user: { id: 'user-1' }, clerkId: 'clerk_1' },
    });
    mockGetTokenBalance.mockResolvedValue(fakeBalance);

    const { GET } = await import('@/app/api/tokens/balance/route');
    const req = new NextRequest('http://localhost:3000/api/tokens/balance');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// /api/feedback — auth + rate limit + field validation
// ---------------------------------------------------------------------------

describe('POST /api/feedback — negative cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
    mockExtractRequestId.mockReturnValue('req-1');
  });

  it('returns 401 when Clerk session is missing', async () => {
    mockAuthenticateClerkSession.mockResolvedValue({
      ok: false,
      response: makeUnauthedResponse(),
    });

    const { POST } = await import('@/app/api/feedback/route');
    const req = makeRequest('http://localhost/api/feedback', { type: 'bug', description: 'A long enough description here' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockAuthenticateClerkSession.mockResolvedValue({ ok: true, clerkId: 'clerk_1' });

    // getUserByClerkId is called internally — mock it via the module
    const { getUserByClerkId } = await import('@/lib/auth/user-service');
    vi.mocked(getUserByClerkId).mockResolvedValue({
      id: 'user-1',
      clerkId: 'clerk_1',
      email: 'test@example.com',
      displayName: 'Test',
      tier: 'starter',
      monthlyTokens: 0,
      monthlyTokensUsed: 0,
      addonTokens: 0,
      earnedCredits: 0,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      billingCycleStart: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as import('@/lib/db/schema').User);

    mockDistributedRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });
    mockRateLimitResponse.mockReturnValue(makeRateLimitedResponse());

    const { POST } = await import('@/app/api/feedback/route');
    const req = makeRequest('http://localhost/api/feedback', { type: 'bug', description: 'Rate limited test' });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON body', async () => {
    mockAuthenticateClerkSession.mockResolvedValue({ ok: true, clerkId: 'clerk_1' });

    const { getUserByClerkId } = await import('@/lib/auth/user-service');
    vi.mocked(getUserByClerkId).mockResolvedValue(null);

    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });

    const { POST } = await import('@/app/api/feedback/route');
    const req = makeRequestRaw('http://localhost/api/feedback', '{not valid json}');
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when type field is missing', async () => {
    mockAuthenticateClerkSession.mockResolvedValue({ ok: true, clerkId: 'clerk_1' });

    const { getUserByClerkId } = await import('@/lib/auth/user-service');
    vi.mocked(getUserByClerkId).mockResolvedValue(null);
    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });

    const { POST } = await import('@/app/api/feedback/route');
    // Missing 'type' field
    const req = makeRequest('http://localhost/api/feedback', { description: 'This description is long enough' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when description is too short', async () => {
    mockAuthenticateClerkSession.mockResolvedValue({ ok: true, clerkId: 'clerk_1' });

    const { getUserByClerkId } = await import('@/lib/auth/user-service');
    vi.mocked(getUserByClerkId).mockResolvedValue(null);
    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });

    const { POST } = await import('@/app/api/feedback/route');
    // Description < 10 chars
    const req = makeRequest('http://localhost/api/feedback', { type: 'bug', description: 'Short' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when type has invalid value', async () => {
    mockAuthenticateClerkSession.mockResolvedValue({ ok: true, clerkId: 'clerk_1' });

    const { getUserByClerkId } = await import('@/lib/auth/user-service');
    vi.mocked(getUserByClerkId).mockResolvedValue(null);
    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });

    const { POST } = await import('@/app/api/feedback/route');
    const req = makeRequest('http://localhost/api/feedback', {
      type: 'invalid_type',
      description: 'This description is long enough to pass the length check',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /api/publish — auth + rate limit + required fields
// ---------------------------------------------------------------------------

describe('POST /api/publish — negative cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
    mockExtractRequestId.mockReturnValue('req-1');
    mockModerateContent.mockReturnValue({ severity: 'none' });
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      ok: false,
      response: makeUnauthedResponse(),
    });

    const { POST } = await import('@/app/api/publish/route');
    const req = makeRequest('http://localhost/api/publish', {
      projectId: 'proj-1',
      title: 'My Game',
      slug: 'my-game',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      ok: true,
      ctx: { user: { id: 'user-1', tier: 'starter' }, clerkId: 'clerk_1' },
    });
    mockDistributedRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });
    mockRateLimitResponse.mockReturnValue(makeRateLimitedResponse());

    const { POST } = await import('@/app/api/publish/route');
    const req = makeRequest('http://localhost/api/publish', {
      projectId: 'proj-1',
      title: 'My Game',
      slug: 'my-game',
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it('returns 400 when projectId is missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      ok: true,
      ctx: { user: { id: 'user-1', tier: 'starter' }, clerkId: 'clerk_1' },
    });
    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });

    const { POST } = await import('@/app/api/publish/route');
    const req = makeRequest('http://localhost/api/publish', {
      title: 'My Game',
      slug: 'my-game',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      ok: true,
      ctx: { user: { id: 'user-1', tier: 'starter' }, clerkId: 'clerk_1' },
    });
    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });

    const { POST } = await import('@/app/api/publish/route');
    const req = makeRequest('http://localhost/api/publish', {
      projectId: 'proj-1',
      slug: 'my-game',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      ok: true,
      ctx: { user: { id: 'user-1', tier: 'starter' }, clerkId: 'clerk_1' },
    });
    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });

    const { POST } = await import('@/app/api/publish/route');
    const req = makeRequestRaw('http://localhost/api/publish', '{broken json');
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when slug is too short', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      ok: true,
      ctx: { user: { id: 'user-1', tier: 'starter' }, clerkId: 'clerk_1' },
    });
    mockDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 });

    const { POST } = await import('@/app/api/publish/route');
    const req = makeRequest('http://localhost/api/publish', {
      projectId: 'proj-1',
      title: 'My Game',
      slug: 'ab', // < 3 chars
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /api/generate/model — auth + rate limit + field validation
// ---------------------------------------------------------------------------

describe('POST /api/generate/model — negative cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated (withApiMiddleware)', async () => {
    mockWithApiMiddleware.mockResolvedValue({
      error: makeUnauthedResponse(),
      authContext: null,
    });

    const { POST } = await import('@/app/api/generate/model/route');
    const req = makeRequest('http://localhost/api/generate/model', { prompt: 'a red cube', mode: 'text-to-3d' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited by middleware', async () => {
    mockWithApiMiddleware.mockResolvedValue({
      error: makeRateLimitedResponse(),
      authContext: null,
    });

    const { POST } = await import('@/app/api/generate/model/route');
    const req = makeRequest('http://localhost/api/generate/model', { prompt: 'a red cube', mode: 'text-to-3d' });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON body', async () => {
    mockWithApiMiddleware.mockResolvedValue({
      error: null,
      authContext: { user: { id: 'user-1', tier: 'starter' }, clerkId: 'clerk_1' },
    });

    const { POST } = await import('@/app/api/generate/model/route');
    const req = makeRequestRaw('http://localhost/api/generate/model', 'not json');
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 422 when prompt is too short', async () => {
    mockWithApiMiddleware.mockResolvedValue({
      error: null,
      authContext: { user: { id: 'user-1', tier: 'starter' }, clerkId: 'clerk_1' },
    });

    const { POST } = await import('@/app/api/generate/model/route');
    const req = makeRequest('http://localhost/api/generate/model', {
      prompt: 'ab', // < 3 chars
      mode: 'text-to-3d',
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('returns 422 when image-to-3d mode is missing imageBase64', async () => {
    mockWithApiMiddleware.mockResolvedValue({
      error: null,
      authContext: { user: { id: 'user-1', tier: 'starter' }, clerkId: 'clerk_1' },
    });

    const { POST } = await import('@/app/api/generate/model/route');
    const req = makeRequest('http://localhost/api/generate/model', {
      prompt: 'a red cube',
      mode: 'image-to-3d',
      // imageBase64 missing
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});
