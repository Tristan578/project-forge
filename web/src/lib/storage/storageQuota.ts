/**
 * Client-side localStorage quota management.
 *
 * Provides estimation, threshold checking, LRU eviction of auto-save entries,
 * and a safe write wrapper that evicts on QuotaExceededError.
 */

export interface StorageEstimate {
  usedBytes: number;
  totalBytes: number;
  usagePercent: number;
}

/** Auto-save key prefixes used by sceneFile.ts and WasmErrorBoundary.tsx */
const AUTOSAVE_KEY_PATTERNS = [
  'forge:autosave',
  'forge-autosave-',
  'forge-editor-crash-backup',
];

/**
 * Estimate localStorage usage by summing all key+value lengths as UTF-16
 * (each character = 2 bytes).
 *
 * Total capacity is estimated by probing: we attempt to write increasing
 * chunks until QuotaExceededError, then binary-search for the true limit.
 * Falls back to 5 MB (common browser default) if probing is unavailable.
 */
export function estimateLocalStorageUsage(): StorageEstimate {
  let usedBytes = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) {
        const value = localStorage.getItem(key) ?? '';
        // UTF-16: 2 bytes per character
        usedBytes += (key.length + value.length) * 2;
      }
    }
  } catch {
    // localStorage may be unavailable in certain contexts
    usedBytes = 0;
  }

  const totalBytes = probeLocalStorageCapacity(usedBytes);
  const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  return { usedBytes, totalBytes, usagePercent };
}

/**
 * Probe total localStorage capacity.
 * Writes a test key with increasing sizes until QuotaExceededError,
 * then returns estimated total = used + free.
 */
function probeLocalStorageCapacity(currentUsedBytes: number): number {
  const PROBE_KEY = '__forge_quota_probe__';
  const DEFAULT_TOTAL = 5 * 1024 * 1024; // 5 MB fallback

  try {
    // Remove any previous probe key
    localStorage.removeItem(PROBE_KEY);

    // Binary search for available free space
    let lo = 0;
    let hi = DEFAULT_TOTAL;
    let lastSuccess = 0;

    while (hi - lo > 1024) {
      const mid = Math.floor((lo + hi) / 2);
      try {
        // Each 'a' is 1 char = 2 bytes UTF-16; divide by 2 to get char count
        localStorage.setItem(PROBE_KEY, 'a'.repeat(Math.floor(mid / 2)));
        lastSuccess = mid;
        lo = mid;
      } catch {
        hi = mid;
      }
    }

    localStorage.removeItem(PROBE_KEY);
    return currentUsedBytes + lastSuccess;
  } catch {
    return DEFAULT_TOTAL;
  }
}

/**
 * Check whether writing `sizeBytes` more data would push usage above
 * `threshold` percent (default 80%).
 */
export function wouldExceedThreshold(sizeBytes: number, threshold = 80): boolean {
  const { usedBytes, totalBytes } = estimateLocalStorageUsage();
  if (totalBytes === 0) return true;
  const projectedPercent = ((usedBytes + sizeBytes) / totalBytes) * 100;
  return projectedPercent >= threshold;
}

/** Metadata about an auto-save entry discovered in localStorage. */
interface AutoSaveEntry {
  key: string;
  timestamp: number;
  sizeBytes: number;
}

/**
 * Collect all auto-save related keys, sorted oldest-first by embedded
 * timestamp.  Keys with no parseable timestamp are treated as oldest (0).
 */
function collectAutoSaveEntries(): AutoSaveEntry[] {
  const entries: AutoSaveEntry[] = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;

      const isAutoSave = AUTOSAVE_KEY_PATTERNS.some((p) => key.startsWith(p));
      if (!isAutoSave) continue;

      const value = localStorage.getItem(key) ?? '';
      const sizeBytes = (key.length + value.length) * 2;

      // Try to extract timestamp from the value (ISO date string embedded in JSON)
      let timestamp = 0;
      try {
        const parsed = JSON.parse(value) as unknown;
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'timestamp' in parsed &&
          typeof (parsed as Record<string, unknown>).timestamp === 'string'
        ) {
          timestamp = new Date((parsed as Record<string, string>).timestamp).getTime();
        }
      } catch {
        // Non-JSON values: use 0 so they're evicted first
      }

      entries.push({ key, timestamp, sizeBytes });
    }
  } catch {
    // localStorage unavailable
  }

  // Sort oldest-first
  entries.sort((a, b) => a.timestamp - b.timestamp);
  return entries;
}

/**
 * Evict old auto-save entries, keeping only the most recent `keepCount`
 * entries (default 2).  Returns the total bytes freed.
 */
export function evictOldAutoSaves(keepCount = 2): number {
  const entries = collectAutoSaveEntries();
  const toEvict = entries.slice(0, Math.max(0, entries.length - keepCount));

  let freedBytes = 0;
  for (const entry of toEvict) {
    try {
      localStorage.removeItem(entry.key);
      freedBytes += entry.sizeBytes;
    } catch {
      // ignore individual failures
    }
  }

  return freedBytes;
}

export interface SafeSetResult {
  success: boolean;
  /** Total bytes freed by eviction (0 if no eviction was needed). */
  evicted: number;
}

/**
 * Write `value` to localStorage under `key`.
 *
 * On QuotaExceededError: evict ALL old auto-saves and retry once.
 * Returns `{ success, evicted }`.
 */
export function safeLocalStorageSet(key: string, value: string): SafeSetResult {
  try {
    localStorage.setItem(key, value);
    return { success: true, evicted: 0 };
  } catch (err) {
    if (!isQuotaError(err)) {
      return { success: false, evicted: 0 };
    }

    // Evict all old auto-saves (keep 0) to free as much space as possible
    const evicted = evictOldAutoSaves(0);

    try {
      localStorage.setItem(key, value);
      return { success: true, evicted };
    } catch {
      return { success: false, evicted };
    }
  }
}

/** Detect QuotaExceededError across browsers.
 *
 * NOTE: In some environments (jsdom, older Safari) `DOMException` does not
 * extend `Error`, so we must not gate the check on `instanceof Error`.
 */
function isQuotaError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    message.includes('quota')
  );
}
