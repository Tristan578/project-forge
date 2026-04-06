/**
 * Additional negative / error case tests for POST /api/publish
 *
 * Extends existing route tests with malformed JSON, description-only
 * moderation, thumbnail size enforcement, slug boundary conditions,
 * and auth edge cases.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeUser } from '@/test/utils/apiTestUtils';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUser = makeUser({ id: 'user-pub', clerkId: 'clerk_pub', tier: 'hobbyist' });

vi.mock('@/lib/auth/api-auth', () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 }),
  rateLimitResponse: vi.fn(() =>
    new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
  ),
}));

vi.mock('@/lib/rateLimit/distributed', () => ({
  distributedRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 }),
}));

vi.mock('@/lib/db/client', () => ({
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
  getDb: vi.fn(),
}));

vi.mock('@/lib/moderation/contentFilter', () => ({
  moderateContent: vi.fn(() => ({ severity: 'pass', reasons: [], cleaned: '' })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { getDb } from '@/lib/db/client';
import { moderateContent } from '@/lib/moderation/contentFilter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/publish', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeRawRequest(rawBody: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/publish', {
    method: 'POST',
    body: rawBody,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    projectId: 'proj-1',
    title: 'My Game',
    slug: 'my-game',
    description: 'A game description',
    tags: ['platformer'],
    ...overrides,
  };
}

function makeNewPublicationDb() {
  const pub = {
    id: 'pub-1',
    userId: 'user-pub',
    projectId: 'proj-1',
    slug: 'my-game',
    title: 'My Game',
    description: 'A game description',
    status: 'published',
    version: 1,
    cdnUrl: '/play/clerk_pub/my-game',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Route uses: db.insert().values().onConflictDoUpdate().returning()
  const mockInsertPublication = {
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([pub]),
      }),
    }),
  };
  // Tags insert: db.insert().values()
  const mockInsertTags = {
    values: vi.fn().mockResolvedValue([]),
  };

  return {
    select: vi.fn()
      .mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([]) }) }) // tier check
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) // slug check
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 'proj-1', userId: 'user-pub' }]) }) }) }), // project
    insert: vi.fn()
      .mockReturnValueOnce(mockInsertPublication)
      .mockReturnValueOnce(mockInsertTags),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/publish — negative cases', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { user: mockUser, clerkId: 'clerk_pub' },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
    vi.mocked(distributedRateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
    vi.mocked(moderateContent).mockReturnValue({ severity: 'pass', reasons: [], cleaned: '' });

    const mod = await import('../route');
    POST = mod.POST;
  });

  // -------------------------------------------------------------------------
  // Malformed JSON body
  // -------------------------------------------------------------------------
  describe('malformed JSON body', () => {
    it('returns 400 for empty string body', async () => {
      const res = await POST(makeRawRequest(''));
      expect(res.status).toBe(400);
    });

    it('returns 400 for truncated JSON', async () => {
      const res = await POST(makeRawRequest('{"projectId": "p1"'));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/Invalid JSON/i);
    });

    it('returns 400 for JSON array body (not object)', async () => {
      const res = await POST(makeRawRequest('["not", "an", "object"]'));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/must be a JSON object/i);
    });

    it('returns 400 for JSON primitive body', async () => {
      const res = await POST(makeRawRequest('"just a string"'));
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Field type validation
  // -------------------------------------------------------------------------
  describe('field type validation', () => {
    it('returns 400 when projectId is a number', async () => {
      const res = await POST(makeRequest(validBody({ projectId: 42 })));
      expect(res.status).toBe(400);
    });

    it('returns 400 when title is a boolean', async () => {
      const res = await POST(makeRequest(validBody({ title: true })));
      expect(res.status).toBe(400);
    });

    it('returns 400 when slug is an object', async () => {
      const res = await POST(makeRequest(validBody({ slug: { value: 'test' } })));
      expect(res.status).toBe(400);
    });

    it('returns 400 when description is a number', async () => {
      const res = await POST(makeRequest(validBody({ description: 12345 })));
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Slug edge cases
  // -------------------------------------------------------------------------
  describe('slug edge cases', () => {
    it('returns 400 for single character slug (below minLength 3)', async () => {
      const res = await POST(makeRequest(validBody({ slug: 'a' })));
      expect(res.status).toBe(400);
    });

    it('returns 400 for slug that is exactly 51 chars (above maxLength 50)', async () => {
      const res = await POST(makeRequest(validBody({ slug: 'a'.repeat(51) })));
      expect(res.status).toBe(400);
    });

    it('allows slug with consecutive dashes (regex permits middle dashes)', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody({ slug: 'my--game' })));
      // Regex /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ allows consecutive dashes
      expect(res.status).toBe(200);
    });

    it('returns 400 for slug with unicode characters', async () => {
      const res = await POST(makeRequest(validBody({ slug: 'my-game-\u00e9' })));
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Thumbnail edge cases
  // -------------------------------------------------------------------------
  describe('thumbnail edge cases', () => {
    it('silently drops oversized thumbnail (>200KB) without failing', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      // Create a data URL that exceeds 200KB
      const largeBase64 = 'data:image/png;base64,' + 'A'.repeat(250 * 1024);
      const res = await POST(makeRequest(validBody({ thumbnail: largeBase64 })));
      // Request succeeds but thumbnail is silently dropped
      expect(res.status).toBe(200);
    });

    it('ignores non-data-URL thumbnail strings', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody({ thumbnail: 'https://example.com/img.png' })));
      // Non-data-URL strings are ignored (thumbnail set to null)
      expect(res.status).toBe(200);
    });

    it('ignores non-string thumbnail values', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody({ thumbnail: 42 })));
      // Non-string thumbnail is ignored
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Auth failures
  // -------------------------------------------------------------------------
  describe('auth failures', () => {
    it('returns 401 when Clerk is not configured', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: false,
        response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) as never,
      });

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(401);
    });

    it('returns 503 when user sync fails', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: false,
        response: new Response(
          JSON.stringify({ error: 'SERVICE_DEGRADED', message: 'User sync temporarily unavailable.' }),
          { status: 503 },
        ) as never,
      });

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(503);
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting edge cases
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('does not query DB when rate limited', async () => {
      vi.mocked(distributedRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 30_000 });
      vi.mocked(rateLimitResponse).mockReturnValue(
        new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }) as never,
      );

      await POST(makeRequest(validBody()));
      expect(getDb).not.toHaveBeenCalled();
    });

    it('does not run content moderation when rate limited', async () => {
      vi.mocked(distributedRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 30_000 });
      vi.mocked(rateLimitResponse).mockReturnValue(
        new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 }) as never,
      );

      await POST(makeRequest(validBody()));
      expect(moderateContent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Content moderation edge cases
  // -------------------------------------------------------------------------
  describe('content moderation edge cases', () => {
    it('does not check description moderation when description is absent', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const body = validBody();
      delete (body as Record<string, unknown>).description;
      await POST(makeRequest(body));

      // moderateContent should be called once for the title only
      expect(moderateContent).toHaveBeenCalledTimes(1);
    });

    it('checks moderation for title before description', async () => {
      vi.mocked(moderateContent)
        .mockReturnValueOnce({ severity: 'block', reasons: ['blocked'], cleaned: '' });

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(422);
      // Title blocked — description moderation should not run
      expect(moderateContent).toHaveBeenCalledTimes(1);
    });
  });
});
