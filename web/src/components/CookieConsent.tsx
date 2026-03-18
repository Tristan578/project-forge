'use client';

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'forge-cookie-consent';

/**
 * Returns the initial consent state by reading localStorage during the first
 * client-side render. Returns null during SSR (window is undefined) so the
 * banner is suppressed server-side — this avoids hydration mismatches because
 * localStorage is unavailable in the Node.js SSR environment.
 *
 * On the client:
 *  - null in localStorage  → returns false (banner visible, user hasn't responded)
 *  - 'true' in localStorage → returns true  (banner hidden, user accepted)
 *  - 'false' in localStorage → returns false (banner visible on next load if they declined)
 */
function readConsentFromStorage(): boolean | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  // Any stored value ('true' or 'false') means the user has already interacted
  return stored !== null;
}

/**
 * Cookie consent banner. Uses a lazy useState initializer instead of useEffect
 * to read localStorage, so consent state is available synchronously on the
 * first client-side render without causing cascading re-renders.
 */
export function CookieConsent() {
  const [consented, setConsented] = useState<boolean | null>(readConsentFromStorage);

  const handleAccept = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setConsented(true);
  }, []);

  const handleDecline = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'false');
    setConsented(true);
  }, []);

  // Don't render during SSR (null) or if already consented/interacted
  if (consented !== false) return null;

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
