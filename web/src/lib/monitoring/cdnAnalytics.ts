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
 * Wrap a WASM fetch with cache status detection and timing.
 *
 * Measures time from `startTimeMs` until HTTP response headers are received
 * (fetch resolution). This does NOT include body download or WASM compilation
 * time — those happen asynchronously after the Response is consumed by the
 * caller. The metric captures network latency + CDN cache behavior.
 *
 * @param url - The WASM binary URL being fetched
 * @param backend - Which engine backend is being loaded
 * @param startTimeMs - performance.now() value from before the fetch started
 */
export async function fetchWasmWithMetrics(
  url: string,
  backend: 'webgpu' | 'webgl2',
  startTimeMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(url, signal ? { signal } : {});

  if (response.ok) {
    const cacheStatus = readCfCacheStatus(response);
    const fetchTimeMs = performance.now() - startTimeMs;
    const cdnEnabled = !url.startsWith('/') && !url.startsWith(window.location.origin);

    // Schedule metric reporting without blocking the load path
    queueMicrotask(() => {
      reportWasmLoadMetric({ loadTimeMs: fetchTimeMs, backend, cacheStatus, cdnEnabled });
    });
  }

  return response;
}
