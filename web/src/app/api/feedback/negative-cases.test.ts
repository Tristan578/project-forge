vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateClerkSession } from '@/lib/auth/api-auth';
import { getUserByClerkId } from '@/lib/auth/user-service';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/auth/user-service');
vi.mock('@/lib/rateLimit/distributed');
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  feedback: { id: 'id', userId: 'userId', type: 'type', description: 'description', metadata: 'metadata' },
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

const BASE_URL = 'http://localhost:3000/api/feedback';

function makeReq(body: string) {
  return new NextRequest(BASE_URL, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupAuth() {
  vi.mocked(authenticateClerkSession).mockResolvedValue({
    ok: true as const,
    clerkId: 'clerk_1',
  });
  vi.mocked(getUserByClerkId).mockResolvedValue({ id: 'user_1' } as never);
  vi.mocked(distributedRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: Date.now() + 60000,
  });
}

function setupDb() {
  const mockDb = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'fb-1' }]),
    }),
  };
  vi.mocked(getDb).mockReturnValue(mockDb as never);
}

describe('PF-675: Negative cases for /api/feedback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupAuth();
    setupDb();
  });

  describe('malformed request body', () => {
    it('returns 400 for non-JSON body', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest(BASE_URL, {
        method: 'POST',
        body: 'this is not json',
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('Invalid JSON');
    });

    it('returns 400 for empty body', async () => {
      const { POST } = await import('./route');
      const req = new NextRequest(BASE_URL, {
        method: 'POST',
        body: '',
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  describe('schema validation', () => {
    it('returns 422 for missing type field', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ description: 'Long enough description for test' })));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 422 for type not in enum', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        type: 'complaint',
        description: 'Long enough description for test',
      })));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 422 for description shorter than 10 chars', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ type: 'bug', description: 'short' })));

      expect(res.status).toBe(422);
    });

    it('returns 422 for description longer than 5000 chars', async () => {
      const { POST } = await import('./route');
      const longDesc = 'A'.repeat(5001);
      const res = await POST(makeReq(JSON.stringify({ type: 'bug', description: longDesc })));

      expect(res.status).toBe(422);
    });

    it('returns 422 for whitespace-only description (trimmed to empty)', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ type: 'bug', description: '         ' })));

      expect(res.status).toBe(422);
    });

    it('returns 422 when description is null', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ type: 'bug', description: null })));

      expect(res.status).toBe(422);
    });

    it('returns 422 when description is a number', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({ type: 'bug', description: 42 })));

      expect(res.status).toBe(422);
    });

    it('returns 422 when body is an array instead of object', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify([{ type: 'bug', description: 'This is an array' }])));

      expect(res.status).toBe(422);
    });
  });

  describe('service errors', () => {
    it('returns 500 when DB insert throws', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockRejectedValue(new Error('unique constraint violation')),
        }),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        type: 'bug',
        description: 'Something is broken in the editor panel',
      })));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('Failed to submit');
    });

    it('does not leak DB error details to client', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockRejectedValue(
            new Error('relation "feedback" does not exist')
          ),
        }),
      };
      vi.mocked(getDb).mockReturnValue(mockDb as never);

      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        type: 'feature',
        description: 'I want a new feature in the editor',
      })));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).not.toContain('relation');
      expect(body.error).not.toContain('does not exist');
    });
  });

  describe('HTML/script injection in valid fields', () => {
    it('accepts HTML in description (stored as-is, rendering layer escapes)', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        type: 'bug',
        description: '<script>alert("xss")</script> This has HTML content in it',
      })));
      const body = await res.json();

      // The route stores raw text; XSS prevention is the rendering layer's job.
      // This test verifies the API doesn't reject valid text containing angle brackets.
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('accepts metadata with nested objects', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeReq(JSON.stringify({
        type: 'general',
        description: 'Feedback with complex metadata object',
        metadata: {
          browser: 'Chrome 130',
          viewport: { width: 1920, height: 1080 },
          nested: { deep: { value: true } },
        },
      })));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });
});
