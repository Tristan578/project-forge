import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DocEntry } from '../docsIndex';

// Shared mock state — must be declared before vi.mock factory runs
let mockEmbedValues: number[] = [0.1, 0.2, 0.3, 0.4, 0.5];

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: function MockGoogleGenerativeAI(this: unknown, _apiKey: string) {
      (this as Record<string, unknown>).getGenerativeModel = function (_opts: unknown) {
        return {
          embedContent: async (_text: unknown) => ({
            embedding: { values: mockEmbedValues },
          }),
        };
      };
    },
  };
});

import {
  cosineSimilarity,
  buildSemanticIndex,
  semanticSearch,
  generateEmbedding,
} from '../semanticSearch';

const sampleDocs: DocEntry[] = [
  {
    path: 'scripting/basics',
    title: 'Scripting Basics',
    content: 'Learn how to write scripts in SpawnForge using the forge API.',
    category: 'scripting',
    sections: [
      { heading: 'Getting Started', content: 'Initialize your script with forge.init().' },
      { heading: 'Events', content: 'Handle events using forge.on("update", callback).' },
    ],
  },
  {
    path: 'physics/collisions',
    title: 'Collision Detection',
    content: 'Detect collisions using the physics system.',
    category: 'physics',
    sections: [
      { heading: 'Collision Events', content: 'Use forge.physics.onCollisionEnter to detect hits.' },
    ],
  },
];

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 0, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 when denominators are zero', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('computes similarity for non-trivial vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const dot = 1 * 4 + 2 * 5 + 3 * 6; // 32
    const normA = Math.sqrt(1 + 4 + 9); // sqrt(14)
    const normB = Math.sqrt(16 + 25 + 36); // sqrt(77)
    const expected = dot / (normA * normB);
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected);
  });

  it('returns 0 for vectors of different length', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('generateEmbedding', () => {
  beforeEach(() => {
    process.env.GOOGLE_AI_API_KEY = 'test-key';
    mockEmbedValues = [0.1, 0.2, 0.3, 0.4, 0.5];
  });

  afterEach(() => {
    delete process.env.GOOGLE_AI_API_KEY;
  });

  it('returns embedding values from the API', async () => {
    const result = await generateEmbedding('test query');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(5);
    expect(result[0]).toBeCloseTo(0.1);
  });

  it('throws when GOOGLE_AI_API_KEY is not set', async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    await expect(generateEmbedding('test')).rejects.toThrow('GOOGLE_AI_API_KEY');
  });
});

describe('buildSemanticIndex', () => {
  beforeEach(() => {
    process.env.GOOGLE_AI_API_KEY = 'test-key';
    mockEmbedValues = [0.1, 0.2, 0.3, 0.4, 0.5];
  });

  it('creates chunks for each doc section plus intro', async () => {
    const index = await buildSemanticIndex(sampleDocs);
    // sampleDocs[0]: intro chunk + 2 sections = 3 chunks
    // sampleDocs[1]: intro chunk + 1 section = 2 chunks
    expect(index.chunks.length).toBe(5);
  });

  it('each chunk has required fields', async () => {
    const index = await buildSemanticIndex(sampleDocs);
    for (const chunk of index.chunks) {
      expect(chunk).toHaveProperty('path');
      expect(chunk).toHaveProperty('title');
      expect(chunk).toHaveProperty('section');
      expect(chunk).toHaveProperty('content');
      expect(chunk).toHaveProperty('embedding');
      expect(Array.isArray(chunk.embedding)).toBe(true);
    }
  });

  it('preserves doc path and title in each chunk', async () => {
    const index = await buildSemanticIndex([sampleDocs[0]]);
    const paths = index.chunks.map((c) => c.path);
    expect(paths.every((p) => p === 'scripting/basics')).toBe(true);
    const titles = index.chunks.map((c) => c.title);
    expect(titles.every((t) => t === 'Scripting Basics')).toBe(true);
  });

  it('handles doc with no sections', async () => {
    const noSectionDoc: DocEntry = {
      path: 'bare',
      title: 'Bare Doc',
      content: 'Just some content with no sections.',
      category: 'misc',
      sections: [],
    };
    const index = await buildSemanticIndex([noSectionDoc]);
    expect(index.chunks.length).toBe(1);
    expect(index.chunks[0].section).toBe('Bare Doc');
  });

  it('returns empty index for empty doc list', async () => {
    const index = await buildSemanticIndex([]);
    expect(index.chunks).toHaveLength(0);
  });
});

describe('semanticSearch', () => {
  beforeEach(() => {
    process.env.GOOGLE_AI_API_KEY = 'test-key';
  });

  it('returns empty array for empty index', async () => {
    mockEmbedValues = [1, 0, 0, 0, 0];
    const results = await semanticSearch('query', { chunks: [] });
    expect(results).toHaveLength(0);
  });

  it('returns results sorted by descending similarity', async () => {
    // Query embedding is [1, 0, 0, 0, 0] — most similar to chunk A ([1,0,0,0,0])
    mockEmbedValues = [1, 0, 0, 0, 0];

    const index = {
      chunks: [
        {
          path: 'b', title: 'B', section: 'B', content: 'B content',
          embedding: [0, 1, 0, 0, 0],
        },
        {
          path: 'a', title: 'A', section: 'A', content: 'A content',
          embedding: [1, 0, 0, 0, 0],
        },
        {
          path: 'c', title: 'C', section: 'C', content: 'C content',
          embedding: [0.9, 0.1, 0, 0, 0],
        },
      ],
    };

    const results = await semanticSearch('test query', index, 3);
    expect(results[0].path).toBe('a');
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    expect(results[1].similarity).toBeGreaterThan(results[2].similarity);
  });

  it('respects topK limit', async () => {
    mockEmbedValues = [1, 0, 0, 0, 0];

    const chunks = Array.from({ length: 10 }, (_, i) => ({
      path: `doc-${i}`,
      title: `Doc ${i}`,
      section: `Section ${i}`,
      content: `Content ${i}`,
      embedding: [i / 10, 0, 0, 0, 0],
    }));

    const results = await semanticSearch('query', { chunks }, 3);
    expect(results).toHaveLength(3);
  });

  it('result fields have correct shape', async () => {
    mockEmbedValues = [1, 0, 0, 0, 0];

    const index = {
      chunks: [
        {
          path: 'test/path', title: 'Test', section: 'Intro',
          content: 'Some content here', embedding: [1, 0, 0, 0, 0],
        },
      ],
    };

    const results = await semanticSearch('query', index, 1);
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('path', 'test/path');
    expect(results[0]).toHaveProperty('title', 'Test');
    expect(results[0]).toHaveProperty('section', 'Intro');
    expect(results[0]).toHaveProperty('snippet');
    expect(results[0]).toHaveProperty('similarity');
    expect(typeof results[0].similarity).toBe('number');
  });

  it('snippet is truncated to 200 characters', async () => {
    mockEmbedValues = [1, 0, 0, 0, 0];

    const longContent = 'x'.repeat(500);
    const index = {
      chunks: [
        {
          path: 'p', title: 'T', section: 'S', content: longContent,
          embedding: [1, 0, 0, 0, 0],
        },
      ],
    };

    const results = await semanticSearch('query', index, 1);
    expect(results[0].snippet.length).toBeLessThanOrEqual(200);
  });
});
