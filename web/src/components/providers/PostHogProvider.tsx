"use client";

import { useEffect, Suspense, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { initPostHog, trackPageView, hasConsented } from "@/lib/analytics/posthog";

function PostHogPageTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handlePageView = useCallback(() => {
    if (pathname) {
      const url = searchParams?.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname;
      trackPageView(url);
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    handlePageView();
  }, [handlePageView]);

  return null;
}

/**
 * Mounts PostHog analytics.
 *
 * Initialization is deferred until the user has granted cookie consent
 * (localStorage 'forge-cookie-consent' === 'true'). A storage event
 * listener re-triggers initialization after the CookieConsent banner
 * is accepted — no page reload required.
 *
 * GDPR default: opted out.
 */
export function PostHogProvider() {
  useEffect(() => {
    // Attempt initialization on mount (no-op if consent not yet granted)
    initPostHog();

    // Re-attempt when the consent key changes in localStorage.
    // This fires when the CookieConsent banner's Accept button writes 'true'.
    function handleStorage(event: StorageEvent) {
      if (event.key === 'forge-cookie-consent' && hasConsented()) {
        initPostHog();
      }
    }

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return (
    <Suspense fallback={null}>
      <PostHogPageTracker />
    </Suspense>
  );
}
