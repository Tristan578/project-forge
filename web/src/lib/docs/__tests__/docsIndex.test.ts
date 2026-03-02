import { describe, it, expect } from 'vitest';
import { getCategories, getDocsByCategory, getDocByPath, clearDocsCache } from '../docsIndex';
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
    expect(doc).toBeDefined();
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
