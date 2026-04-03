/**
 * Health check library for SpawnForge service monitoring.
 *
 * Each check runs with a 5-second timeout. For external services that
 * charge per call (Stripe, etc.) we only validate config presence.
 * For services that are safe to ping (DB, CDN) we perform real checks.
 *
 * Individual service checks for Clerk, Anthropic, Sentry, and Cloudflare R2
 * use a 3-second timeout to keep the health endpoint responsive.
 *
 * The database check additionally consults the query monitor: if the average
 * query time over the last 5 minutes exceeds DEGRADED_AVG_THRESHOLD_MS (1 s),
 * the database is reported as "degraded" even if SELECT 1 succeeds.
 */
import 'server-only';
import { getMetrics, DEGRADED_AVG_THRESHOLD_MS } from '@/lib/db/queryMonitor';
import { DB_PROVIDER } from '@/lib/config/providers';

export type ServiceStatus = 'healthy' | 'degraded' | 'down';

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  latencyMs: number;
  lastChecked: string; // ISO timestamp
  error?: string;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  overall: ServiceStatus;
  timestamp: string;
  services: ServiceHealth[];
  environment: string;
  version: string;
}

const TIMEOUT_MS = 5_000;
/** Tighter timeout for lightweight connectivity checks (Clerk, Anthropic, Sentry, R2) */
const SERVICE_TIMEOUT_MS = 3_000;

/**
 * Race a promise against a timeout. Returns the promise result or throws
 * with a "timed out" message.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Measure elapsed milliseconds for an async operation.
 */
async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Individual service checks
// ---------------------------------------------------------------------------

export async function checkDatabase(): Promise<ServiceHealth> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return {
      name: 'Database (Neon)',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'DATABASE_URL not configured',
    };
  }

  try {
    const { latencyMs } = await timed(() =>
      withTimeout(
        (async () => {
          const { neon } = await import('@neondatabase/serverless');
          const sql = neon(url);
          await sql`SELECT 1`;
        })(),
        TIMEOUT_MS,
      ),
    );
    // Check query monitor metrics: flag as degraded if average query time is too high
    const metrics = getMetrics();
    if (metrics.totalQueryCount > 0 && metrics.avgQueryTimeMs > DEGRADED_AVG_THRESHOLD_MS) {
      return {
        name: 'Database (Neon)',
        status: 'degraded',
        latencyMs,
        lastChecked: new Date().toISOString(),
        error: `Average query time ${Math.round(metrics.avgQueryTimeMs)}ms exceeds ${DEGRADED_AVG_THRESHOLD_MS}ms threshold`,
        details: {
          avgQueryTimeMs: Math.round(metrics.avgQueryTimeMs),
          slowQueryCount: metrics.slowQueryCount,
          totalQueryCount: metrics.totalQueryCount,
        },
      };
    }

    return {
      name: 'Database (Neon)',
      status: 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
      details:
        metrics.totalQueryCount > 0
          ? {
              avgQueryTimeMs: Math.round(metrics.avgQueryTimeMs),
              slowQueryCount: metrics.slowQueryCount,
              totalQueryCount: metrics.totalQueryCount,
            }
          : undefined,
    };
  } catch (err) {
    return {
      name: 'Database (Neon)',
      status: 'down',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkPayments(): Promise<ServiceHealth> {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!key) {
    return {
      name: 'Payments (Stripe)',
      status: 'down',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'STRIPE_SECRET_KEY not configured',
    };
  }

  return {
    name: 'Payments (Stripe)',
    status: 'healthy',
    latencyMs: 0,
    lastChecked: new Date().toISOString(),
    details: {
      secretKeyConfigured: true,
      webhookSecretConfigured: !!webhookSecret,
    },
  };
}

/**
 * @deprecated Use `checkSentry()` instead. This function returns `'Error Tracking (Sentry)'`
 * which does NOT match the canonical name used by `runAllHealthChecks()`. Kept for backwards
 * compatibility only — it is NOT called by `runAllHealthChecks()`. (PF-739)
 */
export async function checkErrorTracking(): Promise<ServiceHealth> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

  if (!dsn) {
    return {
      name: 'Error Tracking (Sentry)',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'NEXT_PUBLIC_SENTRY_DSN not configured — errors will not be tracked',
    };
  }

  return {
    name: 'Error Tracking (Sentry)',
    status: 'healthy',
    latencyMs: 0,
    lastChecked: new Date().toISOString(),
    details: { configured: true },
  };
}

