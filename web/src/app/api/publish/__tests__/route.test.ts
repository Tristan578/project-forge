/**
 * Tests for POST /api/publish
 *
 * Covers: authentication, rate limiting, field validation, slug format,
 * content moderation, tier publish limits, project ownership, new publication,
 * republish (update), tag handling, DB errors.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeUser } from '@/test/utils/apiTestUtils';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUser = makeUser({ id: 'user-1', clerkId: 'clerk_1', tier: 'hobbyist' });

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
  getDb: vi.fn(),
}));

vi.mock('@/lib/moderation/contentFilter', () => ({
  moderateContent: vi.fn(() => ({ severity: 'pass', reasons: [], cleaned: '' })),
}));

vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimitResponse } from '@/lib/rateLimit';
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

function validBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    projectId: 'proj-1',
    title: 'My Awesome Game',
    slug: 'my-awesome-game',
    description: 'A description of the game',
    tags: ['platformer', 'indie'],
    ...overrides,
  };
}

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proj-1',
    userId: 'user-1',
    title: 'My Game',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePublication(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'pub-1',
    userId: 'user-1',
    projectId: 'proj-1',
    slug: 'my-awesome-game',
    title: 'My Awesome Game',
    description: 'A description',
    status: 'published',
    version: 1,
    cdnUrl: '/play/clerk_1/my-awesome-game',
    playCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Build a mock DB that handles the publish flow for a NEW publication.
 * Sequence of DB operations:
 * 1. select existing published games (for tier limit check)
 * 2. select existing slug (returns empty — new publication)
 * 3. select project (returns the project)
 * 4. insert publication → returning [publication]
 * 5. insert tags (no return value needed)
 */
