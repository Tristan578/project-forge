'use client';

import { useEffect, useRef, type ReactNode } from 'react';
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
