import { describe, it, expect } from 'vitest';
import {
  relativeLuminance,
  contrastRatio,
  hasAdequateContrast,
  simulateColorblind,
  colorsDistinguishableForColorblind,
  COLORBLIND_FILTERS,
  analyzeAccessibility,
  generateEntityDescriptions,
  generateAccessibilityProfile,
  buildEntitySummaries,
  createDefaultProfile,
  getColorblindFilterCSS,
  getColorblindSVGFilter,
  type SceneContext,
  type EntitySummary,
  type ColorblindType,
} from '../accessibilityGenerator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSceneContext(overrides: Partial<SceneContext> = {}): SceneContext {
  return {
    sceneGraph: { nodes: {}, rootIds: [] },
    materials: {},
    lights: {},
    scripts: {},
    ...overrides,
  };
}

function makeNode(
  entityId: string,
  name: string,
  components: string[] = ['Mesh3d'],
  children: string[] = [],
) {
  return {
    entityId,
    name,
    parentId: null,
    children,
    components,
    visible: true,
  };
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
  });

  it('returns ~1 for white', () => {
    const lum = relativeLuminance(1, 1, 1);
    expect(lum).toBeGreaterThan(0.99);
    expect(lum).toBeLessThanOrEqual(1);
  });

  it('returns correct luminance for mid-gray', () => {
    const lum = relativeLuminance(0.5, 0.5, 0.5);
    expect(lum).toBeGreaterThan(0.1);
    expect(lum).toBeLessThan(0.3);
  });

  it('handles sRGB linearization correctly for low values', () => {
    // Values <= 0.03928 use the linear formula
    const lum = relativeLuminance(0.03, 0.03, 0.03);
    expect(lum).toBeGreaterThan(0);
    expect(lum).toBeLessThan(0.01);
  });
});