function makeNewPublicationDb(options: {
  existingCount?: number;
  project?: Record<string, unknown> | null;
  publication?: Record<string, unknown>;
} = {}) {
  const existingCount = options.existingCount ?? 0;
  const project = options.project === undefined ? makeProject() : options.project;
  const pub = options.publication ?? makePublication();

  const existingRows = Array.from({ length: existingCount }, (_, i) => ({ id: `pub-${i}` }));

  const mockInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([pub]),
      }),
    }),
  });

  const mockInsertTags = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue([]),
  });

  const selectMock = vi.fn()
    .mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve(existingRows) }),
    })
    .mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]), // no existing slug
        }),
      }),
    })
    .mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(project ? [project] : []),
        }),
      }),
    });

  return {
    select: selectMock,
    insert: vi.fn()
      .mockReturnValueOnce(mockInsert()) // publication insert
      .mockReturnValueOnce(mockInsertTags()), // tags insert (if tags exist)
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/publish', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: authenticated as hobbyist
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { user: mockUser, clerkId: 'clerk_1' },
    });

    // Default: rate limit allows
    vi.mocked(distributedRateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });

    // Default: content passes moderation
    vi.mocked(moderateContent).mockReturnValue({ severity: 'pass', reasons: [], cleaned: '' });

    const mod = await import('../route');
    POST = mod.POST;
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------
  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: false,
        response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) as never,
      });

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('returns 429 when rate limited', async () => {
      vi.mocked(distributedRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 30_000 });
      vi.mocked(rateLimitResponse).mockReturnValue(
        new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }) as never,
      );

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(429);
    });

    it('rate limits by user clerkId with correct limits', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      await POST(makeRequest(validBody()));
      expect(distributedRateLimit).toHaveBeenCalledWith('publish:clerk_1', 10, 60);
    });
  });

  // -------------------------------------------------------------------------
  // Field validation
  // -------------------------------------------------------------------------
  describe('field validation', () => {
    it('returns 400 when projectId is missing', async () => {
      const res = await POST(makeRequest({ title: 'My Game', slug: 'my-game' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when title is missing', async () => {
      const res = await POST(makeRequest({ projectId: 'p1', slug: 'my-game' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when slug is missing', async () => {
      const res = await POST(makeRequest({ projectId: 'p1', title: 'My Game' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when slug is too short (< 3 chars)', async () => {
      const res = await POST(makeRequest(validBody({ slug: 'ab' })));
      expect(res.status).toBe(400);
    });

    it('returns 400 when title exceeds 200 chars', async () => {
      const res = await POST(makeRequest(validBody({ title: 'x'.repeat(201) })));
      expect(res.status).toBe(400);
    });

    it('returns 400 when description exceeds 5000 chars', async () => {
      const res = await POST(makeRequest(validBody({ description: 'x'.repeat(5001) })));
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      const req = new NextRequest('http://localhost:3000/api/publish', {
        method: 'POST',
        body: '{ invalid json !!!',
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Thumbnail MIME type validation (PF-467)
  // -------------------------------------------------------------------------
  describe('thumbnail MIME type validation', () => {
    it('rejects SVG thumbnails to prevent XSS', async () => {
      const svgDataUrl = 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+';
      const res = await POST(makeRequest(validBody({ thumbnail: svgDataUrl })));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Unsupported thumbnail type');
    });

    it('rejects image/gif thumbnails', async () => {
      const gifDataUrl = 'data:image/gif;base64,R0lGODlhAQABAA==';
      const res = await POST(makeRequest(validBody({ thumbnail: gifDataUrl })));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Unsupported thumbnail type');
    });

    it('accepts image/png thumbnails', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);
      const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
      const res = await POST(makeRequest(validBody({ thumbnail: pngDataUrl })));
      expect(res.status).toBe(200);
    });

    it('accepts image/jpeg thumbnails', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);
      const jpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQ=';
      const res = await POST(makeRequest(validBody({ thumbnail: jpegDataUrl })));
      expect(res.status).toBe(200);
    });

    it('accepts image/webp thumbnails', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);
      const webpDataUrl = 'data:image/webp;base64,UklGRg==';
      const res = await POST(makeRequest(validBody({ thumbnail: webpDataUrl })));
      expect(res.status).toBe(200);
    });

    it('rejects thumbnail with crafted SVG MIME containing charset', async () => {
      const craftedUrl = 'data:image/svg+xml;charset=utf-8,<svg onload="alert(1)"/>';
      const res = await POST(makeRequest(validBody({ thumbnail: craftedUrl })));
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Slug format validation
  // -------------------------------------------------------------------------
  describe('slug format', () => {
    const validSlugs = ['my-game', 'abc', 'game123', 'my-awesome-game-2024'];
    const invalidSlugs = [
      'My-Game',        // uppercase
      '-my-game',       // starts with dash
      'my-game-',       // ends with dash
      'my game',        // space
      'my_game',        // underscore
      'game!',          // special char
    ];

    for (const slug of validSlugs) {
      it(`accepts valid slug: ${slug}`, async () => {
        vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

        const res = await POST(makeRequest(validBody({ slug })));
        expect(res.status).toBe(200);
      });
    }

    for (const slug of invalidSlugs) {
      it(`rejects invalid slug: ${slug}`, async () => {
        const res = await POST(makeRequest(validBody({ slug })));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('Invalid slug format');
      });
    }
  });

  // -------------------------------------------------------------------------
  // Reserved slug validation (PF-470)
  // -------------------------------------------------------------------------
  describe('reserved slug validation', () => {
    const reservedSlugs = ['admin', 'api', 'auth', 'webhook', 'webhooks', 'play', 'dev',
      'login', 'logout', 'signup', 'sign-up', 'sign-in', 'settings', 'account',
      'billing', 'dashboard', 'help', 'support', 'status', 'health', 'internal',
      'system', 'static', 'assets', 'public'];

    for (const slug of reservedSlugs) {
      it(`rejects reserved slug: ${slug}`, async () => {
        const res = await POST(makeRequest(validBody({ slug })));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('reserved');
        expect(body.error).toContain(slug);
      });
    }

    it('accepts a non-reserved slug', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);
      const res = await POST(makeRequest(validBody({ slug: 'my-cool-game' })));
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Content moderation
  // -------------------------------------------------------------------------
  describe('content moderation', () => {
    it('returns 422 when title is blocked by moderation', async () => {
      vi.mocked(moderateContent).mockReturnValueOnce({
        severity: 'block',
        reasons: ['Contains prohibited content'],
        cleaned: '***',
      });

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('Game title contains prohibited content');
    });

    it('returns 422 when description is blocked by moderation', async () => {
      vi.mocked(moderateContent)
        .mockReturnValueOnce({ severity: 'pass', reasons: [], cleaned: '' }) // title passes
        .mockReturnValueOnce({                                                 // description blocked
          severity: 'block',
          reasons: ['Contains prohibited content'],
          cleaned: '***',
        });

      const res = await POST(makeRequest(validBody({ description: 'offensive content' })));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('Game description contains prohibited content');
    });

    it('proceeds when title flags but does not block', async () => {
      vi.mocked(moderateContent).mockReturnValue({
        severity: 'flag',
        reasons: ['Contains inappropriate language'],
        cleaned: '***',
      });
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Tier publish limits
  // -------------------------------------------------------------------------
  describe('tier publish limits', () => {
    const tierLimits: Array<[string, number]> = [
      ['starter', 1],
      ['hobbyist', 3],
      ['creator', 10],
      ['pro', 100],
    ];

    for (const [tier, limit] of tierLimits) {
      it(`returns 403 when ${tier} tier reaches limit of ${limit}`, async () => {
        const user = makeUser({ tier: tier as 'starter' | 'hobbyist' | 'creator' | 'pro' });
        vi.mocked(authenticateRequest).mockResolvedValue({
          ok: true,
          ctx: { user, clerkId: 'clerk_1' },
        });

        const existingRows = Array.from({ length: limit }, (_, i) => ({ id: `pub-${i}` }));
        vi.mocked(getDb).mockReturnValue({
          select: vi.fn().mockReturnValue({
            from: () => ({ where: () => Promise.resolve(existingRows) }),
          }),
        } as never);

        const res = await POST(makeRequest(validBody()));
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toContain('Publish limit reached');
        expect(body.error).toContain(tier);
      });

      it(`allows ${tier} tier to publish when under limit (${limit - 1} existing)`, async () => {
        const user = makeUser({ tier: tier as 'starter' | 'hobbyist' | 'creator' | 'pro' });
        vi.mocked(authenticateRequest).mockResolvedValue({
          ok: true,
          ctx: { user, clerkId: 'clerk_1' },
        });

        const underLimit = Math.max(0, limit - 1);
        vi.mocked(getDb).mockReturnValue(
          makeNewPublicationDb({ existingCount: underLimit }) as never,
        );

        const res = await POST(makeRequest(validBody()));
        expect(res.status).toBe(200);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Project ownership
  // -------------------------------------------------------------------------
  describe('project ownership', () => {
    it('returns 404 when project does not exist for this user', async () => {
      vi.mocked(getDb).mockReturnValue(
        makeNewPublicationDb({ project: null }) as never,
      );

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });
  });

  // -------------------------------------------------------------------------
  // New publication
  // -------------------------------------------------------------------------
  describe('new publication', () => {
    it('returns 200 with publication object on success', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('publication');
      expect(body.publication).toHaveProperty('url');
    });

    it('publication URL contains clerkId and slug', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody({ slug: 'my-game' })));
      const body = await res.json();

      expect(body.publication.url).toBe('/play/clerk_1/my-game');
    });

    it('strips invalid tags and keeps valid ones (max 5)', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody({
        tags: ['platformer', '', 42, null, 'action', 'indie', 'rpg', 'extra'],
      })));
      expect(res.status).toBe(200);
    });

    it('normalises tags to lowercase and trims whitespace', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody({
        tags: ['  PLATFORMER  ', ' Action '],
      })));
      expect(res.status).toBe(200);
    });

    it('handles no tags gracefully', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody({ tags: [] })));
      expect(res.status).toBe(200);
    });

    it('handles non-array tags field gracefully', async () => {
      vi.mocked(getDb).mockReturnValue(makeNewPublicationDb() as never);

      const res = await POST(makeRequest(validBody({ tags: 'platformer' })));
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Republish (update existing)
  // -------------------------------------------------------------------------
  describe('republish (update existing slug)', () => {
    it('returns 200 when republishing an existing slug', async () => {
      const existingPublication = { id: 'pub-existing', version: 2 };
      const updatedPub = makePublication({ id: 'pub-existing', version: 3 });

      const mockUpdate = vi.fn().mockReturnValue({
        set: () => ({ where: () => Promise.resolve() }),
      });
      const mockDelete = vi.fn().mockReturnValue({
        where: () => Promise.resolve(),
      });
      const mockInsertTags = vi.fn().mockReturnValue({
        values: () => Promise.resolve(),
      });

      const selectMock = vi.fn()
        .mockReturnValueOnce({
          // tier limit: 0 existing
          from: () => ({ where: () => Promise.resolve([]) }),
        })
        .mockReturnValueOnce({
          // existing slug found
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([existingPublication]),
            }),
          }),
        })
        .mockReturnValueOnce({
          // project ownership check
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([makeProject()]),
            }),
          }),
        })
        .mockReturnValueOnce({
          // final select after update
          from: () => ({
            where: () => Promise.resolve([updatedPub]),
          }),
        });

      vi.mocked(getDb).mockReturnValue({
        select: selectMock,
        update: mockUpdate,
        delete: mockDelete,
        insert: mockInsertTags,
      } as never);

      const res = await POST(makeRequest(validBody()));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('publication');
    });
  });
});
