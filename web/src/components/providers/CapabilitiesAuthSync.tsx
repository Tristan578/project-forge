'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { invalidateCapabilitiesCache } from '@/hooks/useFeatureGating';

/** Mounted only under ClerkProvider; refresh per-user data when sessions change. */
export function CapabilitiesAuthSync() {
  const { isLoaded, userId, sessionId } = useAuth();
  useEffect(() => {
    invalidateCapabilitiesCache();
  }, [isLoaded, userId, sessionId]);
  return null;
}
