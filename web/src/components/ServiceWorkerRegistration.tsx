"use client";

import { useEffect } from "react";

/**
 * Registers the service worker for PWA/offline support.
 * Only active in production builds — skipped in development to avoid
 * stale cache interfering with hot-module replacement.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .catch((_err: unknown) => {
        // SW registration failure is non-fatal — the app still works online
      });
  }, []);

  return null;
}
