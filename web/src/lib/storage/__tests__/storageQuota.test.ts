import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  estimateLocalStorageUsage,
  wouldExceedThreshold,
  evictOldAutoSaves,
  safeLocalStorageSet,
  _resetCapacityCache,
  type StorageEstimate,
} from '../storageQuota';

// ---------------------------------------------------------------------------
// In-memory localStorage substitute
// ---------------------------------------------------------------------------

/**
 * Creates a self-contained in-memory localStorage store with an optional
 * quota.  All tests install spies via `installStoreSpy(s)` so that the
 * module-level `localStorage` identifier sees the controlled implementation.
 */
function buildStore(quotaBytes = 100_000) {
  const data: Record<string, string> = {};

  function bytes(): number {
    return Object.entries(data).reduce((acc, [k, v]) => acc + (k.length + v.length) * 2, 0);
  }

  return {
    data,
    api: {
      get length() { return Object.keys(data).length; },
      key(index: number) { return Object.keys(data)[index] ?? null; },
      getItem(key: string) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
      setItem(key: string, value: string) {
        const existing = data[key] ?? null;
        const keyDelta = existing === null ? key.length * 2 : 0;
        const valueDelta = (value.length - (existing?.length ?? 0)) * 2;
        const delta = keyDelta + valueDelta;
        if (bytes() + delta > quotaBytes) {
          // DOMException.name must be set explicitly (message is the first arg)
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        }
        data[key] = value;
      },
      removeItem(key: string) { delete data[key]; },
      clear() { Object.keys(data).forEach((k) => delete data[k]); },
    },
  };
}

