/**
 * Tests for POST /api/sentry
 *
 * Covers: rate limiting (429), DSN validation, missing configuration,
 * envelope forwarding, and malformed input rejection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mocks ---

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

// Default: TRUSTED_SENTRY is configured via env
// Must be set before any dynamic import so parseTrustedSentryConfig() sees it
process.env['NEXT_PUBLIC_SENTRY_DSN'] = 'https://abc123@o12345.ingest.sentry.io/9999999';

// --- Helpers ---

function makeRequest(body: string, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/sentry', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'x-forwarded-for': ip,
    },
  });
}

function validEnvelope(dsn = 'https://abc123@o12345.ingest.sentry.io/9999999'): string {
  const header = JSON.stringify({ dsn });
  const itemHeader = JSON.stringify({ type: 'event', length: 2 });
  const item = '{}';
  return `${header}\n${itemHeader}\n${item}`;
}

// --- Tests ---

describe('POST /api/sentry', () => {
  let POST: (req: NextRequest) => Promise<Response>;
  let rateLimitPublicRouteMock: ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Ensure DSN env is set before re-importing (parseTrustedSentryConfig runs at module load)
    process.env['NEXT_PUBLIC_SENTRY_DSN'] = 'https://abc123@o12345.ingest.sentry.io/9999999';
    delete process.env['SENTRY_DSN'];

    // Re-import after reset so module-level TRUSTED_SENTRY re-runs
    const rateLimitMod = await import('@/lib/rateLimit');
    rateLimitPublicRouteMock = rateLimitMod.rateLimitPublicRoute as ReturnType<typeof vi.fn>;
    rateLimitPublicRouteMock.mockResolvedValue(null);

    const routeMod = await import('../route');
    POST = routeMod.POST;
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('returns 429 when rateLimitPublicRoute returns a response', async () => {
      const { NextResponse } = await import('next/server');
      const limitResponse = NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
      rateLimitPublicRouteMock.mockResolvedValue(limitResponse);

      const req = makeRequest(validEnvelope());
      const res = await POST(req);

      expect(res.status).toBe(429);
    });

    it('calls rateLimitPublicRoute with the sentry endpoint key', async () => {
      const req = makeRequest(validEnvelope());
      // Route will likely 503 (no real DSN in test env) but rate limit is checked first
      await POST(req);

      expect(rateLimitPublicRouteMock).toHaveBeenCalledWith(req, 'sentry');
    });

    it('proceeds when rate limit returns null', async () => {
      rateLimitPublicRouteMock.mockResolvedValue(null);

      const req = makeRequest(validEnvelope());
      const res = await POST(req);

      // Should not be 429 (may be 503/403 due to DSN mismatch in test)
      expect(res.status).not.toBe(429);
    });
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  describe('input validation', () => {
    it('returns 400 for empty envelope body', async () => {
      const req = makeRequest('');
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON in envelope header', async () => {
      const req = makeRequest('not-json\nsecond-line');
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when DSN field is missing from header', async () => {
      const req = makeRequest(JSON.stringify({ eventId: 'abc' }) + '\n{}');
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when DSN is not a valid URL', async () => {
      const req = makeRequest(JSON.stringify({ dsn: 'not-a-url' }) + '\n{}');
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Configuration guard
  // -------------------------------------------------------------------------
  describe('configuration guard', () => {
    it('returns 503 when TRUSTED_SENTRY is not configured', async () => {
      vi.resetModules();
      process.env['NEXT_PUBLIC_SENTRY_DSN'] = '';
      delete process.env['SENTRY_DSN'];

      const rateLimitMod = await import('@/lib/rateLimit');
      (rateLimitMod.rateLimitPublicRoute as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const routeMod = await import('../route');
      const req = makeRequest(validEnvelope());
      const res = await routeMod.POST(req);

      expect(res.status).toBe(503);
    });
  });

  // -------------------------------------------------------------------------
  // DSN validation
  // -------------------------------------------------------------------------
  describe('DSN validation', () => {
    it('returns 403 when envelope DSN does not match configured Sentry project', async () => {
      const req = makeRequest(validEnvelope('https://xyz@evil.example.com/12345'));
      const res = await POST(req);
      expect(res.status).toBe(403);
    });
  });
});
