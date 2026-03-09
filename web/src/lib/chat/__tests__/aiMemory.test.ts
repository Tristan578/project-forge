import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadMemories,
  saveMemories,
  addMemory,
  removeMemory,
  updateMemory,
  touchMemory,
  clearMemories,
  searchMemories,
  buildMemoryContext,
  detectMemoryHints,
  AI_MEMORY_CATEGORIES,
  type AIMemoryEntry,
  type AIMemoryCategory,
} from '@/lib/chat/aiMemory';

// Mock localStorage
const mockStorage: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  key: vi.fn((index: number) => Object.keys(mockStorage)[index] ?? null),
  get length() { return Object.keys(mockStorage).length; },
  clear: vi.fn(() => { for (const k of Object.keys(mockStorage)) delete mockStorage[k]; }),
};

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageMock);
  localStorageMock.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadMemories / saveMemories', () => {
  it('returns empty array for no stored data', () => {
    expect(loadMemories('proj1')).toEqual([]);
  });

  it('round-trips memories through save/load', () => {
    const memories: AIMemoryEntry[] = [{
      id: 'mem_1',
      createdAt: 1000,
      lastUsedAt: 1000,
      category: 'style-preference',
      content: 'User prefers dark themes',
      importance: 7,
    }];
    saveMemories('proj1', memories);
    const loaded = loadMemories('proj1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe('User prefers dark themes');
  });

  it('handles corrupt data gracefully', () => {
    mockStorage['forge-ai-memory-proj1'] = '{invalid';
    expect(loadMemories('proj1')).toEqual([]);
  });

  it('enforces max entries limit', () => {
    const memories: AIMemoryEntry[] = Array.from({ length: 60 }, (_, i) => ({
      id: `mem_${i}`,
      createdAt: 1000,
      lastUsedAt: 1000,
      category: 'custom' as AIMemoryCategory,
      content: `Memory ${i}`,
      importance: i % 10,
    }));
    saveMemories('proj1', memories);
    const loaded = loadMemories('proj1');
    expect(loaded.length).toBeLessThanOrEqual(50);
  });
});

describe('addMemory', () => {
  it('adds a memory entry', () => {
    const entry = addMemory('proj1', 'style-preference', 'User likes metallic materials');
    expect(entry.id).toBeTruthy();
    expect(entry.content).toBe('User likes metallic materials');
    expect(entry.category).toBe('style-preference');
    expect(entry.importance).toBe(5); // default

    const loaded = loadMemories('proj1');
    expect(loaded).toHaveLength(1);
  });

  it('clamps importance to 1-10', () => {
    const low = addMemory('proj1', 'custom', 'Low', 0);
    expect(low.importance).toBe(1);
    const high = addMemory('proj1', 'custom', 'High', 15);
    expect(high.importance).toBe(10);
  });

  it('truncates content over max length', () => {
    const long = 'x'.repeat(600);
    const entry = addMemory('proj1', 'custom', long);
    expect(entry.content.length).toBeLessThanOrEqual(500);
  });
});

describe('removeMemory', () => {
  it('removes existing memory', () => {
    const entry = addMemory('proj1', 'custom', 'To remove');
    const result = removeMemory('proj1', entry.id);
    expect(result).toBe(true);
    expect(loadMemories('proj1')).toHaveLength(0);
  });

  it('returns false for non-existent memory', () => {
    expect(removeMemory('proj1', 'nonexistent')).toBe(false);
  });
});

describe('updateMemory', () => {
  it('updates memory content', () => {
    const entry = addMemory('proj1', 'custom', 'Original');
    const updated = updateMemory('proj1', entry.id, { content: 'Updated' });
    expect(updated).not.toBeNull();
    expect(updated!.content).toBe('Updated');
  });

  it('updates memory category', () => {
    const entry = addMemory('proj1', 'custom', 'Test');
    const updated = updateMemory('proj1', entry.id, { category: 'correction' });
    expect(updated!.category).toBe('correction');
  });

  it('updates lastUsedAt on update', () => {
    const entry = addMemory('proj1', 'custom', 'Test');
    const before = entry.lastUsedAt;
    // Small delay
    const updated = updateMemory('proj1', entry.id, { content: 'New' });
    expect(updated!.lastUsedAt).toBeGreaterThanOrEqual(before);
  });

  it('returns null for non-existent memory', () => {
    expect(updateMemory('proj1', 'nonexistent', { content: 'X' })).toBeNull();
  });
});