/** Install spies on the real `localStorage` object using the provided store. */
function installStoreSpy(store: ReturnType<typeof buildStore>) {
  // Node 22's localStorage is a Proxy where defineProperty on 'length' fails.
  // Replace the entire globalThis.localStorage with a plain object that supports spying.
  const mock = {
    get length() { return store.api.length; },
    key: (i: number) => store.api.key(i),
    getItem: (k: string) => store.api.getItem(k),
    setItem: (k: string, v: string) => store.api.setItem(k, v),
    removeItem: (k: string) => store.api.removeItem(k),
    clear: () => store.api.clear(),
  } as unknown as Storage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Capture the original localStorage for restoration after each test
const _originalLocalStorage = globalThis.localStorage;

describe('storageQuota', () => {
  afterEach(() => {
    // Restore original localStorage (installStoreSpy replaces it)
    Object.defineProperty(globalThis, 'localStorage', {
      value: _originalLocalStorage,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
    _resetCapacityCache();
  });

  // -------------------------------------------------------------------------
  // estimateLocalStorageUsage
  // -------------------------------------------------------------------------

  describe('estimateLocalStorageUsage', () => {
    it('returns zero usedBytes when localStorage is empty', () => {
      const s = buildStore(10_000);
      installStoreSpy(s);

      const result: StorageEstimate = estimateLocalStorageUsage();
      expect(result.usedBytes).toBe(0);
    });

    it('counts key + value lengths as UTF-16 (2 bytes per char)', () => {
      const s = buildStore(10_000);
      s.data['ab'] = 'cdef'; // key=2, value=4 → (2+4)*2 = 12 bytes
      installStoreSpy(s);

      const { usedBytes } = estimateLocalStorageUsage();
      expect(usedBytes).toBe(12);
    });

    it('reports usagePercent between 0 and 100 inclusive', () => {
      const s = buildStore(10_000);
      s.data['key'] = 'val';
      installStoreSpy(s);

      const { usagePercent } = estimateLocalStorageUsage();
      expect(usagePercent).toBeGreaterThanOrEqual(0);
      expect(usagePercent).toBeLessThanOrEqual(100);
    });

    it('totalBytes is at least as large as usedBytes', () => {
      const s = buildStore(10_000);
      s.data['hello'] = 'world';
      installStoreSpy(s);

      const { usedBytes, totalBytes } = estimateLocalStorageUsage();
      expect(totalBytes).toBeGreaterThanOrEqual(usedBytes);
    });
  });

  // -------------------------------------------------------------------------
  // wouldExceedThreshold
  // -------------------------------------------------------------------------

  describe('wouldExceedThreshold', () => {
    it('returns false when projected usage is below threshold', () => {
      const s = buildStore(10_000);
      installStoreSpy(s);

      expect(wouldExceedThreshold(100, 80)).toBe(false);
    });

    it('returns true when projected usage equals or exceeds threshold', () => {
      const s = buildStore(10_000);
      // Fill ~79 %: key '__fill__' (8 chars) + value (3942 chars) = 3950 chars = 7900 bytes
      s.data['__fill__'] = 'x'.repeat(3942);
      installStoreSpy(s);

      // Adding 100 more bytes should push to/over 80 %
      expect(wouldExceedThreshold(100, 80)).toBe(true);
    });

    it('defaults threshold to 80', () => {
      const s = buildStore(10_000);
      installStoreSpy(s);

      expect(wouldExceedThreshold(0)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // evictOldAutoSaves
  // -------------------------------------------------------------------------

  describe('evictOldAutoSaves', () => {
    it('removes oldest auto-save entries, keeping keepCount most recent', () => {
      const s = buildStore(100_000);
      s.data['forge:autosave'] = JSON.stringify({ timestamp: '2024-01-01T00:00:00.000Z', state: 'old' });
      s.data['forge-autosave-2'] = JSON.stringify({ timestamp: '2024-02-01T00:00:00.000Z', state: 'mid' });
      s.data['forge-autosave-3'] = JSON.stringify({ timestamp: '2024-03-01T00:00:00.000Z', state: 'new' });
      installStoreSpy(s);

      evictOldAutoSaves(1);

      expect(s.data['forge-autosave-3']).toBeDefined();
      expect(s.data['forge:autosave']).toBeUndefined();
      expect(s.data['forge-autosave-2']).toBeUndefined();
    });

    it('returns the number of bytes freed', () => {
      const s = buildStore(100_000);
      s.data['forge:autosave'] = JSON.stringify({ timestamp: '2024-01-01T00:00:00.000Z', state: 'a' });
      s.data['forge-autosave-newer'] = JSON.stringify({ timestamp: '2025-01-01T00:00:00.000Z', state: 'b' });
      installStoreSpy(s);

      const freed = evictOldAutoSaves(1);
      expect(freed).toBeGreaterThan(0);
    });

    it('does not evict anything when there are fewer entries than keepCount', () => {
      const s = buildStore(100_000);
      s.data['forge:autosave'] = JSON.stringify({ timestamp: '2024-01-01T00:00:00.000Z', state: 'only' });
      installStoreSpy(s);

      const freed = evictOldAutoSaves(2);
      expect(freed).toBe(0);
      expect(s.data['forge:autosave']).toBeDefined();
    });

    it('treats entries without parseable timestamps as oldest (evicted first)', () => {
      const s = buildStore(100_000);
      s.data['forge:autosave'] = 'plain-string-no-timestamp';
      s.data['forge-autosave-newer'] = JSON.stringify({ timestamp: '2025-01-01T00:00:00.000Z', state: 'new' });
      installStoreSpy(s);

      evictOldAutoSaves(1);

      expect(s.data['forge:autosave']).toBeUndefined();
      expect(s.data['forge-autosave-newer']).toBeDefined();
    });

    it('evicts the autosave triplet atomically (all three keys together)', () => {
      const s = buildStore(100_000);
      // Real autosave triplet format: plain strings, not JSON with timestamps
      s.data['forge:autosave'] = '{"formatVersion":3,"entities":[]}';
      s.data['forge:autosave:name'] = 'My Scene';
      s.data['forge:autosave:time'] = '2024-01-01T00:00:00.000Z';
      // A newer standalone entry
      s.data['forge-autosave-other'] = JSON.stringify({ timestamp: '2025-06-01T00:00:00.000Z', state: 'newer' });
      installStoreSpy(s);

      evictOldAutoSaves(1);

      // The triplet (older) should be evicted as a unit
      expect(s.data['forge:autosave']).toBeUndefined();
      expect(s.data['forge:autosave:name']).toBeUndefined();
      expect(s.data['forge:autosave:time']).toBeUndefined();
      // The newer standalone entry should be kept
      expect(s.data['forge-autosave-other']).toBeDefined();
    });

    it('does not partially evict the autosave triplet', () => {
      const s = buildStore(100_000);
      s.data['forge:autosave'] = '{"formatVersion":3,"entities":[{"id":"1"}]}';
      s.data['forge:autosave:name'] = 'Test';
      s.data['forge:autosave:time'] = '2025-01-01T00:00:00.000Z';
      installStoreSpy(s);

      // Keep 1 — the triplet is the only group, so nothing is evicted
      evictOldAutoSaves(1);

      expect(s.data['forge:autosave']).toBeDefined();
      expect(s.data['forge:autosave:name']).toBeDefined();
      expect(s.data['forge:autosave:time']).toBeDefined();
    });

    it('respects protectedKeys and skips protected entries during eviction', () => {
      const s = buildStore(100_000);
      s.data['forge:autosave'] = '{"formatVersion":3}';
      s.data['forge:autosave:name'] = 'Protected';
      s.data['forge:autosave:time'] = '2024-01-01T00:00:00.000Z';
      installStoreSpy(s);

      const protectedKeys = new Set(['forge:autosave', 'forge:autosave:name', 'forge:autosave:time']);
      const freed = evictOldAutoSaves(0, protectedKeys);

      // Nothing should be evicted because all keys are protected
      expect(freed).toBe(0);
      expect(s.data['forge:autosave']).toBeDefined();
      expect(s.data['forge:autosave:name']).toBeDefined();
      expect(s.data['forge:autosave:time']).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // safeLocalStorageSet
  // -------------------------------------------------------------------------

  describe('safeLocalStorageSet', () => {
    it('returns success=true when write succeeds without eviction', () => {
      const s = buildStore(100_000);
      installStoreSpy(s);

      const result = safeLocalStorageSet('test-key', 'test-value');
      expect(result.success).toBe(true);
      expect(result.evicted).toBe(0);
    });

    it('stores the value in localStorage', () => {
      const s = buildStore(100_000);
      installStoreSpy(s);

      safeLocalStorageSet('my-key', 'my-value');
      expect(s.data['my-key']).toBe('my-value');
    });

    it('evicts old auto-saves on QuotaExceededError and retries', () => {
      // Build a store whose quota is just barely too small for a new write
      // on top of an existing auto-save entry, but large enough once the
      // auto-save is evicted.
      //
      // auto-save: key=14 chars, value=50 chars → (64)*2 = 128 bytes used
      // new write: key=7 chars, value=27 chars → delta = (27)*2 = 54 bytes
      // quota = 128 + 10 = 138 → first write: 128+54=182 > 138 → throws
      //                        → after eviction: 0+54 < 138 → succeeds
      const autosaveValue = JSON.stringify({ timestamp: '2020-01-01T00:00:00.000Z', x: '123' });
      // autosaveValue.length === 50 chars; key 'forge:autosave'.length === 14 chars
      const existingBytes = ('forge:autosave'.length + autosaveValue.length) * 2;
      const s = buildStore(existingBytes + 10);

      s.data['forge:autosave'] = autosaveValue;
      installStoreSpy(s);

      const newKey = 'new-key';
      const newValue = 'this-is-new-value'; // 17 chars
      const result = safeLocalStorageSet(newKey, newValue);

      expect(result.success).toBe(true);
      expect(result.evicted).toBeGreaterThan(0);
      expect(s.data[newKey]).toBe(newValue);
    });

    it('returns success=false when storage is full even after eviction', () => {
      // Quota of 0 — every write fails
      const s = buildStore(0);
      installStoreSpy(s);

      const result = safeLocalStorageSet('k', 'v');
      expect(result.success).toBe(false);
    });
  });
});
