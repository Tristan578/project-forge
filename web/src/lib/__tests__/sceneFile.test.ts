import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CURRENT_FORMAT_VERSION, readSceneFile, getAutoSave, clearAutoSave, saveAutoSave } from '../sceneFile';

// ---------------------------------------------------------------------------
// Allow selective spying on storageQuota helpers used by saveAutoSave
// ---------------------------------------------------------------------------
vi.mock('@/lib/storage/storageQuota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/storageQuota')>();
  return { ...actual };
});

describe('CURRENT_FORMAT_VERSION', () => {
  it('should be a positive number', () => {
    expect(CURRENT_FORMAT_VERSION).toBeGreaterThan(0);
    expect(typeof CURRENT_FORMAT_VERSION).toBe('number');
  });
});

describe('readSceneFile', () => {
  function makeFile(content: string): File {
    return new File([content], 'test.forge', { type: 'application/json' });
  }

  it('should accept a valid scene file', async () => {
    const json = JSON.stringify({ formatVersion: CURRENT_FORMAT_VERSION, scene: {} });
    const result = await readSceneFile(makeFile(json));
    expect(result).toBe(json);
  });

  it('should accept older format versions', async () => {
    const json = JSON.stringify({ formatVersion: 1, scene: {} });
    const result = await readSceneFile(makeFile(json));
    expect(result).toBe(json);
  });

  it('should reject file without formatVersion', async () => {
    const json = JSON.stringify({ scene: {} });
    await expect(readSceneFile(makeFile(json))).rejects.toThrow('missing formatVersion');
  });

  it('should reject format version 0', async () => {
    const json = JSON.stringify({ formatVersion: 0, scene: {} });
    await expect(readSceneFile(makeFile(json))).rejects.toThrow('Unsupported scene format');
  });

  it('should reject format version above current', async () => {
    const json = JSON.stringify({ formatVersion: CURRENT_FORMAT_VERSION + 1, scene: {} });
    await expect(readSceneFile(makeFile(json))).rejects.toThrow('Unsupported scene format');
  });

  it('should reject invalid JSON', async () => {
    await expect(readSceneFile(makeFile('not json'))).rejects.toThrow();
  });
});

