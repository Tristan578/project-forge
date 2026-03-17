"use client";

import { useEffect } from "react";
import { reportWebVitals } from "@/lib/monitoring/webVitals";

/**
 * Client component that registers Core Web Vitals observers on mount.
 * Place in the root layout alongside AnalyticsProvider.
 */
export function WebVitalsReporter() {
  useEffect(() => {
    reportWebVitals();
  }, []);

  return null;
}
