import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  MATERIAL_PRESETS,
  ALL_CATEGORIES,
  getPresetById,
  getPresetsByCategory,
  loadCustomMaterials,
  saveCustomMaterial,
  deleteCustomMaterial,
} from '../materialPresets';

describe('MATERIAL_PRESETS', () => {
  it('should have unique IDs', () => {
    const ids = MATERIAL_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should have all required fields', () => {
    for (const preset of MATERIAL_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.category).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.tags.length).toBeGreaterThan(0);
      expect(preset.data).toBeDefined();
      expect(preset.data.baseColor).toBeDefined();
    }
  });

  it('should only use valid categories', () => {
    for (const preset of MATERIAL_PRESETS) {
      expect(ALL_CATEGORIES).toContain(preset.category);
    }
  });

  it('should have presets in every category', () => {
    for (const category of ALL_CATEGORIES) {
      const presets = MATERIAL_PRESETS.filter(p => p.category === category);
      expect(presets.length, `${category} should have presets`).toBeGreaterThan(0);
    }
  });
});

describe('getPresetById', () => {
  it('should find a preset by ID', () => {
    const preset = getPresetById('gold');
    expect(preset).toBeDefined();
    expect(preset!.name).toBe('Gold');
    expect(preset!.category).toBe('metal');
  });

  it('should return undefined for unknown ID', () => {
    expect(getPresetById('nonexistent')).toBeUndefined();
  });
});

describe('getPresetsByCategory', () => {
  it('should filter by category', () => {
    const metals = getPresetsByCategory('metal');
    expect(metals.length).toBeGreaterThan(0);
    for (const preset of metals) {
      expect(preset.category).toBe('metal');
    }
  });

  it('should return empty for unknown category', () => {
    expect(getPresetsByCategory('unknown')).toEqual([]);
  });
});

describe('custom materials (localStorage)', () => {
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

  it('loadCustomMaterials should return empty when nothing stored', () => {
    expect(loadCustomMaterials()).toEqual([]);
  });

  it('saveCustomMaterial should persist and return a material', () => {
    const baseData = MATERIAL_PRESETS[0].data;
    const saved = saveCustomMaterial('My Material', baseData);
    expect(saved.name).toBe('My Material');
    expect(saved.id).toContain('custom_');
    expect(saved.data).toEqual(baseData);

    const loaded = loadCustomMaterials();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('My Material');
  });

  it('deleteCustomMaterial should remove by ID', () => {
    const baseData = MATERIAL_PRESETS[0].data;
    const saved = saveCustomMaterial('ToDelete', baseData);
    expect(loadCustomMaterials()).toHaveLength(1);

    deleteCustomMaterial(saved.id);
    expect(loadCustomMaterials()).toHaveLength(0);
  });
});
