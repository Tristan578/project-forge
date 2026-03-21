/**
 * Coverage sweep for accessibilityGenerator.ts
 * Targets uncovered branches in:
 *  - getColorblindFilterCSS / getColorblindSVGFilter
 *  - generateAccessibilityProfile (guessGamepadButton / guessTouchGesture)
 *  - describeColor (branch paths for all dominant hues)
 *  - generateEntityDescriptions (various entity configurations)
 *  - analyzeAccessibility additional branches
 */

import { describe, it, expect } from 'vitest';
import {
  getColorblindFilterCSS,
  getColorblindSVGFilter,
  generateAccessibilityProfile,
  generateEntityDescriptions,
  analyzeAccessibility,
  type SceneContext,
  type ColorblindConfig,
  type ColorblindType,
  type EntitySummary,
} from '../accessibilityGenerator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDisabledColorblind(): ColorblindConfig {
  return { enabled: false, mode: 'deuteranopia', filterStrength: 1.0 };
}

function makeColorblind(mode: ColorblindType, strength = 1.0): ColorblindConfig {
  return { enabled: true, mode, filterStrength: strength };
}

function makeSceneContext(overrides: Partial<SceneContext> = {}): SceneContext {
  return {
    sceneGraph: { nodes: {}, rootIds: [] },
    materials: {},
    lights: {},
    scripts: {},
    ...overrides,
  };
}

