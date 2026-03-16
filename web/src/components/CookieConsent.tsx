'use client';

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'forge-cookie-consent';

/**
 * Read consent state from localStorage. Returns false (show banner)
 * when no consent has been stored. Safe to call during SSR — returns
 * true (hide banner) when localStorage is unavailable.
 */
function hasStoredConsent(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/**
 * Cookie consent banner. Uses a lazy useState initializer to read
 * localStorage, avoiding both SSR hydration mismatches and the
 * react-hooks/set-state-in-effect lint rule.
 */
export function CookieConsent() {
  const [consented, setConsented] = useState(hasStoredConsent);

  const handleAccept = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setConsented(true);
  }, []);

  const handleDecline = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'false');
    setConsented(true);
  }, []);

  if (consented) return null;

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
