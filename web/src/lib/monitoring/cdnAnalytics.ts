/**
 * CDN cache hit rate and WASM load time monitoring (PF-617).
 *
 * Tracks:
 *  - WASM load time (ms) — measured from `useEngine` fetch start to module ready
 *  - CDN cache status — read from the `cf-cache-status` response header
 *    (Cloudflare: HIT | MISS | EXPIRED | BYPASS | REVALIDATED | UPDATING | DYNAMIC)
 *
 * Events are reported to Vercel Analytics (`track`) in production and logged to
 * the console in development. Reporting is fire-and-forget (best effort).
 */

export type CfCacheStatus =
  | 'HIT'
  | 'MISS'
  | 'EXPIRED'
  | 'BYPASS'
  | 'REVALIDATED'
  | 'UPDATING'
  | 'DYNAMIC'
  | 'UNKNOWN';

export interface WasmLoadMetric {
  /** Elapsed milliseconds from fetch start to module ready */
  loadTimeMs: number;
  /** Engine backend selected: 'webgpu' | 'webgl2' */
  backend: 'webgpu' | 'webgl2';
  /** Whether the WASM binary was served from the CDN cache */
  cacheStatus: CfCacheStatus;
  /** Whether the CDN base URL was configured (vs. same-origin) */
  cdnEnabled: boolean;
}

/**
 * Read the Cloudflare cache status from a fetch Response.
 *
 * The `cf-cache-status` header is only present on Cloudflare-proxied origins.
 * Returns 'UNKNOWN' when the header is absent (same-origin / non-CDN requests).
 */
export function readCfCacheStatus(response: Response): CfCacheStatus {
  const raw = response.headers.get('cf-cache-status');
  if (!raw) return 'UNKNOWN';

  const upper = raw.trim().toUpperCase() as CfCacheStatus;
  const valid: ReadonlySet<string> = new Set<CfCacheStatus>([
    'HIT', 'MISS', 'EXPIRED', 'BYPASS', 'REVALIDATED', 'UPDATING', 'DYNAMIC',
  ]);
  return valid.has(upper) ? upper : 'UNKNOWN';
}

/**
 * Report a WASM load metric to Vercel Analytics (production) or console (dev).
 *
 * This is called by `useEngine` after the WASM binary has been fetched and
 * the module is ready. The metric helps understand:
 *  - Whether the CDN is serving cached responses (HIT) or origin requests (MISS)
 *  - How load time varies between cache HIT and MISS scenarios
 *  - WebGPU vs WebGL2 build size differences
 */
export function reportWasmLoadMetric(metric: WasmLoadMetric): void {
  if (typeof window === 'undefined') return;

  const { loadTimeMs, backend, cacheStatus, cdnEnabled } = metric;

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[CDN Analytics] WASM load — ${loadTimeMs.toFixed(0)}ms | backend=${backend} | cache=${cacheStatus} | cdn=${cdnEnabled}`,
    );
    return;
  }

  // Report to Vercel Analytics
  import('@vercel/analytics').then(({ track }) => {
    track('wasm-load', {
      loadTimeMs: Math.round(loadTimeMs),
      backend,
      cacheStatus,
      cdnEnabled,
      cacheHit: cacheStatus === 'HIT',
    });
  }).catch(() => {
    // Vercel Analytics unavailable — silently skip
  });
}

/**
 * Fetch with exponential backoff retry for transient failures (#8246).
 *
 * Up to `maxAttempts` attempts (default 3) with exponential backoff between
 * them (1s, 2s). Retries on 5xx and network errors. Fails fast on 4xx
 * (permanent errors). Throws on all non-2xx responses after retries exhaust.
 * Respects AbortSignal — aborted fetches are never retried.
 */
export async function fetchWithRetry(
  url: string,
  signal: AbortSignal | undefined,
  maxAttempts = 3,
): Promise<Response> {
  const clampedAttempts = Math.max(1, Math.floor(maxAttempts));
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < clampedAttempts; attempt++) {
    // Check abort before each attempt (including after backoff sleep)
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    try {
      const response = await fetch(url, signal ? { signal } : {});
      if (response.ok) return response;
      // 4xx = permanent error, fail fast (do NOT retry)
      if (response.status < 500) {
        throw new Error(`WASM fetch failed: ${response.status} ${response.statusText}`);
      }
      // 5xx = transient, retry
      lastError = new Error(`WASM fetch failed: ${response.status} ${response.statusText}`);
    } catch (err) {
      if (signal?.aborted) throw err;
      const error = err instanceof Error ? err : new Error(String(err));
      // Rethrow permanent (4xx) errors — only retry transient failures
      if (error.message.startsWith('WASM fetch failed:')) throw error;
      lastError = error;
    }
    if (attempt < clampedAttempts - 1) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError!;
}

/**
 * Fetch a WASM binary with retry, cache status detection, and timing.
 *
 * Uses `fetchWithRetry` internally — throws on all non-2xx responses (4xx
 * immediately, 5xx after retries exhaust). Measures network latency from
 * `startTimeMs` and reports CDN cache metrics via Vercel Analytics.
 */
export async function fetchWasmWithMetrics(
  url: string,
  backend: 'webgpu' | 'webgl2',
  startTimeMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetchWithRetry(url, signal);

  const cacheStatus = readCfCacheStatus(response);
  const fetchTimeMs = performance.now() - startTimeMs;
  const cdnEnabled = !url.startsWith('/') && !url.startsWith(window.location.origin);

  // Schedule metric reporting without blocking the load path
  queueMicrotask(() => {
    reportWasmLoadMetric({ loadTimeMs: fetchTimeMs, backend, cacheStatus, cdnEnabled });
  });

  return response;
}
