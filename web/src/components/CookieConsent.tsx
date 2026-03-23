'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { initPostHog } from '@/lib/analytics/posthog';

const STORAGE_KEY = 'forge-cookie-consent';

function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getConsentSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

function getServerSnapshot(): boolean {
  // Return true (hide banner) during SSR to match the initial client render
  // after useSyncExternalStore resolves. This prevents hydration mismatch.
  return true;
}

/**
 * Cookie consent banner. Uses useSyncExternalStore so localStorage is read
 * hydration-safe: getServerSnapshot returns true (banner hidden), matching
 * the SSR output. After hydration the client snapshot takes over — if the
 * user hasn't interacted yet (no key in localStorage), the banner appears.
 */
export function CookieConsent() {
  const hasInteracted = useSyncExternalStore(subscribeToStorage, getConsentSnapshot, getServerSnapshot);

  const handleAccept = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    initPostHog();
    // Force re-render via storage event won't fire in same tab — trigger
    // by dispatching a synthetic event so useSyncExternalStore picks it up.
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  }, []);

  const handleDecline = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  }, []);

  // Already interacted → hide banner
  if (hasInteracted) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl sm:left-auto sm:right-4"
      role="region"
      aria-label="Cookie consent"
    >
      <p className="mb-3 text-sm text-zinc-300">
        We use cookies to improve your experience. By continuing to use SpawnForge, you agree to our use of cookies.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleAccept}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Accept
        </button>
        <button
          onClick={handleDecline}
          className="rounded bg-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
