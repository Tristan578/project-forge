'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { invalidateCapabilitiesCache } from '@/hooks/useFeatureGating';

/** Mounted only under ClerkProvider; refresh per-user data when sessions change. */
export function CapabilitiesAuthSync() {
  const { isLoaded, userId, sessionId } = useAuth();
  /** The identity the current cached body was fetched for; null until known. */
  const lastIdentity = useRef<string | null>(null);

  useEffect(() => {
    // Clerk reports `isLoaded` false -> true with `userId` undefined -> null|id
    // on EVERY page load under ClerkProvider, and both change together. Firing
    // on that transition invalidated the cache while the FIRST request — sent
    // with the session cookie, so already correct — was still in flight: the
    // cacheVersion guard discarded its response and a second `no-store`
    // request went out, on every editor page load including anonymous ones.
    // That doubled the traffic the 120/min ceiling was raised for and flipped
    // consumers back to `loading` (gate unblocked) in between (#9725 p7).
    //
    // So: wait for the load to settle, record the identity as the baseline,
    // and invalidate only when it changes AFTERWARDS (account switch, sign-in
    // from an anonymous tab, sign-out).
    if (!isLoaded) return;
    const identity = `${userId ?? ''}:${sessionId ?? ''}`;
    const previous = lastIdentity.current;
    lastIdentity.current = identity;
    if (previous !== null && previous !== identity) {
      invalidateCapabilitiesCache();
    }
  }, [isLoaded, userId, sessionId]);

  return null;
}
