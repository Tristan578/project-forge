/**
 * Core Web Vitals monitoring.
 *
 * Measures LCP, FCP, CLS, INP, and TTFB using the `web-vitals` library and reports
 * metrics to Vercel Analytics (via the `@vercel/analytics` `track` helper) in
 * production, or logs to the console during development.
 *
 * In production, also sends metrics to `/api/vitals` for backend observability.
 */

import type { Metric } from 'web-vitals';

export interface WebVitalMetric {
  name: string;
  value: number;
  rating: string;
  id: string;
  delta: number;
}

type MetricReporter = (metric: WebVitalMetric) => void;

/**
 * Send a metric to the /api/vitals endpoint using sendBeacon (fallback: fetch).
 * Only runs in production.
 */
function sendToEndpoint(metric: WebVitalMetric): void {
  if (process.env.NODE_ENV !== 'production') return;

  const payload = JSON.stringify({
    name: metric.name,
    value: metric.value,
    id: metric.id,
    delta: metric.delta,
  });

  const url = '/api/vitals';

  // Prefer sendBeacon for reliability during page unload
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([payload], { type: 'application/json' });
    const sent = navigator.sendBeacon(url, blob);
    if (sent) return;
  }

  // Fallback to fetch with keepalive
  fetch(url, {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
  }).catch(() => {
    // Silently ignore — vitals reporting is best-effort
  });
}

/** Default reporter: console in dev, Vercel Analytics track() in prod. */
function defaultReporter(metric: WebVitalMetric): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Web Vital] ${metric.name}: ${metric.value.toFixed(2)} (${metric.rating})`);
    return;
  }

  // Send to our backend endpoint
  sendToEndpoint(metric);

  // Dynamic import so tree-shaking can eliminate in non-Vercel builds
  import('@vercel/analytics').then(({ track }) => {
    track(`web-vital-${metric.name.toLowerCase()}`, {
      value: Math.round(metric.value * 1000) / 1000,
      rating: metric.rating,
      id: metric.id,
    });
  }).catch(() => {
    // Vercel Analytics unavailable — silently skip
  });
}

function adaptMetric(metric: Metric): WebVitalMetric {
  return {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    delta: metric.delta,
  };
}

/**
 * Register all Core Web Vitals observers.
 *
 * Call once from a client component mounted at the root layout.
 * Safe to call in SSR (no-ops if `window` is undefined).
 */
export function reportWebVitals(reporter: MetricReporter = defaultReporter): void {
  if (typeof window === 'undefined') return;

  import('web-vitals').then(({ onLCP, onFCP, onCLS, onINP, onTTFB }) => {
    const report = (m: Metric) => reporter(adaptMetric(m));
    onLCP(report);
    onFCP(report);
    onCLS(report);
    onINP(report);
    onTTFB(report);
  }).catch(() => {
    // web-vitals not available — silently skip
  });
}

// Re-export for direct usage
export { sendToEndpoint };
