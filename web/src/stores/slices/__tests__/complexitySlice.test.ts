/**
 * Tests for the complexitySlice store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// localStorage mock (vitest runs in node environment — no window.localStorage)
// ---------------------------------------------------------------------------
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
  clear: vi.fn(() => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }),
  length: 0,
  key: vi.fn(),
};

vi.stubGlobal('localStorage', localStorageMock);

// ---------------------------------------------------------------------------
// Import AFTER stubbing globals so the store initialises with the mock
// ---------------------------------------------------------------------------
import {
  COMPLEXITY_FEATURES,
  COMPLEXITY_LABELS,
  COMPLEXITY_DESCRIPTIONS,
  type ComplexityLevel,
} from '../complexitySlice';

// Re-import the store fresh for each test by resetting modules
async function getStore() {
  const mod = await import('../complexitySlice');
  return mod.useComplexityStore;
}

describe('COMPLEXITY_FEATURES', () => {
  it('beginner features do not include physics', () => {
    expect(COMPLEXITY_FEATURES.beginner.inspectorSections).not.toContain('physics');
  });

  it('intermediate features include physics', () => {
    expect(COMPLEXITY_FEATURES.intermediate.inspectorSections).toContain('physics');
  });

  it('expert features include particles and terrain', () => {
    expect(COMPLEXITY_FEATURES.expert.inspectorSections).toContain('particles');
    expect(COMPLEXITY_FEATURES.expert.inspectorSections).toContain('terrain');
  });

  it('beginner features do not include audio', () => {
    expect(COMPLEXITY_FEATURES.beginner.inspectorSections).not.toContain('audio');
  });

  it('intermediate features include audio', () => {
    expect(COMPLEXITY_FEATURES.intermediate.inspectorSections).toContain('audio');
  });

  it('transform is always visible (beginner)', () => {
    expect(COMPLEXITY_FEATURES.beginner.inspectorSections).toContain('transform');
    expect(COMPLEXITY_FEATURES.intermediate.inspectorSections).toContain('transform');
    expect(COMPLEXITY_FEATURES.expert.inspectorSections).toContain('transform');
  });

  it('beginner sidebar tools do not include CSG', () => {
    expect(COMPLEXITY_FEATURES.beginner.sidebarTools).not.toContain('csg-union');
  });

  it('expert sidebar tools include CSG operations', () => {
    expect(COMPLEXITY_FEATURES.expert.sidebarTools).toContain('csg-union');
    expect(COMPLEXITY_FEATURES.expert.sidebarTools).toContain('csg-subtract');
    expect(COMPLEXITY_FEATURES.expert.sidebarTools).toContain('csg-intersect');
  });

  it('beginner right-panel tabs only have inspector and chat', () => {
    expect(COMPLEXITY_FEATURES.beginner.rightPanelTabs).toEqual(['inspector', 'chat']);
  });

  it('intermediate right-panel tabs include script and ui', () => {
    expect(COMPLEXITY_FEATURES.intermediate.rightPanelTabs).toContain('script');
    expect(COMPLEXITY_FEATURES.intermediate.rightPanelTabs).toContain('ui');
  });
});

describe('COMPLEXITY_LABELS', () => {
  it('has a label for every level', () => {
    expect(COMPLEXITY_LABELS).toEqual({
      beginner: 'Beginner',
      intermediate: 'Intermediate',
      expert: 'Expert',
    });
  });
});

describe('COMPLEXITY_DESCRIPTIONS', () => {
  it('has a description for every level', () => {
    const levels: ComplexityLevel[] = ['beginner', 'intermediate', 'expert'];
    for (const level of levels) {
      expect(typeof COMPLEXITY_DESCRIPTIONS[level]).toBe('string');
      expect(COMPLEXITY_DESCRIPTIONS[level].length).toBeGreaterThan(0);
    }
  });
});

describe('useComplexityStore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('defaults to beginner when localStorage is empty', async () => {
    const store = await getStore();
    expect(store.getState().level).toBe('beginner');
  });

  it('loads stored level from localStorage', async () => {
    localStorageStore['forge-complexity-level'] = 'expert';
    const store = await getStore();
    expect(store.getState().level).toBe('expert');
  });

  it('defaults to beginner if stored value is invalid', async () => {
    localStorageStore['forge-complexity-level'] = 'invalid-level';
    const store = await getStore();
    expect(store.getState().level).toBe('beginner');
  });

  it('setLevel updates state and persists to localStorage', async () => {
    const store = await getStore();
    store.getState().setLevel('intermediate');
    expect(store.getState().level).toBe('intermediate');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('forge-complexity-level', 'intermediate');
  });

  it('setLevel updates features to match the new level', async () => {
    const store = await getStore();
    store.getState().setLevel('expert');
    expect(store.getState().features).toEqual(COMPLEXITY_FEATURES.expert);
  });

  it('setLevel to beginner hides expert sections', async () => {
    const store = await getStore();
    store.getState().setLevel('expert');
    store.getState().setLevel('beginner');
    expect(store.getState().features.inspectorSections).not.toContain('particles');
  });

  it('isInspectorSectionVisible returns true for visible sections', async () => {
    const store = await getStore();
    store.getState().setLevel('intermediate');
    expect(store.getState().isInspectorSectionVisible('physics')).toBe(true);
    expect(store.getState().isInspectorSectionVisible('transform')).toBe(true);
  });

  it('isInspectorSectionVisible returns false for hidden sections', async () => {
    const store = await getStore();
    store.getState().setLevel('beginner');
    expect(store.getState().isInspectorSectionVisible('physics')).toBe(false);
    expect(store.getState().isInspectorSectionVisible('particles')).toBe(false);
  });

  it('isSidebarToolVisible returns true for visible tools', async () => {
    const store = await getStore();
    store.getState().setLevel('beginner');
    expect(store.getState().isSidebarToolVisible('translate')).toBe(true);
  });

  it('isSidebarToolVisible returns false for hidden tools', async () => {
    const store = await getStore();
    store.getState().setLevel('beginner');
    expect(store.getState().isSidebarToolVisible('csg-union')).toBe(false);
  });

  it('isRightPanelTabVisible returns true for chat in beginner mode', async () => {
    const store = await getStore();
    store.getState().setLevel('beginner');
    expect(store.getState().isRightPanelTabVisible('chat')).toBe(true);
    expect(store.getState().isRightPanelTabVisible('inspector')).toBe(true);
  });

  it('isRightPanelTabVisible returns false for script in beginner mode', async () => {
    const store = await getStore();
    store.getState().setLevel('beginner');
    expect(store.getState().isRightPanelTabVisible('script')).toBe(false);
  });

  it('isWorkspacePanelVisible returns true for scene-hierarchy at all levels', async () => {
    const store = await getStore();
    const levels: ComplexityLevel[] = ['beginner', 'intermediate', 'expert'];
    for (const level of levels) {
      store.getState().setLevel(level);
      expect(store.getState().isWorkspacePanelVisible('scene-hierarchy')).toBe(true);
    }
  });

  it('isWorkspacePanelVisible returns false for shader-editor in beginner mode', async () => {
    const store = await getStore();
    store.getState().setLevel('beginner');
    expect(store.getState().isWorkspacePanelVisible('shader-editor')).toBe(false);
  });

  it('isWorkspacePanelVisible returns true for shader-editor in expert mode', async () => {
    const store = await getStore();
    store.getState().setLevel('expert');
    expect(store.getState().isWorkspacePanelVisible('shader-editor')).toBe(true);
  });

  it('cycling through all levels updates features correctly', async () => {
    const store = await getStore();
    const levels: ComplexityLevel[] = ['beginner', 'intermediate', 'expert'];
    for (const level of levels) {
      store.getState().setLevel(level);
      expect(store.getState().level).toBe(level);
      expect(store.getState().features).toEqual(COMPLEXITY_FEATURES[level]);
    }
  });
});
