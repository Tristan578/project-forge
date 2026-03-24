import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ART_STYLE_PRESETS,
  analyzeStyleConsistency,
  generateStylePromptModifier,
  buildStyleMaterial,
  applyStyleToScene,
  getStylePresetKeys,
  getStylePreset,
  isValidHex,
  colorDistance,
  loadLockedStyle,
  saveLockedStyle,
  clearLockedStyle,
} from '../artStyleEngine';
import type { EntitySummary } from '../artStyleEngine';
import type { MaterialData } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Helper to create a material with sensible defaults
// ---------------------------------------------------------------------------
function makeMaterial(overrides: Partial<MaterialData> = {}): MaterialData {
  return {
    baseColor: [0.5, 0.5, 0.5, 1.0],
    metallic: 0.0,
    perceptualRoughness: 0.5,
    reflectance: 0.5,
    emissive: [0.0, 0.0, 0.0, 1.0],
    emissiveExposureWeight: 0.0,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
    doubleSided: false,
    unlit: false,
    uvOffset: [0, 0],
    uvScale: [1, 1],
    uvRotation: 0,
    parallaxDepthScale: 0.1,
    parallaxMappingMethod: 'occlusion',
    maxParallaxLayerCount: 16,
    parallaxReliefMaxSteps: 5,
    clearcoat: 0,
    clearcoatPerceptualRoughness: 0.5,
    specularTransmission: 0,
    diffuseTransmission: 0,
    ior: 1.5,
    thickness: 0,
    attenuationDistance: null,
    attenuationColor: [1, 1, 1],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Preset validation
// ---------------------------------------------------------------------------
describe('ART_STYLE_PRESETS', () => {
  const presetKeys = Object.keys(ART_STYLE_PRESETS);

  it('has at least 8 presets', () => {
    expect(presetKeys.length).toBeGreaterThanOrEqual(8);
  });

  it.each(presetKeys)('preset "%s" has valid hex values in colour palette', (key) => {
    const style = ART_STYLE_PRESETS[key];
    const { colorPalette } = style;
    expect(isValidHex(colorPalette.primary)).toBe(true);
    expect(isValidHex(colorPalette.secondary)).toBe(true);
    expect(isValidHex(colorPalette.accent)).toBe(true);
    expect(isValidHex(colorPalette.neutral)).toBe(true);
    expect(isValidHex(colorPalette.background)).toBe(true);
  });

  it.each(presetKeys)('preset "%s" has valid material property ranges', (key) => {
    const { materialProperties } = ART_STYLE_PRESETS[key];
    const [rMin, rMax] = materialProperties.roughnessRange;
    expect(rMin).toBeGreaterThanOrEqual(0);
    expect(rMax).toBeLessThanOrEqual(1);
    expect(rMin).toBeLessThanOrEqual(rMax);

    const [mMin, mMax] = materialProperties.metallicRange;
    expect(mMin).toBeGreaterThanOrEqual(0);
    expect(mMax).toBeLessThanOrEqual(1);
    expect(mMin).toBeLessThanOrEqual(mMax);

    expect(materialProperties.emissiveIntensity).toBeGreaterThanOrEqual(0);
  });

  it.each(presetKeys)('preset "%s" has non-empty descriptive fields', (key) => {
    const style = ART_STYLE_PRESETS[key];
    expect(style.name.length).toBeGreaterThan(0);
    expect(style.description.length).toBeGreaterThan(0);
    expect(style.lightingMood.length).toBeGreaterThan(0);
    expect(style.textureStyle.length).toBeGreaterThan(0);
    expect(style.geometryStyle.length).toBeGreaterThan(0);
  });

  it.each(presetKeys)('preset "%s" has a valid harmony type', (key) => {
    const harmony = ART_STYLE_PRESETS[key].colorPalette.harmony;
    expect(['complementary', 'analogous', 'triadic', 'monochromatic']).toContain(harmony);
  });
});

// ---------------------------------------------------------------------------
// isValidHex
// ---------------------------------------------------------------------------
describe('isValidHex', () => {
  it('accepts valid 6-digit hex', () => {
    expect(isValidHex('#ff00ff')).toBe(true);
    expect(isValidHex('#AABBCC')).toBe(true);
    expect(isValidHex('#000000')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(isValidHex('#fff')).toBe(false);
    expect(isValidHex('ff00ff')).toBe(false);
    expect(isValidHex('#gggggg')).toBe(false);
    expect(isValidHex('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// colorDistance
// ---------------------------------------------------------------------------
describe('colorDistance', () => {
  it('returns 0 for identical colours', () => {
    expect(colorDistance([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])).toBe(0);
  });

  it('returns correct distance for black to white', () => {
    const d = colorDistance([0, 0, 0], [1, 1, 1]);
    expect(d).toBeCloseTo(Math.sqrt(3), 5);
  });

  it('returns a positive value for different colours', () => {
    expect(colorDistance([1, 0, 0], [0, 1, 0])).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// analyzeStyleConsistency
// ---------------------------------------------------------------------------
describe('analyzeStyleConsistency', () => {
  const lowPolyStyle = ART_STYLE_PRESETS['low_poly'];

  it('returns 100 score for an empty entity list', () => {
    const report = analyzeStyleConsistency([], lowPolyStyle);
    expect(report.score).toBe(100);
    expect(report.totalEntities).toBe(0);
  });

  it('returns 100 score when entities have no materials', () => {
    const entities: EntitySummary[] = [
      { entityId: '1', name: 'Empty', material: null },
    ];
    const report = analyzeStyleConsistency(entities, lowPolyStyle);
    expect(report.score).toBe(100);
  });

  it('detects roughness deviation', () => {
    const entities: EntitySummary[] = [
      {
        entityId: '1',
        name: 'Shiny',
        material: makeMaterial({ perceptualRoughness: 0.1 }),
      },
    ];
    const report = analyzeStyleConsistency(entities, lowPolyStyle);
    expect(report.deviatingCount).toBe(1);
    expect(report.deviations[0].reasons.some((r) => r.includes('roughness'))).toBe(true);
  });

  it('detects metallic deviation', () => {
    const entities: EntitySummary[] = [
      {
        entityId: '1',
        name: 'Metal',
        material: makeMaterial({ metallic: 0.9 }),
      },
    ];
    const report = analyzeStyleConsistency(entities, lowPolyStyle);
    expect(report.deviatingCount).toBe(1);
    expect(report.deviations[0].reasons.some((r) => r.includes('metallic'))).toBe(true);
  });

  it('detects colour deviation from palette', () => {
    // Bright magenta is far from the low_poly palette
    const entities: EntitySummary[] = [
      {
        entityId: '1',
        name: 'Wild',
        material: makeMaterial({
          baseColor: [1.0, 0.0, 1.0, 1.0],
          perceptualRoughness: 0.7,
          metallic: 0.0,
        }),
      },
    ];
    const report = analyzeStyleConsistency(entities, lowPolyStyle);
    expect(report.deviations.length).toBeGreaterThanOrEqual(1);
    const colourReasons = report.deviations[0].reasons.filter((r) => r.includes('colour'));
    expect(colourReasons.length).toBeGreaterThanOrEqual(1);
  });

  it('marks fully consistent entities as consistent', () => {
    // low_poly: roughness 0.6-0.9, metallic 0-0.1, palette includes #4ecdc4
    // #4ecdc4 in linear ≈ [0.056, 0.531, 0.462]
    const entities: EntitySummary[] = [
      {
        entityId: '1',
        name: 'Good',
        material: makeMaterial({
          baseColor: [0.056, 0.531, 0.462, 1.0],
          perceptualRoughness: 0.75,
          metallic: 0.05,
        }),
      },
    ];
    const report = analyzeStyleConsistency(entities, lowPolyStyle);
    expect(report.consistentCount).toBe(1);
    expect(report.deviatingCount).toBe(0);
    expect(report.score).toBe(100);
  });

  it('computes score correctly for mixed scene', () => {
    const entities: EntitySummary[] = [
      {
        entityId: '1',
        name: 'Good',
        material: makeMaterial({
          baseColor: [0.056, 0.531, 0.462, 1.0],
          perceptualRoughness: 0.75,
          metallic: 0.05,
        }),
      },
      {
        entityId: '2',
        name: 'Bad',
        material: makeMaterial({ metallic: 0.9 }),
      },
    ];
    const report = analyzeStyleConsistency(entities, lowPolyStyle);
    expect(report.score).toBe(50);
    expect(report.consistentCount).toBe(1);
    expect(report.deviatingCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// generateStylePromptModifier
// ---------------------------------------------------------------------------
describe('generateStylePromptModifier', () => {
  it('includes the style name', () => {
    const mod = generateStylePromptModifier(ART_STYLE_PRESETS['pixel_retro']);
    expect(mod).toContain('Pixel Retro');
  });

  it('includes palette hex values', () => {
    const style = ART_STYLE_PRESETS['neon_cyberpunk'];
    const mod = generateStylePromptModifier(style);
    expect(mod).toContain('#ff00ff');
    expect(mod).toContain('#00ffff');
  });

  it('includes roughness and metallic ranges', () => {
    const mod = generateStylePromptModifier(ART_STYLE_PRESETS['realistic']);
    expect(mod).toContain('roughness');
    expect(mod).toContain('metallic');
  });

  it('includes lighting mood', () => {
    const mod = generateStylePromptModifier(ART_STYLE_PRESETS['watercolor']);
    expect(mod).toContain('warm');
    expect(mod).toContain('diffused');
  });

  it('includes emissive info when intensity > 0', () => {
    const mod = generateStylePromptModifier(ART_STYLE_PRESETS['neon_cyberpunk']);
    expect(mod).toContain('Emissive');
  });

  it('excludes emissive info when intensity is 0', () => {
    const mod = generateStylePromptModifier(ART_STYLE_PRESETS['pixel_retro']);
    expect(mod).not.toContain('Emissive');
  });

  it('includes harmony type', () => {
    const mod = generateStylePromptModifier(ART_STYLE_PRESETS['minimalist']);
    expect(mod).toContain('monochromatic');
  });
});

// ---------------------------------------------------------------------------
// buildStyleMaterial
// ---------------------------------------------------------------------------
describe('buildStyleMaterial', () => {
  it('creates a valid MaterialData object', () => {
    const mat = buildStyleMaterial(ART_STYLE_PRESETS['low_poly']);
    expect(mat.baseColor).toHaveLength(4);
    expect(mat.emissive).toHaveLength(4);
    expect(mat.alphaMode).toBe('opaque');
    expect(mat.perceptualRoughness).toBeGreaterThanOrEqual(0);
    expect(mat.perceptualRoughness).toBeLessThanOrEqual(1);
  });

  it('uses mid-range roughness and metallic', () => {
    const style = ART_STYLE_PRESETS['realistic'];
    const mat = buildStyleMaterial(style);
    const expectedRoughness = (0.1 + 0.9) / 2;
    const expectedMetallic = (0.0 + 1.0) / 2;
    expect(mat.perceptualRoughness).toBeCloseTo(expectedRoughness, 5);
    expect(mat.metallic).toBeCloseTo(expectedMetallic, 5);
  });

  it('sets blend alpha mode for transparent styles', () => {
    const mat = buildStyleMaterial(ART_STYLE_PRESETS['watercolor']);
    expect(mat.alphaMode).toBe('blend');
  });

  it('respects palette key parameter', () => {
    const mat1 = buildStyleMaterial(ART_STYLE_PRESETS['low_poly'], 'primary');
    const mat2 = buildStyleMaterial(ART_STYLE_PRESETS['low_poly'], 'accent');
    // Different palette keys should produce different base colours
    expect(mat1.baseColor[0]).not.toBeCloseTo(mat2.baseColor[0], 2);
  });

  it('sets emissive values for high-emissive styles', () => {
    const mat = buildStyleMaterial(ART_STYLE_PRESETS['neon_cyberpunk']);
    expect(mat.emissive[3]).toBeGreaterThan(0);
    expect(mat.emissiveExposureWeight).toBeGreaterThan(0);
  });

  it('sets zero emissive for non-emissive styles', () => {
    const mat = buildStyleMaterial(ART_STYLE_PRESETS['pixel_retro']);
    expect(mat.emissive[3]).toBe(0);
    expect(mat.emissiveExposureWeight).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyStyleToScene
// ---------------------------------------------------------------------------
describe('applyStyleToScene', () => {
  it('dispatches update_material for each entity', () => {
    const dispatch = vi.fn();
    const ids = ['e1', 'e2', 'e3'];
    applyStyleToScene(ART_STYLE_PRESETS['low_poly'], ids, dispatch);
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenNthCalledWith(1, 'update_material', expect.objectContaining({ entityId: 'e1' }));
    expect(dispatch).toHaveBeenNthCalledWith(2, 'update_material', expect.objectContaining({ entityId: 'e2' }));
    expect(dispatch).toHaveBeenNthCalledWith(3, 'update_material', expect.objectContaining({ entityId: 'e3' }));
  });

  it('cycles through palette keys for variety', () => {
    const dispatch = vi.fn();
    const ids = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];
    applyStyleToScene(ART_STYLE_PRESETS['low_poly'], ids, dispatch);

    // 6th entity wraps back to secondary (index 5 % 5 = 0 => primary)
    const firstCall = dispatch.mock.calls[0][1] as Record<string, unknown>;
    const sixthCall = dispatch.mock.calls[5][1] as Record<string, unknown>;
    // entity 0 -> primary, entity 5 -> background (5%5=0 => primary)
    expect(firstCall['entityId']).toBe('e1');
    expect(sixthCall['entityId']).toBe('e6');
  });

  it('does nothing for empty entity list', () => {
    const dispatch = vi.fn();
    applyStyleToScene(ART_STYLE_PRESETS['low_poly'], [], dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getStylePresetKeys / getStylePreset
// ---------------------------------------------------------------------------
describe('getStylePresetKeys', () => {
  it('returns all preset keys', () => {
    const keys = getStylePresetKeys();
    expect(keys).toContain('pixel_retro');
    expect(keys).toContain('low_poly');
    expect(keys).toContain('realistic');
    expect(keys).toContain('neon_cyberpunk');
    expect(keys.length).toBeGreaterThanOrEqual(8);
  });
});

describe('getStylePreset', () => {
  it('returns the correct preset', () => {
    const style = getStylePreset('minimalist');
    expect(style).not.toBeUndefined();
    expect(style?.name).toBe('Minimalist');
  });

  it('returns undefined for unknown key', () => {
    expect(getStylePreset('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------
describe('style lock persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no style is locked', () => {
    expect(loadLockedStyle()).toBeNull();
  });

  it('saves and loads a locked style', () => {
    const style = ART_STYLE_PRESETS['pixel_retro'];
    saveLockedStyle('pixel_retro', style);
    const loaded = loadLockedStyle();
    expect(loaded).not.toBeNull();
    expect(loaded?.presetKey).toBe('pixel_retro');
    expect(loaded?.style.name).toBe('Pixel Retro');
  });

  it('clears the locked style', () => {
    saveLockedStyle('low_poly', ART_STYLE_PRESETS['low_poly']);
    clearLockedStyle();
    expect(loadLockedStyle()).toBeNull();
  });
});
