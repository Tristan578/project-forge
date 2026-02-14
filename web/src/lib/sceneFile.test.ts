/**
 * Tests for scene file I/O utilities.
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readSceneFile, getAutoSave, clearAutoSave, downloadSceneFile } from './sceneFile';

// ============ readSceneFile TESTS ============

describe('readSceneFile', () => {
  // Helper to create a File with .text() method (jsdom doesn't implement it)
  function createFileWithText(content: string, name: string): File {
    const blob = new Blob([content], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    // Polyfill .text() method for jsdom
    Object.defineProperty(file, 'text', {
      value: async () => content,
    });
    return file;
  }

  it('valid file with formatVersion 1 returns JSON string', async () => {
    const sceneData = { formatVersion: 1, entities: [] };
    const file = createFileWithText(JSON.stringify(sceneData), 'test.forge');

    const result = await readSceneFile(file);

    expect(result).toBe(JSON.stringify(sceneData));
  });

  it('missing formatVersion throws error', async () => {
    const sceneData = { entities: [] }; // No formatVersion
    const file = createFileWithText(JSON.stringify(sceneData), 'test.forge');

    await expect(readSceneFile(file)).rejects.toThrow('Invalid scene file: missing formatVersion');
  });

  it('wrong formatVersion throws error', async () => {
    const sceneData = { formatVersion: 2, entities: [] };
    const file = createFileWithText(JSON.stringify(sceneData), 'test.forge');

    await expect(readSceneFile(file)).rejects.toThrow('Unsupported scene format version: 2');
  });

  it('valid complex scene with entities round-trips', async () => {
    const sceneData = {
      formatVersion: 1,
      sceneName: 'TestScene',
      entities: [
        {
          id: 'e1',
          name: 'Cube',
          entityType: 'cube',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          material: { baseColor: [1, 0, 0, 1], metallic: 0.5, perceptualRoughness: 0.3 },
        },
        {
          id: 'e2',
          name: 'Light',
          entityType: 'point_light',
          transform: { position: [5, 5, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
          light: { lightType: 'point', intensity: 1000, color: [1, 1, 1] },
        },
      ],
      ambientLight: { color: [0.3, 0.3, 0.3], brightness: 0.5 },
      environment: { clearColor: [0.1, 0.1, 0.15, 1], fogEnabled: false },
    };
    const file = createFileWithText(JSON.stringify(sceneData), 'complex.forge');

    const result = await readSceneFile(file);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual(sceneData);
    expect(parsed.entities.length).toBe(2);
    expect(parsed.entities[0].name).toBe('Cube');
  });

  it('non-JSON content throws', async () => {
    const file = createFileWithText('not valid json {{{', 'invalid.forge');

    await expect(readSceneFile(file)).rejects.toThrow();
  });
});

// ============ AUTO-SAVE TESTS ============

describe('auto-save functions', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('getAutoSave returns null when no save exists', () => {
    const result = getAutoSave();
    expect(result).toBeNull();
  });

  it('getAutoSave returns saved data from localStorage', () => {
    const sceneJson = JSON.stringify({ formatVersion: 1, entities: [] });
    const sceneName = 'TestScene';
    const saveTime = new Date().toISOString();

    localStorage.setItem('forge:autosave', sceneJson);
    localStorage.setItem('forge:autosave:name', sceneName);
    localStorage.setItem('forge:autosave:time', saveTime);

    const result = getAutoSave();

    expect(result).not.toBeNull();
    expect(result?.json).toBe(sceneJson);
    expect(result?.name).toBe(sceneName);
    expect(result?.time).toBe(saveTime);
  });

  it('clearAutoSave removes all three keys', () => {
    localStorage.setItem('forge:autosave', 'test');
    localStorage.setItem('forge:autosave:name', 'test');
    localStorage.setItem('forge:autosave:time', 'test');

    clearAutoSave();

    expect(localStorage.getItem('forge:autosave')).toBeNull();
    expect(localStorage.getItem('forge:autosave:name')).toBeNull();
    expect(localStorage.getItem('forge:autosave:time')).toBeNull();
  });

  it('getAutoSave defaults name to Untitled when name key missing', () => {
    const sceneJson = JSON.stringify({ formatVersion: 1, entities: [] });
    localStorage.setItem('forge:autosave', sceneJson);
    // Don't set name or time

    const result = getAutoSave();

    expect(result).not.toBeNull();
    expect(result?.name).toBe('Untitled');
  });

  it('getAutoSave defaults time to empty string when time key missing', () => {
    const sceneJson = JSON.stringify({ formatVersion: 1, entities: [] });
    localStorage.setItem('forge:autosave', sceneJson);
    // Don't set time

    const result = getAutoSave();

    expect(result).not.toBeNull();
    expect(result?.time).toBe('');
  });
});

// ============ downloadSceneFile TESTS ============

describe('downloadSceneFile', () => {
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let _appendChildSpy: ReturnType<typeof vi.spyOn>;
  let removeChildSpy: ReturnType<typeof vi.spyOn>;
  let _createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock DOM methods
    const mockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement;

    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
    _appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor);
    removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor);
    _createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates correct filename with .forge extension', () => {
    const sceneJson = JSON.stringify({ formatVersion: 1, entities: [] });
    const sceneName = 'MyAwesomeGame';

    downloadSceneFile(sceneJson, sceneName);

    expect(createElementSpy).toHaveBeenCalledWith('a');
    const anchor = createElementSpy.mock.results[0].value as HTMLAnchorElement;
    expect(anchor.download).toBe('MyAwesomeGame.forge');
    expect(anchor.href).toBe('blob:mock-url');
    expect(anchor.click).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('uses Untitled when name is empty', () => {
    const sceneJson = JSON.stringify({ formatVersion: 1, entities: [] });

    downloadSceneFile(sceneJson, '');

    const anchor = createElementSpy.mock.results[0].value as HTMLAnchorElement;
    expect(anchor.download).toBe('Untitled.forge');
  });
});

// ============ ADDITIONAL EDGE CASES ============

describe('sceneFile: edge cases', () => {
  it('readSceneFile handles formatVersion as string "1"', async () => {
    // Some systems might serialize numbers as strings
    const sceneData = { formatVersion: '1' as unknown as number, entities: [] };
    const file = createFileWithText(JSON.stringify(sceneData), 'test.forge');

    // Should fail because '1' !== 1 in type check
    await expect(readSceneFile(file)).rejects.toThrow('Invalid scene file: missing formatVersion');
  });

  it('getAutoSave handles corrupted localStorage gracefully', () => {
    // Simulate localStorage throwing (quota exceeded, etc.)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage error');
    });

    const result = getAutoSave();
    expect(result).toBeNull();

    vi.restoreAllMocks();
  });

  it('clearAutoSave handles localStorage errors gracefully', () => {
    // Simulate localStorage throwing
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Storage error');
    });

    // Should not throw
    expect(() => clearAutoSave()).not.toThrow();

    vi.restoreAllMocks();
  });

  it('readSceneFile handles empty file', async () => {
    const file = createFileWithText('', 'empty.forge');

    await expect(readSceneFile(file)).rejects.toThrow();
  });

  // Helper function needs to be accessible to edge case tests too
  function createFileWithText(content: string, name: string): File {
    const blob = new Blob([content], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    // Polyfill .text() method for jsdom
    Object.defineProperty(file, 'text', {
      value: async () => content,
    });
    return file;
  }

  it('downloadSceneFile creates blob with correct MIME type', () => {
    const sceneJson = JSON.stringify({ formatVersion: 1, entities: [] });
    let capturedBlob: Blob | null = null;

    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return 'blob:mock-url';
    });

    downloadSceneFile(sceneJson, 'Test');

    expect(capturedBlob).not.toBeNull();
    expect((capturedBlob as unknown as Blob).type).toBe('application/json');

    vi.restoreAllMocks();
  });
});
