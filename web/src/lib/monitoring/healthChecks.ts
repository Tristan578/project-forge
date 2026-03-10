/**
 * Health check library for SpawnForge service monitoring.
 *
 * Each check runs with a 5-second timeout. For external services that
 * charge per call (Stripe, etc.) we only validate config presence.
 * For services that are safe to ping (DB, CDN) we perform real checks.
 */
import 'server-only';

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
      status: 'down',
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
    return {
      name: 'Database (Neon)',
      status: 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
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

export async function checkAuthentication(): Promise<ServiceHealth> {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!publishableKey || !secretKey) {
    return {
      name: 'Authentication (Clerk)',
      status: 'down',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'Clerk keys not configured',
    };
  }

  try {
    const jwksUrl = 'https://api.clerk.com/v1/jwks';
    const { latencyMs } = await timed(() =>
      withTimeout(
        fetch(jwksUrl, {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${secretKey}` },
        }).then((res) => {
          if (!res.ok && res.status !== 405) {
            throw new Error(`JWKS endpoint returned ${res.status}`);
          }
        }),
        TIMEOUT_MS,
      ),
    );
    return {
      name: 'Authentication (Clerk)',
      status: 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
      details: { configured: true },
    };
  } catch (err) {
    return {
      name: 'Authentication (Clerk)',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      details: { configured: true },
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
          // 4xx/5xx except 404 indicates CDN is reachable but something is wrong
          if (res.status >= 500) {
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

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/** Services whose downtime should trigger HTTP 503 */
const CRITICAL_SERVICES = new Set(['Database (Neon)', 'Authentication (Clerk)']);

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
 * Run all service checks concurrently and return a full HealthReport.
 */
export async function runAllHealthChecks(): Promise<HealthReport> {
  const services = await Promise.all([
    checkDatabase(),
    checkAuthentication(),
    checkPayments(),
    checkErrorTracking(),
    checkAssetStorage(),
    checkRateLimiting(),
    checkEngineCdn(),
    checkAiProviders(),
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
