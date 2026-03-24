import { describe, it, expect, beforeAll } from 'vitest';
import { buildClientIndex, searchDocs } from '../docsSearch';
import type { DocEntry } from '../docsIndex';

function makeDocs(): DocEntry[] {
  return [
    {
      path: '/docs/entities',
      title: 'Entity System',
      content: 'Entities are the core building blocks of the scene. Each entity has components and transforms.',
      sections: [{ heading: 'Overview', content: 'Entities are the core building blocks' }],
    },
    {
      path: '/docs/physics',
      title: 'Physics Engine',
      content: 'The physics engine uses Rapier for rigid body simulation. Colliders and joints are supported.',
      sections: [{ heading: 'Rapier', content: 'rigid body simulation with Rapier' }],
    },
    {
      path: '/docs/scripting',
      title: 'Scripting Guide',
      content: 'Scripts can be attached to entities to add custom behavior. The scripting API provides access to transforms and physics.',
      sections: [
        { heading: 'Basics', content: 'Scripts can be attached to entities' },
        { heading: 'API', content: 'access to transforms and physics' },
      ],
    },
    {
      path: '/docs/materials',
      title: 'Material System',
      content: 'Materials define how meshes look. PBR materials with base color, metallic, and roughness.',
      sections: [{ heading: 'PBR', content: 'base color metallic roughness' }],
    },
  ] as DocEntry[];
}

describe('buildClientIndex', () => {
  it('should build index from docs', () => {
    const docs = makeDocs();
    const index = buildClientIndex(docs);

    expect(index.docCount).toBe(4);
    expect(index.docLengths).toHaveLength(4);
    expect(index.termFreqs.size).toBeGreaterThan(0);
  });

  it('should count terms correctly', () => {
    const docs = makeDocs();
    const index = buildClientIndex(docs);

    // "entities" appears in doc 0 and doc 2
    const entityFreqs = index.termFreqs.get('entities');
    expect(entityFreqs).not.toBeUndefined();
    expect(entityFreqs!.size).toBeGreaterThanOrEqual(1);
  });

  it('should handle empty docs array', () => {
    const index = buildClientIndex([]);
    expect(index.docCount).toBe(0);
    expect(index.docLengths).toEqual([]);
  });
});

describe('searchDocs', () => {
  let docs: DocEntry[];
  let index: ReturnType<typeof buildClientIndex>;

  beforeAll(() => {
    docs = makeDocs();
    index = buildClientIndex(docs);
  });

  it('should find relevant docs for "physics"', () => {
    const results = searchDocs('physics', docs, index);

    expect(results.length).toBeGreaterThan(0);
    // Physics doc should be in results
    expect(results.some(r => r.path === '/docs/physics')).toBe(true);
  });

  it('should find relevant docs for "entity components"', () => {
    const results = searchDocs('entity components', docs, index);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('/docs/entities');
  });

  it('should rank results by relevance', () => {
    const results = searchDocs('materials PBR', docs, index);

    expect(results.length).toBeGreaterThan(0);
    // Materials doc should rank first
    expect(results[0].path).toBe('/docs/materials');
  });

  it('should return empty for no matches', () => {
    const results = searchDocs('xyznonexistent', docs, index);
    expect(results).toEqual([]);
  });

  it('should return empty for empty query', () => {
    const results = searchDocs('', docs, index);
    expect(results).toEqual([]);
  });

  it('should respect maxResults', () => {
    const results = searchDocs('the', docs, index, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should include score and snippet', () => {
    const results = searchDocs('physics', docs, index);

    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].snippet.length).toBeGreaterThan(0);
  });

  it('should find matching section', () => {
    const results = searchDocs('rapier rigid body', docs, index);

    const physDoc = results.find(r => r.path === '/docs/physics');
    expect(physDoc).not.toBeUndefined();
    expect(physDoc!.matchSection).toBe('Rapier');
  });

  it('should handle single-character query terms (filtered out)', () => {
    // Single character tokens are filtered by tokenize
    const results = searchDocs('a', docs, index);
    expect(results).toEqual([]);
  });
});
