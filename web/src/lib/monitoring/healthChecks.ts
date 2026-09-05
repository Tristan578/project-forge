/**
 * Health check library for SpawnForge service monitoring.
 *
 * Each check runs with a 5-second timeout. Services that are safe to ping
 * (DB, CDN) get real checks. Two probes that used to be config-presence checks
 * now make one authenticated, credit-free call each, because presence checks
 * reported them healthy while the service could not serve a request:
 * Upstash executes one read-only EVAL (#9623, four months of refused commands
 * behind a green probe) and Stripe retrieves the account balance (#9719, a
 * revoked key would have stayed green forever). The shared fan-out budget
 * bounds what those probes can cost.
 *
 * Individual service checks for Clerk, Stripe, the chat backend and the
 * generation factory use a 3-second timeout (SERVICE_TIMEOUT_MS) to keep the
 * health endpoint responsive; the Upstash probe is bounded by
 * UPSTASH_REST_TIMEOUT_MS. Sentry and Cloudflare R2 are config-presence checks
 * and make no call. AI Providers makes no call either, but its status is
 * decided per capability (#9719), not by the presence of any one key.
 *
 * Every environment variable a check reads comes from a shared constants module
 * (`@/lib/config/providers`, `@/lib/config/assetStorage`) rather than a literal
 * here. Before PF-1054 this file carried its own copy of both namespaces, both
 * had drifted to names nothing else in the tree reads, and the result was two
 * permanent false outages on the public status page.
 *
 * The database check additionally consults the query monitor: if the average
 * query time over the last 5 minutes exceeds DEGRADED_AVG_THRESHOLD_MS (1 s),
 * the database is reported as "degraded" even if SELECT 1 succeeds.
 */
import 'server-only';
import { getMetrics, DEGRADED_AVG_THRESHOLD_MS } from '@/lib/db/queryMonitor';
import { dbCircuitBreaker } from '@/lib/db/circuitBreaker';
import {
  DB_PROVIDER,
  PLATFORM_KEY_ENV,
  listUnconfiguredCapabilities,
  resolveConfiguredChatBackend,
  type PlatformKeyProvider,
} from '@/lib/config/providers';
import { ASSET_STORAGE_ENV } from '@/lib/config/assetStorage';
import { HEALTH_CACHE_TTL_MS, UPSTASH_REST_TIMEOUT_MS } from '@/lib/config/timeouts';
import { isUpstashConfigured, postUpstashCommand } from '@/lib/upstash/restCommand';
import { AI_MODEL_PRIMARY } from '@/lib/ai/models';