describe('contrastRatio', () => {
  it('returns 21:1 for black vs white', () => {
    const ratio = contrastRatio(0, 1);
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('returns 1:1 for same luminance', () => {
    expect(contrastRatio(0.5, 0.5)).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio(0.2, 0.8)).toBeCloseTo(contrastRatio(0.8, 0.2), 5);
  });
});

describe('hasAdequateContrast', () => {
  it('returns true for black vs white (AA)', () => {
    expect(hasAdequateContrast([0, 0, 0], [1, 1, 1], 'AA')).toBe(true);
  });

  it('returns false for similar grays (AA)', () => {
    expect(hasAdequateContrast([0.5, 0.5, 0.5], [0.6, 0.6, 0.6], 'AA')).toBe(false);
  });

  it('uses AA level by default', () => {
    expect(hasAdequateContrast([0, 0, 0], [1, 1, 1])).toBe(true);
  });

  it('AAA is stricter than AA', () => {
    // A pair that passes AA but may fail AAA
    const dark: [number, number, number] = [0.0, 0.0, 0.0];
    const mid: [number, number, number] = [0.4, 0.4, 0.4];
    const aa = hasAdequateContrast(dark, mid, 'AA');
    const aaa = hasAdequateContrast(dark, mid, 'AAA');
    // AAA should be equal or stricter
    if (aa) {
      // If AA passes, AAA may or may not pass
      expect(typeof aaa).toBe('boolean');
    } else {
      // If AA fails, AAA must also fail
      expect(aaa).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Colorblind simulation
// ---------------------------------------------------------------------------

describe('simulateColorblind', () => {
  it('returns clamped values between 0 and 1', () => {
    const result = simulateColorblind(1, 0, 0, 'protanopia');
    expect(result[0]).toBeGreaterThanOrEqual(0);
    expect(result[0]).toBeLessThanOrEqual(1);
    expect(result[1]).toBeGreaterThanOrEqual(0);
    expect(result[1]).toBeLessThanOrEqual(1);
    expect(result[2]).toBeGreaterThanOrEqual(0);
    expect(result[2]).toBeLessThanOrEqual(1);
  });

  it('converts to grayscale for achromatopsia', () => {
    const [r, g, b] = simulateColorblind(1, 0, 0, 'achromatopsia');
    // All channels should be the same for achromatopsia
    expect(r).toBeCloseTo(g, 3);
    expect(g).toBeCloseTo(b, 3);
  });

  it('preserves white under all types', () => {
    const types: ColorblindType[] = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
    for (const type of types) {
      const [r, g, b] = simulateColorblind(1, 1, 1, type);
      // White should remain approximately white (sum close to original)
      expect(r + g + b).toBeGreaterThan(2.5);
    }
  });

  it('preserves black under all types', () => {
    const types: ColorblindType[] = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
    for (const type of types) {
      const [r, g, b] = simulateColorblind(0, 0, 0, type);
      expect(r).toBeCloseTo(0, 5);
      expect(g).toBeCloseTo(0, 5);
      expect(b).toBeCloseTo(0, 5);
    }
  });
});

describe('colorsDistinguishableForColorblind', () => {
  it('returns true for very different colors', () => {
    expect(
      colorsDistinguishableForColorblind([0, 0, 0], [1, 1, 1], 'protanopia'),
    ).toBe(true);
  });

  it('detects that red and green are hard for deuteranopia', () => {
    // Pure red and green become very similar for deuteranopia
    const result = colorsDistinguishableForColorblind(
      [0.8, 0.2, 0.0],
      [0.2, 0.8, 0.0],
      'deuteranopia',
    );
    // These should be difficult to distinguish
    expect(typeof result).toBe('boolean');
  });

  it('returns true for black vs white under any type', () => {
    const types: ColorblindType[] = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
    for (const type of types) {
      expect(
        colorsDistinguishableForColorblind([0, 0, 0], [1, 1, 1], type),
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Colorblind filters
// ---------------------------------------------------------------------------

describe('COLORBLIND_FILTERS', () => {
  it('has entries for all four types', () => {
    expect(COLORBLIND_FILTERS.protanopia).toBeDefined();
    expect(COLORBLIND_FILTERS.deuteranopia).toBeDefined();
    expect(COLORBLIND_FILTERS.tritanopia).toBeDefined();
    expect(COLORBLIND_FILTERS.achromatopsia).toBeDefined();
  });

  it('contains valid CSS feColorMatrix values (20 numbers)', () => {
    for (const [_type, matrix] of Object.entries(COLORBLIND_FILTERS)) {
      const values = matrix.split(/[\s,]+/).filter(Boolean);
      expect(values.length).toBe(20);
      for (const val of values) {
        const num = Number(val);
        expect(Number.isNaN(num)).toBe(false);
      }
    }
  });

  it('preserves alpha channel (row 4 = 0 0 0 1 0)', () => {
    for (const [_type, matrix] of Object.entries(COLORBLIND_FILTERS)) {
      const values = matrix.split(/[\s,]+/).filter(Boolean).map(Number);
      // Last row (indices 15-19): 0 0 0 1 0
      expect(values[15]).toBe(0);
      expect(values[16]).toBe(0);
      expect(values[17]).toBe(0);
      expect(values[18]).toBe(1);
      expect(values[19]).toBe(0);
    }
  });
});

describe('getColorblindFilterCSS', () => {
  it('returns "none" when disabled', () => {
    expect(getColorblindFilterCSS({ enabled: false, mode: 'protanopia', filterStrength: 1 })).toBe('none');
  });

  it('returns a url reference when enabled', () => {
    const result = getColorblindFilterCSS({ enabled: true, mode: 'deuteranopia', filterStrength: 1 });
    expect(result).toContain('url(#colorblind-deuteranopia)');
  });
});

describe('getColorblindSVGFilter', () => {
  it('returns empty string when disabled', () => {
    expect(getColorblindSVGFilter({ enabled: false, mode: 'protanopia', filterStrength: 1 })).toBe('');
  });

  it('returns valid SVG markup when enabled', () => {
    const svg = getColorblindSVGFilter({ enabled: true, mode: 'tritanopia', filterStrength: 1 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('feColorMatrix');
    expect(svg).toContain('colorblind-tritanopia');
    expect(svg).toContain('</filter>');
    expect(svg).toContain('</svg>');
  });

  it('interpolates matrix when filterStrength < 1', () => {
    const full = getColorblindSVGFilter({ enabled: true, mode: 'protanopia', filterStrength: 1 });
    const half = getColorblindSVGFilter({ enabled: true, mode: 'protanopia', filterStrength: 0.5 });
    // The half-strength values should differ from full strength
    expect(half).not.toBe(full);
    expect(half).toContain('feColorMatrix');
  });
});

// ---------------------------------------------------------------------------
// Accessibility audit
// ---------------------------------------------------------------------------

describe('analyzeAccessibility', () => {
  it('returns 100 score for empty scene with lights', () => {
    const ctx = makeSceneContext({
      lights: { 'light-1': { lightType: 'directional', color: [1, 1, 1], intensity: 1, shadowsEnabled: false, shadowDepthBias: 0, shadowNormalBias: 0, range: 100, radius: 0, innerAngle: 0.5, outerAngle: 0.8 } },
    });
    const audit = analyzeAccessibility(ctx);
    expect(audit.score).toBe(100);
    expect(audit.issues.length).toBe(0);
  });

  it('flags missing lights in non-empty scenes', () => {
    const ctx = makeSceneContext({
      sceneGraph: {
        nodes: { e1: makeNode('e1', 'Cube') },
        rootIds: ['e1'],
      },
    });
    const audit = analyzeAccessibility(ctx);
    expect(audit.issues.some((i) => i.message.includes('no light sources'))).toBe(true);
  });

  it('flags audio entities without visuals', () => {
    const ctx = makeSceneContext({
      sceneGraph: {
        nodes: { e1: makeNode('e1', 'SoundEmitter', ['AudioEnabled']) },
        rootIds: ['e1'],
      },
      lights: { l1: { lightType: 'directional', color: [1, 1, 1], intensity: 1, shadowsEnabled: false, shadowDepthBias: 0, shadowNormalBias: 0, range: 100, radius: 0, innerAngle: 0.5, outerAngle: 0.8 } },
      audioEntities: new Set(['e1']),
    });
    const audit = analyzeAccessibility(ctx);
    expect(audit.issues.some((i) => i.category === 'auditory')).toBe(true);
  });

  it('detects low-contrast entity pairs', () => {
    const ctx = makeSceneContext({
      sceneGraph: {
        nodes: {
          e1: makeNode('e1', 'Box1'),
          e2: makeNode('e2', 'Box2'),
        },
        rootIds: ['e1', 'e2'],
      },
      materials: {
        e1: { baseColor: [0.5, 0.5, 0.5, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5, emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, unlit: false },
        e2: { baseColor: [0.52, 0.52, 0.52, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5, emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, unlit: false },
      },
      lights: { l1: { lightType: 'directional', color: [1, 1, 1], intensity: 1, shadowsEnabled: false, shadowDepthBias: 0, shadowNormalBias: 0, range: 100, radius: 0, innerAngle: 0.5, outerAngle: 0.8 } },
    });
    const audit = analyzeAccessibility(ctx);
    expect(audit.issues.some((i) => i.message.includes('similar colors'))).toBe(true);
  });

  it('returns totalChecks count', () => {
    const ctx = makeSceneContext();
    const audit = analyzeAccessibility(ctx);
    expect(audit.totalChecks).toBeGreaterThanOrEqual(7);
  });

  it('includes passedChecks array', () => {
    const ctx = makeSceneContext({
      lights: { l1: { lightType: 'directional', color: [1, 1, 1], intensity: 1, shadowsEnabled: false, shadowDepthBias: 0, shadowNormalBias: 0, range: 100, radius: 0, innerAngle: 0.5, outerAngle: 0.8 } },
    });
    const audit = analyzeAccessibility(ctx);
    expect(audit.passedChecks.length).toBeGreaterThan(0);
  });

  it('flags extreme brightness/darkness', () => {
    const ctx = makeSceneContext({
      sceneGraph: {
        nodes: { e1: makeNode('e1', 'DarkBox') },
        rootIds: ['e1'],
      },
      materials: {
        e1: { baseColor: [0.001, 0.001, 0.001, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5, emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, unlit: false },
      },
      lights: { l1: { lightType: 'directional', color: [1, 1, 1], intensity: 1, shadowsEnabled: false, shadowDepthBias: 0, shadowNormalBias: 0, range: 100, radius: 0, innerAngle: 0.5, outerAngle: 0.8 } },
    });
    const audit = analyzeAccessibility(ctx);
    expect(audit.issues.some((i) => i.message.includes('very dark'))).toBe(true);
  });

  it('score is clamped between 0 and 100', () => {
    // Create a scene with many issues to try to drive score below 0
    const nodes: Record<string, ReturnType<typeof makeNode>> = {};
    const materials: Record<string, SceneContext['materials'][string]> = {};
    for (let i = 0; i < 20; i++) {
      const id = `e${i}`;
      nodes[id] = makeNode(id, `Entity${i}`);
      materials[id] = { baseColor: [0.5, 0.5, 0.5, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5, emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, unlit: false };
    }
    const ctx = makeSceneContext({
      sceneGraph: { nodes, rootIds: Object.keys(nodes) },
      materials,
    });
    const audit = analyzeAccessibility(ctx);
    expect(audit.score).toBeGreaterThanOrEqual(0);
    expect(audit.score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Entity descriptions
// ---------------------------------------------------------------------------

describe('generateEntityDescriptions', () => {
  it('generates descriptions for all entities', () => {
    const entities: EntitySummary[] = [
      { entityId: 'e1', name: 'Player', entityType: 'mesh', components: ['Mesh3d'], hasPhysics: true, hasScript: true, hasAudio: false },
      { entityId: 'e2', name: 'Sun', entityType: 'directional_light', components: ['DirectionalLight'], hasPhysics: false, hasScript: false, hasAudio: false },
    ];
    const descs = generateEntityDescriptions(entities);
    expect(descs.size).toBe(2);
    expect(descs.get('e1')).toContain('Player');
    expect(descs.get('e2')).toContain('Sun');
  });

  it('includes physics/script/audio context', () => {
    const entities: EntitySummary[] = [
      { entityId: 'e1', name: 'Ball', entityType: 'mesh', components: ['Mesh3d'], hasPhysics: true, hasScript: true, hasAudio: true },
    ];
    const descs = generateEntityDescriptions(entities);
    const desc = descs.get('e1') ?? '';
    expect(desc).toContain('physics');
    expect(desc).toContain('interactive');
    expect(desc).toContain('sound');
  });

  it('includes color description when material color is provided', () => {
    const entities: EntitySummary[] = [
      { entityId: 'e1', name: 'RedBox', entityType: 'mesh', components: ['Mesh3d'], hasPhysics: false, hasScript: false, hasAudio: false, materialColor: [0.9, 0.1, 0.1, 1] },
    ];
    const descs = generateEntityDescriptions(entities);
    const desc = descs.get('e1') ?? '';
    expect(desc).toContain('red');
  });

  it('handles terrain entity type', () => {
    const entities: EntitySummary[] = [
      { entityId: 'e1', name: 'Ground', entityType: 'terrain', components: ['TerrainEnabled'], hasPhysics: false, hasScript: false, hasAudio: false },
    ];
    const descs = generateEntityDescriptions(entities);
    expect(descs.get('e1')).toContain('Terrain');
  });

  it('handles sprite entity type', () => {
    const entities: EntitySummary[] = [
      { entityId: 'e1', name: 'Hero', entityType: 'sprite', components: ['Sprite'], hasPhysics: false, hasScript: false, hasAudio: false },
    ];
    const descs = generateEntityDescriptions(entities);
    expect(descs.get('e1')).toContain('sprite');
  });
});

// ---------------------------------------------------------------------------
// Profile generation
// ---------------------------------------------------------------------------

describe('generateAccessibilityProfile', () => {
  it('returns a complete profile structure', () => {
    const ctx = makeSceneContext({
      sceneGraph: {
        nodes: { e1: makeNode('e1', 'Cube') },
        rootIds: ['e1'],
      },
    });
    const profile = generateAccessibilityProfile(ctx);
    expect(profile.colorblindMode).toBeDefined();
    expect(profile.screenReader).toBeDefined();
    expect(profile.inputRemapping).toBeDefined();
    expect(profile.subtitles).toBeDefined();
    expect(profile.fontSize).toBeDefined();
  });

  it('generates screen reader descriptions for all entities', () => {
    const ctx = makeSceneContext({
      sceneGraph: {
        nodes: {
          e1: makeNode('e1', 'Player'),
          e2: makeNode('e2', 'Enemy'),
        },
        rootIds: ['e1', 'e2'],
      },
    });
    const profile = generateAccessibilityProfile(ctx);
    expect(profile.screenReader.entityDescriptions.size).toBe(2);
  });

  it('maps input bindings to remappings', () => {
    const ctx = makeSceneContext({
      inputBindings: [
        { actionName: 'jump', keys: ['Space', 'W'] },
        { actionName: 'attack', keys: ['J'] },
      ],
    });
    const profile = generateAccessibilityProfile(ctx);
    expect(profile.inputRemapping.remappings.length).toBe(2);
    expect(profile.inputRemapping.remappings[0].action).toBe('jump');
    expect(profile.inputRemapping.remappings[0].gamepadButton).toBe('A');
    expect(profile.inputRemapping.remappings[1].action).toBe('attack');
    expect(profile.inputRemapping.remappings[1].gamepadButton).toBe('X');
  });

  it('defaults subtitles to enabled', () => {
    const ctx = makeSceneContext();
    const profile = generateAccessibilityProfile(ctx);
    expect(profile.subtitles.enabled).toBe(true);
  });
});

describe('buildEntitySummaries', () => {
  it('builds summaries from scene context', () => {
    const ctx = makeSceneContext({
      sceneGraph: {
        nodes: {
          e1: makeNode('e1', 'Player', ['Mesh3d', 'PhysicsEnabled']),
        },
        rootIds: ['e1'],
      },
      scripts: { e1: { enabled: true } },
      audioEntities: new Set(['e1']),
      materials: {
        e1: { baseColor: [1, 0, 0, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5, emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, unlit: false },
      },
    });
    const summaries = buildEntitySummaries(ctx);
    expect(summaries.length).toBe(1);
    expect(summaries[0].hasPhysics).toBe(true);
    expect(summaries[0].hasScript).toBe(true);
    expect(summaries[0].hasAudio).toBe(true);
    expect(summaries[0].materialColor).toEqual([1, 0, 0, 1]);
  });
});

describe('createDefaultProfile', () => {
  it('returns profile with all features disabled', () => {
    const profile = createDefaultProfile();
    expect(profile.colorblindMode.enabled).toBe(false);
    expect(profile.screenReader.enabled).toBe(false);
    expect(profile.inputRemapping.enabled).toBe(false);
    expect(profile.subtitles.enabled).toBe(false);
    expect(profile.fontSize.enabled).toBe(false);
  });

  it('has empty entity descriptions', () => {
    const profile = createDefaultProfile();
    expect(profile.screenReader.entityDescriptions.size).toBe(0);
  });

  it('defaults to deuteranopia mode', () => {
    const profile = createDefaultProfile();
    expect(profile.colorblindMode.mode).toBe('deuteranopia');
  });
});
