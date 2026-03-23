"use client";

import { Analytics } from "@vercel/analytics/next";
import type { BeforeSendEvent } from "@vercel/analytics";

// Analytics environment: "development" logs to console only, "production" sends data
const analyticsMode =
  process.env.NODE_ENV === "development" ? "development" : "production";

// Filter out internal routes from analytics
// Exported for testing — not part of the public API surface.
export function analyticsBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = event.url;
  // Exclude dev bypass (exact /dev path or /dev/* subpaths), admin, and API routes
  if (url === "/dev" || url.startsWith("/dev/") || url.includes("/admin") || url.includes("/api/")) {
    return null;
  }
  return event;
}

export function AnalyticsProvider() {
  return <Analytics mode={analyticsMode} beforeSend={analyticsBeforeSend} />;
}
