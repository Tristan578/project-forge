'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useUser } from '@clerk/nextjs';
import posthog from 'posthog-js';
import { initSentryClient } from '@/lib/monitoring/sentry-client';

interface SentryProviderProps {
  children: ReactNode;
}

/**
 * Client component that initializes the Sentry browser SDK on mount.
 * Renders children as a simple passthrough -- no visual output.
 *
 * Usage (in root layout):
 * ```tsx
 * <SentryProvider>{children}</SentryProvider>
 * ```
 */
export function SentryProvider({ children }: SentryProviderProps) {
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    initSentryClient();
  }, []);

  return <>{children}</>;
}

export function PostHogIdentity() {
  const { isLoaded, user } = useUser();
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !posthog.__loaded) return;

    if (!user) {
      if (identifiedUserId.current) {
        posthog.reset();
        identifiedUserId.current = null;
      }
      return;
    }

    if (identifiedUserId.current === user.id) return;

    if (identifiedUserId.current) {
      posthog.reset();
    }

    const email = user.primaryEmailAddress?.emailAddress;
    const name = user.fullName;

    posthog.identify(user.id, {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
    });
    identifiedUserId.current = user.id;
  }, [isLoaded, user]);

  return null;
}