/**
 * @deprecated Use `checkCloudflareR2()` instead. This function returns `'Asset Storage (R2)'`
 * which does NOT match the canonical name used by `runAllHealthChecks()`. Kept for backwards
 * compatibility only — it is NOT called by `runAllHealthChecks()`. (PF-739)
 */
export async function checkAssetStorage(): Promise<ServiceHealth> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  const allConfigured = !!(accountId && accessKeyId && secretAccessKey && bucketName);
  const anyConfigured = !!(accountId || accessKeyId || secretAccessKey || bucketName);

  if (!allConfigured) {
    return {
      name: 'Asset Storage (R2)',
      status: anyConfigured ? 'degraded' : 'down',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: anyConfigured
        ? 'R2 partially configured — some vars missing'
        : 'R2 not configured',
      details: {
        accountIdConfigured: !!accountId,
        accessKeyConfigured: !!accessKeyId,
        secretKeyConfigured: !!secretAccessKey,
        bucketNameConfigured: !!bucketName,
      },
    };
  }

  return {
    name: 'Asset Storage (R2)',
    status: 'healthy',
    latencyMs: 0,
    lastChecked: new Date().toISOString(),
    details: { configured: true, bucket: bucketName },
  };
}

export async function checkRateLimiting(): Promise<ServiceHealth> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return {
      name: 'Rate Limiting (Upstash)',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'Upstash vars not configured — rate limiting disabled',
    };
  }

  return {
    name: 'Rate Limiting (Upstash)',
    status: 'healthy',
    latencyMs: 0,
    lastChecked: new Date().toISOString(),
    details: { configured: true },
  };
}

export async function checkEngineCdn(): Promise<ServiceHealth> {
  const cdnUrl = process.env.NEXT_PUBLIC_ENGINE_CDN_URL;

  if (!cdnUrl) {
    return {
      name: 'Engine CDN',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'NEXT_PUBLIC_ENGINE_CDN_URL not configured — using local engine',
    };
  }

  try {
    const pingUrl = cdnUrl.endsWith('/') ? cdnUrl : `${cdnUrl}/`;
    const { latencyMs } = await timed(() =>
      withTimeout(
        fetch(pingUrl, { method: 'HEAD' }).then((res) => {
          // 5xx indicates CDN server error; 4xx (except 404) indicates auth/config issue
          if (res.status >= 500 || (res.status >= 400 && res.status !== 404)) {
            throw new Error(`CDN returned ${res.status}`);
          }
        }),
        TIMEOUT_MS,
      ),
    );
    return {
      name: 'Engine CDN',
      status: 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
      details: { url: cdnUrl },
    };
  } catch (err) {
    return {
      name: 'Engine CDN',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      details: { url: cdnUrl },
    };
  }
}

export async function checkAiProviders(): Promise<ServiceHealth> {
  const providers: Record<string, boolean> = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    meshy: !!process.env.MESHY_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    suno: !!process.env.SUNO_API_KEY,
  };

  const configuredCount = Object.values(providers).filter(Boolean).length;
  const totalCount = Object.keys(providers).length;

  let status: ServiceStatus = 'healthy';
  if (configuredCount === 0) {
    status = 'down';
  } else if (configuredCount < totalCount) {
    status = 'degraded';
  }

  const unconfigured = Object.entries(providers)
    .filter(([, configured]) => !configured)
    .map(([name]) => name);

  return {
    name: 'AI Providers',
    status,
    latencyMs: 0,
    lastChecked: new Date().toISOString(),
    details: {
      configured: providers,
      configuredCount,
      totalCount,
    },
    error:
      unconfigured.length > 0
        ? `Missing providers: ${unconfigured.join(', ')}`
        : undefined,
  };
}

/**
 * Check Clerk auth service by validating key presence and pinging the JWKS endpoint.
 * Uses a 3-second timeout. Sends the secret key only in the Authorization header.
 * Status: healthy = keys present + endpoint reachable,
 *         degraded = keys missing or endpoint unreachable.
 */
