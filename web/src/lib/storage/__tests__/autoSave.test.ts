import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  autoSaveKey,
  saveAutoSaveEntry,
  loadAutoSaveEntry,
  deleteAutoSaveEntry,
  startAutoSave,
  setLastExportedScene,
  _resetLastExportedScene,
  AUTO_SAVE_INTERVAL_MS,
  type AutoSaveEntry,
  type GetSceneState,
} from '../autoSave';

// ---------------------------------------------------------------------------
// Mock the IndexedDB fallback module
// ---------------------------------------------------------------------------

const mockSave = vi.fn().mockResolvedValue(true);
const mockLoad = vi.fn().mockResolvedValue(null);
const mockDelete = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/storage/indexedDBFallback', () => ({
  saveToIndexedDB: (...args: [string, string]) => mockSave(...args),
  loadFromIndexedDB: (...args: [string]) => mockLoad(...args),
  deleteFromIndexedDB: (...args: [string]) => mockDelete(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<AutoSaveEntry> = {}): AutoSaveEntry {
  return {
    sceneJson: '{"entities":[]}',
    sceneName: 'Test Scene',
    savedAt: new Date().toISOString(),
    projectId: 'proj-123',
    ...overrides,
  };
}

function makeGetState(overrides: Partial<ReturnType<GetSceneState>> = {}): GetSceneState {
  return () => ({
    projectId: 'proj-123',
    sceneName: 'Test Scene',
    sceneModified: true,
    autoSaveEnabled: true,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetLastExportedScene();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Key generation
  // -------------------------------------------------------------------------

  describe('autoSaveKey', () => {
    it('returns the correct key format', () => {
      expect(autoSaveKey('abc-123')).toBe('forge:autosave:abc-123');
    });
  });

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  describe('saveAutoSaveEntry', () => {
    it('serializes entry and calls saveToIndexedDB', async () => {
      const entry = makeEntry();
      const result = await saveAutoSaveEntry(entry);
      expect(result).toBe(true);
      expect(mockSave).toHaveBeenCalledWith(
        'forge:autosave:proj-123',
        JSON.stringify(entry),
      );
    });

    it('returns false when IndexedDB fails', async () => {
      mockSave.mockResolvedValueOnce(false);
      const result = await saveAutoSaveEntry(makeEntry());
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------

  describe('loadAutoSaveEntry', () => {
    it('returns parsed entry on success', async () => {
      const entry = makeEntry();
      mockLoad.mockResolvedValueOnce(JSON.stringify(entry));
      const result = await loadAutoSaveEntry('proj-123');
      expect(result).toEqual(entry);
    });

    it('returns null when no entry exists', async () => {
      mockLoad.mockResolvedValueOnce(null);
      const result = await loadAutoSaveEntry('proj-123');
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      mockLoad.mockResolvedValueOnce('not-json');
      const result = await loadAutoSaveEntry('proj-123');
      expect(result).toBeNull();
    });

    it('returns null for valid JSON missing required fields', async () => {
      mockLoad.mockResolvedValueOnce(JSON.stringify({ sceneJson: 'x' }));
      const result = await loadAutoSaveEntry('proj-123');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  describe('deleteAutoSaveEntry', () => {
    it('calls deleteFromIndexedDB with correct key', async () => {
      await deleteAutoSaveEntry('proj-123');
      expect(mockDelete).toHaveBeenCalledWith('forge:autosave:proj-123');
    });
  });

  // -------------------------------------------------------------------------
  // setLastExportedScene
  // -------------------------------------------------------------------------

  describe('setLastExportedScene', () => {
    it('caches scene data for the next auto-save cycle', () => {
      const triggerExport = vi.fn();
      const getState = makeGetState();

      setLastExportedScene('{"test":true}', 'Cached Scene');

      const handle = startAutoSave(getState, triggerExport, 1000);

      // Advance past one interval
      vi.advanceTimersByTime(1000);

      expect(mockSave).toHaveBeenCalledTimes(1);
      const savedPayload = JSON.parse(mockSave.mock.calls[0][1]) as AutoSaveEntry;
      expect(savedPayload.sceneJson).toBe('{"test":true}');
      expect(savedPayload.sceneName).toBe('Cached Scene');
      expect(savedPayload.projectId).toBe('proj-123');

      handle.stop();
    });
  });

  // -------------------------------------------------------------------------
  // startAutoSave
  // -------------------------------------------------------------------------

  describe('startAutoSave', () => {
    it('triggers an initial export on start', () => {
      const triggerExport = vi.fn();
      const handle = startAutoSave(makeGetState(), triggerExport, 5000);

      expect(triggerExport).toHaveBeenCalledTimes(1);
      handle.stop();
    });

    it('does not save when auto-save is disabled', () => {
      const triggerExport = vi.fn();
      const getState = makeGetState({ autoSaveEnabled: false });

      setLastExportedScene('data', 'name');
      const handle = startAutoSave(getState, triggerExport, 1000);

      vi.advanceTimersByTime(1000);
      expect(mockSave).not.toHaveBeenCalled();
      handle.stop();
    });

    it('does not save when no project is loaded', () => {
      const triggerExport = vi.fn();
      const getState = makeGetState({ projectId: null });

      setLastExportedScene('data', 'name');
      const handle = startAutoSave(getState, triggerExport, 1000);

      vi.advanceTimersByTime(1000);
      expect(mockSave).not.toHaveBeenCalled();
      handle.stop();
    });

    it('does not save when scene is not modified', () => {
      const triggerExport = vi.fn();
      const getState = makeGetState({ sceneModified: false });

      setLastExportedScene('data', 'name');
      const handle = startAutoSave(getState, triggerExport, 1000);

      vi.advanceTimersByTime(1000);
      expect(mockSave).not.toHaveBeenCalled();
      handle.stop();
    });

    it('does not save when no exported scene is cached', () => {
      const triggerExport = vi.fn();
      const getState = makeGetState();

      // Don't call setLastExportedScene
      const handle = startAutoSave(getState, triggerExport, 1000);

      vi.advanceTimersByTime(1000);
      expect(mockSave).not.toHaveBeenCalled();
      // But should still trigger export for next cycle
      expect(triggerExport).toHaveBeenCalledTimes(2); // initial + 1 interval
      handle.stop();
    });

    it('saves and requests new export each interval', () => {
      const triggerExport = vi.fn();
      const getState = makeGetState();

      setLastExportedScene('data', 'name');
      const handle = startAutoSave(getState, triggerExport, 1000);

      vi.advanceTimersByTime(3000);

      // 3 intervals worth of saves
      expect(mockSave).toHaveBeenCalledTimes(3);
      // 1 initial + 3 interval triggers = 4
      expect(triggerExport).toHaveBeenCalledTimes(4);
      handle.stop();
    });

    it('stop() clears the interval', () => {
      const triggerExport = vi.fn();
      const getState = makeGetState();

      setLastExportedScene('data', 'name');
      const handle = startAutoSave(getState, triggerExport, 1000);

      handle.stop();
      vi.advanceTimersByTime(5000);

      // Only the initial trigger, no interval triggers
      expect(triggerExport).toHaveBeenCalledTimes(1);
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('uses default interval of 30s', () => {
      expect(AUTO_SAVE_INTERVAL_MS).toBe(30_000);
    });
  });

  // -------------------------------------------------------------------------
  // Full save/load/delete lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('save -> load -> delete cycle works end-to-end', async () => {
      const entry = makeEntry();

      // Save
      await saveAutoSaveEntry(entry);
      expect(mockSave).toHaveBeenCalledTimes(1);

      // Load (mock returns what was saved)
      mockLoad.mockResolvedValueOnce(JSON.stringify(entry));
      const loaded = await loadAutoSaveEntry('proj-123');
      expect(loaded).toEqual(entry);

      // Delete
      await deleteAutoSaveEntry('proj-123');
      expect(mockDelete).toHaveBeenCalledWith('forge:autosave:proj-123');
    });
  });
});
