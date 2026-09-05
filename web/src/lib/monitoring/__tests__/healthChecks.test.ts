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

    // #9719: `summary` is the one field a probe may use to say WHAT is wrong
    // in public terms (capability names), so it must survive sanitization
    // while `error` and `details` are still stripped.
    it('preserves the public-safe summary while stripping error and details', async () => {
      const { sanitizeForPublic } = await import('@/lib/monitoring/healthChecks');
      const services = [
        {
          name: 'AI Providers',
          status: 'degraded' as const,
          latencyMs: 0,
          lastChecked: '',
          error: 'PLATFORM_MESHY_KEY unset',
          summary: 'Unavailable: model3d, texture',
          details: { generationProviders: { meshy: false } },
        },
      ];
      const sanitized = sanitizeForPublic(services);
      expect(sanitized[0].summary).toBe('Unavailable: model3d, texture');
      expect(sanitized[0].error).toBe('AI Providers is degraded');
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

    // #9719: presence of STRIPE_SECRET_KEY is not evidence Stripe will accept
    // it. The probe performs ONE authenticated, credit-free request — Retrieve
    // balance, `GET https://api.stripe.com/v1/balance` with
    // `Authorization: Bearer <secret key>` (https://docs.stripe.com/api/balance/balance_retrieve,
    // https://docs.stripe.com/api/authentication) — and grades the answer.
    // The request shape pinned here is Stripe's, not ours (lesson 14).
    it('returns healthy with real latency when Stripe accepts the key on GET /v1/balance', async () => {
      vi.resetModules();
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
      const fetchMock = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return new Response('{"object":"balance","livemode":false}', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      const { checkPayments } = await import('@/lib/monitoring/healthChecks');
      const result = await checkPayments();
      expect(result.status).toBe('healthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(4);
      expect(result.details?.secretKeyConfigured).toBe(true);
      expect(result.details?.probe).toBe('GET /v1/balance');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.stripe.com/v1/balance');
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_abc');
    });

    it('returns degraded with an auth error when Stripe rejects the key (401)', async () => {
      vi.resetModules();
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_revoked');
      vi.stubGlobal('fetch', vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return new Response('{"error":{"type":"invalid_request_error"}}', { status: 401 });
      }));
      const { checkPayments } = await import('@/lib/monitoring/healthChecks');
      const result = await checkPayments();
      expect(result.status).toBe('degraded');
      expect(result.latencyMs).toBeGreaterThanOrEqual(4);
      expect(result.error).toMatch(/401/);
      expect(result.error).toMatch(/rejected|auth/i);
      expect(result.error).not.toContain('sk_test_revoked');
    });

    it('returns degraded (never throws) on a transient network failure', async () => {
      vi.resetModules();
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
      const { checkPayments } = await import('@/lib/monitoring/healthChecks');
      const result = await checkPayments();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('ECONNRESET');
    });

    it('returns degraded on a Stripe 5xx', async () => {
      vi.resetModules();
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
      const { checkPayments } = await import('@/lib/monitoring/healthChecks');
      const result = await checkPayments();
      expect(result.status).toBe('degraded');
      expect(result.error).toMatch(/503/);
    });

    it('reports webhook secret presence in details', async () => {
      vi.resetModules();
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_xyz');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
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

    // The probe must EXECUTE a command in the limiter's own body-form shape.
    // Until #9623 this check returned 'healthy' on env-var presence while every
    // real EVAL was being refused with 400 — the lesson-#1 pattern.
    function stubUpstash(status: number, body: string) {
      const fetchMock = vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : status === 400 ? 'Bad Request' : 'Error',
        text: async () => body,
        json: async () => JSON.parse(body) as unknown,
      }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    async function probeWith(status: number, body: string) {
      vi.resetModules();
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token_abc');
      const fetchMock = stubUpstash(status, body);
      const { checkRateLimiting } = await import('@/lib/monitoring/healthChecks');
      const result = await checkRateLimiting();
      return { result, fetchMock };
    }

    it('returns healthy only after a real EVAL answers {"result":1}', async () => {
      const { result, fetchMock } = await probeWith(200, '{"result":1}');
      expect(result.status).toBe('healthy');
      expect(result.details).toEqual({ probe: 'EVAL return 1' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      // Body form to the BASE url — never the path form that Upstash refuses.
      expect(calledUrl).toBe('https://redis.upstash.io');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual(['EVAL', 'return 1', 0]);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token_abc');
    });

    it('reports degraded with the Upstash error body when the command is refused', async () => {
      const { result } = await probeWith(400, '{"error":"ERR wrong number of arguments for \'eval\' command"}');
      expect(result.status).toBe('degraded');
      // The exact message the limiter's own transport produces — same code path.
      expect(result.error).toBe(
        'Upstash EVAL failed: 400 Bad Request — {"error":"ERR wrong number of arguments for \'eval\' command"}',
      );
    });

    it('reports degraded with a bare status line when the refusal body is empty', async () => {
      const { result } = await probeWith(400, '');
      expect(result.status).toBe('degraded');
      expect(result.error).toBe('Upstash EVAL failed: 400 Bad Request');
    });

    it('reports degraded when the answer is not the script result', async () => {
      const { result } = await probeWith(200, '{"result":"PONG"}');
      expect(result.status).toBe('degraded');
      expect(result.error).toBe('Upstash answered EVAL with "PONG" instead of 1');
    });

    it('reports degraded on a non-JSON body', async () => {
      const { result } = await probeWith(200, '<html>maintenance</html>');
      expect(result.status).toBe('degraded');
      expect(result.error).toBe('Upstash EVAL answered with a non-JSON body');
    });

    it('reports degraded with the abort error when Upstash stalls past the transport timeout', async () => {
      vi.resetModules();
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token_abc');
      // The bound is AbortSignal.timeout inside postUpstashCommand; when it
      // fires, fetch rejects with this exact DOMException. Node's internal
      // timer is out of reach of vitest's fake timers, so the stub reproduces
      // the rejection fetch produces rather than the clock that causes it.
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }));
      const { checkRateLimiting } = await import('@/lib/monitoring/healthChecks');
      const { UPSTASH_REST_TIMEOUT_MS } = await import('@/lib/config/timeouts');

      const result = await checkRateLimiting();

      // runAllHealthChecks applies no outer bound, so the transport's signal is
      // the only thing between a stalled Upstash and a hung /api/health.
      expect(timeoutSpy).toHaveBeenCalledWith(UPSTASH_REST_TIMEOUT_MS);
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('The operation was aborted due to timeout');
      timeoutSpy.mockRestore();
    });

    it('reports degraded when fetch throws', async () => {
      vi.resetModules();
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token_abc');
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
      const { checkRateLimiting } = await import('@/lib/monitoring/healthChecks');
      const result = await checkRateLimiting();
      expect(result.status).toBe('degraded');
      expect(result.error).toBe('ECONNRESET');
    });
  });

  // ---------------------------------------------------------------------------
  // checkEngineCdn
  // ---------------------------------------------------------------------------
  describe('checkEngineCdn', () => {
    // This check reported "up" through two separate outages.
    //
    //   #9581  it pinged the CDN *host* -- always up -- and excluded 404 from
    //          its error condition, so a version prefix that had never been
    //          written still passed.
    //   #9593  it then checked only the STATUS of a real asset. The aliased
    //          prefix returned 200 for everything while serving no
    //          Content-Type, which MIME-blocks the module import in
    //          useEngine.ts. The engine could not load; the check said "up".
    //
    // So these pin the urls it must request AND the headers it must enforce.
    const CDN = 'https://engine.spawnforge.ai';
    const JS = 'https://engine.spawnforge.ai/abc123/engine-pkg-webgl2/forge_engine.js';
    const WASM = 'https://engine.spawnforge.ai/abc123/engine-pkg-webgl2/forge_engine_bg.wasm';

    /** Fetch stub keyed by url -> [status, content-type]. */
    const stubFetch = (byUrl: Record<string, [number, string]>) => {
      const mockFetch = vi.fn((url: string) => {
        const [status, type] = byUrl[url] ?? [404, ''];
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) },
        });
      });
      vi.stubGlobal('fetch', mockFetch);
      return mockFetch;
    };

    const healthy = { [JS]: [200, 'text/javascript'], [WASM]: [200, 'application/wasm'] } as Record<
      string,
      [number, string]
    >;

    beforeEach(() => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', CDN);
      vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', 'abc123');
    });

    it('returns degraded when CDN URL not configured', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', '');
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('degraded');
      expect(result.error).toContain('not configured');
    });

    it('probes the STAMPED prefix for the exact files useEngine.ts imports', async () => {
      const mockFetch = stubFetch(healthy);
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();

      expect(result.status).toBe('healthy');
      // Probing anything shorter is what made the old check blind to #9581.
      expect(mockFetch).toHaveBeenCalledWith(JS, expect.objectContaining({ method: 'HEAD' }));
      expect(mockFetch).toHaveBeenCalledWith(WASM, expect.objectContaining({ method: 'HEAD' }));
    });

    it('falls back to the latest prefix when no version is stamped', async () => {
      vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', '');
      const mockFetch = stubFetch({
        'https://engine.spawnforge.ai/latest/engine-pkg-webgl2/forge_engine.js': [200, 'text/javascript'],
        'https://engine.spawnforge.ai/latest/engine-pkg-webgl2/forge_engine_bg.wasm': [200, 'application/wasm'],
      });
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      await checkEngineCdn();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://engine.spawnforge.ai/latest/engine-pkg-webgl2/forge_engine.js',
        expect.objectContaining({ method: 'HEAD' }),
      );
    });

    it('returns down on 404 — the shape of #9581', async () => {
      stubFetch({});
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('down');
      expect(result.error).toContain('404');
    });

    it('returns down when the glue module has NO Content-Type — the shape of #9593', async () => {
      // 200 for everything, no type. The browser refuses a module script
      // without a JavaScript MIME type, so this must not read as healthy.
      stubFetch({ [JS]: [200, ''], [WASM]: [200, 'application/wasm'] });
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('down');
      expect(result.error).toContain('(none)');
      expect(result.error).toContain('JavaScript MIME type');
    });

    it('returns down when the wasm is not application/wasm', async () => {
      stubFetch({ [JS]: [200, 'text/javascript'], [WASM]: [200, 'application/octet-stream'] });
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('down');
      expect(result.error).toContain('application/wasm');
    });

    it('accepts a charset parameter on the JS type', async () => {
      stubFetch({ [JS]: [200, 'text/javascript; charset=utf-8'], [WASM]: [200, 'application/wasm'] });
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      expect((await checkEngineCdn()).status).toBe('healthy');
    });

    // A prefix match would accept these. They are not JavaScript or wasm media
    // types, and a browser refuses them exactly as it refuses an empty one, so
    // the gate must not read them as healthy.
    it('rejects a near-miss type that only shares a prefix', async () => {
      stubFetch({ [JS]: [200, 'text/javascript2'], [WASM]: [200, 'application/wasm'] });
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('down');
      expect(result.error).toContain('text/javascript2');
    });

    it('rejects a near-miss wasm type that only shares a prefix', async () => {
      stubFetch({ [JS]: [200, 'text/javascript'], [WASM]: [200, 'application/wasm2'] });
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('down');
      expect(result.error).toContain('application/wasm2');
    });

    it('returns down when the CDN returns 500', async () => {
      stubFetch({ [JS]: [503, 'text/javascript'], [WASM]: [200, 'application/wasm'] });
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('down');
      expect(result.error).toContain('503');
    });

    it('returns down when the request throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
      const { checkEngineCdn } = await import('@/lib/monitoring/healthChecks');
      const result = await checkEngineCdn();
      expect(result.status).toBe('down');
      expect(result.error).toBe('network failure');
    });

    it('resolveEngineRoot tolerates trailing slashes and untrimmed versions', async () => {
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

    // #9719: the gateway key serves chat only. With no generation key set the
    // paid offer is mostly unavailable, so the probe must say so — and say
    // WHICH capabilities — in the public body, not only in stripped details.
    it('returns degraded naming every unconfigured capability when only the gateway key is set', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('degraded');
      expect(result.details?.chatBackend).toBe('vercel-gateway');
      expect(result.details?.generationConfiguredCount).toBe(0);
      const missing = result.details?.unconfiguredCapabilities as string[];
      expect(missing).toEqual(
        expect.arrayContaining(['model3d', 'texture', 'sfx', 'voice', 'music', 'sprite', 'bg_removal']),
      );
      expect(missing).not.toContain('chat');
      expect(result.error).toContain('model3d');
      // Public-safe summary survives sanitizeForPublic; it carries capability
      // names only, never env var names.
      expect(result.summary).toContain('model3d');
      expect(result.summary).not.toContain('PLATFORM_');
    });

    it('returns healthy when a chat backend and every generation key are configured', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');
      vi.stubEnv('PLATFORM_MESHY_KEY', 'x');
      vi.stubEnv('PLATFORM_ELEVENLABS_KEY', 'x');
      vi.stubEnv('PLATFORM_SUNO_KEY', 'x');
      vi.stubEnv('PLATFORM_OPENAI_KEY', 'x');
      vi.stubEnv('PLATFORM_REPLICATE_KEY', 'x');
      vi.stubEnv('PLATFORM_REMOVEBG_KEY', 'x');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('healthy');
      expect(result.details?.unconfiguredCapabilities).toEqual([]);
      expect(result.error).toBeUndefined();
      expect(result.summary).toBeUndefined();
    });

    it('resolves the gateway via Vercel OIDC with no explicit key at all (chat is not "down")', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '1');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      // Not 'down': chat resolves. Not 'healthy' either — no generation key
      // is set, and #9719 makes that a degraded state, not a footnote.
      expect(result.status).toBe('degraded');
      expect(result.details?.chatBackend).toBe('vercel-gateway');
      expect(result.details?.unconfiguredCapabilities).not.toContain('chat');
    });

    it('names only the capabilities that remain unconfigured once some keys are set', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');
      vi.stubEnv('PLATFORM_MESHY_KEY', 'meshy_abc');
      vi.stubEnv('PLATFORM_ELEVENLABS_KEY', 'el_abc');
      const { checkAiProviders } = await import('@/lib/monitoring/healthChecks');
      const result = await checkAiProviders();
      expect(result.status).toBe('degraded');
      expect(result.details?.generationConfiguredCount).toBe(2);
      const providers = result.details?.generationProviders as Record<string, boolean>;
      expect(providers.meshy).toBe(true);
      expect(providers.elevenlabs).toBe(true);
      expect(providers.suno).toBe(false);
      const missing = result.details?.unconfiguredCapabilities as string[];
      expect(missing).not.toContain('model3d');
      expect(missing).not.toContain('sfx');
      expect(missing).toContain('sprite');
      expect(missing).toContain('music');
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
      expect(result.status).not.toBe('down');
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

    it('surfaces the configured primary model id so a stale/wrong id is visible in the report (PF-1216 / #9339)', async () => {
      vi.resetModules();
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_abc');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const { checkChatBackend } = await import('@/lib/monitoring/healthChecks');
      const { AI_MODEL_PRIMARY } = await import('@/lib/ai/models');
      const result = await checkChatBackend();

      // Configuration visibility, not verification — this check never confirms
      // the Gateway actually serves the model, only what this deploy asks for.
      expect(result.details?.configuredModel).toBe(AI_MODEL_PRIMARY);
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
