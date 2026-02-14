import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MATERIAL_PRESETS,
  ALL_CATEGORIES,
  getPresetById,
  getPresetsByCategory,
  loadCustomMaterials,
  saveCustomMaterial,
  deleteCustomMaterial,
} from './materialPresets';

describe('materialPresets', () => {
  // ══════════════ PRESET DATA INTEGRITY ══════════════
  describe('Preset Data Integrity', () => {
    it('should have exactly 56 total presets', () => {
      expect(MATERIAL_PRESETS).toHaveLength(56);
    });

    it('should have no duplicate preset IDs', () => {
      const ids = MATERIAL_PRESETS.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have no duplicate preset names', () => {
      const names = MATERIAL_PRESETS.map((p) => p.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should have all required fields on every preset', () => {
      MATERIAL_PRESETS.forEach((preset) => {
        expect(preset).toHaveProperty('id');
        expect(preset).toHaveProperty('name');
        expect(preset).toHaveProperty('category');
        expect(preset).toHaveProperty('description');
        expect(preset).toHaveProperty('tags');
        expect(preset).toHaveProperty('data');

        expect(typeof preset.id).toBe('string');
        expect(typeof preset.name).toBe('string');
        expect(typeof preset.category).toBe('string');
        expect(typeof preset.description).toBe('string');
        expect(Array.isArray(preset.tags)).toBe(true);
        expect(typeof preset.data).toBe('object');

        expect(preset.id.length).toBeGreaterThan(0);
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      });
    });

    it('should have all presets with valid categories', () => {
      const validCategories = new Set(ALL_CATEGORIES);
      MATERIAL_PRESETS.forEach((preset) => {
        expect(validCategories.has(preset.category)).toBe(true);
      });
    });

    it('should have all PBR values in valid ranges', () => {
      MATERIAL_PRESETS.forEach((preset) => {
        const { data } = preset;

        // Metallic: 0-1
        expect(data.metallic).toBeGreaterThanOrEqual(0);
        expect(data.metallic).toBeLessThanOrEqual(1);

        // Perceptual roughness: 0-1
        expect(data.perceptualRoughness).toBeGreaterThanOrEqual(0);
        expect(data.perceptualRoughness).toBeLessThanOrEqual(1);

        // Reflectance: 0-1
        expect(data.reflectance).toBeGreaterThanOrEqual(0);
        expect(data.reflectance).toBeLessThanOrEqual(1);

        // Base color alpha: 0-1
        expect(data.baseColor[3]).toBeGreaterThanOrEqual(0);
        expect(data.baseColor[3]).toBeLessThanOrEqual(1);

        // Clearcoat: 0-1
        expect(data.clearcoat).toBeGreaterThanOrEqual(0);
        expect(data.clearcoat).toBeLessThanOrEqual(1);

        // Specular transmission: 0-1
        expect(data.specularTransmission).toBeGreaterThanOrEqual(0);
        expect(data.specularTransmission).toBeLessThanOrEqual(1);

        // Alpha mode must be valid
        expect(['opaque', 'mask', 'blend']).toContain(data.alphaMode);
      });
    });
  });

  // ══════════════ CATEGORY DISTRIBUTION ══════════════
  describe('Category Distribution', () => {
    it('should have expected count per category', () => {
      const expectedCounts: Record<string, number> = {
        basic: 6,
        metal: 10,
        natural: 8,
        glass: 5,
        special: 6,
        fabric: 6,
        plastic: 5,
        stone: 5,
        wood: 5,
      };

      for (const [category, expectedCount] of Object.entries(expectedCounts)) {
        const presets = MATERIAL_PRESETS.filter((p) => p.category === category);
        expect(presets).toHaveLength(expectedCount);
      }
    });

    it('should have exactly 9 categories in ALL_CATEGORIES', () => {
      expect(ALL_CATEGORIES).toHaveLength(9);
      expect(ALL_CATEGORIES).toEqual([
        'basic',
        'metal',
        'natural',
        'glass',
        'special',
        'fabric',
        'plastic',
        'stone',
        'wood',
      ]);
    });
  });

  // ══════════════ LOOKUP FUNCTIONS ══════════════
  describe('Lookup Functions', () => {
    it('should find preset by ID', () => {
      const gold = getPresetById('gold');
      expect(gold).toBeDefined();
      expect(gold?.name).toBe('Gold');
      expect(gold?.category).toBe('metal');
    });

    it('should return undefined for nonexistent ID', () => {
      const result = getPresetById('nonexistent_material_12345');
      expect(result).toBeUndefined();
    });

    it('should get all presets in a category', () => {
      const metalPresets = getPresetsByCategory('metal');
      expect(metalPresets).toHaveLength(10);
      metalPresets.forEach((preset) => {
        expect(preset.category).toBe('metal');
      });
    });

    it('should return empty array for nonexistent category', () => {
      const result = getPresetsByCategory('invalid_category');
      expect(result).toHaveLength(0);
    });
  });

  // ══════════════ DOMAIN-SPECIFIC ══════════════
  describe('Domain-Specific Material Properties', () => {
    it('should have emissive presets with positive emissive values', () => {
      const neonGlow = getPresetById('neon_glow');
      const lava = getPresetById('lava');

      expect(neonGlow).toBeDefined();
      expect(lava).toBeDefined();

      // Emissive color should have at least one channel > 0
      const neonEmissive = neonGlow!.data.emissive;
      const lavaEmissive = lava!.data.emissive;

      expect(
        neonEmissive[0] > 0 || neonEmissive[1] > 0 || neonEmissive[2] > 0
      ).toBe(true);
      expect(
        lavaEmissive[0] > 0 || lavaEmissive[1] > 0 || lavaEmissive[2] > 0
      ).toBe(true);
    });

    it('should have glass category presets with specular transmission', () => {
      const glassPresets = getPresetsByCategory('glass');
      expect(glassPresets.length).toBeGreaterThan(0);

      glassPresets.forEach((preset) => {
        expect(preset.data.specularTransmission).toBeGreaterThan(0);
      });
    });

    it('should have metal category presets with high metallic values', () => {
      const metalPresets = getPresetsByCategory('metal');
      expect(metalPresets.length).toBeGreaterThan(0);

      metalPresets.forEach((preset) => {
        expect(preset.data.metallic).toBeGreaterThanOrEqual(0.85);
      });
    });

    it('should have clearcoat materials with clearcoat > 0', () => {
      const ceramic = getPresetById('ceramic');
      const carPaint = getPresetById('car_paint');

      expect(ceramic?.data.clearcoat).toBeGreaterThan(0);
      expect(carPaint?.data.clearcoat).toBeGreaterThan(0);
    });

    it('should have transparent materials with alpha blend mode', () => {
      const glass = getPresetById('glass');
      const water = getPresetById('water');

      expect(glass?.data.alphaMode).toBe('blend');
      expect(water?.data.alphaMode).toBe('blend');
    });

    it('should have mirror preset with perfect reflection', () => {
      const mirror = getPresetById('mirror');
      expect(mirror?.data.metallic).toBe(1.0);
      expect(mirror?.data.perceptualRoughness).toBe(0.0);
    });
  });

  // ══════════════ CUSTOM MATERIALS (localStorage) ══════════════
  describe('Custom Materials', () => {
    let store: Record<string, string>;
    let originalLocalStorage: Storage | undefined;

    beforeEach(() => {
      // Save original localStorage if it exists
      originalLocalStorage = global.localStorage;

      // Mock localStorage with fresh store per test
      store = {};
      const mockStorage: Storage = {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          Object.keys(store).forEach((key) => delete store[key]);
        },
        key: (_index: number) => null,
        get length() {
          return Object.keys(store).length;
        },
      };
      global.localStorage = mockStorage;
    });

    afterEach(() => {
      // Restore original localStorage
      if (originalLocalStorage) {
        global.localStorage = originalLocalStorage;
      }
    });

    it('should return empty array when no custom materials stored', () => {
      const customs = loadCustomMaterials();
      expect(customs).toEqual([]);
    });

    it('should save custom material to localStorage', () => {
      const testData = {
        baseColor: [1, 0, 0, 1] as [number, number, number, number],
        metallic: 0.5,
        perceptualRoughness: 0.3,
        reflectance: 0.5,
        emissive: [0, 0, 0, 1] as [number, number, number, number],
        emissiveExposureWeight: 0,
        alphaMode: 'opaque' as const,
        alphaCutoff: 0.5,
        doubleSided: false,
        unlit: false,
        uvOffset: [0, 0] as [number, number],
        uvScale: [1, 1] as [number, number],
        uvRotation: 0,
        parallaxDepthScale: 0.1,
        parallaxMappingMethod: 'occlusion' as const,
        maxParallaxLayerCount: 16,
        parallaxReliefMaxSteps: 5,
        clearcoat: 0,
        clearcoatPerceptualRoughness: 0.5,
        specularTransmission: 0,
        diffuseTransmission: 0,
        ior: 1.5,
        thickness: 0,
        attenuationDistance: null,
        attenuationColor: [1, 1, 1] as [number, number, number],
      };

      const saved = saveCustomMaterial('My Red Material', testData);

      expect(saved.name).toBe('My Red Material');
      expect(saved.data.baseColor).toEqual([1, 0, 0, 1]);
      expect(saved.id).toMatch(/^custom_\d+$/);
      expect(saved.createdAt).toBeGreaterThan(0);

      // Verify it's in localStorage
      const customs = loadCustomMaterials();
      expect(customs).toHaveLength(1);
      expect(customs[0].name).toBe('My Red Material');
    });

    it('should load saved custom materials', () => {
      const testData = {
        baseColor: [0, 1, 0, 1] as [number, number, number, number],
        metallic: 0.8,
        perceptualRoughness: 0.2,
        reflectance: 0.5,
        emissive: [0, 0, 0, 1] as [number, number, number, number],
        emissiveExposureWeight: 0,
        alphaMode: 'opaque' as const,
        alphaCutoff: 0.5,
        doubleSided: false,
        unlit: false,
        uvOffset: [0, 0] as [number, number],
        uvScale: [1, 1] as [number, number],
        uvRotation: 0,
        parallaxDepthScale: 0.1,
        parallaxMappingMethod: 'occlusion' as const,
        maxParallaxLayerCount: 16,
        parallaxReliefMaxSteps: 5,
        clearcoat: 0,
        clearcoatPerceptualRoughness: 0.5,
        specularTransmission: 0,
        diffuseTransmission: 0,
        ior: 1.5,
        thickness: 0,
        attenuationDistance: null,
        attenuationColor: [1, 1, 1] as [number, number, number],
      };

      saveCustomMaterial('Material A', testData);
      saveCustomMaterial('Material B', testData);

      const customs = loadCustomMaterials();
      expect(customs).toHaveLength(2);
      expect(customs[0].name).toBe('Material A');
      expect(customs[1].name).toBe('Material B');
    });

    it('should verify localStorage mock works', () => {
      // Direct localStorage test
      localStorage.setItem('test', 'value');
      expect(localStorage.getItem('test')).toBe('value');

      localStorage.setItem('test', 'newvalue');
      expect(localStorage.getItem('test')).toBe('newvalue');
    });

    it('should delete custom material by ID', () => {
      // Mock Date.now() to ensure unique IDs
      let mockTime = 1000000;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime++);

      const testData = {
        baseColor: [0, 0, 1, 1] as [number, number, number, number],
        metallic: 0.0,
        perceptualRoughness: 0.5,
        reflectance: 0.5,
        emissive: [0, 0, 0, 1] as [number, number, number, number],
        emissiveExposureWeight: 0,
        alphaMode: 'opaque' as const,
        alphaCutoff: 0.5,
        doubleSided: false,
        unlit: false,
        uvOffset: [0, 0] as [number, number],
        uvScale: [1, 1] as [number, number],
        uvRotation: 0,
        parallaxDepthScale: 0.1,
        parallaxMappingMethod: 'occlusion' as const,
        maxParallaxLayerCount: 16,
        parallaxReliefMaxSteps: 5,
        clearcoat: 0,
        clearcoatPerceptualRoughness: 0.5,
        specularTransmission: 0,
        diffuseTransmission: 0,
        ior: 1.5,
        thickness: 0,
        attenuationDistance: null,
        attenuationColor: [1, 1, 1] as [number, number, number],
      };

      const material1 = saveCustomMaterial('Keep', testData);
      const material2 = saveCustomMaterial('Delete', testData);

      // Verify both saved and have different IDs
      const beforeDelete = loadCustomMaterials();
      expect(beforeDelete).toHaveLength(2);
      expect(material1.id).not.toBe(material2.id);

      deleteCustomMaterial(material2.id);

      const afterDelete = loadCustomMaterials();
      expect(afterDelete).toHaveLength(1);
      expect(afterDelete[0].id).toBe(material1.id);
      expect(afterDelete[0].name).toBe('Keep');

      // Restore Date.now
      vi.restoreAllMocks();
    });

    it('should handle corrupted localStorage gracefully', () => {
      localStorage.setItem('forge-custom-materials', 'invalid JSON {{{');
      const customs = loadCustomMaterials();
      expect(customs).toEqual([]);
    });
  });
});
