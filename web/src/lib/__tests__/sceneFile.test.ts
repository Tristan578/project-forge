import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CURRENT_FORMAT_VERSION, readSceneFile, getAutoSave, clearAutoSave } from '../sceneFile';

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
