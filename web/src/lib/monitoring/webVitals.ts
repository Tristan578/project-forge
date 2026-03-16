/**
 * Core Web Vitals monitoring.
 *
 * Measures LCP, FCP, CLS, and INP using the `web-vitals` library and reports
 * metrics to Vercel Analytics (via the `@vercel/analytics` `track` helper) in
 * production, or logs to the console during development.
 */

import type { Metric } from 'web-vitals';

export interface WebVitalMetric {
  name: string;
  value: number;
  rating: string;
  id: string;
}

type MetricReporter = (metric: WebVitalMetric) => void;

/** Default reporter: console in dev, Vercel Analytics track() in prod. */
function defaultReporter(metric: WebVitalMetric): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Web Vital] ${metric.name}: ${metric.value.toFixed(2)} (${metric.rating})`);
    return;
  }

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

  import('web-vitals').then(({ onLCP, onFCP, onCLS, onINP }) => {
    const report = (m: Metric) => reporter(adaptMetric(m));
    onLCP(report);
    onFCP(report);
    onCLS(report);
    onINP(report);
  }).catch(() => {
    // web-vitals not available — silently skip
  });
}
