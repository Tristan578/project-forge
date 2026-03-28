vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';
import { moderateContent } from '@/lib/moderation/contentFilter';
import { containsBlockedKeyword } from '@/lib/moderation/keywords';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  gameComments: { id: 'id', gameId: 'gameId', userId: 'userId', content: 'content', parentId: 'parentId', createdAt: 'createdAt', flagged: 'flagged' },
  users: { id: 'id', displayName: 'displayName' },
}));
vi.mock('@/lib/moderation/contentFilter', () => ({
  moderateContent: vi.fn(() => ({ severity: 'pass', reasons: [], cleaned: '' })),
}));
vi.mock('@/lib/moderation/keywords', () => ({
  containsBlockedKeyword: vi.fn(() => false),
}));

function mockDbChain(data: unknown[] = []) {
  const resolver = vi.fn().mockResolvedValue(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ['from', 'leftJoin', 'where', 'groupBy', 'orderBy', 'limit', 'offset']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => resolver().then(resolve, reject);
  return chain;
}

describe('GET /api/community/games/[id]/comment', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should return comments list', async () => {
    const commentsData = [
      { id: 'c1', content: 'Great!', parentId: null, createdAt: new Date('2025-01-01'), authorId: 'u1', authorName: 'User1' },
    ];
    const mockDb = {
      select: vi.fn().mockReturnValue(mockDbChain(commentsData)),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment');
    const res = await GET(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].content).toBe('Great!');
  });

  it('should return 500 on error', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB error'); });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment');
    const res = await GET(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(500);
  });
});

describe('POST /api/community/games/[id]/comment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator', displayName: 'Test' } as never },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60000 });
    // getDb() is called at the top of the try block
    const mockDb = { select: vi.fn().mockReturnValue(mockDbChain([])), insert: vi.fn() };
    vi.mocked(getDb).mockReturnValue(mockDb as never);
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment', {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment', {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(429);
  });

  it('should return 400 when content is missing', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Content is required');
  });

  it('should return 400 for empty content after sanitization', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment', {
      method: 'POST',
      body: JSON.stringify({ content: '<>' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Comment cannot be empty');
  });

  it('should create comment and return 201', async () => {
    const newComment = { id: 'c-new', content: 'Nice game', parentId: null, createdAt: new Date('2025-01-01') };
    const authorData = [{ displayName: 'TestUser' }];

    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([newComment]),
      }),
      select: vi.fn().mockReturnValue(mockDbChain(authorData)),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment', {
      method: 'POST',
      body: JSON.stringify({ content: 'Nice game' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.comment.content).toBe('Nice game');
    expect(body.comment.authorName).toBe('TestUser');
  });
});

describe('POST /api/community/games/[id]/comment — auto-flagging', () => {
  // Capture the `values` call argument so we can inspect the flagged field
  let capturedValues: Record<string, unknown> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedValues = null;

    // Default auth + rate-limit for this describe block
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator', displayName: 'Test' } as never },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60000 });

    // Default DB: captures the values argument so tests can assert on flagged
    const selectChain = mockDbChain([{ displayName: 'Test' }]);
    vi.mocked(getDb).mockReturnValue({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
          capturedValues = vals;
          return {
            returning: vi.fn().mockResolvedValue([{
              id: 'c1', content: 'text', parentId: null, createdAt: new Date(),
            }]),
          };
        }),
      }),
      select: vi.fn().mockReturnValue(selectChain),
    } as never);
  });

  it('sets flagged=1 when contentFilter returns severity=flag', async () => {
    vi.mocked(moderateContent).mockReturnValue({ severity: 'flag', reasons: [], cleaned: '' });
    vi.mocked(containsBlockedKeyword).mockReturnValue(false);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment', {
      method: 'POST',
      body: JSON.stringify({ content: 'bad text' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(201);
    expect(capturedValues?.flagged).toBe(1);
  });

  it('sets flagged=1 when keyword blocklist matches', async () => {
    vi.mocked(moderateContent).mockReturnValue({ severity: 'pass', reasons: [], cleaned: '' });
    vi.mocked(containsBlockedKeyword).mockReturnValue(true);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment', {
      method: 'POST',
      body: JSON.stringify({ content: 'spam text' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(201);
    expect(capturedValues?.flagged).toBe(1);
  });

  it('sets flagged=0 for clean content with no keyword hits', async () => {
    vi.mocked(moderateContent).mockReturnValue({ severity: 'pass', reasons: [], cleaned: '' });
    vi.mocked(containsBlockedKeyword).mockReturnValue(false);

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/community/games/game-1/comment', {
      method: 'POST',
      body: JSON.stringify({ content: 'clean text' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'game-1' }) });

    expect(res.status).toBe(201);
    expect(capturedValues?.flagged).toBe(0);
  });
});
