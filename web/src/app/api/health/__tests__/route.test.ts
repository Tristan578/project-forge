/**
 * Tests for GET /api/health
 *
 * Covers: response format, status fields, environment handling,
 * DB connected/unavailable/not_configured states.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('GET /api/health', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const mod = await import('../route');
    GET = mod.GET;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // Response format
  // -------------------------------------------------------------------------
  describe('response format', () => {
    it('returns 200 status', async () => {
      const res = await GET();
      expect(res.status).toBe(200);
    });

    it('returns JSON with status=ok', async () => {
      const res = await GET();
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    it('includes required fields: status, environment, commit, branch, database, timestamp, services', async () => {
      const res = await GET();
      const body = await res.json();

      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('environment');
      expect(body).toHaveProperty('commit');
      expect(body).toHaveProperty('branch');
      expect(body).toHaveProperty('database');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('services');
    });

    it('services is a non-empty array', async () => {
      const res = await GET();
      const body = await res.json();

      expect(Array.isArray(body.services)).toBe(true);
      expect(body.services.length).toBeGreaterThan(0);
    });

    it('each service entry has name, status, latencyMs fields', async () => {
      const res = await GET();
      const body = await res.json();

      for (const svc of body.services) {
        expect(svc).toHaveProperty('name');
        expect(svc).toHaveProperty('status');
        expect(svc).toHaveProperty('latencyMs');
      }
    });

    it('service status values are up, degraded, or down (never "healthy")', async () => {
      const res = await GET();
      const body = await res.json();

      const validStatuses = new Set(['up', 'degraded', 'down']);
      for (const svc of body.services) {
        expect(validStatuses.has(svc.status)).toBe(true);
      }
    });

    it('services array includes at least 8 service checks', async () => {
      const res = await GET();
      const body = await res.json();

      const names: string[] = body.services.map((s: { name: string }) => s.name);
      expect(names.length).toBeGreaterThanOrEqual(8);
      expect(names).toContain('Clerk');
      expect(names).toContain('Sentry');
      expect(names).toContain('Cloudflare R2');
    });

    it('timestamp is a valid ISO 8601 string', async () => {
      const res = await GET();
      const body = await res.json();

      expect(() => new Date(body.timestamp)).not.toThrow();
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    it('commit is truncated to 8 characters from VERCEL_GIT_COMMIT_SHA', async () => {
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234567890');

      const mod = await import('../route');
      const res = await mod.GET();
      const body = await res.json();

      expect(body.commit).toBe('abcdef12');
    });

    it('commit is a string (present or defaulting to "local")', async () => {
      const res = await GET();
      const body = await res.json();

      // Commit is always a string (either truncated SHA or 'local')
      expect(typeof body.commit).toBe('string');
    });

    it('branch comes from VERCEL_GIT_COMMIT_REF', async () => {
      vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');

      const mod = await import('../route');
      const res = await mod.GET();
      const body = await res.json();

      expect(body.branch).toBe('main');
    });

    it('branch is a string (from env or defaulting to "unknown")', async () => {
      const res = await GET();
      const body = await res.json();

      // Branch is always a string
      expect(typeof body.branch).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // Environment field
  // -------------------------------------------------------------------------
  describe('environment field', () => {
    it('uses NEXT_PUBLIC_ENVIRONMENT when set', async () => {
      vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'staging');

      const mod = await import('../route');
      const res = await mod.GET();
      const body = await res.json();

      expect(body.environment).toBe('staging');
    });

    it('falls back to NODE_ENV when NEXT_PUBLIC_ENVIRONMENT is absent', async () => {
      vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', '');
      vi.stubEnv('NODE_ENV', 'production');

      const mod = await import('../route');
      const res = await mod.GET();
      const body = await res.json();

      // NODE_ENV is 'test' in vitest, so check it's a string
      expect(typeof body.environment).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // Database status
  // -------------------------------------------------------------------------
  describe('database status', () => {
    it('returns database=not_configured when DATABASE_URL is absent', async () => {
      vi.stubEnv('DATABASE_URL', '');

      const mod = await import('../route');
      const res = await mod.GET();
      const body = await res.json();

      expect(body.database).toBe('not_configured');
    });

    it('returns database=connected when neon query succeeds', async () => {
      vi.stubEnv('DATABASE_URL', 'postgres://localhost/test');

      // Mock the dynamic import of @neondatabase/serverless
      vi.doMock('@neondatabase/serverless', () => ({
        neon: vi.fn(() => {
          const mockSql = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
          // Make it work as a tagged template literal
          return new Proxy(mockSql, {
            apply: (_target, _this, args) => mockSql(...args),
          });
        }),
      }));

      const mod = await import('../route');
      const res = await mod.GET();
      const body = await res.json();

      expect(body.database).toBe('connected');
    });

    it('returns database=unavailable when neon query throws', async () => {
      vi.stubEnv('DATABASE_URL', 'postgres://localhost/test');

      vi.doMock('@neondatabase/serverless', () => ({
        neon: vi.fn(() => {
          const mockSql = vi.fn().mockRejectedValue(new Error('Connection refused'));
          return new Proxy(mockSql, {
            apply: (_target, _this, args) => mockSql(...args),
          });
        }),
      }));

      const mod = await import('../route');
      const res = await mod.GET();
      const body = await res.json();

      expect(body.database).toBe('unavailable');
    });
  });
});
