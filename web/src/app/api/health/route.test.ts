import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('should return ok status with environment info', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'test');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc12345def');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    // No DATABASE_URL set, so DB should be 'not_configured'

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.environment).toBe('test');
    expect(body.commit).toBe('abc12345');
    expect(body.branch).toBe('main');
    expect(body.database).toBe('not_configured');
    expect(body.timestamp).toBeDefined();
  });

  it('should use defaults when env vars not set', async () => {
    delete process.env.NEXT_PUBLIC_ENVIRONMENT;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_REF;
    delete process.env.DATABASE_URL;

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.commit).toBe('local');
    expect(body.branch).toBe('unknown');
  });
});
