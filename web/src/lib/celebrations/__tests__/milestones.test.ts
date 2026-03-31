import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkMilestone,
  hasCelebrated,
  resetMilestones,
  getCelebratedMilestones,
  MILESTONE_STORAGE_KEY,
} from '@/lib/celebrations/milestones';

// Minimal localStorage stub
const localStorageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
};

vi.stubGlobal('localStorage', mockLocalStorage);

describe('milestones', () => {
  beforeEach(() => {
    // Clear storage before each test
    Object.keys(localStorageStore).forEach((k) => { delete localStorageStore[k]; });
  });

  describe('hasCelebrated', () => {
    it('returns false when no milestones have been celebrated', () => {
      expect(hasCelebrated('FIRST_ENTITY')).toBe(false);
    });

    it('returns true after the milestone has been celebrated', () => {
      checkMilestone('FIRST_ENTITY');
      expect(hasCelebrated('FIRST_ENTITY')).toBe(true);
    });

    it('returns false for uncelebrated milestones when others have been recorded', () => {
      checkMilestone('FIRST_ENTITY');
      expect(hasCelebrated('FIRST_PLAY')).toBe(false);
    });
  });

  describe('checkMilestone', () => {
    it('returns celebration data on first call', () => {
      const data = checkMilestone('FIRST_ENTITY');
      expect(data).not.toBeNull();
      expect(data?.title).not.toBe('');
      expect(data?.message).not.toBe('');
    });

    it('returns null on second call (already celebrated)', () => {
      checkMilestone('FIRST_ENTITY');
      const second = checkMilestone('FIRST_ENTITY');
      expect(second).toBeNull();
    });

    it('returns data for FIRST_SCENE', () => {
      const data = checkMilestone('FIRST_SCENE');
      expect(data?.title).toContain('scene');
    });

    it('returns data for FIRST_PLAY', () => {
      const data = checkMilestone('FIRST_PLAY');
      expect(data?.title).not.toBe('');
    });

    it('returns data for FIRST_PUBLISH', () => {
      const data = checkMilestone('FIRST_PUBLISH');
      expect(data?.message).not.toBe('');
    });

    it('returns data for FIRST_AI_GENERATION', () => {
      const data = checkMilestone('FIRST_AI_GENERATION');
      expect(data?.title).not.toBe('');
    });

    it('returns data for ENTITY_COUNT_50', () => {
      const data = checkMilestone('ENTITY_COUNT_50');
      expect(data?.title).toContain('50');
    });

    it('returns data for ENTITY_COUNT_100', () => {
      const data = checkMilestone('ENTITY_COUNT_100');
      expect(data?.title).toContain('100');
    });

    it('persists celebration to localStorage', () => {
      checkMilestone('FIRST_ENTITY');
      const raw = localStorageStore[MILESTONE_STORAGE_KEY];
      expect(raw).toBeTypeOf('string');
      const parsed = JSON.parse(raw) as string[];
      expect(parsed).toContain('FIRST_ENTITY');
    });

    it('accumulates multiple milestones in storage', () => {
      checkMilestone('FIRST_ENTITY');
      checkMilestone('FIRST_PLAY');
      const parsed = JSON.parse(localStorageStore[MILESTONE_STORAGE_KEY]) as string[];
      expect(parsed).toContain('FIRST_ENTITY');
      expect(parsed).toContain('FIRST_PLAY');
    });
  });

  describe('getCelebratedMilestones', () => {
    it('returns empty set when storage is empty', () => {
      const result = getCelebratedMilestones();
      expect(result.size).toBe(0);
    });

    it('returns the set of previously celebrated milestones', () => {
      checkMilestone('FIRST_ENTITY');
      checkMilestone('FIRST_SCENE');
      const result = getCelebratedMilestones();
      expect(result.has('FIRST_ENTITY')).toBe(true);
      expect(result.has('FIRST_SCENE')).toBe(true);
    });

    it('returns empty set when storage contains invalid JSON', () => {
      localStorageStore[MILESTONE_STORAGE_KEY] = '{invalid';
      const result = getCelebratedMilestones();
      expect(result.size).toBe(0);
    });

    it('returns empty set when storage value is not an array', () => {
      localStorageStore[MILESTONE_STORAGE_KEY] = '"not-an-array"';
      const result = getCelebratedMilestones();
      expect(result.size).toBe(0);
    });
  });

  describe('resetMilestones', () => {
    it('clears all celebrated milestones from storage', () => {
      checkMilestone('FIRST_ENTITY');
      checkMilestone('FIRST_PLAY');
      resetMilestones();
      expect(hasCelebrated('FIRST_ENTITY')).toBe(false);
      expect(hasCelebrated('FIRST_PLAY')).toBe(false);
    });

    it('allows milestones to fire again after reset', () => {
      checkMilestone('FIRST_ENTITY');
      resetMilestones();
      const data = checkMilestone('FIRST_ENTITY');
      expect(data).not.toBeNull();
    });
  });
});