export async function checkClerk(): Promise<ServiceHealth> {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!publishableKey || !secretKey) {
    return {
      name: 'Clerk',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'Clerk API keys not configured',
      details: {
        publishableKeyConfigured: !!publishableKey,
        secretKeyConfigured: !!secretKey,
      },
    };
  }

  try {
    const { latencyMs } = await timed(() =>
      withTimeout(
        fetch('https://api.clerk.com/v1/jwks', {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${secretKey}` },
        }).then((res) => {
          // 405 (Method Not Allowed) is acceptable — endpoint exists but HEAD isn't supported
          if (!res.ok && res.status !== 405) {
            throw new Error(`Clerk JWKS returned ${res.status}`);
          }
        }),
        SERVICE_TIMEOUT_MS,
      ),
    );
    return {
      name: 'Clerk',
      status: 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
      details: { configured: true },
    };
  } catch (err) {
    return {
      name: 'Clerk',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      details: { configured: true },
    };
  }
}

/**
 * Check Anthropic API availability via a HEAD request to api.anthropic.com.
 * Does NOT call a billable endpoint — only checks connectivity and key presence.
 * Uses a 3-second timeout.
 * Status: healthy = key present + host reachable,
 *         degraded = key absent or host unreachable.
 */
export async function checkAnthropic(): Promise<ServiceHealth> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      name: 'Anthropic',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'ANTHROPIC_API_KEY not configured',
      details: { configured: false },
    };
  }

  try {
    // HEAD request to the base API host — no tokens consumed, just connectivity.
    const { latencyMs } = await timed(() =>
      withTimeout(
        fetch('https://api.anthropic.com', { method: 'HEAD' }).then((res) => {
          // Any HTTP response (including 4xx) means the host is reachable.
          if (res.status >= 500) {
            throw new Error(`Anthropic API returned ${res.status}`);
          }
        }),
        SERVICE_TIMEOUT_MS,
      ),
    );
    return {
      name: 'Anthropic',
      status: 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
      details: { configured: true },
    };
  } catch (err) {
    return {
      name: 'Anthropic',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      details: { configured: true },
    };
  }
}

/**
 * Check Sentry error tracking configuration.
 * Validates DSN presence and basic format. No network call — DSNs are config-only.
 * Status: healthy = DSN present and well-formed,
 *         degraded = DSN absent or malformed.
 */
export async function checkSentry(): Promise<ServiceHealth> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

  if (!dsn) {
    return {
      name: 'Sentry',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'NEXT_PUBLIC_SENTRY_DSN not configured — errors will not be tracked',
      details: { configured: false },
    };
  }

  // Basic DSN format check: must start with https:// and contain @
  const isWellFormed = dsn.startsWith('https://') && dsn.includes('@');
  if (!isWellFormed) {
    return {
      name: 'Sentry',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'NEXT_PUBLIC_SENTRY_DSN appears malformed',
      details: { configured: true, wellFormed: false },
    };
  }

  return {
    name: 'Sentry',
    status: 'healthy',
    latencyMs: 0,
    lastChecked: new Date().toISOString(),
    details: { configured: true, wellFormed: true },
  };
}

/**
 * Check Cloudflare R2 bucket configuration.
 * Validates all required env vars are present. No actual bucket call — S3 API
 * calls are expensive and slow. A config check is sufficient for health monitoring.
 * Status: healthy = all 4 vars present,
 *         degraded = some vars present (partial config),
 *         down = no R2 vars at all.
 */
export async function checkCloudflareR2(): Promise<ServiceHealth> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  const allConfigured = !!(accountId && accessKeyId && secretAccessKey && bucketName);
  const anyConfigured = !!(accountId || accessKeyId || secretAccessKey || bucketName);

  const details = {
    accountIdConfigured: !!accountId,
    accessKeyConfigured: !!accessKeyId,
    secretKeyConfigured: !!secretAccessKey,
    bucketNameConfigured: !!bucketName,
  };

  if (!allConfigured) {
    return {
      name: 'Cloudflare R2',
      status: anyConfigured ? 'degraded' : 'down',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: anyConfigured
        ? 'Cloudflare R2 partially configured — some vars missing'
        : 'Cloudflare R2 not configured',
      details,
    };
  }

  return {
    name: 'Cloudflare R2',
    status: 'healthy',
    latencyMs: 0,
    lastChecked: new Date().toISOString(),
    details: { ...details, bucket: bucketName },
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/** Services whose downtime should trigger HTTP 503 */
const CRITICAL_SERVICES = new Set(['Database (Neon)', 'Clerk']);

/**
 * Compute overall status from a list of service results.
 * - any 'down' → overall 'down'
 * - any 'degraded' → overall 'degraded'
 * - all 'healthy' → 'healthy'
 */
export function computeOverallStatus(services: ServiceHealth[]): ServiceStatus {
  if (services.some((s) => s.status === 'down')) return 'down';
  if (services.some((s) => s.status === 'degraded')) return 'degraded';
  return 'healthy';
}

/**
 * Compute HTTP-relevant status based only on critical services.
 * Optional services (Stripe, AI providers, etc.) being down should not cause 503.
 */
export function computeCriticalStatus(services: ServiceHealth[]): ServiceStatus {
  const critical = services.filter((s) => CRITICAL_SERVICES.has(s.name));
  if (critical.some((s) => s.status === 'down')) return 'down';
  if (critical.some((s) => s.status === 'degraded')) return 'degraded';
  return 'healthy';
}

/**
 * Strip sensitive error details for public consumption.
 * Returns service list with errors replaced by generic messages.
 */
export function sanitizeForPublic(services: ServiceHealth[]): ServiceHealth[] {
  return services.map((s) => ({
    ...s,
    error: s.error ? `${s.name} is ${s.status}` : undefined,
    details: undefined,
  }));
}

/**
 * Smoke-test the createGenerationHandler factory wiring.
 *
 * Creates a trivial handler and sends an unauthenticated request through it.
 * Because createGenerationHandler authenticates first, the expected outcome is
 * a structured 401 response rather than an unhandled error.
 *
 * This verifies that the factory can be imported, instantiated, and invoked on
 * the auth path without throwing. It does not exercise later stages such as
 * body parsing, validation dispatch, or provider/operation resolution.
 */
async function checkGenerationFactory(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const res = await withTimeout(
      (async () => {
        const { createGenerationHandler } = await import('@/lib/api/createGenerationHandler');
        const handler = createGenerationHandler({
          route: '/api/health/factory-smoke',
          provider: DB_PROVIDER.chat,
          operation: 'chat_short',
          rateLimitKey: 'health-smoke',
          validate: (body) => {
            const prompt = body.prompt;
            if (!prompt || typeof prompt !== 'string') return { ok: false, error: 'missing prompt' };
            return { ok: true, params: { prompt } };
          },
          execute: async (params) => ({ echo: params.prompt }),
        });

        const { NextRequest } = await import('next/server');
        const req = new NextRequest('http://localhost/api/health/factory-smoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'smoke test' }),
        });

        return handler(req);
      })(),
      SERVICE_TIMEOUT_MS,
    );
    // Auth should reject (no Clerk session on health route) — 401 is expected.
    // 200 means auth leaked from the caller's request context (authenticateRequest
    // calls auth() which reads Clerk context, not the synthetic NextRequest).
    // Treat 200 as degraded: factory works but may have billed tokens.
    const latencyMs = Date.now() - start;

    if (res.status === 401) {
      return {
        name: 'Generation Factory',
        status: 'healthy',
        latencyMs,
        lastChecked: new Date().toISOString(),
        details: { responseStatus: res.status },
      };
    }

    if (res.status === 200) {
      return {
        name: 'Generation Factory',
        status: 'degraded',
        latencyMs,
        lastChecked: new Date().toISOString(),
        error: 'Factory smoke test unexpectedly authenticated — may have billed tokens',
        details: { responseStatus: res.status },
      };
    }

    // Unexpected status — factory pipeline may be broken
    return {
      name: 'Generation Factory',
      status: 'degraded',
      latencyMs,
      lastChecked: new Date().toISOString(),
      error: `Unexpected status ${res.status} from factory smoke test`,
    };
  } catch (err) {
    // Factory threw — this is the critical failure case
    return {
      name: 'Generation Factory',
      status: 'down',
      latencyMs: Date.now() - start,
      lastChecked: new Date().toISOString(),
      error: `Factory smoke test threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Run all service checks concurrently and return a full HealthReport.
 * Checks run in parallel. Anthropic downtime causes 'degraded' overall but
 * does not trigger 503 (not in CRITICAL_SERVICES).
 */
export async function runAllHealthChecks(): Promise<HealthReport> {
  const services = await Promise.all([
    checkDatabase(),
    checkPayments(),
    checkRateLimiting(),
    checkEngineCdn(),
    checkAiProviders(),
    checkClerk(),
    checkAnthropic(),
    checkSentry(),
    checkCloudflareR2(),
    checkGenerationFactory(),
  ]);

  const env = process.env.NEXT_PUBLIC_ENVIRONMENT ?? process.env.NODE_ENV ?? 'unknown';
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';

  return {
    overall: computeOverallStatus(services),
    timestamp: new Date().toISOString(),
    services,
    environment: env,
    version: commit.slice(0, 8),
  };
}