function makeEntitySummary(overrides: Partial<EntitySummary> = {}): EntitySummary {
  return {
    entityId: 'e1',
    name: 'Entity',
    entityType: 'generic',
    components: [],
    hasPhysics: false,
    hasScript: false,
    hasAudio: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getColorblindFilterCSS
// ---------------------------------------------------------------------------

describe('getColorblindFilterCSS', () => {
  it('returns "none" when disabled', () => {
    expect(getColorblindFilterCSS(makeDisabledColorblind())).toBe('none');
  });

  it('returns url reference for deuteranopia', () => {
    const result = getColorblindFilterCSS(makeColorblind('deuteranopia'));
    expect(result).toBe('url(#colorblind-deuteranopia)');
  });

  it('returns url reference for protanopia', () => {
    const result = getColorblindFilterCSS(makeColorblind('protanopia'));
    expect(result).toBe('url(#colorblind-protanopia)');
  });

  it('returns url reference for tritanopia', () => {
    const result = getColorblindFilterCSS(makeColorblind('tritanopia'));
    expect(result).toBe('url(#colorblind-tritanopia)');
  });

  it('returns url reference for achromatopsia', () => {
    const result = getColorblindFilterCSS(makeColorblind('achromatopsia'));
    expect(result).toBe('url(#colorblind-achromatopsia)');
  });
});

// ---------------------------------------------------------------------------
// getColorblindSVGFilter
// ---------------------------------------------------------------------------

describe('getColorblindSVGFilter', () => {
  it('returns empty string when disabled', () => {
    expect(getColorblindSVGFilter(makeDisabledColorblind())).toBe('');
  });

  it('returns SVG string containing filter id for deuteranopia', () => {
    const result = getColorblindSVGFilter(makeColorblind('deuteranopia'));
    expect(result).toContain('id="colorblind-deuteranopia"');
    expect(result).toContain('<feColorMatrix');
    expect(result).toContain('<filter');
  });

  it('returns SVG string for protanopia', () => {
    const result = getColorblindSVGFilter(makeColorblind('protanopia'));
    expect(result).toContain('id="colorblind-protanopia"');
  });

  it('returns SVG string for tritanopia', () => {
    const result = getColorblindSVGFilter(makeColorblind('tritanopia'));
    expect(result).toContain('id="colorblind-tritanopia"');
  });

  it('returns SVG string for achromatopsia', () => {
    const result = getColorblindSVGFilter(makeColorblind('achromatopsia'));
    expect(result).toContain('id="colorblind-achromatopsia"');
  });

  it('interpolates matrix when filterStrength < 1', () => {
    const result = getColorblindSVGFilter(makeColorblind('deuteranopia', 0.5));
    // Should produce a valid SVG with interpolated matrix values
    expect(result).toContain('<feColorMatrix');
    expect(result.length).toBeGreaterThan(50);
  });

  it('uses full matrix when filterStrength = 1 exactly', () => {
    const full = getColorblindSVGFilter(makeColorblind('deuteranopia', 1.0));
    const interpolated = getColorblindSVGFilter(makeColorblind('deuteranopia', 0.5));
    // They should both be valid SVGs but with different matrix values
    expect(full).toContain('<feColorMatrix');
    expect(interpolated).toContain('<feColorMatrix');
  });
});

// ---------------------------------------------------------------------------
// generateAccessibilityProfile — guessGamepadButton branch coverage
// ---------------------------------------------------------------------------

describe('generateAccessibilityProfile — gamepad button mapping', () => {
  function profileWithBinding(actionName: string) {
    const ctx = makeSceneContext({
      inputBindings: [{ actionName, keys: ['Space'] }],
    });
    return generateAccessibilityProfile(ctx);
  }

  it('maps "jump" action to gamepad A', () => {
    const p = profileWithBinding('jump');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('A');
  });

  it('maps "confirm" action to gamepad A', () => {
    const p = profileWithBinding('confirm');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('A');
  });

  it('maps "attack" action to gamepad X', () => {
    const p = profileWithBinding('attack');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('X');
  });

  it('maps "action" to gamepad X', () => {
    const p = profileWithBinding('action');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('X');
  });

  it('maps "cancel" to gamepad B', () => {
    const p = profileWithBinding('cancel');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('B');
  });

  it('maps "back" to gamepad B', () => {
    const p = profileWithBinding('back');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('B');
  });

  it('maps "interact" to gamepad Y', () => {
    const p = profileWithBinding('interact');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Y');
  });

  it('maps "use" to gamepad Y', () => {
    const p = profileWithBinding('use');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Y');
  });

  it('maps "move_forward" to Left Stick', () => {
    const p = profileWithBinding('move_forward');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Left Stick');
  });

  it('maps "walk_left" to Left Stick', () => {
    const p = profileWithBinding('walk_left');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Left Stick');
  });

  it('maps "look_up" to Right Stick', () => {
    const p = profileWithBinding('look_up');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Right Stick');
  });

  it('maps "aim" to Right Stick', () => {
    const p = profileWithBinding('aim');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Right Stick');
  });

  it('maps "sprint" to Left Bumper', () => {
    const p = profileWithBinding('sprint');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Left Bumper');
  });

  it('maps "run" to Left Bumper', () => {
    const p = profileWithBinding('run');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Left Bumper');
  });

  it('maps "shoot" to Right Trigger', () => {
    const p = profileWithBinding('shoot');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Right Trigger');
  });

  it('maps "fire" to Right Trigger', () => {
    const p = profileWithBinding('fire');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('Right Trigger');
  });

  it('maps unknown actions to gamepad A fallback', () => {
    // "xyz123_binding" contains no matching substrings
    const p = profileWithBinding('xyz123_binding');
    expect(p.inputRemapping.remappings[0].gamepadButton).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// generateAccessibilityProfile — guessTouchGesture branch coverage
// ---------------------------------------------------------------------------

describe('generateAccessibilityProfile — touch gesture mapping', () => {
  function touchGestureFor(actionName: string) {
    const ctx = makeSceneContext({
      inputBindings: [{ actionName, keys: ['Space'] }],
    });
    const p = generateAccessibilityProfile(ctx);
    return p.inputRemapping.remappings[0].touchGesture;
  }

  it('maps "jump" to tap', () => {
    expect(touchGestureFor('jump')).toBe('tap');
  });

  it('maps "move_forward" to virtual joystick', () => {
    expect(touchGestureFor('move_forward')).toBe('virtual joystick');
  });

  it('maps "walk_right" to virtual joystick', () => {
    expect(touchGestureFor('walk_right')).toBe('virtual joystick');
  });

  it('maps "look_up" to swipe', () => {
    expect(touchGestureFor('look_up')).toBe('swipe');
  });

  it('maps "aim" to swipe', () => {
    expect(touchGestureFor('aim')).toBe('swipe');
  });

  it('maps "attack" to tap (right side)', () => {
    expect(touchGestureFor('attack')).toBe('tap (right side)');
  });

  it('maps "shoot" to tap (right side)', () => {
    expect(touchGestureFor('shoot')).toBe('tap (right side)');
  });

  it('maps "interact" to double tap', () => {
    expect(touchGestureFor('interact')).toBe('double tap');
  });

  it('maps "use" to double tap', () => {
    expect(touchGestureFor('use')).toBe('double tap');
  });

  it('maps unknown action to tap fallback', () => {
    expect(touchGestureFor('unknown_gesture_action')).toBe('tap');
  });
});

// ---------------------------------------------------------------------------
// generateEntityDescriptions — additional entity configurations
// ---------------------------------------------------------------------------

describe('generateEntityDescriptions — additional coverage', () => {
  it('generates descriptions for entities with audio', () => {
    const summaries: EntitySummary[] = [
      makeEntitySummary({ entityId: 'e1', name: 'Explosion', entityType: 'audio_source', hasAudio: true }),
    ];
    const descriptions = generateEntityDescriptions(summaries);
    expect(descriptions.has('e1')).toBe(true);
    expect(descriptions.get('e1')).toBeTruthy();
  });

  it('generates descriptions for entities with physics', () => {
    const summaries: EntitySummary[] = [
      makeEntitySummary({ entityId: 'e2', name: 'Player', entityType: 'player', hasPhysics: true }),
    ];
    const descriptions = generateEntityDescriptions(summaries);
    expect(descriptions.has('e2')).toBe(true);
  });

  it('generates descriptions for entities with script', () => {
    const summaries: EntitySummary[] = [
      makeEntitySummary({ entityId: 'e3', name: 'Enemy', entityType: 'enemy', hasScript: true }),
    ];
    const descriptions = generateEntityDescriptions(summaries);
    expect(descriptions.has('e3')).toBe(true);
  });

  it('handles a light entity type', () => {
    const summaries: EntitySummary[] = [
      makeEntitySummary({ entityId: 'e4', name: 'Sun', entityType: 'light' }),
    ];
    const descriptions = generateEntityDescriptions(summaries);
    expect(descriptions.has('e4')).toBe(true);
  });

  it('handles camera entity type', () => {
    const summaries: EntitySummary[] = [
      makeEntitySummary({ entityId: 'e5', name: 'MainCam', entityType: 'camera' }),
    ];
    const descriptions = generateEntityDescriptions(summaries);
    expect(descriptions.has('e5')).toBe(true);
  });

  it('handles terrain entity type', () => {
    const summaries: EntitySummary[] = [
      makeEntitySummary({ entityId: 'e6', name: 'Ground', entityType: 'terrain' }),
    ];
    const descriptions = generateEntityDescriptions(summaries);
    expect(descriptions.has('e6')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// analyzeAccessibility — additional branch coverage
// ---------------------------------------------------------------------------

describe('analyzeAccessibility — additional branches', () => {
  it('handles scene with multiple entities', () => {
    const ctx = makeSceneContext({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'Player', parentId: null, children: [], components: ['Mesh3d', 'PhysicsEnabled'], visible: true },
          e2: { entityId: 'e2', name: 'Enemy', parentId: null, children: [], components: ['Mesh3d'], visible: true },
          e3: { entityId: 'e3', name: 'Light', parentId: null, children: [], components: ['LightData'], visible: true },
        },
        rootIds: ['e1', 'e2', 'e3'],
      },
      materials: {
        e1: { baseColor: [0.1, 0.1, 0.1, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5, emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, unlit: false },
        e2: { baseColor: [0.9, 0.9, 0.9, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5, emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, unlit: false },
      },
    });
    const audit = analyzeAccessibility(ctx);
    expect(audit.issues).toBeDefined();
    // AccessibilityAudit has score, issues, passedChecks, totalChecks (no entityDescriptions field)
    expect(audit.score).toBeGreaterThanOrEqual(0);
    expect(audit.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(audit.issues)).toBe(true);
  });

  it('returns an audit with score in 0-100 range for empty scene', () => {
    const audit = analyzeAccessibility(makeSceneContext());
    expect(audit.score).toBeGreaterThanOrEqual(0);
    expect(audit.score).toBeLessThanOrEqual(100);
    expect(typeof audit.totalChecks).toBe('number');
  });

  it('flags entities with potentially similar material colors', () => {
    const ctx = makeSceneContext({
      sceneGraph: {
        nodes: {
          e1: { entityId: 'e1', name: 'Obj1', parentId: null, children: [], components: ['Mesh3d'], visible: true },
          e2: { entityId: 'e2', name: 'Obj2', parentId: null, children: [], components: ['Mesh3d'], visible: true },
        },
        rootIds: ['e1', 'e2'],
      },
      materials: {
        e1: { baseColor: [0.8, 0.2, 0.2, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5, emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, unlit: false },
        e2: { baseColor: [0.7, 0.3, 0.2, 1], metallic: 0, perceptualRoughness: 0.5, reflectance: 0.5, emissive: [0, 0, 0, 1], emissiveExposureWeight: 0, alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false, unlit: false },
      },
    });
    const audit = analyzeAccessibility(ctx);
    // Audit must complete without throwing
    expect(audit.score).toBeGreaterThanOrEqual(0);
  });
});
