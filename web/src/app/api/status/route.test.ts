import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(ip = '1.2.3.4'): NextRequest {
  return {
    headers: {
      get: (name: string) => (name === 'x-forwarded-for' ? ip : null),
    },
  } as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/status', () => {
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

  it('returns HTTP 200 with a well-formed StatusPagePayload', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('overall');
    expect(body).toHaveProperty('services');
    expect(body).toHaveProperty('activeIncidents');
    expect(Array.isArray(body.services)).toBe(true);
    expect(Array.isArray(body.activeIncidents)).toBe(true);
  });

  it('returns activeIncidents as an empty array (automated endpoint)', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.activeIncidents).toEqual([]);
  });

  it('overall status is one of the valid OverallStatus values', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(['operational', 'partial_outage', 'major_outage', 'maintenance']).toContain(
      body.overall,
    );
  });

  it('each service entry has the required shape', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();

    for (const service of body.services) {
      expect(service).toHaveProperty('id');
      expect(service).toHaveProperty('name');
      expect(service).toHaveProperty('status');
      expect(service).toHaveProperty('lastCheckedAt');
      expect(service).toHaveProperty('latencyMs');
      expect(['operational', 'degraded', 'outage', 'maintenance']).toContain(service.status);
      expect(typeof service.latencyMs).toBe('number');
    }
  });

  it('includes Cache-Control header for CDN caching', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    expect(res.headers.get('Cache-Control')).toContain('max-age=30');
  });

  it('maps all configured MONITORED_SERVICES to response entries', async () => {
    vi.resetModules();

    // Mock health checks to return predictable results for all service names
    vi.doMock('@/lib/monitoring/healthChecks', () => ({
      runAllHealthChecks: vi.fn().mockResolvedValue({
        overall: 'healthy',
        timestamp: '2026-03-16T12:00:00.000Z',
        services: [
          { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Clerk', status: 'healthy', latencyMs: 10, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'AI Providers', status: 'healthy', latencyMs: 50, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Cloudflare R2', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Engine CDN', status: 'healthy', latencyMs: 20, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Payments (Stripe)', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Rate Limiting (Upstash)', status: 'degraded', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Sentry', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
        ],
        environment: 'test',
        version: 'abcd1234',
      }),
    }));

    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();

    // All services that are in MONITORED_SERVICES and have a matching health check
    // result should appear in the response
    const ids = body.services.map((s: { id: string }) => s.id);
    expect(ids).toContain('database');
    expect(ids).toContain('auth');
    expect(ids).toContain('ai');
    expect(ids).toContain('asset_storage');
    expect(ids).toContain('engine_cdn');
    expect(ids).toContain('payments');
  });

  it('maps healthy → operational, degraded → degraded, down → outage', async () => {
    vi.resetModules();

    vi.doMock('@/lib/monitoring/healthChecks', () => ({
      runAllHealthChecks: vi.fn().mockResolvedValue({
        overall: 'down',
        timestamp: '2026-03-16T12:00:00.000Z',
        services: [
          { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Clerk', status: 'degraded', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'AI Providers', status: 'down', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Cloudflare R2', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Engine CDN', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Payments (Stripe)', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Rate Limiting (Upstash)', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Sentry', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
        ],
        environment: 'test',
        version: 'abcd1234',
      }),
    }));

    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();

    const db = body.services.find((s: { id: string }) => s.id === 'database');
    const auth = body.services.find((s: { id: string }) => s.id === 'auth');
    const ai = body.services.find((s: { id: string }) => s.id === 'ai');

    expect(db?.status).toBe('operational');
    expect(auth?.status).toBe('degraded');
    expect(ai?.status).toBe('outage');
  });

  it('overall becomes major_outage when any service is outage', async () => {
    vi.resetModules();

    vi.doMock('@/lib/monitoring/healthChecks', () => ({
      runAllHealthChecks: vi.fn().mockResolvedValue({
        overall: 'down',
        timestamp: '2026-03-16T12:00:00.000Z',
        services: [
          { name: 'Database (Neon)', status: 'down', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Clerk', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'AI Providers', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Cloudflare R2', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Engine CDN', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Payments (Stripe)', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Rate Limiting (Upstash)', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Sentry', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
        ],
        environment: 'test',
        version: 'abcd1234',
      }),
    }));

    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.overall).toBe('major_outage');
  });

  it('overall becomes partial_outage when any service is degraded (but none outage)', async () => {
    vi.resetModules();

    vi.doMock('@/lib/monitoring/healthChecks', () => ({
      runAllHealthChecks: vi.fn().mockResolvedValue({
        overall: 'degraded',
        timestamp: '2026-03-16T12:00:00.000Z',
        services: [
          { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Clerk', status: 'degraded', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'AI Providers', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Cloudflare R2', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Engine CDN', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Payments (Stripe)', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Rate Limiting (Upstash)', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Sentry', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
        ],
        environment: 'test',
        version: 'abcd1234',
      }),
    }));

    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.overall).toBe('partial_outage');
  });

  it('overall is operational when all services are healthy', async () => {
    vi.resetModules();

    vi.doMock('@/lib/monitoring/healthChecks', () => ({
      runAllHealthChecks: vi.fn().mockResolvedValue({
        overall: 'healthy',
        timestamp: '2026-03-16T12:00:00.000Z',
        services: [
          { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Clerk', status: 'healthy', latencyMs: 10, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'AI Providers', status: 'healthy', latencyMs: 50, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Cloudflare R2', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Engine CDN', status: 'healthy', latencyMs: 20, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Payments (Stripe)', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Rate Limiting (Upstash)', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
          { name: 'Sentry', status: 'healthy', latencyMs: 0, lastChecked: '2026-03-16T12:00:00.000Z' },
        ],
        environment: 'test',
        version: 'abcd1234',
      }),
    }));

    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.overall).toBe('operational');
    for (const service of body.services) {
      expect(service.status).toBe('operational');
    }
  });

  it('services with no matching health check entry are omitted', async () => {
    vi.resetModules();

    // Only provide health data for one service
    vi.doMock('@/lib/monitoring/healthChecks', () => ({
      runAllHealthChecks: vi.fn().mockResolvedValue({
        overall: 'healthy',
        timestamp: '2026-03-16T12:00:00.000Z',
        services: [
          { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, lastChecked: '2026-03-16T12:00:00.000Z' },
        ],
        environment: 'test',
        version: 'abcd1234',
      }),
    }));

    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();

    // Only the database service should appear
    expect(body.services).toHaveLength(1);
    expect(body.services[0].id).toBe('database');
  });

  it('returns 429 when rate limit is exceeded', async () => {
    vi.resetModules();

    vi.doMock('@/lib/rateLimit', () => ({
      rateLimitPublicRoute: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': '9999999999',
            'Retry-After': '300',
          },
        }),
      ),
    }));

    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
  });

  it('generatedAt matches the health report timestamp', async () => {
    vi.resetModules();

    const fixedTimestamp = '2026-03-16T12:34:56.000Z';

    vi.doMock('@/lib/rateLimit', () => ({
      rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
    }));

    vi.doMock('@/lib/monitoring/healthChecks', () => ({
      runAllHealthChecks: vi.fn().mockResolvedValue({
        overall: 'healthy',
        timestamp: fixedTimestamp,
        services: [
          { name: 'Database (Neon)', status: 'healthy', latencyMs: 5, lastChecked: fixedTimestamp },
        ],
        environment: 'test',
        version: 'abcd1234',
      }),
    }));

    const { GET } = await import('./route');
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.generatedAt).toBe(fixedTimestamp);
  });
});
