import { describe, it, expect, vi } from 'vitest';
import {
  TEXTURE_STYLES,
  VALID_TEXTURE_SLOTS,
  VALID_BLEND_MODES,
  generateTexturePrompt,
  applyMaterialChanges,
  detectCurrentStyle,
  clampIntensity,
  findStyleByName,
  type TextureModification,
  type TextureStyle,
  type BlendMode,
  type TextureSlot,
} from '../texturePainter';
import type { MaterialData } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Helper: minimal MaterialData fixture
// ---------------------------------------------------------------------------
function makeMaterialData(
  overrides: Partial<Pick<MaterialData, 'perceptualRoughness' | 'metallic' | 'emissive'>> = {},
): MaterialData {
  return {
    baseColor: [1, 1, 1, 1],
    metallic: overrides.metallic ?? 0.5,
    perceptualRoughness: overrides.perceptualRoughness ?? 0.5,
    reflectance: 0.5,
    emissive: overrides.emissive ?? [0, 0, 0, 1],
    emissiveExposureWeight: 0.0,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
    doubleSided: false,
    unlit: false,
  };
}

// ---------------------------------------------------------------------------
// TEXTURE_STYLES
// ---------------------------------------------------------------------------

describe('TEXTURE_STYLES', () => {
  it('contains 12 pre-built styles', () => {
    expect(TEXTURE_STYLES).toHaveLength(12);
  });

  it('each style has required fields', () => {
    for (const style of TEXTURE_STYLES) {
      expect(style.name).not.toBe('');
      expect(style.description).not.toBe('');
      expect(style.promptModifier).not.toBe('');
      expect(style.materialAdjustments).toBeDefined();
    }
  });

  it('has unique style names', () => {
    const names = TEXTURE_STYLES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('material adjustments have values in valid ranges', () => {
    for (const style of TEXTURE_STYLES) {
      const adj = style.materialAdjustments;
      if (adj.roughness !== undefined) {
        expect(adj.roughness).toBeGreaterThanOrEqual(0);
        expect(adj.roughness).toBeLessThanOrEqual(1);
      }
      if (adj.metallic !== undefined) {
        expect(adj.metallic).toBeGreaterThanOrEqual(0);
        expect(adj.metallic).toBeLessThanOrEqual(1);
      }
      if (adj.emissive !== undefined) {
        expect(adj.emissive).toBeGreaterThanOrEqual(0);
        expect(adj.emissive).toBeLessThanOrEqual(1);
      }
      if (adj.opacity !== undefined) {
        expect(adj.opacity).toBeGreaterThanOrEqual(0);
        expect(adj.opacity).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

describe('VALID_TEXTURE_SLOTS', () => {
  it('contains all 5 PBR texture slots', () => {
    expect(VALID_TEXTURE_SLOTS).toEqual([
      'base_color',
      'normal',
      'metallic_roughness',
      'emissive',
      'occlusion',
    ]);
  });
});

describe('VALID_BLEND_MODES', () => {
  it('contains all 4 blend modes', () => {
    expect(VALID_BLEND_MODES).toEqual(['replace', 'overlay', 'multiply', 'add']);
  });
});

// ---------------------------------------------------------------------------
// clampIntensity
// ---------------------------------------------------------------------------

describe('clampIntensity', () => {
  it('clamps below 0 to 0', () => {
    expect(clampIntensity(-0.5)).toBe(0);
  });

  it('clamps above 1 to 1', () => {
    expect(clampIntensity(1.5)).toBe(1);
  });

  it('passes through values in [0,1]', () => {
    expect(clampIntensity(0.5)).toBe(0.5);
    expect(clampIntensity(0)).toBe(0);
    expect(clampIntensity(1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// findStyleByName
// ---------------------------------------------------------------------------

describe('findStyleByName', () => {
  it('finds a style by exact name', () => {
    const style = findStyleByName('rusty');
    expect(style).toBeDefined();
    expect(style!.name).toBe('rusty');
  });

  it('finds a style case-insensitively', () => {
    const style = findStyleByName('FROZEN');
    expect(style).toBeDefined();
    expect(style!.name).toBe('frozen');
  });

  it('returns undefined for unknown names', () => {
    expect(findStyleByName('nonexistent')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(findStyleByName('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateTexturePrompt
// ---------------------------------------------------------------------------

describe('generateTexturePrompt', () => {
  const baseModification: TextureModification = {
    description: 'cracked stone wall',
    targetSlot: 'base_color',
    intensity: 0.5,
    blendMode: 'replace',
  };

  it('includes the slot hint in the prompt', () => {
    const prompt = generateTexturePrompt(baseModification);
    expect(prompt).toContain('diffuse albedo color map');
  });

  it('includes the user description', () => {
    const prompt = generateTexturePrompt(baseModification);
    expect(prompt).toContain('cracked stone wall');
  });

  it('includes blend mode description', () => {
    const prompt = generateTexturePrompt(baseModification);
    expect(prompt).toContain('fully replacing the existing texture');
  });

  it('includes quality boilerplate', () => {
    const prompt = generateTexturePrompt(baseModification);
    expect(prompt).toContain('1024x1024');
    expect(prompt).toContain('seamless tiling');
  });

  it('includes style modifier when style is provided', () => {
    const style = findStyleByName('rusty')!;
    const prompt = generateTexturePrompt(baseModification, style);
    expect(prompt).toContain('rusty metal');
  });

  it('does not include aesthetic line when no style provided', () => {
    const prompt = generateTexturePrompt(baseModification);
    expect(prompt).not.toContain('Aesthetic:');
  });

  it('adds subtle hint for low intensity', () => {
    const mod: TextureModification = { ...baseModification, intensity: 0.1 };
    const prompt = generateTexturePrompt(mod);
    expect(prompt).toContain('subtly');
  });

  it('adds strong hint for high intensity', () => {
    const mod: TextureModification = { ...baseModification, intensity: 0.9 };
    const prompt = generateTexturePrompt(mod);
    expect(prompt).toContain('strongly');
  });

  it('no intensity hint for mid-range intensity', () => {
    const prompt = generateTexturePrompt(baseModification); // 0.5
    expect(prompt).not.toContain('subtly');
    expect(prompt).not.toContain('strongly');
  });

  it.each([
    ['base_color', 'diffuse albedo color map'],
    ['normal', 'tangent-space normal map'],
    ['metallic_roughness', 'metallic-roughness PBR map'],
    ['emissive', 'emissive glow map'],
    ['occlusion', 'ambient occlusion map'],
  ] as [TextureSlot, string][])('includes correct hint for slot %s', (slot, expected) => {
    const mod: TextureModification = { ...baseModification, targetSlot: slot };
    const prompt = generateTexturePrompt(mod);
    expect(prompt).toContain(expected);
  });

  it.each([
    ['replace', 'fully replacing'],
    ['overlay', 'overlaid on top'],
    ['multiply', 'multiplied with'],
    ['add', 'additively blended'],
  ] as [BlendMode, string][])('includes correct description for blend mode %s', (mode, expected) => {
    const mod: TextureModification = { ...baseModification, blendMode: mode };
    const prompt = generateTexturePrompt(mod);
    expect(prompt).toContain(expected);
  });
});

// ---------------------------------------------------------------------------
// applyMaterialChanges
// ---------------------------------------------------------------------------

describe('applyMaterialChanges', () => {
  it('dispatches update_material command', () => {
    const dispatch = vi.fn();
    const style = findStyleByName('rusty')!;
    applyMaterialChanges(style, 'entity-1', dispatch);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('update_material', expect.objectContaining({
      entityId: 'entity-1',
    }));
  });

  it('applies roughness and metallic at full intensity', () => {
    const dispatch = vi.fn();
    const style = findStyleByName('rusty')!;
    applyMaterialChanges(style, 'e1', dispatch, 1.0);
    const payload = dispatch.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.perceptualRoughness).toBeCloseTo(0.95);
    expect(payload.metallic).toBeCloseTo(0.2);
  });

  it('lerps toward target values by intensity', () => {
    const dispatch = vi.fn();
    const style = findStyleByName('rusty')!;
    applyMaterialChanges(style, 'e1', dispatch, 0.5);
    const payload = dispatch.mock.calls[0][1] as Record<string, unknown>;
    // Lerp from default (roughness=0.5, metallic=0.0) toward target at 50% intensity
    // roughness: 0.5 + (0.95 - 0.5) * 0.5 = 0.725
    // metallic: 0.0 + (0.2 - 0.0) * 0.5 = 0.1
    expect(payload.perceptualRoughness).toBeCloseTo(0.725);
    expect(payload.metallic).toBeCloseTo(0.1);
  });

  it('includes emissive array when style has emissive', () => {
    const dispatch = vi.fn();
    const style = findStyleByName('burning')!;
    applyMaterialChanges(style, 'e1', dispatch, 1.0);
    const payload = dispatch.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.emissive).toEqual([0.7, 0.7, 0.7, 1.0]);
  });

  it('lerps emissive from currentEmissive rather than from zero (regression PF-785)', () => {
    const dispatch = vi.fn();
    const style = findStyleByName('burning')!; // emissive target = 0.7
    // Apply at 50% intensity starting from currentEmissive = 0.4
    applyMaterialChanges(style, 'e1', dispatch, 0.5, undefined, 0.5, 0.0, 0.4);
    const payload = dispatch.mock.calls[0][1] as Record<string, unknown>;
    // Expected: 0.4 + (0.7 - 0.4) * 0.5 = 0.4 + 0.15 = 0.55
    expect(payload.emissive).toBeDefined();
    const emissive = payload.emissive as number[];
    expect(emissive[0]).toBeCloseTo(0.55);
    expect(emissive[1]).toBeCloseTo(0.55);
    expect(emissive[2]).toBeCloseTo(0.55);
  });

  it('emissive at zero intensity leaves currentEmissive unchanged (regression PF-785)', () => {
    const dispatch = vi.fn();
    const style = findStyleByName('burning')!;
    // Apply at 0 intensity from currentEmissive = 0.3
    applyMaterialChanges(style, 'e1', dispatch, 0.0, undefined, 0.5, 0.0, 0.3);
    const payload = dispatch.mock.calls[0][1] as Record<string, unknown>;
    // Expected: 0.3 + (0.7 - 0.3) * 0.0 = 0.3
    const emissive = payload.emissive as number[];
    expect(emissive[0]).toBeCloseTo(0.3);
  });

  it('includes alpha and alphaMode for translucent styles', () => {
    const dispatch = vi.fn();
    const style = findStyleByName('frozen')!;
    applyMaterialChanges(style, 'e1', dispatch, 1.0);
    const payload = dispatch.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.alphaMode).toBe('blend');
    expect(payload.baseColor).toBeDefined();
  });

  it('does not include alphaMode for opaque styles', () => {
    const dispatch = vi.fn();
    const style = findStyleByName('rusty')!;
    applyMaterialChanges(style, 'e1', dispatch, 1.0);
    const payload = dispatch.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.alphaMode).toBeUndefined();
  });

  it('defaults intensity to 1.0', () => {
    const dispatch = vi.fn();
    const style = findStyleByName('holographic')!;
    applyMaterialChanges(style, 'e1', dispatch);
    const payload = dispatch.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.metallic).toBeCloseTo(0.95);
  });
});

// ---------------------------------------------------------------------------
// detectCurrentStyle
// ---------------------------------------------------------------------------

describe('detectCurrentStyle', () => {
  it('returns exact-match style for matching material', () => {
    const mat = makeMaterialData({
      perceptualRoughness: 0.95,
      metallic: 0.2,
    });
    const style = detectCurrentStyle(mat);
    expect(style).not.toBeNull();
    expect(style!.name).toBe('rusty');
  });

  it('returns null when no style is close', () => {
    // Use values that are far from all presets:
    // Most styles cluster at high roughness/low metallic or vice versa
    // 0.55 roughness + 0.75 metallic + high emissive is far from everything
    const mat = makeMaterialData({
      perceptualRoughness: 0.55,
      metallic: 0.75,
      emissive: [0.4, 0.4, 0.4, 1],
    });
    const style = detectCurrentStyle(mat);
    expect(style).toBeNull();
  });

  it('detects holographic style', () => {
    const mat = makeMaterialData({
      perceptualRoughness: 0.1,
      metallic: 0.95,
    });
    const style = detectCurrentStyle(mat);
    expect(style).not.toBeNull();
    expect(style!.name).toBe('holographic');
  });

  it('detects neon_glow style with high emissive', () => {
    // neon_glow: roughness=0.3, metallic=0.4, emissive=0.9
    const mat = makeMaterialData({
      perceptualRoughness: 0.3,
      metallic: 0.4,
      emissive: [0.9, 0.9, 0.9, 1],
    });
    const style = detectCurrentStyle(mat);
    expect(style).not.toBeNull();
    expect(style!.name).toBe('neon_glow');
  });

  it('returns best match when score is within threshold', () => {
    // polished: roughness=0.05, metallic=1.0 — use close values
    const mat = makeMaterialData({
      perceptualRoughness: 0.05,
      metallic: 1.0,
    });
    const style = detectCurrentStyle(mat);
    expect(style).not.toBeNull();
    expect(style!.name).toBe('metallic_polished');
  });

  it('considers emissive channel averages', () => {
    // neon_glow has emissive: 0.9 — use non-uniform channels that average to 0.9
    const mat = makeMaterialData({
      perceptualRoughness: 0.3,
      metallic: 0.4,
      emissive: [0.8, 0.9, 1.0, 1],
    });
    const style = detectCurrentStyle(mat);
    expect(style).not.toBeNull();
    expect(style!.name).toBe('neon_glow');
  });
});

// ---------------------------------------------------------------------------
// Type-level exhaustiveness sanity checks
// ---------------------------------------------------------------------------

describe('type exhaustiveness', () => {
  it('TextureStyle has all required properties', () => {
    const style: TextureStyle = {
      name: 'test',
      description: 'test',
      promptModifier: 'test',
      materialAdjustments: {},
    };
    expect(style.name).toBe('test');
  });

  it('TextureModification has all required properties', () => {
    const mod: TextureModification = {
      description: 'test',
      targetSlot: 'base_color',
      intensity: 0.5,
      blendMode: 'replace',
    };
    expect(mod.targetSlot).toBe('base_color');
  });
});
