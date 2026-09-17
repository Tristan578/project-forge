'use client';

/** Collect an explicit analytics consent choice with accessible shared controls. */

import { useCallback, useSyncExternalStore } from 'react';
import { Button } from '@spawnforge/ui';
import { initPostHog } from '@/lib/analytics/posthog';

const STORAGE_KEY = 'forge-cookie-consent';

/**
 * Safe localStorage accessor — returns null/no-ops when localStorage is
 * unavailable (e.g. Android WebViews with storage disabled, private browsing).
 */
const safeLocalStorage = {
  getItem(key: string): string | null {
    try {
      return window.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage?.setItem(key, value);
    } catch {
      // Storage unavailable — silently no-op
    }
  },
};

/**
 * Mirror the consent choice into a server-readable cookie so server-side
 * analytics (e.g. LLM observability, PF-907) can honor it — `localStorage` is
 * client-only and invisible to route handlers. Non-`HttpOnly` so the client
 * keeps managing it; site-wide; ~1 year; `Lax` to allow top-level navigations;
 * `Secure` only over https (so it still works on the local http dev origin).
 */
function setConsentCookie(consented: boolean) {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${STORAGE_KEY}=${consented ? 'true' : 'false'}; path=/; max-age=31536000; SameSite=Lax${secure}`;
}

function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getConsentSnapshot(): boolean {
  return safeLocalStorage.getItem(STORAGE_KEY) !== null;
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
 * @returns An accessible consent banner, or null after a stored choice. Accept
 * writes storage/cookie consent and requests analytics initialization; Decline
 * writes a denial without initializing analytics.
 */
export function CookieConsent() {
  const hasInteracted = useSyncExternalStore(subscribeToStorage, getConsentSnapshot, getServerSnapshot);

  const handleAccept = useCallback(() => {
    safeLocalStorage.setItem(STORAGE_KEY, 'true');
    setConsentCookie(true);
    initPostHog();
    // Force re-render via storage event won't fire in same tab — trigger
    // by dispatching a synthetic event so useSyncExternalStore picks it up.
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  }, []);

  const handleDecline = useCallback(() => {
    safeLocalStorage.setItem(STORAGE_KEY, 'false');
    setConsentCookie(false);
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
        Optional analytics cookies help us improve SpawnForge. You can accept or decline them.
      </p>
      <div className="flex gap-2">
        <Button
          onClick={handleAccept}
          size="sm"
          className="min-h-[44px] min-w-[44px]"
        >
          Accept
        </Button>
        <Button
          onClick={handleDecline}
          variant="secondary"
          size="sm"
          className="min-h-[44px] min-w-[44px]"
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
