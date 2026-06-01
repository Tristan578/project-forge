/**
 * Isomorphic monitoring barrel export.
 *
 * Server components / API routes should import from '@/lib/monitoring/sentry-server'
 * directly for tree-shaking. This barrel is provided as a convenience for shared
 * code that may run in either environment.
 *
 * NOTE: Because Next.js statically analyses imports, the server module is loaded
 * on the server and the client module is loaded on the client. Avoid importing
 * this file from server-only contexts where you want guaranteed server behaviour
 * -- use the direct import instead.
 */

export { captureException, captureMessage, startSpan } from './sentry-server';

/**
 * Throttled Sentry capture for hot fail-open / degrade paths (issues #8664,
 * #8666). Re-exported here for discoverability — prefer this over a raw
 * `captureException` on any path that can fire on every request during an
 * outage (rate limiters, cache fallbacks). See `./sampledCapture`.
 */
export { sampledCaptureException, SAMPLE_THROTTLE_MS } from './sampledCapture';
