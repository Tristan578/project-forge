import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We import the module under test after stubbing env vars
// and mocking external deps in each test.

describe('healthChecks', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
  // checkDatabase
  // ---------------------------------------------------------------------------
  describe('checkDatabase', () => {
    it('returns down when DATABASE_URL not configured', async () => {
      vi.resetModules();
      const { checkDatabase } = await import('@/lib/monitoring/healthChecks');
      const result = await checkDatabase();
      expect(result.status).toBe('down');
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
  // runAllHealthChecks
  // ---------------------------------------------------------------------------
  describe('runAllHealthChecks', () => {
    it('returns a HealthReport with all 8 services', async () => {
      vi.resetModules();

      // Minimal mocks: DB neon needs a mock even with no DATABASE_URL
      vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'test');
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234');

      const { runAllHealthChecks } = await import('@/lib/monitoring/healthChecks');
      const report = await runAllHealthChecks();

      expect(report.services).toHaveLength(8);
      expect(report.environment).toBe('test');
      expect(report.version).toBe('abcdef12');
      expect(report.timestamp).toBeDefined();
      expect(['healthy', 'degraded', 'down']).toContain(report.overall);
    });

    it('overall is down when DB is unavailable and no keys configured', async () => {
      vi.resetModules();
      const { runAllHealthChecks } = await import('@/lib/monitoring/healthChecks');
      const report = await runAllHealthChecks();
      // No DATABASE_URL → DB is down → overall is down
      expect(report.overall).toBe('down');
    });
  });
});
