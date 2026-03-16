import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CURRENT_FORMAT_VERSION, readSceneFile, migrateScene, getAutoSave, clearAutoSave, saveAutoSave } from '../sceneFile';

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

describe('migrateScene', () => {
  it('should migrate v1 to v2 by adding postProcessing, audioBuses, gameUi', () => {
    const v1 = { formatVersion: 1, scene: { name: 'test' } };
    const v2 = migrateScene(v1, 1, 2);
    expect(v2.formatVersion).toBe(2);
    expect(v2.postProcessing).toEqual({});
    expect(v2.audioBuses).toEqual({});
    expect(v2.gameUi).toBeNull();
    expect(v2.scene).toEqual({ name: 'test' });
  });

  it('should migrate v2 to v3 by adding customWgslSource and assets', () => {
    const v2 = { formatVersion: 2, postProcessing: { bloom: true }, audioBuses: {}, gameUi: null };
    const v3 = migrateScene(v2, 2, 3);
    expect(v3.formatVersion).toBe(3);
    expect(v3.customWgslSource).toBeNull();
    expect(v3.assets).toEqual({});
    expect(v3.postProcessing).toEqual({ bloom: true });
  });

  it('should run full migration chain from v1 to v3', () => {
    const v1 = { formatVersion: 1, metadata: { name: 'OldScene' } };
    const v3 = migrateScene(v1, 1, 3);
    expect(v3.formatVersion).toBe(3);
    expect(v3.postProcessing).toEqual({});
    expect(v3.audioBuses).toEqual({});
    expect(v3.gameUi).toBeNull();
    expect(v3.customWgslSource).toBeNull();
    expect(v3.assets).toEqual({});
    expect(v3.metadata).toEqual({ name: 'OldScene' });
  });

  it('should be a no-op when fromVersion equals toVersion', () => {
    const data = { formatVersion: 3, entities: [] };
    const result = migrateScene(data, 3, 3);
    expect(result).toEqual(data);
  });

  it('should not mutate the original data', () => {
    const original = { formatVersion: 1, scene: {} };
    const originalCopy = JSON.parse(JSON.stringify(original));
    migrateScene(original, 1, 3);
    expect(original).toEqual(originalCopy);
  });

  it('should preserve existing v2 fields when migrating from v1', () => {
    const data = { formatVersion: 1, postProcessing: { bloom: true } };
    const v2 = migrateScene(data, 1, 2);
    expect(v2.postProcessing).toEqual({ bloom: true });
  });

  it('should throw for missing migration step', () => {
    const data = { formatVersion: 99 };
    expect(() => migrateScene(data, 99, 100)).toThrow(
      'No migration registered for format version 99 -> 100',
    );
  });
});

describe('readSceneFile', () => {
  function makeFile(content: string): File {
    return new File([content], 'test.forge', { type: 'application/json' });
  }

  it('should accept a valid scene file at current version', async () => {
    const json = JSON.stringify({ formatVersion: CURRENT_FORMAT_VERSION, scene: {} });
    const result = await readSceneFile(makeFile(json));
    expect(result).toBe(json);
  });

  it('should migrate older format versions and warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const json = JSON.stringify({ formatVersion: 1, scene: {} });
    const result = await readSceneFile(makeFile(json));
    const parsed = JSON.parse(result);
    expect(parsed.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(parsed.postProcessing).toEqual({});
    expect(parsed.assets).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Migrating scene from format v1'),
    );
    warnSpy.mockRestore();
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

describe('saveAutoSave', () => {
  let mockStore: Record<string, string>;

  function makeLocalStorageMock(overrideSetItem?: (key: string, val: string) => void) {
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
    expect(new Date(mockStore['forge:autosave:time']).getFullYear()).toBeGreaterThan(2000);
  });

  it('calls evictOldAutoSaves when storage would exceed threshold', async () => {
    const storageQuota = await import('@/lib/storage/storageQuota');
    const thresholdSpy = vi.spyOn(storageQuota, 'wouldExceedThreshold').mockReturnValue(true);
    const evictSpy = vi.spyOn(storageQuota, 'evictOldAutoSaves').mockReturnValue(0);
    saveAutoSave('{"scene":"new"}', 'NewScene');
    expect(thresholdSpy).toHaveBeenCalled();
    expect(evictSpy).toHaveBeenCalledWith(1);
    expect(mockStore['forge:autosave']).toBe('{"scene":"new"}');
  });

  it('logs a warning but does not throw when localStorage remains full', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('localStorage', makeLocalStorageMock(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    }));
    expect(() => saveAutoSave('{"scene":true}', 'Test')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('localStorage write failed'));
  });

  it('does not throw and warns when a non-quota error blocks all writes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('localStorage', makeLocalStorageMock(() => {
      throw new Error('SecurityError: access denied');
    }));
    expect(() => saveAutoSave('{"scene":true}', 'Test')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('localStorage write failed'));
  });
});
