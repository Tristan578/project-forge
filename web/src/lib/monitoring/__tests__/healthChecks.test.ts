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
    // This check reported "up" throughout #9581, while production could not
    // load the engine at all. It pinged the CDN *host* -- always up -- and its
    // error condition explicitly excluded 404, so a version prefix that had
    // never been written still passed. The tests below pin the prefix it must
    // actually probe and the statuses it must actually return.
    const CDN = 'https://engine.spawnforge.ai';

    const stubFetch = (status: number) => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });
      vi.stubGlobal('fetch', mockFetch);
      return mockFetch;
    };

    it('returns degraded when CDN URL not configured', async () => {
      vi.resetModules();
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('not configured');
    });

    it('probes the STAMPED version prefix, not the CDN root', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', CDN);
      vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', 'abc123');
      const mockFetch = stubFetch(200);

      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();

      expect(result.status).toBe('healthy');
      // The exact url useEngine.ts will request. Probing anything shorter is
      // what made the old check unable to observe the outage.
      expect(mockFetch).toHaveBeenCalledWith(
        `${CDN}/abc123/engine-pkg-webgl2/wasm-manifest.json`,
        expect.objectContaining({ method: 'HEAD' }),
      );
    });

    it('falls back to the latest prefix when no version is stamped', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', CDN);
      vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', '');
      const mockFetch = stubFetch(200);

      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      await checkEngineCdn();

      expect(mockFetch).toHaveBeenCalledWith(
        `${CDN}/latest/engine-pkg-webgl2/wasm-manifest.json`,
        expect.objectContaining({ method: 'HEAD' }),
      );
    });

    it('returns down on 404 — the exact shape of #9581', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', CDN);
      vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', 'never-uploaded');
      stubFetch(404);

      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();

      // The previous implementation returned 'healthy' here.
      expect(result.status).toBe('down');
      expect(result.error).toContain('404');
    });

    it('returns down when the CDN returns 500', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', CDN);
      stubFetch(503);

      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();

      expect(result.status).toBe('down');
      expect(result.error).toContain('503');
    });

    it('returns down when the request throws', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', CDN);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));

      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();

      expect(result.status).toBe('down');
      expect(result.error).toBe('network failure');
    });

    it('resolveEngineRoot tolerates trailing slashes and untrimmed versions', async () => {
      vi.resetModules();
      const { resolveEngineRoot } = await import('@/lib/monitoring/healthChecks');
      expect(resolveEngineRoot('https://cdn.test//', 'sha1')).toBe('https://cdn.test/sha1');
      expect(resolveEngineRoot('https://cdn.test', '  ')).toBe('https://cdn.test/latest');
    });
  });

  // ---------------------------------------------------------------------------
  // checkAiProviders
  // ---------------------------------------------------------------------------
  describe('checkAiProviders', () => {
    it('returns down when no chat backend is configured', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('down');
      expect(result.details?.chatBackend).toBeNull();
      expect(result.details?.chatBackendConfigured).toBe(false);
      expect(result.error).toContain('No chat backend is configured');
    });

    it('returns healthy on the gateway key alone, with zero generation keys set', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('healthy');
      expect(result.details?.chatBackend).toBe('vercel-gateway');
      // Generation keys are an informational facet only — they never move status.
      expect(result.details?.generationConfiguredCount).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('returns healthy via Vercel OIDC with no explicit key at all', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '1');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('healthy');
      expect(result.details?.chatBackend).toBe('vercel-gateway');
    });

    it('reports platform generation keys without changing status', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');
      vi.stubEnv('PLATFORM_MESHY_KEY', 'meshy_abc');
      vi.stubEnv('PLATFORM_ELEVENLABS_KEY', 'el_abc');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('healthy');
      expect(result.details?.generationConfiguredCount).toBe(2);
      const providers = result.details?.generationProviders as Record<string, boolean>;
      expect(providers.meshy).toBe(true);
      expect(providers.elevenlabs).toBe(true);
      expect(providers.suno).toBe(false);
    });

    it('stays down when generation keys are set but no chat backend is', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('PLATFORM_MESHY_KEY', 'meshy_abc');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('down');
      expect(result.details?.generationConfiguredCount).toBe(1);
    });

    it('falls back to the direct Anthropic backend when only that key is set', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-abc');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('healthy');
      expect(result.details?.chatBackend).toBe('direct');
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
  // checkChatBackend
  // ---------------------------------------------------------------------------
  describe('checkChatBackend', () => {
    it('returns degraded when no chat backend is configured', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      const { checkChatBackend } = await import('@/lib/monitoring/healthChecks');
      const result = await checkChatBackend();
      expect(result.name).toBe('Chat Backend');
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('No chat backend is configured');
      expect(result.details?.configured).toBe(false);
    });

    it('probes the gateway host — not api.anthropic.com — when the gateway is configured', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkChatBackend } = await import('@/lib/monitoring/healthChecks');
      const result = await checkChatBackend();

      expect(result.status).toBe('healthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.details?.configured).toBe(true);
      expect(result.details?.backend).toBe('vercel-gateway');
      expect(mockFetch).toHaveBeenCalledWith('https://ai-gateway.vercel.sh/v1', {
        method: 'HEAD',
      });
    });

    it('probes api.anthropic.com when the direct backend is the one resolved', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');

      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkChatBackend } = await import('@/lib/monitoring/healthChecks');
      const result = await checkChatBackend();

      expect(result.status).toBe('healthy');
      expect(result.details?.backend).toBe('direct');
      expect(mockFetch).toHaveBeenCalledWith('https://api.anthropic.com', { method: 'HEAD' });
    });

    it('accepts 4xx responses as healthy (host is reachable)', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkChatBackend } = await import('@/lib/monitoring/healthChecks');
      const result = await checkChatBackend();

      expect(result.status).toBe('healthy');
    });

    it('returns degraded when the backend host returns 5xx', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');

      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal('fetch', mockFetch);

      const { checkChatBackend } = await import('@/lib/monitoring/healthChecks');
      const result = await checkChatBackend();

      expect(result.status).toBe('degraded');
      expect(result.error).toContain('503');
    });

    it('returns degraded when fetch throws', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');

      const mockFetch = vi.fn().mockRejectedValue(new Error('DNS failure'));
      vi.stubGlobal('fetch', mockFetch);

      const { checkChatBackend } = await import('@/lib/monitoring/healthChecks');
      const result = await checkChatBackend();

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
      vi.stubEnv('ASSET_R2_ACCOUNT_ID', 'acct_abc');
      const { checkCloudflareR2 } = await import('@/lib/monitoring/healthChecks');
      const result = await checkCloudflareR2();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('partially configured');
      expect(result.details?.accountIdConfigured).toBe(true);
      expect(result.details?.accessKeyConfigured).toBe(false);
    });

    it('returns healthy when all R2 vars are present', async () => {
      vi.resetModules();
      vi.stubEnv('ASSET_R2_ACCOUNT_ID', 'acct_abc');
      vi.stubEnv('ASSET_R2_ACCESS_KEY_ID', 'key123');
      vi.stubEnv('ASSET_R2_SECRET_ACCESS_KEY', 'secret456');
      vi.stubEnv('ASSET_BUCKET_NAME', 'spawnforge-assets');
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
      vi.stubEnv('ASSET_R2_ACCOUNT_ID', 'acct_abc');
      vi.stubEnv('ASSET_R2_ACCESS_KEY_ID', 'key123');
      vi.stubEnv('ASSET_R2_SECRET_ACCESS_KEY', 'secret456');
      // ASSET_BUCKET_NAME missing
      const { checkCloudflareR2 } = await import('@/lib/monitoring/healthChecks');
      const result = await checkCloudflareR2();
      expect(result.status).toBe('degraded');
      expect(result.details?.bucketNameConfigured).toBe(false);
    });

    it('reads the same env names `lib/storage/r2.ts` writes to', async () => {
      // The whole point of PF-1054: the check and the only real R2 consumer must
      // agree on the namespace, or the status page grades variables nothing sets.
      const { ASSET_STORAGE_ENV } = await import('@/lib/config/assetStorage');
      expect(ASSET_STORAGE_ENV).toEqual({
        accountId: 'ASSET_R2_ACCOUNT_ID',
        accessKeyId: 'ASSET_R2_ACCESS_KEY_ID',
        secretAccessKey: 'ASSET_R2_SECRET_ACCESS_KEY',
        bucketName: 'ASSET_BUCKET_NAME',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // runAllHealthChecks
  // ---------------------------------------------------------------------------
  describe('runAllHealthChecks', () => {
    it('returns a HealthReport with all 10 services', async () => {
      vi.resetModules();

      // Minimal mocks: DB neon needs a mock even with no DATABASE_URL
      vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'test');
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef1234');
      vi.stubEnv('VERCEL', '');

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
      // VERCEL must be explicitly cleared: OIDC auto-auth would otherwise resolve
      // a chat backend with no key set and make "AI Providers" healthy.
      vi.stubEnv('VERCEL', '');
      const { runAllHealthChecks } = await import('@/lib/monitoring/healthChecks');
      const report = await runAllHealthChecks();
      // No DATABASE_URL → DB is degraded, but Stripe/AI are down → overall is down
      expect(report.overall).toBe('down');
    });
  });

  // ---------------------------------------------------------------------------
  // getCachedHealthReport
  // ---------------------------------------------------------------------------
  //
  // `runAllHealthChecks()` builds a fresh report object on every invocation, so
  // object identity is a faithful proxy for "did we fan out again?" — a returned
  // reference that is `toBe` the previous one could only have come from the
  // cache, and a distinct one could only have come from a second fan-out.
  describe('getCachedHealthReport', () => {
    // These are the only tests in this file that drive the REAL
    // `runAllHealthChecks()` end to end, so they are the only ones that would
    // otherwise make real outbound calls — on a populated dev machine that
    // means opening a Neon connection and sending the live CLERK_SECRET_KEY to
    // api.clerk.com just to run the suite. Stub the network and clear the DB
    // URL so the fan-out stays entirely in-process; identity, not content, is
    // what these assertions read.
    beforeEach(() => {
      vi.stubEnv('DATABASE_URL', '');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
      );
    });

    it('serves a second call inside the TTL from cache, without a second fan-out', async () => {
      vi.resetModules();
      const { getCachedHealthReport } = await import('@/lib/monitoring/healthChecks');

      const first = await getCachedHealthReport();
      const second = await getCachedHealthReport();

      expect(second).toBe(first);
    });

    it('collapses CONCURRENT cold calls into a single fan-out', async () => {
      vi.resetModules();
      const { getCachedHealthReport } = await import('@/lib/monitoring/healthChecks');

      // Both calls start before either resolves, so the TTL cache alone cannot
      // help here — only the in-flight promise dedup can. Without it, a cold
      // cache under concurrency amplifies exactly as much as no cache at all.
      const [first, second] = await Promise.all([
        getCachedHealthReport(),
        getCachedHealthReport(),
      ]);

      expect(second).toBe(first);
    });

    it('fans out again once the TTL has elapsed', async () => {
      vi.resetModules();
      const { getCachedHealthReport } = await import('@/lib/monitoring/healthChecks');
      const { HEALTH_CACHE_TTL_MS } = await import('@/lib/config/timeouts');

      let clock = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
      try {
        const first = await getCachedHealthReport();
        clock += HEALTH_CACHE_TTL_MS + 1;
        const second = await getCachedHealthReport();

        expect(second).not.toBe(first);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('resetCachedHealthReport() drops the cached report', async () => {
      vi.resetModules();
      const { getCachedHealthReport, resetCachedHealthReport } = await import(
        '@/lib/monitoring/healthChecks'
      );

      const first = await getCachedHealthReport();
      resetCachedHealthReport();
      const second = await getCachedHealthReport();

      expect(second).not.toBe(first);
    });

    it('peekCachedHealthReport() serves a live report and stops at the TTL', async () => {
      vi.resetModules();
      const { getCachedHealthReport, peekCachedHealthReport } = await import(
        '@/lib/monitoring/healthChecks'
      );
      const { HEALTH_CACHE_TTL_MS } = await import('@/lib/config/timeouts');

      let clock = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
      try {
        // Cold: peek never fans out, so it has nothing to hand back.
        expect(peekCachedHealthReport()).toBeNull();

        const report = await getCachedHealthReport();
        expect(peekCachedHealthReport()).toBe(report);

        clock += HEALTH_CACHE_TTL_MS + 1;
        // Expired. Peek is the free fast path in front of the fan-out budget,
        // and it never refreshes — so an unchecked expiry would pin /health and
        // /api/health to one report forever, not merely serve it a bit late.
        expect(peekCachedHealthReport()).toBeNull();
      } finally {
        nowSpy.mockRestore();
      }
    });

    // A fan-out detached by `resetCachedHealthReport()` is still running; a
    // newer one now owns the cache slot. Both the `.then` write and the
    // `.finally` clear are identity-guarded so the detached one cannot land on
    // top of the newer one — a stale report stamped with a full fresh TTL, or a
    // live in-flight promise evicted out from under its joiners.
    it('does not let a detached fan-out clobber the one that replaced it', async () => {
      vi.resetModules();

      // Force at least one probe. Every fetching check is env-gated, and in a
      // bare test env they all short-circuit before touching `fetch` — the
      // gates below would then never fill and this test would pass vacuously.
      // The engine-CDN probe is the safe one to enable: a fake URL, not a
      // secret-shaped key like the ones `checkClerk` needs.
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', 'https://cdn.invalid/');

      const gates: Array<() => void> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              gates.push(() => resolve(new Response(null, { status: 200 })));
            }),
        ),
      );

      const { getCachedHealthReport, peekCachedHealthReport, resetCachedHealthReport } =
        await import('@/lib/monitoring/healthChecks');

      // Each check awaits before it reaches `fetch`, so the probes are not all
      // issued synchronously. Wait on the observable effect — a gate landing —
      // rather than on a fixed delay.
      const probesIssued = () => vi.waitFor(() => expect(gates.length).toBeGreaterThan(0));

      const a = getCachedHealthReport();
      await probesIssued();
      // Count-agnostic: collect whatever this fan-out issued rather than
      // hardcoding a probe count that a new check would silently invalidate.
      const aGates = gates.splice(0);

      // Detach A. A newer fan-out claims the slot while A is still settling.
      resetCachedHealthReport();
      const b = getCachedHealthReport();
      await probesIssued();
      const bGates = gates.splice(0);

      // Land the DETACHED fan-out first — the whole point of the race. `a` IS
      // the chained promise, so awaiting it runs both handlers to completion.
      aGates.forEach((release) => release());
      const reportA = await a;

      // Write guard: A lost the slot, so its report must not be cached. An
      // unconditional write would serve the OLDER report for a full fresh TTL.
      expect(peekCachedHealthReport()).toBeNull();

      // Finally guard: B still owns the slot and is still in flight, so a
      // caller arriving now must join it rather than start a third fan-out.
      //
      // This is a negative — "no probe was issued" — and the probes are only
      // reachable through several awaits, so it is only meaningful once the
      // task queue has been yielded to. `vi.waitFor` cannot express it (it
      // would pass on its first tick, before a third fan-out could show up)
      // and neither can promise identity: `getCachedHealthReport` is `async`,
      // so `return inFlightHealthReport` wraps the joined promise in a fresh
      // one and identity is not observable from here. A macrotask boundary is
      // load-bearing, not a sleep — dropping either identity guard in the
      // dedup turns the assertion below red, which is what pins it.
      const c = getCachedHealthReport();
      // eslint-disable-next-line no-restricted-syntax -- see above: this is a queue yield, not a sleep
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(gates).toHaveLength(0);

      bGates.forEach((release) => release());
      const reportB = await b;

      expect(await c).toBe(reportB);
      expect(reportB).not.toBe(reportA);
    });
  });
});
