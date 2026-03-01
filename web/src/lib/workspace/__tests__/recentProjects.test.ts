import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getRecentProjects,
  trackProjectOpen,
  removeRecentProject,
} from '../recentProjects';

describe('recentProjects', () => {
  let mockStore: Record<string, string>;

  beforeEach(() => {
    mockStore = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStore[key] ?? null,
      setItem: (key: string, val: string) => { mockStore[key] = val; },
      removeItem: (key: string) => { delete mockStore[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getRecentProjects', () => {
    it('should return empty array when nothing stored', () => {
      expect(getRecentProjects()).toEqual([]);
    });

    it('should return stored projects', () => {
      mockStore['forge-recent-projects'] = JSON.stringify([
        { id: 'p1', name: 'Project 1', openedAt: 1000 },
      ]);
      const projects = getRecentProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('p1');
    });

    it('should return empty array on invalid JSON', () => {
      mockStore['forge-recent-projects'] = 'not json';
      expect(getRecentProjects()).toEqual([]);
    });
  });

  describe('trackProjectOpen', () => {
    it('should add a new project', () => {
      trackProjectOpen('p1', 'Project 1');
      const projects = getRecentProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('p1');
      expect(projects[0].name).toBe('Project 1');
    });

    it('should put newest project first', () => {
      trackProjectOpen('p1', 'Project 1');
      trackProjectOpen('p2', 'Project 2');
      const projects = getRecentProjects();
      expect(projects[0].id).toBe('p2');
      expect(projects[1].id).toBe('p1');
    });

    it('should deduplicate by ID', () => {
      trackProjectOpen('p1', 'Project 1');
      trackProjectOpen('p2', 'Project 2');
      trackProjectOpen('p1', 'Project 1 Updated');
      const projects = getRecentProjects();
      expect(projects).toHaveLength(2);
      expect(projects[0].id).toBe('p1');
      expect(projects[0].name).toBe('Project 1 Updated');
    });

    it('should cap at 10 projects', () => {
      for (let i = 0; i < 15; i++) {
        trackProjectOpen(`p${i}`, `Project ${i}`);
      }
      const projects = getRecentProjects();
      expect(projects).toHaveLength(10);
      // Most recent should be first
      expect(projects[0].id).toBe('p14');
    });
  });

  describe('removeRecentProject', () => {
    it('should remove a project by ID', () => {
      trackProjectOpen('p1', 'Project 1');
      trackProjectOpen('p2', 'Project 2');
      removeRecentProject('p1');
      const projects = getRecentProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('p2');
    });

    it('should handle removing non-existent project', () => {
      trackProjectOpen('p1', 'Project 1');
      removeRecentProject('nonexistent');
      expect(getRecentProjects()).toHaveLength(1);
    });
  });
});
