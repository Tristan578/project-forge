"use client";

import { useEffect, Suspense, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { initPostHog, trackPageView } from "@/lib/analytics/posthog";

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

export function PostHogProvider() {
  useEffect(() => {
    initPostHog();
  }, []);

  return (
    <Suspense fallback={null}>
      <PostHogPageTracker />
    </Suspense>
  );
}