describe('touchMemory', () => {
  it('updates lastUsedAt', () => {
    const entry = addMemory('proj1', 'custom', 'Test');
    const originalTime = entry.lastUsedAt;
    touchMemory('proj1', entry.id);
    const loaded = loadMemories('proj1');
    expect(loaded[0].lastUsedAt).toBeGreaterThanOrEqual(originalTime);
  });
});

describe('clearMemories', () => {
  it('removes all memories for project', () => {
    addMemory('proj1', 'custom', 'A');
    addMemory('proj1', 'custom', 'B');
    clearMemories('proj1');
    expect(loadMemories('proj1')).toEqual([]);
  });

  it('does not affect other projects', () => {
    addMemory('proj1', 'custom', 'A');
    addMemory('proj2', 'custom', 'B');
    clearMemories('proj1');
    expect(loadMemories('proj2')).toHaveLength(1);
  });
});

describe('searchMemories', () => {
  beforeEach(() => {
    addMemory('proj1', 'style-preference', 'Likes dark metallic surfaces');
    addMemory('proj1', 'naming-convention', 'Prefix all enemies with "Enemy_"');
    addMemory('proj1', 'correction', 'Do not use emissive materials');
  });

  it('returns all memories for empty query', () => {
    expect(searchMemories('proj1', '')).toHaveLength(3);
  });

  it('filters by content', () => {
    const results = searchMemories('proj1', 'metallic');
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('metallic');
  });

  it('case insensitive search', () => {
    expect(searchMemories('proj1', 'ENEMY')).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    expect(searchMemories('proj1', 'nonexistent xyz')).toHaveLength(0);
  });
});

describe('buildMemoryContext', () => {
  it('returns empty string for no memories', () => {
    expect(buildMemoryContext('proj1')).toBe('');
  });

  it('builds context string with memories', () => {
    addMemory('proj1', 'style-preference', 'Dark theme preferred', 8);
    addMemory('proj1', 'correction', 'Never use Comic Sans', 9);
    const context = buildMemoryContext('proj1');
    expect(context).toContain('AI Memory');
    expect(context).toContain('Dark theme');
    expect(context).toContain('Comic Sans');
  });

  it('prioritizes high-importance memories', () => {
    addMemory('proj1', 'custom', 'Low importance', 1);
    addMemory('proj1', 'custom', 'High importance', 10);
    const context = buildMemoryContext('proj1', 100);
    // With a small budget, high importance should come first
    expect(context).toContain('High importance');
  });

  it('respects token budget', () => {
    for (let i = 0; i < 20; i++) {
      addMemory('proj1', 'custom', `Memory entry number ${i} with some padding text to fill space`, 5);
    }
    const context = buildMemoryContext('proj1', 50); // Very small budget
    // Should not include all 20 memories
    const lineCount = context.split('\n').length;
    expect(lineCount).toBeLessThan(20);
  });
});

describe('detectMemoryHints', () => {
  it('detects correction patterns with "don\'t"', () => {
    const hints = detectMemoryHints("Don't use blue colors on enemies");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some((h) => h.category === 'correction')).toBe(true);
  });

  it('detects preference patterns with "always"', () => {
    const hints = detectMemoryHints('Always use warm lighting for indoor scenes');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some((h) => h.category === 'style-preference')).toBe(true);
  });

  it('detects naming convention patterns', () => {
    const hints = detectMemoryHints('Name entities like "Platform_01"');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some((h) => h.category === 'naming-convention')).toBe(true);
  });

  it('returns empty for non-matching messages', () => {
    const hints = detectMemoryHints('Create a red cube');
    expect(hints.length).toBe(0);
  });

  it('all hints have confidence between 0 and 1', () => {
    const hints = detectMemoryHints("Don't use emissive materials. Always prefer matte finishes.");
    for (const hint of hints) {
      expect(hint.confidence).toBeGreaterThan(0);
      expect(hint.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('AI_MEMORY_CATEGORIES', () => {
  it('has labels for all categories', () => {
    const cats: AIMemoryCategory[] = [
      'style-preference', 'naming-convention', 'workflow-pattern',
      'project-context', 'correction', 'custom',
    ];
    for (const c of cats) {
      expect(AI_MEMORY_CATEGORIES[c]).toBeTruthy();
    }
  });
});
