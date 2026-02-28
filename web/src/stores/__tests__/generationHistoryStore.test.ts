import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGenerationHistoryStore, type HistoryEntry } from '../generationHistoryStore';

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    type: 'model',
    prompt: 'a treasure chest',
    provider: 'meshy',
    resultUrl: 'https://example.com/result.glb',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('generationHistoryStore', () => {
  beforeEach(() => {
    // Reset store and localStorage between tests
    useGenerationHistoryStore.setState({
      entries: [],
      searchQuery: '',
      filterType: 'all',
    });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  describe('addEntry', () => {
    it('adds an entry to the front of the list', () => {
      const entry = makeEntry({ id: 'e1' });
      useGenerationHistoryStore.getState().addEntry(entry);

      expect(useGenerationHistoryStore.getState().entries).toHaveLength(1);
      expect(useGenerationHistoryStore.getState().entries[0].id).toBe('e1');
    });

    it('deduplicates entries by id', () => {
      const entry = makeEntry({ id: 'dup-1' });
      useGenerationHistoryStore.getState().addEntry(entry);
      useGenerationHistoryStore.getState().addEntry(entry);

      expect(useGenerationHistoryStore.getState().entries).toHaveLength(1);
    });

    it('prepends new entries (most recent first)', () => {
      const e1 = makeEntry({ id: 'e1', prompt: 'first' });
      const e2 = makeEntry({ id: 'e2', prompt: 'second' });
      useGenerationHistoryStore.getState().addEntry(e1);
      useGenerationHistoryStore.getState().addEntry(e2);

      expect(useGenerationHistoryStore.getState().entries[0].id).toBe('e2');
      expect(useGenerationHistoryStore.getState().entries[1].id).toBe('e1');
    });

    it('caps at MAX_ENTRIES (200)', () => {
      const store = useGenerationHistoryStore.getState();
      for (let i = 0; i < 210; i++) {
        store.addEntry(makeEntry({ id: `e${i}` }));
      }
      expect(useGenerationHistoryStore.getState().entries.length).toBeLessThanOrEqual(200);
    });

    it('saves to localStorage', () => {
      useGenerationHistoryStore.getState().addEntry(makeEntry());
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'forge-generation-history',
        expect.any(String)
      );
    });
  });

  describe('removeEntry', () => {
    it('removes an entry by id', () => {
      const entry = makeEntry({ id: 'remove-me' });
      useGenerationHistoryStore.getState().addEntry(entry);
      useGenerationHistoryStore.getState().removeEntry('remove-me');

      expect(useGenerationHistoryStore.getState().entries).toHaveLength(0);
    });
  });

  describe('clearAll', () => {
    it('clears all entries', () => {
      useGenerationHistoryStore.getState().addEntry(makeEntry({ id: 'e1' }));
      useGenerationHistoryStore.getState().addEntry(makeEntry({ id: 'e2' }));
      useGenerationHistoryStore.getState().clearAll();

      expect(useGenerationHistoryStore.getState().entries).toHaveLength(0);
    });
  });

  describe('filteredEntries', () => {
    beforeEach(() => {
      useGenerationHistoryStore.getState().addEntry(makeEntry({ id: 'e1', type: 'model', prompt: 'treasure chest' }));
      useGenerationHistoryStore.getState().addEntry(makeEntry({ id: 'e2', type: 'sprite', prompt: 'pixel hero' }));
      useGenerationHistoryStore.getState().addEntry(makeEntry({ id: 'e3', type: 'music', prompt: 'epic battle' }));
    });

    it('returns all entries when no filter', () => {
      const filtered = useGenerationHistoryStore.getState().filteredEntries();
      expect(filtered).toHaveLength(3);
    });

    it('filters by type', () => {
      useGenerationHistoryStore.getState().setFilterType('sprite');
      const filtered = useGenerationHistoryStore.getState().filteredEntries();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe('sprite');
    });

    it('filters by search query', () => {
      useGenerationHistoryStore.getState().setSearchQuery('epic');
      const filtered = useGenerationHistoryStore.getState().filteredEntries();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].prompt).toContain('epic');
    });

    it('combines type and search filters', () => {
      useGenerationHistoryStore.getState().setFilterType('model');
      useGenerationHistoryStore.getState().setSearchQuery('treasure');
      const filtered = useGenerationHistoryStore.getState().filteredEntries();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('e1');
    });

    it('returns empty when no match', () => {
      useGenerationHistoryStore.getState().setSearchQuery('nonexistent');
      const filtered = useGenerationHistoryStore.getState().filteredEntries();
      expect(filtered).toHaveLength(0);
    });
  });
});
