/**
 * Safe localStorage wrappers for environments where storage may be unavailable
 * (private browsing, strict tracking prevention, storage quota exceeded).
 */

/** Returns null if storage is unavailable or the key doesn't exist. */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Silently ignores write failures (quota exceeded, storage unavailable). */
export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — silently ignore
  }
}
