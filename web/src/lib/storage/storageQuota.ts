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
 * Keys that form an atomic group — evicting one requires evicting all.
 * Each group is identified by its primary key; satellite keys share the
 * same timestamp source (`forge:autosave:time` for the autosave triplet).
 */
const AUTOSAVE_GROUPS: ReadonlyArray<{
  primary: string;
  keys: readonly string[];
  timestampKey: string;
}> = [
  {
    primary: 'forge:autosave',
    keys: ['forge:autosave', 'forge:autosave:name', 'forge:autosave:time'],
    timestampKey: 'forge:autosave:time',
  },
];

/**
 * Estimate localStorage usage by summing all key+value lengths as UTF-16
 * (each character = 2 bytes).
 *
 * Total capacity is probed via binary search up to 5 MB (common browser
 * default). The probe writes increasing chunks until QuotaExceededError to
 * determine available free space, capped at 5 MB.
 * Falls back to 5 MB if probing is unavailable.
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

  const totalBytes = getCachedCapacity(usedBytes);
  const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  return { usedBytes, totalBytes, usagePercent };
}

/** Cached total capacity — probed once per session to avoid main-thread stalls. */
// Exported for tests only via _resetCapacityCache()
let cachedTotalCapacity: number | null = null;

/** @internal Reset the cached capacity — for tests only. */
export function _resetCapacityCache(): void {
  cachedTotalCapacity = null;
}

/** Return cached capacity or probe once and cache. */
function getCachedCapacity(currentUsedBytes: number): number {
  if (cachedTotalCapacity !== null) return cachedTotalCapacity;
  cachedTotalCapacity = probeLocalStorageCapacity(currentUsedBytes);
  return cachedTotalCapacity;
}

/**
 * Probe total localStorage capacity.
 * Binary-searches for available free space up to 5 MB (DEFAULT_TOTAL).
 * The probe is capped at this ceiling — browsers with larger quotas will
 * still report at most ~5 MB.  Returns estimated total = used + free.
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
  /** All keys that belong to this logical entry (evicted/kept as a unit). */
  keys: string[];
  timestamp: number;
  sizeBytes: number;
}

/**
 * Collect all auto-save related keys, sorted oldest-first by embedded
 * timestamp.  Keys with no parseable timestamp are treated as oldest (0).
 *
 * Keys that belong to an atomic group (e.g. the autosave triplet) are
 * merged into a single entry so they are evicted or kept together.
 */
function collectAutoSaveEntries(): AutoSaveEntry[] {
  const entries: AutoSaveEntry[] = [];
  const groupedKeys = new Set<string>();

  try {
    // First pass: emit grouped entries
    for (const group of AUTOSAVE_GROUPS) {
      const presentKeys: string[] = [];
      let sizeBytes = 0;

      for (const gk of group.keys) {
        const val = localStorage.getItem(gk);
        if (val !== null) {
          presentKeys.push(gk);
          sizeBytes += (gk.length + val.length) * 2;
          groupedKeys.add(gk);
        }
      }

      if (presentKeys.length === 0) continue;

      // Use the dedicated timestamp key for ordering
      let timestamp = 0;
      const tsVal = localStorage.getItem(group.timestampKey);
      if (tsVal !== null) {
        const t = new Date(tsVal).getTime();
        if (!Number.isNaN(t)) timestamp = t;
      }

      entries.push({ keys: presentKeys, timestamp, sizeBytes });
    }

    // Second pass: ungrouped auto-save keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || groupedKeys.has(key)) continue;

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

      entries.push({ keys: [key], timestamp, sizeBytes });
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
export function evictOldAutoSaves(
  keepCount = 2,
  protectedKeys?: ReadonlySet<string>,
): number {
  const entries = collectAutoSaveEntries();
  const toEvict = entries.slice(0, Math.max(0, entries.length - keepCount));

  let freedBytes = 0;
  for (const entry of toEvict) {
    // Skip entries that contain any protected key
    if (protectedKeys && entry.keys.some((k) => protectedKeys.has(k))) {
      continue;
    }
    for (const key of entry.keys) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore individual failures
      }
    }
    freedBytes += entry.sizeBytes;
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
 * Pass `protectedKeys` to prevent specific keys from being evicted
 * (e.g. sibling keys being written in the same batch).
 * Returns `{ success, evicted }`.
 */
export function safeLocalStorageSet(
  key: string,
  value: string,
  protectedKeys?: ReadonlySet<string>,
): SafeSetResult {
  try {
    localStorage.setItem(key, value);
    return { success: true, evicted: 0 };
  } catch (err) {
    if (!isQuotaError(err)) {
      return { success: false, evicted: 0 };
    }

    // Evict all old auto-saves (keep 0) to free as much space as possible,
    // but skip any keys the caller is currently writing.
    const evicted = evictOldAutoSaves(0, protectedKeys);

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