export type ServiceStatus = 'healthy' | 'degraded' | 'down';

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  latencyMs: number;
  lastChecked: string; // ISO timestamp
  error?: string;
  /**
   * Public-safe one-liner saying WHAT is wrong (#9719). Unlike `error`, which
   * `sanitizeForPublic` replaces because it may carry env-var names or
   * provider text, `summary` survives into the public body — so a probe must
   * put only vocabulary a user already sees in it (capability names, counts).
   */
  summary?: string;
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
 * Tighter timeout for lightweight connectivity checks (Clerk, chat backend,
 * generation factory). The Upstash probe uses UPSTASH_REST_TIMEOUT_MS from
 * `@/lib/config/timeouts` instead, so it is bounded the same way the limiter is.
 */
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
    const cbStats = dbCircuitBreaker.getStats();

    // Circuit breaker open = DB is effectively down
    if (cbStats.state === 'open') {
      return {
        name: 'Database (Neon)',
        status: 'down',
        latencyMs,
        lastChecked: new Date().toISOString(),
        error: 'Circuit breaker is open — DB connections refused to prevent cascading failures',
        details: {
          circuitBreaker: cbStats,
          avgQueryTimeMs: metrics.totalQueryCount > 0 ? Math.round(metrics.avgQueryTimeMs) : undefined,
          slowQueryCount: metrics.slowQueryCount,
          totalQueryCount: metrics.totalQueryCount,
        },
      };
    }

    if (metrics.totalQueryCount > 0 && metrics.avgQueryTimeMs > DEGRADED_AVG_THRESHOLD_MS) {
      return {
        name: 'Database (Neon)',
        status: 'degraded',
        latencyMs,
        lastChecked: new Date().toISOString(),
        error: `Average query time ${Math.round(metrics.avgQueryTimeMs)}ms exceeds ${DEGRADED_AVG_THRESHOLD_MS}ms threshold`,
        details: {
          circuitBreaker: cbStats,
          avgQueryTimeMs: Math.round(metrics.avgQueryTimeMs),
          slowQueryCount: metrics.slowQueryCount,
          totalQueryCount: metrics.totalQueryCount,
        },
      };
    }

    return {
      name: 'Database (Neon)',
      status: cbStats.state === 'half-open' ? 'degraded' : 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
      details: {
        circuitBreaker: cbStats,
        ...(metrics.totalQueryCount > 0 && {
          avgQueryTimeMs: Math.round(metrics.avgQueryTimeMs),
          slowQueryCount: metrics.slowQueryCount,
          totalQueryCount: metrics.totalQueryCount,
        }),
      },
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

/**
 * Stripe's documented, credit-free authenticated read: Retrieve balance.
 * `GET https://api.stripe.com/v1/balance` with `Authorization: Bearer <secret>`
 * — https://docs.stripe.com/api/balance/balance_retrieve and
 * https://docs.stripe.com/api/authentication. It exercises exactly the
 * property checkout depends on (this key is accepted by this account) and
 * moves no money.
 */
const STRIPE_BALANCE_URL = 'https://api.stripe.com/v1/balance';

/**
 * Payments probe (#9719). A present `STRIPE_SECRET_KEY` is not evidence that
 * Stripe will accept it — a revoked or wrong-mode key sat behind a green
 * probe with `latencyMs: 0`. One authenticated GET grades the key for real:
 * accepted → healthy; 401/403 → degraded with an auth error; anything else
 * (5xx, timeout, network) → degraded, never thrown, so a Stripe blip does not
 * page as a SpawnForge outage. `down` is reserved for "no key at all".
 */
export async function checkPayments(): Promise<ServiceHealth> {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const name = 'Payments (Stripe)';

  if (!key) {
    return {
      name,
      status: 'down',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'STRIPE_SECRET_KEY not configured',
    };
  }

  const details = {
    secretKeyConfigured: true,
    webhookSecretConfigured: !!webhookSecret,
    probe: 'GET /v1/balance',
    mode: key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test',
  };

  try {
    const { result: status, latencyMs } = await timed(() =>
      withTimeout(
        fetch(STRIPE_BALANCE_URL, {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}` },
        }).then((res) => res.status),
        SERVICE_TIMEOUT_MS,
      ),
    );
    const lastChecked = new Date().toISOString();
    if (status >= 200 && status < 300) {
      return { name, status: 'healthy', latencyMs, lastChecked, details };
    }
    if (status === 401 || status === 403) {
      return {
        name,
        status: 'degraded',
        latencyMs,
        lastChecked,
        error: `Stripe rejected STRIPE_SECRET_KEY (auth ${status}) on GET /v1/balance`,
        summary: 'Stripe rejected the platform key',
        details,
      };
    }
    return {
      name,
      status: 'degraded',
      latencyMs,
      lastChecked,
      error: `Stripe returned ${status} on GET /v1/balance`,
      details,
    };
  } catch (err) {
    return {
      name,
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      details,
    };
  }
}

export async function checkRateLimiting(): Promise<ServiceHealth> {
  if (!isUpstashConfigured()) {
    return {
      name: 'Rate Limiting (Upstash)',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'Upstash vars not configured — rate limiting disabled',
    };
  }

  // Execute a read-only EVAL through the SAME transport the limiter uses
  // (`postUpstashCommand`: body form, base URL, bounded error detail, same
  // timeout) — by construction, not by transcription, so a change to the
  // limiter's request is a change to this probe. Reporting "healthy" on the
  // presence of the two env vars is how this check said the rate limiter was
  // fine in the very request whose own EVAL had just been refused with 400
  // (#9623, four months). Upstash bills per command; the fan-out budget that
  // gates every cold report is the bound on that spend.
  // The bound lives in the transport (AbortSignal.timeout(UPSTASH_REST_TIMEOUT_MS)),
  // so a stall surfaces as fetch's own "aborted due to timeout" error — no
  // second race is wrapped around it, which would only hide which bound fired.
  try {
    const { latencyMs } = await timed(async () => {
      const result = await postUpstashCommand(['EVAL', 'return 1', 0], {
        timeoutMs: UPSTASH_REST_TIMEOUT_MS,
      });
      if (result !== 1) {
        throw new Error(`Upstash answered EVAL with ${JSON.stringify(result)} instead of 1`);
      }
    });
    return {
      name: 'Rate Limiting (Upstash)',
      status: 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
      details: { probe: 'EVAL return 1' },
    };
  } catch (err) {
    // 'degraded', not 'down': the limiter degrades to the SDK path and then to
    // per-instance memory, so requests still flow — with less protection.
    return {
      name: 'Rate Limiting (Upstash)',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      details: { probe: 'EVAL return 1' },
    };
  }
}

/**
 * Resolve the engine root exactly as `useEngine.ts` does.
 *
 * Kept in lockstep with ENGINE_CDN_ROOT there: `<cdn>/<version>` when a version
 * is stamped, `<cdn>/latest` when it is not. Probing anything else is how the
 * old check stayed green through #9581 — it HEAD'd the CDN *host*, which is
 * always up, rather than the prefix this deployment actually asks for.
 */
export function resolveEngineRoot(cdnBase: string, version: string): string {
  const base = cdnBase.replace(/\/+$/, '');
  const v = version.trim();
  return v ? `${base}/${v}` : `${base}/latest`;
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

  // Real assets under the resolved prefix, not the bucket root -- and their
  // HEADERS, not just their status.
  //
  // Status alone is not evidence the engine is usable. #9593 shipped a prefix
  // where every object returned HTTP 200 with NO Content-Type, because the
  // server-side copy used `--metadata-directive REPLACE` and restated only
  // cache-control. The browser refuses a module script without a JavaScript
  // MIME type, so the engine could not load while this check said "up" -- the
  // same shape as the pre-#9588 check that probed the CDN host.
  //
  // The two files below are exactly what useEngine.ts requests, and each is
  // checked for the property the browser actually enforces:
  //
  //   forge_engine.js        loaded via `await import()`, so it must carry a
  //                          JavaScript MIME type or the import is refused
  //   forge_engine_bg.wasm   WebAssembly.instantiateStreaming requires
  //                          application/wasm; otherwise the 95 MB module is
  //                          buffered whole before compiling
  const root = resolveEngineRoot(cdnUrl, process.env.NEXT_PUBLIC_ENGINE_VERSION ?? '');
  const base = `${root}/engine-pkg-webgl2`;
  const probes: { url: string; accept: (t: string) => boolean; want: string }[] = [
    {
      url: `${base}/forge_engine.js`,
      // Anchored at both ends: the type must END there or continue with a
      // parameter. A bare prefix match would accept 'text/javascript2',
      // which is not a JavaScript media type and which the browser would
      // refuse exactly as it refuses an empty one.
      accept: (t) => /^(text|application)\/(javascript|ecmascript)[ \t]*(;|$)/.test(t),
      want: 'a JavaScript MIME type',
    },
    {
      url: `${base}/forge_engine_bg.wasm`,
      accept: (t) => /^application\/wasm[ \t]*(;|$)/.test(t),
      want: 'application/wasm',
    },
  ];

  try {
    const { latencyMs } = await timed(() =>
      withTimeout(
        (async () => {
          for (const probe of probes) {
            const res = await fetch(probe.url, { method: 'HEAD' });
            if (!res.ok) {
              throw new Error(`${probe.url} returned ${res.status}`);
            }
            const type = (res.headers.get('content-type') ?? '').toLowerCase();
            if (!probe.accept(type)) {
              throw new Error(
                `${probe.url} is served as "${type || '(none)'}" — expected ${probe.want}`,
              );
            }
          }
        })(),
        TIMEOUT_MS,
      ),
    );
    return {
      name: 'Engine CDN',
      status: 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
      details: { url: base },
    };
  } catch (err) {
    // 'down', not 'degraded': there is no fallback. useEngine.ts tries the CDN
    // then same-origin, and on a CDN deployment same-origin has no engine
    // either, so an unusable asset means the editor cannot start.
    return {
      name: 'Engine CDN',
      status: 'down',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      details: { url: base },
    };
  }
}

/**
 * Configuration check behind the public "AI Providers" service (#9719).
 *
 *   down      — no chat backend resolves (nothing AI-shaped can be served)
 *   degraded  — a chat backend resolves but at least one offered generation
 *               capability has neither a platform key nor a gateway route; the
 *               unconfigured capabilities are named in `error`, in
 *               `details.unconfiguredCapabilities`, and — because the public
 *               body strips both of those — in `summary`
 *   healthy   — chat resolves and every capability in CAPABILITY_ENV_VARS is
 *               configured
 *
 * Before #9719 this reported healthy on the chat backend alone and filed the
 * generation keys under `details`, which the public body strips: production
 * showed "up" with zero PLATFORM_* keys, i.e. while every platform-path
 * generation request failed. That is lesson 1 — a check asserting a property
 * adjacent to the one users depend on. Capability configuration is decided by
 * `isCapabilityConfigured` (the same table `/api/capabilities` reads), so the
 * probe cannot disagree with the feature-gating endpoint. BYOK users are
 * unaffected by any of this and are not what a platform health probe grades.
 */
export async function checkAiProviders(): Promise<ServiceHealth> {
  const backend = resolveConfiguredChatBackend();

  const generationProviders = Object.fromEntries(
    (Object.keys(PLATFORM_KEY_ENV) as PlatformKeyProvider[]).map((provider) => [
      provider,
      Boolean(process.env[PLATFORM_KEY_ENV[provider]]),
    ]),
  );
  const generationConfiguredCount = Object.values(generationProviders).filter(Boolean).length;
  // `chat` is graded by the backend resolution above; listing it twice would
  // double-report the same fact.
  const unconfiguredCapabilities = listUnconfiguredCapabilities().filter((c) => c !== 'chat');

  const details = {
    chatBackend: backend?.id ?? null,
    chatBackendConfigured: Boolean(backend),
    generationProviders,
    generationConfiguredCount,
    generationTotalCount: Object.keys(generationProviders).length,
    unconfiguredCapabilities,
  };
  const lastChecked = new Date().toISOString();

  if (!backend) {
    return {
      name: 'AI Providers',
      status: 'down',
      latencyMs: 0,
      lastChecked,
      error: 'No chat backend is configured',
      summary: 'No chat backend is configured',
      details,
    };
  }

  if (unconfiguredCapabilities.length > 0) {
    const list = unconfiguredCapabilities.join(', ');
    return {
      name: 'AI Providers',
      status: 'degraded',
      latencyMs: 0,
      lastChecked,
      error: `Generation unavailable on the platform path for ${list} — no platform key or gateway route configured`,
      summary: `Unavailable: ${list}`,
      details,
    };
  }

  return {
    name: 'AI Providers',
    status: 'healthy',
    latencyMs: 0,
    lastChecked,
    details,
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
 * Reachability check for whichever chat backend this environment would actually
 * use, via a HEAD request to that backend's host.
 *
 * Before PF-1054 this probed `api.anthropic.com` unconditionally and keyed off
 * `ANTHROPIC_API_KEY`. Production routes chat through the Vercel AI Gateway, so
 * the check measured a path production never takes and graded a key it never
 * sets.
 *
 * Does NOT call a billable endpoint — only connectivity. Uses a 3-second
 * timeout. Status: healthy = a backend is configured and its host is reachable,
 *                 degraded = no backend configured, or the host is unreachable.
 */
export async function checkChatBackend(): Promise<ServiceHealth> {
  const backend = resolveConfiguredChatBackend();

  if (!backend) {
    return {
      name: 'Chat Backend',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'No chat backend is configured',
      details: { configured: false },
    };
  }

  // `AI_MODEL_PRIMARY` (not per-backend `resolveModelId`) — deliberately: the
  // per-backend translation lives on the LIVE registry (`providers/registry.ts`),
  // and this file's own header already rules out calling that from a health
  // check (it would grade recent circuit-breaker state, not configuration).
  // This is the canonical id the migration in PF-1216 / #9339 configured this
  // deploy to request — surfaced so a wrong or stale id (e.g. a rollback that
  // missed a call site) is at least VISIBLE in the health report. It is not
  // verification: nothing here confirms the Gateway actually serves it, which
  // would require a billable call this check is intentionally not making.
  const details = {
    configured: true,
    backend: backend.id,
    backendName: backend.name,
    configuredModel: AI_MODEL_PRIMARY,
  };

  try {
    // HEAD request to the backend host — no tokens consumed, just connectivity.
    const { latencyMs } = await timed(() =>
      withTimeout(
        fetch(backend.probeUrl, { method: 'HEAD' }).then((res) => {
          // Any HTTP response (including 4xx) means the host is reachable.
          if (res.status >= 500) {
            throw new Error(`${backend.name} returned ${res.status}`);
          }
        }),
        SERVICE_TIMEOUT_MS,
      ),
    );
    return {
      name: 'Chat Backend',
      status: 'healthy',
      latencyMs,
      lastChecked: new Date().toISOString(),
      details,
    };
  } catch (err) {
    return {
      name: 'Chat Backend',
      status: 'degraded',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      details,
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
 *
 * The names come from `ASSET_STORAGE_ENV`, the same constants `lib/storage/r2.ts`
 * reads to construct its client, so this can never again grade a namespace
 * nothing writes.
 *
 * Status: healthy = all 4 vars present,
 *         degraded = some vars present (partial config),
 *         down = no R2 vars at all.
 */
export async function checkCloudflareR2(): Promise<ServiceHealth> {
  const accountId = process.env[ASSET_STORAGE_ENV.accountId];
  const accessKeyId = process.env[ASSET_STORAGE_ENV.accessKeyId];
  const secretAccessKey = process.env[ASSET_STORAGE_ENV.secretAccessKey];
  const bucketName = process.env[ASSET_STORAGE_ENV.bucketName];

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
 * Returns service list with errors replaced by generic messages. `summary`
 * is kept by design — it is the public-safe "what is wrong" a probe opts
 * into (see `ServiceHealth.summary`).
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
 * Checks run in parallel. Chat-backend downtime causes 'degraded' overall but
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
    checkChatBackend(),
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

/**
 * Module-level cache for `runAllHealthChecks()`.
 *
 * Of the ten checks it runs, **six make outbound network calls**: the database
 * (`SELECT 1` against Neon), the engine CDN (HEAD), Clerk (`HEAD
 * api.clerk.com/v1/jwks`), the chat backend (HEAD to its probe URL — the AI
 * Gateway in production), Upstash (a read-only `EVAL`, billed per command —
 * #9623) and Stripe (`GET /v1/balance`, credit-free — #9719).
 * `checkGenerationFactory` drives the handler in-process, and the remaining
 * three are `process.env` checks that return `latencyMs: 0` without touching
 * the network. So one inbound request costs six outbound ones — smaller than a naive read of
 * `runAllHealthChecks()` suggests, but still an amplification vector, and the
 * Clerk probe in particular sends `CLERK_SECRET_KEY` to Clerk's API on behalf
 * of whoever triggered it.
 *
 * Two layers, both about cost rather than access control:
 *
 * - a TTL cache, so a burst of requests inside `HEALTH_CACHE_TTL_MS` costs one
 *   fan-out, and
 * - in-flight promise dedup, so N *concurrent* cold requests also cost one
 *   fan-out rather than N. Without the second layer a cold cache under
 *   concurrency is exactly as amplifying as no cache at all.
 *
 * This is NOT a rate limit and must not be described as one. The state is
 * per-lambda-instance, so it bounds an instance, not the internet: under a
 * distributed burst Vercel scales instances and aggregate fan-out scales with
 * them. An anonymous caller therefore needs a real, shared bound as well —
 * `distributedRateLimit()` takes a plain string key and is callable from a
 * Server Component, which is what `/health` uses. (An earlier revision of this
 * comment claimed a Server Component had no rate-limiting option and that the
 * cache "IS the guard". Both halves were wrong.)
 *
 * A rejection is never cached and clears the in-flight slot, so a transient
 * failure does not pin the surface into an error state for the whole TTL. Every
 * check above catches its own errors, so `runAllHealthChecks()` does not reject
 * today — the `.finally` is there so a future check that stops being defensive
 * cannot wedge the cache permanently.
 */
let cachedHealthReport: { report: HealthReport; expiresAt: number } | null = null;
let inFlightHealthReport: Promise<HealthReport> | null = null;

export async function getCachedHealthReport(): Promise<HealthReport> {
  const cached = cachedHealthReport;
  if (cached && Date.now() < cached.expiresAt) {
    return cached.report;
  }
  if (inFlightHealthReport) {
    return inFlightHealthReport;
  }

  const pending: Promise<HealthReport> = runAllHealthChecks()
    .then((report) => {
      // Same identity guard as the `.finally` below, and for the same reason:
      // once `resetCachedHealthReport()` has detached this fan-out, a newer one
      // owns the slot. Writing unconditionally would let a slow, detached probe
      // land last and overwrite a FRESHER report — and, worse, stamp it with a
      // full new `expiresAt`, so the stale data would then be served for an
      // entire TTL. Losing the write is correct: the report we would have
      // written is by definition the older of the two.
      if (inFlightHealthReport === pending) {
        cachedHealthReport = { report, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS };
      }
      return report;
    })
    .finally(() => {
      // Identity-guarded: `resetCachedHealthReport()` can null the slot and a
      // NEWER fan-out can claim it while this one is still settling. Clearing
      // unconditionally would then evict that newer in-flight promise, and the
      // next caller would start a third redundant fan-out.
      if (inFlightHealthReport === pending) {
        inFlightHealthReport = null;
      }
    });

  inFlightHealthReport = pending;
  return pending;
}

/**
 * The cached report if one is live, else `null`. Never starts a fan-out.
 *
 * For callers that want fresh-if-cheap and are not willing to pay for a probe —
 * e.g. a request that has already been rate-limited and must still render.
 */
export function peekCachedHealthReport(): HealthReport | null {
  const cached = cachedHealthReport;
  return cached && Date.now() < cached.expiresAt ? cached.report : null;
}

/**
 * Test seam — drops the cached report and detaches any in-flight fan-out.
 *
 * "Detaches", not "cancels": a promise already in flight cannot be cancelled,
 * so an outstanding fan-out still runs to completion. What detaching buys is
 * that its result is then discarded — both the cache write and the in-flight
 * clear are guarded on promise identity, so a slow probe that lands after a
 * reset cannot overwrite a fresher report, refresh its TTL, or evict the newer
 * in-flight slot. The NEXT call observes neither the old report nor the old
 * promise.
 */
export function resetCachedHealthReport(): void {
  cachedHealthReport = null;
  inFlightHealthReport = null;
}
