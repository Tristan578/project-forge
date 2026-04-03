import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

describe('healthChecks', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // ---------------------------------------------------------------------------
  // computeOverallStatus
  // ---------------------------------------------------------------------------
  describe('computeOverallStatus', () => {
    it('returns healthy when all services are healthy', async () => {
      const { computeOverallStatus } = await import('@/lib/monitoring/healthChecks');
      const services = [
        { name: 'A', status: 'healthy' as const, latencyMs: 1, lastChecked: '' },
        { name: 'B', status: 'healthy' as const, latencyMs: 2, lastChecked: '' },
      ];
      expect(computeOverallStatus(services)).toBe('healthy');
    });

    it('returns degraded when any service is degraded', async () => {
      const { computeOverallStatus } = await import('@/lib/monitoring/healthChecks');
      const services = [
        { name: 'A', status: 'healthy' as const, latencyMs: 1, lastChecked: '' },
        { name: 'B', status: 'degraded' as const, latencyMs: 2, lastChecked: '' },
      ];
      expect(computeOverallStatus(services)).toBe('degraded');
    });

    it('returns down when any service is down', async () => {
      const { computeOverallStatus } = await import('@/lib/monitoring/healthChecks');
      const services = [
        { name: 'A', status: 'healthy' as const, latencyMs: 1, lastChecked: '' },
        { name: 'B', status: 'degraded' as const, latencyMs: 2, lastChecked: '' },
        { name: 'C', status: 'down' as const, latencyMs: 0, lastChecked: '' },
      ];
      expect(computeOverallStatus(services)).toBe('down');
    });

    it('returns down over degraded when both present', async () => {
      const { computeOverallStatus } = await import('@/lib/monitoring/healthChecks');
      const services = [
        { name: 'A', status: 'down' as const, latencyMs: 0, lastChecked: '' },
        { name: 'B', status: 'degraded' as const, latencyMs: 1, lastChecked: '' },
      ];
      expect(computeOverallStatus(services)).toBe('down');
    });
  });

  // ---------------------------------------------------------------------------
  // computeCriticalStatus
  // ---------------------------------------------------------------------------
  describe('computeCriticalStatus', () => {
    it('returns healthy when critical services are healthy regardless of optional', async () => {
      const { computeCriticalStatus } = await import('@/lib/monitoring/healthChecks');
      const services = [
        { name: 'Database (Neon)', status: 'healthy' as const, latencyMs: 5, lastChecked: '' },
        { name: 'Clerk', status: 'healthy' as const, latencyMs: 10, lastChecked: '' },
        { name: 'AI Providers', status: 'down' as const, latencyMs: 0, lastChecked: '' },
      ];
      expect(computeCriticalStatus(services)).toBe('healthy');
    });

    it('returns down when DB is down', async () => {
      const { computeCriticalStatus } = await import('@/lib/monitoring/healthChecks');
      const services = [
        { name: 'Database (Neon)', status: 'down' as const, latencyMs: 0, lastChecked: '' },
        { name: 'AI Providers', status: 'healthy' as const, latencyMs: 0, lastChecked: '' },
      ];
      expect(computeCriticalStatus(services)).toBe('down');
    });
  });

  // ---------------------------------------------------------------------------
  // sanitizeForPublic
  // ---------------------------------------------------------------------------
  describe('sanitizeForPublic', () => {
    it('strips error details and replaces with generic message', async () => {
      const { sanitizeForPublic } = await import('@/lib/monitoring/healthChecks');
      const services = [
        { name: 'Database (Neon)', status: 'down' as const, latencyMs: 0, lastChecked: '', error: 'connection refused at 10.0.0.1', details: { url: 'postgresql://secret' } },
      ];
      const sanitized = sanitizeForPublic(services);
      expect(sanitized[0].error).toBe('Database (Neon) is down');
      expect(sanitized[0].details).toBeUndefined();
    });

    it('leaves healthy services without error unchanged', async () => {
      const { sanitizeForPublic } = await import('@/lib/monitoring/healthChecks');
      const services = [
        { name: 'Engine CDN', status: 'healthy' as const, latencyMs: 12, lastChecked: '' },
      ];
      const sanitized = sanitizeForPublic(services);
      expect(sanitized[0].error).toBeUndefined();
      expect(sanitized[0].details).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // checkDatabase
  // ---------------------------------------------------------------------------
  describe('checkDatabase', () => {
    it('returns degraded when DATABASE_URL not configured', async () => {
      vi.resetModules();
      const { checkDatabase } = await import('@/lib/monitoring/healthChecks');
      const result = await checkDatabase();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('DATABASE_URL not configured');
      expect(result.name).toBe('Database (Neon)');
    });

    it('returns healthy when SELECT 1 succeeds', async () => {
      vi.resetModules();
      vi.stubEnv('DATABASE_URL', 'postgresql://test');

      const mockSql = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
      const mockNeon = vi.fn().mockReturnValue(mockSql);
      vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }));

      const { checkDatabase } = await import('@/lib/monitoring/healthChecks');
      const result = await checkDatabase();

      expect(result.status).toBe('healthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.name).toBe('Database (Neon)');
    });

    it('returns down when database query throws', async () => {
      vi.resetModules();
      vi.stubEnv('DATABASE_URL', 'postgresql://test');

      const mockSql = vi.fn().mockRejectedValue(new Error('connection refused'));
      const mockNeon = vi.fn().mockReturnValue(mockSql);
      vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }));

      const { checkDatabase } = await import('@/lib/monitoring/healthChecks');
      const result = await checkDatabase();

      expect(result.status).toBe('down');
      expect(result.error).toBe('connection refused');
    });

    it('returns down on timeout', async () => {
      vi.resetModules();
      vi.useFakeTimers();
      vi.stubEnv('DATABASE_URL', 'postgresql://test');

      const mockSql = vi.fn().mockImplementation(
        () => new Promise((_resolve) => { /* never resolves */ }),
      );
      const mockNeon = vi.fn().mockReturnValue(mockSql);
      vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }));

      const { checkDatabase } = await import('@/lib/monitoring/healthChecks');

      const promise = checkDatabase();
      vi.advanceTimersByTime(6_000);
      const result = await promise;

      expect(result.status).toBe('down');
      expect(result.error).toContain('timed out');

      vi.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // checkPayments
  // ---------------------------------------------------------------------------
  describe('checkPayments', () => {
    it('returns down when STRIPE_SECRET_KEY not set', async () => {
      vi.resetModules();
      const { checkPayments } = await import('@/lib/monitoring/healthChecks');
      const result = await checkPayments();
      expect(result.status).toBe('down');
      expect(result.error).toContain('STRIPE_SECRET_KEY not configured');
    });

    it('returns healthy when STRIPE_SECRET_KEY is set', async () => {
      vi.resetModules();
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
      const { checkPayments } = await import('@/lib/monitoring/healthChecks');
      const result = await checkPayments();
      expect(result.status).toBe('healthy');
      expect(result.details?.secretKeyConfigured).toBe(true);
    });

    it('reports webhook secret presence in details', async () => {
      vi.resetModules();
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_xyz');
      const { checkPayments } = await import('@/lib/monitoring/healthChecks');
      const result = await checkPayments();
      expect(result.details?.webhookSecretConfigured).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // checkErrorTracking
  // ---------------------------------------------------------------------------
  describe('checkErrorTracking', () => {
    it('returns degraded when DSN not configured', async () => {
      vi.resetModules();
      const { checkErrorTracking } = await import('@/lib/monitoring/healthChecks');
      const result = await checkErrorTracking();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('not configured');
    });

    it('returns healthy when NEXT_PUBLIC_SENTRY_DSN is set', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://abc@sentry.io/123');
      const { checkErrorTracking } = await import('@/lib/monitoring/healthChecks');
      const result = await checkErrorTracking();
      expect(result.status).toBe('healthy');
    });

    it('returns healthy when SENTRY_DSN fallback is set', async () => {
      vi.resetModules();
      vi.stubEnv('SENTRY_DSN', 'https://abc@sentry.io/123');
      const { checkErrorTracking } = await import('@/lib/monitoring/healthChecks');
      const result = await checkErrorTracking();
      expect(result.status).toBe('healthy');
    });
  });

  // ---------------------------------------------------------------------------
  // checkAssetStorage
  // ---------------------------------------------------------------------------
  describe('checkAssetStorage', () => {
    it('returns down when no R2 vars configured', async () => {
      vi.resetModules();
      const { checkAssetStorage } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAssetStorage();
      expect(result.status).toBe('down');
    });

    it('returns degraded when only some R2 vars are present', async () => {
      vi.resetModules();
      vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct_abc');
      const { checkAssetStorage } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAssetStorage();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('partially configured');
    });

    it('returns healthy when all R2 vars are present', async () => {
      vi.resetModules();
      vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct_abc');
      vi.stubEnv('R2_ACCESS_KEY_ID', 'key123');
      vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret456');
      vi.stubEnv('R2_BUCKET_NAME', 'spawnforge-assets');
      const { checkAssetStorage } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAssetStorage();
      expect(result.status).toBe('healthy');
    });
  });

  // ---------------------------------------------------------------------------
  // checkRateLimiting
  // ---------------------------------------------------------------------------
  describe('checkRateLimiting', () => {
    it('returns degraded when Upstash vars not set', async () => {
      vi.resetModules();
      const { checkRateLimiting } = await import('@/lib/monitoring/healthChecks');
      const result = await checkRateLimiting();
      expect(result.status).toBe('degraded');
    });

    it('returns healthy when Upstash vars are set', async () => {
      vi.resetModules();
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token_abc');
      const { checkRateLimiting } = await import('@/lib/monitoring/healthChecks');
      const result = await checkRateLimiting();
      expect(result.status).toBe('healthy');
    });
  });

  // ---------------------------------------------------------------------------
  // checkEngineCdn
  // ---------------------------------------------------------------------------
  describe('checkEngineCdn', () => {
    it('returns degraded when CDN URL not configured', async () => {
      vi.resetModules();
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('not configured');
    });

    it('returns healthy when CDN responds with 2xx/3xx/4xx (not 5xx)', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', 'https://engine.spawnforge.ai');

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();

      expect(result.status).toBe('healthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns degraded when CDN returns 500', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', 'https://engine.spawnforge.ai');

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();

      expect(result.status).toBe('degraded');
      expect(result.error).toContain('503');
    });

    it('returns degraded when CDN request throws', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', 'https://engine.spawnforge.ai');

      const mockFetch = vi.fn().mockRejectedValue(new Error('network failure'));
      vi.stubGlobal('fetch', mockFetch);

      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();

      expect(result.status).toBe('degraded');
      expect(result.error).toBe('network failure');
    });
  });

  // ---------------------------------------------------------------------------
  // checkAiProviders
  // ---------------------------------------------------------------------------
  describe('checkAiProviders', () => {
    it('returns down when no provider keys configured', async () => {
      vi.resetModules();
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('down');
      expect(result.details?.configuredCount).toBe(0);
    });

    it('returns degraded when some provider keys configured', async () => {
      vi.resetModules();
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-abc');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('degraded');
      expect(result.details?.configuredCount).toBe(1);
    });

    it('returns healthy when all provider keys configured', async () => {
      vi.resetModules();
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-abc');
      vi.stubEnv('MESHY_API_KEY', 'meshy_abc');
      vi.stubEnv('ELEVENLABS_API_KEY', 'el_abc');
      vi.stubEnv('SUNO_API_KEY', 'suno_abc');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('healthy');
      expect(result.details?.configuredCount).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // checkClerk
  // ---------------------------------------------------------------------------
  describe('checkClerk', () => {
    it('returns degraded when Clerk keys not configured', async () => {
      vi.resetModules();
      const { checkClerk } = await import('@/lib/monitoring/healthChecks');
      const result = await checkClerk();
      expect(result.name).toBe('Clerk');
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('not configured');
      expect(result.details?.publishableKeyConfigured).toBe(false);
      expect(result.details?.secretKeyConfigured).toBe(false);
    });

    it('returns degraded when only publishable key is set', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_abc');
      const { checkClerk } = await import('@/lib/monitoring/healthChecks');
      const result = await checkClerk();
      expect(result.status).toBe('degraded');
    });

    it('returns healthy when both keys are set and JWKS endpoint responds', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_abc');
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_abc');

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkClerk } = await import('@/lib/monitoring/healthChecks');
      const result = await checkClerk();

      expect(result.status).toBe('healthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.details?.configured).toBe(true);
    });

    it('accepts 405 as a healthy response (HEAD not supported)', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_abc');
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_abc');

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 405 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkClerk } = await import('@/lib/monitoring/healthChecks');
      const result = await checkClerk();

      expect(result.status).toBe('healthy');
    });

    it('returns degraded when JWKS endpoint returns non-200 non-405', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_abc');
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_abc');

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkClerk } = await import('@/lib/monitoring/healthChecks');
      const result = await checkClerk();

      expect(result.status).toBe('degraded');
      expect(result.error).toContain('503');
    });

    it('returns degraded when JWKS fetch throws', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_abc');
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_abc');

      const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
      vi.stubGlobal('fetch', mockFetch);

      const { checkClerk } = await import('@/lib/monitoring/healthChecks');
      const result = await checkClerk();

      expect(result.status).toBe('degraded');
      expect(result.error).toBe('network error');
    });
  });

  // ---------------------------------------------------------------------------
  // checkAnthropic
  // ---------------------------------------------------------------------------
  describe('checkAnthropic', () => {
    it('returns degraded when ANTHROPIC_API_KEY not set', async () => {
      vi.resetModules();
      const { checkAnthropic } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAnthropic();
      expect(result.name).toBe('Anthropic');
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('ANTHROPIC_API_KEY not configured');
      expect(result.details?.configured).toBe(false);
    });

    it('returns healthy when key is set and api.anthropic.com responds', async () => {
      vi.resetModules();
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkAnthropic } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAnthropic();

      expect(result.status).toBe('healthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.details?.configured).toBe(true);
    });

    it('accepts 4xx responses as healthy (host is reachable)', async () => {
      vi.resetModules();
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkAnthropic } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAnthropic();

      expect(result.status).toBe('healthy');
    });

    it('returns degraded when api.anthropic.com returns 5xx', async () => {
      vi.resetModules();
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkAnthropic } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAnthropic();

      expect(result.status).toBe('degraded');
      expect(result.error).toContain('503');
    });

    it('returns degraded when fetch throws', async () => {
      vi.resetModules();
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');

      const mockFetch = vi.fn().mockRejectedValue(new Error('DNS failure'));
      vi.stubGlobal('fetch', mockFetch);

      const { checkAnthropic } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAnthropic();

      expect(result.status).toBe('degraded');
      expect(result.error).toBe('DNS failure');
    });
  });

  // ---------------------------------------------------------------------------
  // checkSentry
  // ---------------------------------------------------------------------------
  describe('checkSentry', () => {
    it('returns degraded when no Sentry DSN configured', async () => {
      vi.resetModules();
      const { checkSentry } = await import('@/lib/monitoring/healthChecks');
      const result = await checkSentry();
      expect(result.name).toBe('Sentry');
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('not configured');
      expect(result.details?.configured).toBe(false);
    });

    it('returns healthy when NEXT_PUBLIC_SENTRY_DSN is well-formed', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://abc123@o123.ingest.sentry.io/456');
      const { checkSentry } = await import('@/lib/monitoring/healthChecks');
      const result = await checkSentry();
      expect(result.status).toBe('healthy');
      expect(result.details?.configured).toBe(true);
      expect(result.details?.wellFormed).toBe(true);
    });

    it('returns healthy when SENTRY_DSN fallback is well-formed', async () => {
      vi.resetModules();
      vi.stubEnv('SENTRY_DSN', 'https://xyz@sentry.io/789');
      const { checkSentry } = await import('@/lib/monitoring/healthChecks');
      const result = await checkSentry();
      expect(result.status).toBe('healthy');
    });

    it('returns degraded when DSN is malformed (no @)', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'not-a-valid-dsn');
      const { checkSentry } = await import('@/lib/monitoring/healthChecks');
      const result = await checkSentry();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('malformed');
      expect(result.details?.wellFormed).toBe(false);
    });

    it('returns degraded when DSN does not start with https://', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'http://abc@sentry.io/123');
      const { checkSentry } = await import('@/lib/monitoring/healthChecks');
      const result = await checkSentry();
      expect(result.status).toBe('degraded');
    });
  });

  // ---------------------------------------------------------------------------
  // checkCloudflareR2
  // ---------------------------------------------------------------------------
  describe('checkCloudflareR2', () => {
    it('returns down when no R2 env vars configured', async () => {
      vi.resetModules();
      const { checkCloudflareR2 } = await import('@/lib/monitoring/healthChecks');
      const result = await checkCloudflareR2();
      expect(result.name).toBe('Cloudflare R2');
      expect(result.status).toBe('down');
      expect(result.error).toContain('not configured');
    });

    it('returns degraded when only some R2 vars are present', async () => {
      vi.resetModules();
      vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct_abc');
      const { checkCloudflareR2 } = await import('@/lib/monitoring/healthChecks');
      const result = await checkCloudflareR2();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('partially configured');
      expect(result.details?.accountIdConfigured).toBe(true);
      expect(result.details?.accessKeyConfigured).toBe(false);
    });

    it('returns healthy when all R2 vars are present', async () => {
      vi.resetModules();
      vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct_abc');
      vi.stubEnv('R2_ACCESS_KEY_ID', 'key123');
      vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret456');
      vi.stubEnv('R2_BUCKET_NAME', 'spawnforge-assets');
      const { checkCloudflareR2 } = await import('@/lib/monitoring/healthChecks');
      const result = await checkCloudflareR2();
      expect(result.status).toBe('healthy');
      expect(result.details?.bucket).toBe('spawnforge-assets');
      expect(result.details?.accountIdConfigured).toBe(true);
      expect(result.details?.accessKeyConfigured).toBe(true);
      expect(result.details?.secretKeyConfigured).toBe(true);
      expect(result.details?.bucketNameConfigured).toBe(true);
    });

    it('returns degraded when 3 of 4 vars are present', async () => {
      vi.resetModules();
      vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct_abc');
      vi.stubEnv('R2_ACCESS_KEY_ID', 'key123');
      vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret456');
      // R2_BUCKET_NAME missing
      const { checkCloudflareR2 } = await import('@/lib/monitoring/healthChecks');
      const result = await checkCloudflareR2();
      expect(result.status).toBe('degraded');
      expect(result.details?.bucketNameConfigured).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // runAllHealthChecks
  // ---------------------------------------------------------------------------
  describe('runAllHealthChecks', () => {
    it('returns a HealthReport with all 9 services', async () => {
      vi.resetModules();

      // Minimal mocks: DB neon needs a mock even with no DATABASE_URL
      vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'test');
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234');

      const { runAllHealthChecks } = await import('@/lib/monitoring/healthChecks');
      const report = await runAllHealthChecks();

      expect(report.services).toHaveLength(10);
      expect(report.environment).toBe('test');
      expect(report.version).toBe('abcdef12');
      expect(report.timestamp).toBeDefined();
      expect(['healthy', 'degraded', 'down']).toContain(report.overall);
    });

    it('overall is down when DB is unavailable and no keys configured', async () => {
      vi.resetModules();
      const { runAllHealthChecks } = await import('@/lib/monitoring/healthChecks');
      const report = await runAllHealthChecks();
      // No DATABASE_URL → DB is degraded, but Stripe/AI are down → overall is down
      expect(report.overall).toBe('down');
    });
  });
});
