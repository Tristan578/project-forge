import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCategories, getDocsByCategory, getDocByPath, clearDocsCache, loadDocsIndex } from '../docsIndex';
import type { DocEntry } from '../docsIndex';

function makeDocs(): DocEntry[] {
  return [
    {
      path: '/docs/entities',
      title: 'Entity System',
      content: 'Entities are building blocks.',
      category: 'core',
      sections: [{ heading: 'Overview', content: 'Entities overview' }],
    },
    {
      path: '/docs/physics',
      title: 'Physics Engine',
      content: 'Physics uses Rapier.',
      category: 'systems',
      sections: [{ heading: 'Rapier', content: 'Rapier details' }],
    },
    {
      path: '/docs/scripting',
      title: 'Scripting Guide',
      content: 'Scripts can be attached.',
      category: 'systems',
      sections: [{ heading: 'Basics', content: 'Scripting basics' }],
    },
    {
      path: '/docs/materials',
      title: 'Material System',
      content: 'PBR materials.',
      category: 'rendering',
      sections: [{ heading: 'PBR', content: 'PBR details' }],
    },
    {
      path: '/docs/transforms',
      title: 'Transform System',
      content: 'Position, rotation, scale.',
      category: 'core',
      sections: [],
    },
  ];
}

describe('getCategories', () => {
  it('should return unique sorted categories', () => {
    const cats = getCategories(makeDocs());
    expect(cats).toEqual(['core', 'rendering', 'systems']);
  });

  it('should return empty array for no docs', () => {
    expect(getCategories([])).toEqual([]);
  });

  it('should return single category when all docs share it', () => {
    const docs = makeDocs().map((d) => ({ ...d, category: 'all' }));
    expect(getCategories(docs)).toEqual(['all']);
  });
});

describe('getDocsByCategory', () => {
  it('should filter docs by category', () => {
    const docs = makeDocs();
    const core = getDocsByCategory(docs, 'core');
    expect(core).toHaveLength(2);
    expect(core.map((d) => d.path)).toEqual(['/docs/entities', '/docs/transforms']);
  });

  it('should return systems docs', () => {
    const systems = getDocsByCategory(makeDocs(), 'systems');
    expect(systems).toHaveLength(2);
  });

  it('should return empty for non-existent category', () => {
    expect(getDocsByCategory(makeDocs(), 'nonexistent')).toEqual([]);
  });

  it('should return empty for empty docs', () => {
    expect(getDocsByCategory([], 'core')).toEqual([]);
  });
});

describe('getDocByPath', () => {
  it('should find a doc by path', () => {
    const doc = getDocByPath(makeDocs(), '/docs/physics');
    expect(doc).not.toBeUndefined();
    expect(doc!.title).toBe('Physics Engine');
  });

  it('should return undefined for non-existent path', () => {
    expect(getDocByPath(makeDocs(), '/docs/nonexistent')).toBeUndefined();
  });

  it('should return undefined for empty docs', () => {
    expect(getDocByPath([], '/docs/entities')).toBeUndefined();
  });
});

describe('clearDocsCache', () => {
  it('should not throw', () => {
    expect(() => clearDocsCache()).not.toThrow();
  });
});

describe('loadDocsIndex', () => {
  beforeEach(() => {
    clearDocsCache();
    vi.restoreAllMocks();
  });

  it('should fetch and cache non-empty docs', async () => {
    const docsData = { docs: makeDocs(), meta: {} };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => docsData,
    } as Response);

    const result = await loadDocsIndex();
    expect(result.docs).toHaveLength(5);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call should use cache (no additional fetch)
    const result2 = await loadDocsIndex();
    expect(result2.docs).toHaveLength(5);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should cache empty docs with TTL and not retry within 30s', async () => {
    const emptyData = { docs: [], meta: {} };
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => emptyData,
      } as Response);

    // First call returns empty — cached with TTL
    const result1 = await loadDocsIndex();
    expect(result1.docs).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call within TTL — returns cached empty, no refetch
    const result2 = await loadDocsIndex();
    expect(result2.docs).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should retry empty docs after TTL expires', async () => {
    vi.useFakeTimers();
    const emptyData = { docs: [], meta: {} };
    const nonEmptyData = { docs: makeDocs(), meta: {} };
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => emptyData,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => nonEmptyData,
      } as Response);

    // First call returns empty
    const result1 = await loadDocsIndex();
    expect(result1.docs).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance past TTL (30 seconds)
    vi.advanceTimersByTime(31_000);

    // Now it should retry and get non-empty docs
    const result2 = await loadDocsIndex();
    expect(result2.docs).toHaveLength(5);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should throw on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(loadDocsIndex()).rejects.toThrow('Failed to load docs: 500');
  });

  it('should retry after clearDocsCache is called', async () => {
    const docsData = { docs: makeDocs(), meta: {} };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => docsData,
    } as Response);

    await loadDocsIndex();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    clearDocsCache();

    await loadDocsIndex();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
