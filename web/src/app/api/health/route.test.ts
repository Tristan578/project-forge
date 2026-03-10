import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('should return ok status with environment info (backward-compatible)', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'test');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc12345def');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    // No DATABASE_URL set, so DB should be 'not_configured'

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBeLessThan(600); // any valid HTTP status
    expect(body.environment).toBe('test');
    expect(body.commit).toBe('abc12345');
    expect(body.branch).toBe('main');
    expect(body.timestamp).toBeDefined();
  });

  it('should use defaults when env vars not set', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(body.commit).toBe('local');
    expect(body.branch).toBe('unknown');
  });

  it('should include services array with 8 entries', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(body.services).toBeInstanceOf(Array);
    expect(body.services).toHaveLength(8);
    for (const service of body.services) {
      expect(service).toHaveProperty('name');
      expect(service).toHaveProperty('status');
      expect(service).toHaveProperty('latencyMs');
      expect(service).toHaveProperty('lastChecked');
      expect(['healthy', 'degraded', 'down']).toContain(service.status);
    }
  });

  it('should include overall status field', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(['healthy', 'degraded', 'down']).toContain(body.overall);
  });

  it('should return 503 when overall status is down', async () => {
    vi.resetModules();
    // No DATABASE_URL → DB is 'down' → overall is 'down' → HTTP 503
    const { GET } = await import('./route');
    const res = await GET();
    // No keys configured at all — DB is down
    expect(res.status).toBe(503);
  });

  it('should return 200 when all critical services healthy', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_abc');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_abc');

    // Mock neon to succeed
    const mockSql = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const mockNeon = vi.fn().mockReturnValue(mockSql);
    vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }));

    // Mock fetch for Clerk JWKS check
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    // Both critical services (DB + Auth) healthy → HTTP 200
    expect(body.database).toBe('connected');
    expect(res.status).toBe(200);
  });

  it('should report database as unavailable when DB throws', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://bad-url');

    const mockSql = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const mockNeon = vi.fn().mockReturnValue(mockSql);
    vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }));

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(body.database).toBe('unavailable');
  });

  it('should report database as not_configured when DATABASE_URL missing', async () => {
    vi.resetModules();
    // No DATABASE_URL
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(body.database).toBe('not_configured');
  });
});
