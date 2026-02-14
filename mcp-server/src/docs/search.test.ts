import { describe, it, expect } from 'vitest';
import { buildIndex, search } from './search.js';
import type { DocIndex, DocEntry, TopicMeta } from './loader.js';

/**
 * Helper to build a test DocIndex from simple doc specs.
 */
function makeDocIndex(docs: Array<{ path: string; title: string; content: string; tags?: string[] }>): DocIndex {
  const docsMap = new Map<string, DocEntry>();
  const metaMap = new Map<string, TopicMeta>();

  for (const d of docs) {
    docsMap.set(d.path, {
      path: d.path,
      title: d.title,
      content: d.content,
      sections: [],
    });

    if (d.tags) {
      metaMap.set(d.path, {
        title: d.title,
        tags: d.tags,
      });
    }
  }

  return { docs: docsMap, meta: metaMap };
}

describe('search', () => {
  describe('Empty/Edge Cases', () => {
    it('should return no results for empty query', () => {
      const docIndex = makeDocIndex([
        { path: 'test', title: 'Test Doc', content: 'Some content here' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('', docIndex, termIndex);
      expect(results).toHaveLength(0);
    });

    it('should return no results for empty doc index', () => {
      const docIndex = makeDocIndex([]);
      const termIndex = buildIndex(docIndex);
      const results = search('test query', docIndex, termIndex);
      expect(results).toHaveLength(0);
    });

    it('should return no results for single character query', () => {
      const docIndex = makeDocIndex([
        { path: 'test', title: 'Test', content: 'x marks the spot' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('x', docIndex, termIndex);
      // Single-character tokens are filtered out (length > 1 requirement)
      expect(results).toHaveLength(0);
    });
  });

  describe('Basic Search', () => {
    it('should find exact word in doc title', () => {
      const docIndex = makeDocIndex([
        { path: 'physics', title: 'Physics Guide', content: 'How to use physics in your game' },
        { path: 'audio', title: 'Audio System', content: 'Sound and music management' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('physics', docIndex, termIndex);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe('physics');
      expect(results[0].title).toBe('Physics Guide');
    });

    it('should find word in doc content', () => {
      const docIndex = makeDocIndex([
        { path: 'test', title: 'Test Doc', content: 'This document covers animation features' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('animation', docIndex, termIndex);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe('test');
    });

    it('should be case-insensitive', () => {
      const docIndex = makeDocIndex([
        { path: 'scripting', title: 'Scripting API', content: 'Learn how to write scripts' },
      ]);
      const termIndex = buildIndex(docIndex);

      const lowerResults = search('scripting', docIndex, termIndex);
      const upperResults = search('SCRIPTING', docIndex, termIndex);
      const mixedResults = search('ScRiPtInG', docIndex, termIndex);

      expect(lowerResults.length).toBeGreaterThan(0);
      expect(upperResults.length).toBeGreaterThan(0);
      expect(mixedResults.length).toBeGreaterThan(0);
      expect(lowerResults[0].path).toBe('scripting');
      expect(upperResults[0].path).toBe('scripting');
      expect(mixedResults[0].path).toBe('scripting');
    });

    it('should match multiple query terms', () => {
      const docIndex = makeDocIndex([
        { path: 'materials', title: 'PBR Materials', content: 'Physically based rendering materials with metallic and roughness' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('pbr metallic', docIndex, termIndex);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe('materials');
    });
  });

  describe('Ranking', () => {
    it('should rank title match higher than body match', () => {
      const docIndex = makeDocIndex([
        { path: 'terrain-guide', title: 'Terrain System', content: 'How to create procedural landscapes' },
        { path: 'materials', title: 'Material Editor', content: 'Use terrain textures and heightmaps' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('terrain', docIndex, termIndex);

      expect(results.length).toBeGreaterThanOrEqual(2);
      // Title match (terrain-guide) should rank higher than body match (materials)
      expect(results[0].path).toBe('terrain-guide');
    });

    it('should rank tag match higher than body match', () => {
      const docIndex = makeDocIndex([
        { path: 'physics-intro', title: 'Getting Started', content: 'Introduction to physics system', tags: ['physics', 'beginner'] },
        { path: 'materials', title: 'Materials', content: 'Configure physics materials for collisions' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('physics', docIndex, termIndex);

      expect(results.length).toBeGreaterThanOrEqual(2);
      // Tag match (physics-intro) should rank higher than body match (materials)
      expect(results[0].path).toBe('physics-intro');
    });
  });

  describe('Result Shape', () => {
    it('should include path, title, score, and snippet', () => {
      const docIndex = makeDocIndex([
        { path: 'export', title: 'Exporting Games', content: 'Export your game as standalone HTML' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('export', docIndex, termIndex);

      expect(results.length).toBeGreaterThan(0);
      const result = results[0];

      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('snippet');

      expect(typeof result.path).toBe('string');
      expect(typeof result.title).toBe('string');
      expect(typeof result.score).toBe('number');
      expect(typeof result.snippet).toBe('string');
    });

    it('should limit results to maxResults parameter', () => {
      const docIndex = makeDocIndex([
        { path: 'doc1', title: 'First', content: 'test content' },
        { path: 'doc2', title: 'Second', content: 'test content' },
        { path: 'doc3', title: 'Third', content: 'test content' },
        { path: 'doc4', title: 'Fourth', content: 'test content' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('test', docIndex, termIndex, 2);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should include snippet with query term', () => {
      const docIndex = makeDocIndex([
        { path: 'test', title: 'Test', content: 'The CSG boolean operations allow you to combine meshes' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('boolean', docIndex, termIndex);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippet.toLowerCase()).toContain('boolean');
    });
  });

  describe('Index Building', () => {
    it('should build index from multiple documents', () => {
      const docIndex = makeDocIndex([
        { path: 'doc1', title: 'First', content: 'alpha beta' },
        { path: 'doc2', title: 'Second', content: 'gamma delta' },
      ]);
      const termIndex = buildIndex(docIndex);

      expect(termIndex.docCount).toBe(2);
      expect(termIndex.docLengths.size).toBe(2);
      expect(termIndex.termFreqs.size).toBeGreaterThan(0);
    });

    it('should handle documents with tags', () => {
      const docIndex = makeDocIndex([
        { path: 'test', title: 'Test', content: 'Some content', tags: ['important', 'tutorial'] },
      ]);
      const termIndex = buildIndex(docIndex);

      expect(termIndex.docCount).toBe(1);
      // Tags should be tokenized and added to the index
      expect(termIndex.termFreqs.has('important')).toBe(true);
      expect(termIndex.termFreqs.has('tutorial')).toBe(true);
    });
  });

  describe('Multi-document Search', () => {
    it('should rank documents by relevance', () => {
      const docIndex = makeDocIndex([
        { path: 'particle-guide', title: 'Particle Effects', content: 'Create stunning particle effects with GPU rendering' },
        { path: 'audio-guide', title: 'Audio System', content: 'Particle effects can be synced with audio' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('particle effects', docIndex, termIndex);

      expect(results.length).toBeGreaterThanOrEqual(2);
      // particle-guide has both terms in title and content
      expect(results[0].path).toBe('particle-guide');
    });

    it('should return multiple results sorted by score', () => {
      const docIndex = makeDocIndex([
        { path: 'a', title: 'Animation Basics', content: 'Introduction to animation' },
        { path: 'b', title: 'Advanced Topics', content: 'Animation blending and transitions' },
        { path: 'c', title: 'Other Features', content: 'Various features' },
      ]);
      const termIndex = buildIndex(docIndex);
      const results = search('animation', docIndex, termIndex);

      expect(results.length).toBeGreaterThanOrEqual(2);
      // Scores should be descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });
});