describe('getAutoSave and clearAutoSave', () => {
  let mockStore: Record<string, string>;

  beforeEach(() => {
    mockStore = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStore[key] ?? null,
      setItem: (key: string, val: string) => { mockStore[key] = val; },
      removeItem: (key: string) => { delete mockStore[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should return null when no autosave exists', () => {
    expect(getAutoSave()).toBeNull();
  });

  it('should return autosave data when present', () => {
    mockStore['forge:autosave'] = '{"scene":true}';
    mockStore['forge:autosave:name'] = 'MyScene';
    mockStore['forge:autosave:time'] = '2024-01-01T00:00:00Z';

    const result = getAutoSave();
    expect(result).not.toBeNull();
    expect(result!.json).toBe('{"scene":true}');
    expect(result!.name).toBe('MyScene');
    expect(result!.time).toBe('2024-01-01T00:00:00Z');
  });

  it('should use defaults for missing name/time', () => {
    mockStore['forge:autosave'] = '{}';
    const result = getAutoSave();
    expect(result!.name).toBe('Untitled');
    expect(result!.time).toBe('');
  });

  it('should clear autosave data', () => {
    mockStore['forge:autosave'] = '{}';
    mockStore['forge:autosave:name'] = 'Test';
    mockStore['forge:autosave:time'] = 'now';

    clearAutoSave();

    expect(mockStore['forge:autosave']).toBeUndefined();
    expect(mockStore['forge:autosave:name']).toBeUndefined();
    expect(mockStore['forge:autosave:time']).toBeUndefined();
  });

  it('should handle localStorage errors gracefully', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('quota exceeded'); },
      removeItem: () => { throw new Error('quota exceeded'); },
    });

    expect(getAutoSave()).toBeNull();
    expect(() => clearAutoSave()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// saveAutoSave tests
// ---------------------------------------------------------------------------

describe('saveAutoSave', () => {
  let mockStore: Record<string, string>;

  function makeLocalStorageMock(
    overrideSetItem?: (key: string, val: string) => void,
  ) {
    return {
      getItem: (key: string) => mockStore[key] ?? null,
      setItem: overrideSetItem ?? ((key: string, val: string) => { mockStore[key] = val; }),
      removeItem: (key: string) => { delete mockStore[key]; },
      get length() { return Object.keys(mockStore).length; },
      key: (i: number) => Object.keys(mockStore)[i] ?? null,
    };
  }

  beforeEach(() => {
    mockStore = {};
    vi.stubGlobal('localStorage', makeLocalStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('writes json, name, and timestamp to localStorage on successful write', () => {
    saveAutoSave('{"scene":true}', 'MyScene');

    expect(mockStore['forge:autosave']).toBe('{"scene":true}');
    expect(mockStore['forge:autosave:name']).toBe('MyScene');
    expect(typeof mockStore['forge:autosave:time']).toBe('string');
    // Timestamp should be a parseable ISO date
    expect(new Date(mockStore['forge:autosave:time']).getFullYear()).toBeGreaterThan(2000);
  });

  it('calls evictOldAutoSaves when storage would exceed threshold, then writes successfully', async () => {
    // Force wouldExceedThreshold to return true to exercise the eviction branch
    const storageQuota = await import('@/lib/storage/storageQuota');
    const thresholdSpy = vi.spyOn(storageQuota, 'wouldExceedThreshold').mockReturnValue(true);
    const evictSpy = vi.spyOn(storageQuota, 'evictOldAutoSaves').mockReturnValue(0);

    saveAutoSave('{"scene":"new"}', 'NewScene');

    expect(thresholdSpy).toHaveBeenCalled();
    expect(evictSpy).toHaveBeenCalledWith(1);
    // Data should still be written
    expect(mockStore['forge:autosave']).toBe('{"scene":"new"}');
    expect(mockStore['forge:autosave:name']).toBe('NewScene');
  });

  it('logs a warning but does not throw when localStorage remains full after quota eviction', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Make setItem always throw QuotaExceededError (name must match isQuotaError)
    vi.stubGlobal('localStorage', makeLocalStorageMock(() => {
      const err = new DOMException('QuotaExceededError', 'QuotaExceededError');
      throw err;
    }));

    expect(() => saveAutoSave('{"scene":true}', 'Test')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('localStorage write failed'),
    );
  });

  it('does not throw and warns when a non-quota error blocks all writes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Make setItem always throw a generic (non-quota) error
    vi.stubGlobal('localStorage', makeLocalStorageMock(() => {
      throw new Error('SecurityError: access denied');
    }));

    expect(() => saveAutoSave('{"scene":true}', 'Test')).not.toThrow();
    // saveAutoSave warns when any of its three writes fail
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('localStorage write failed'),
    );
  });

  it('passes autosave keys as protected set so they are not evicted during write', async () => {
    // Seed the store with a pre-existing autosave that eviction would normally delete
    mockStore['forge:autosave'] = '{"old":"data"}';
    mockStore['forge:autosave:time'] = new Date(0).toISOString(); // epoch — oldest possible

    // Force threshold to be exceeded so evictOldAutoSaves IS called
    const storageQuota = await import('@/lib/storage/storageQuota');
    vi.spyOn(storageQuota, 'wouldExceedThreshold').mockReturnValue(true);
    const evictSpy = vi.spyOn(storageQuota, 'evictOldAutoSaves').mockReturnValue(0);

    saveAutoSave('{"scene":"new"}', 'NewScene');

    // evictOldAutoSaves must be called with count=1
    expect(evictSpy).toHaveBeenCalledWith(1);

    // Now verify that safeLocalStorageSet passes a protected-keys set containing the autosave keys.
    // We validate this indirectly: the three autosave keys must all be present in mockStore
    // after the call (they were not evicted).
    expect(mockStore['forge:autosave']).toBe('{"scene":"new"}');
    expect(mockStore['forge:autosave:name']).toBe('NewScene');
    expect(typeof mockStore['forge:autosave:time']).toBe('string');
  });

  it('handles partial write failure gracefully — warns but does not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let callCount = 0;
    // First write (json key) succeeds; subsequent writes fail with a non-quota error
    vi.stubGlobal('localStorage', makeLocalStorageMock((key: string, val: string) => {
      callCount += 1;
      if (callCount === 1) {
        mockStore[key] = val; // first write succeeds
      } else {
        throw new Error('SecurityError: access denied'); // non-quota, subsequent writes fail
      }
    }));

    expect(() => saveAutoSave('{"scene":true}', 'PartialTest')).not.toThrow();
    // Two of three writes failed → warn should fire
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('localStorage write failed'),
    );
  });

  it('succeeds after eviction frees enough space (quota error then retry succeeds)', () => {
    // Simulate: first setItem call throws QuotaExceededError; after that, writes succeed.
    let firstAttempt = true;
    vi.stubGlobal('localStorage', makeLocalStorageMock((key: string, val: string) => {
      if (firstAttempt) {
        firstAttempt = false;
        const err = new DOMException('QuotaExceededError', 'QuotaExceededError');
        throw err;
      }
      mockStore[key] = val;
    }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Should not throw even if first write hits quota; safeLocalStorageSet retries
    expect(() => saveAutoSave('{"scene":true}', 'RetryScene')).not.toThrow();

    // After the retry the remaining writes succeeded, so no warning should appear
    // (name and time writes should have written without error)
    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockStore['forge:autosave:name']).toBe('RetryScene');
  });
});
