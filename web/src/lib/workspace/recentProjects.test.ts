import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getRecentProjects, trackProjectOpen, removeRecentProject } from './recentProjects';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const key in store) delete store[key]; }),
  length: 0,
  key: vi.fn(() => null),
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('recentProjects', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('returns empty array when no recent projects', () => {
    expect(getRecentProjects()).toEqual([]);
  });

  it('tracks a project open', () => {
    trackProjectOpen('proj-1', 'My Game');
    const recent = getRecentProjects();
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('proj-1');
    expect(recent[0].name).toBe('My Game');
    expect(typeof recent[0].openedAt).toBe('number');
  });

  it('deduplicates by ID and moves to front', () => {
    trackProjectOpen('proj-1', 'Game A');
    trackProjectOpen('proj-2', 'Game B');
    trackProjectOpen('proj-1', 'Game A Updated');

    const recent = getRecentProjects();
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe('proj-1');
    expect(recent[0].name).toBe('Game A Updated');
    expect(recent[1].id).toBe('proj-2');
  });

  it('caps at 10 entries', () => {
    for (let i = 0; i < 15; i++) {
      trackProjectOpen(`proj-${i}`, `Game ${i}`);
    }
    const recent = getRecentProjects();
    expect(recent).toHaveLength(10);
    // Most recent should be first
    expect(recent[0].id).toBe('proj-14');
  });

  it('removes a project from recent list', () => {
    trackProjectOpen('proj-1', 'Game A');
    trackProjectOpen('proj-2', 'Game B');
    removeRecentProject('proj-1');

    const recent = getRecentProjects();
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('proj-2');
  });

  it('handles corrupt localStorage gracefully', () => {
    store['forge-recent-projects'] = 'not-json';
    expect(getRecentProjects()).toEqual([]);
  });
});
