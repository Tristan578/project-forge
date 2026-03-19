/**
 * Tests for the physics feel profiler module.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  PHYSICS_PRESETS,
  PRESET_KEYS,
  interpolateProfiles,
  analyzePhysicsFeel,
  applyPhysicsProfile,
  generateCustomProfile,
} from '../physicsFeel';
import type {
  PhysicsSceneContext,
  CommandDispatcher,
} from '../physicsFeel';

// ---------------------------------------------------------------------------
// Preset validation
// ---------------------------------------------------------------------------

describe('PHYSICS_PRESETS', () => {
  it('should have at least 8 presets', () => {
    expect(PRESET_KEYS.length).toBeGreaterThanOrEqual(8);
  });

  it('should have valid positive gravity for all presets', () => {
    for (const key of PRESET_KEYS) {
      const p = PHYSICS_PRESETS[key];
      expect(p.gravity).toBeGreaterThan(0);
    }
  });

  it('should have non-negative jumpForce for all presets', () => {
    for (const key of PRESET_KEYS) {
      const p = PHYSICS_PRESETS[key];
      expect(p.jumpForce).toBeGreaterThanOrEqual(0);
    }
  });

  it('should have positive moveSpeed for all presets', () => {
    for (const key of PRESET_KEYS) {
      const p = PHYSICS_PRESETS[key];
      expect(p.moveSpeed).toBeGreaterThan(0);
    }
  });

  it('should have friction in 0-1 range for all presets', () => {
    for (const key of PRESET_KEYS) {
      const p = PHYSICS_PRESETS[key];
      expect(p.friction).toBeGreaterThanOrEqual(0);
      expect(p.friction).toBeLessThanOrEqual(1);
    }
  });

  it('should have airControl in 0-1 range for all presets', () => {
    for (const key of PRESET_KEYS) {
      const p = PHYSICS_PRESETS[key];
      expect(p.airControl).toBeGreaterThanOrEqual(0);
      expect(p.airControl).toBeLessThanOrEqual(1);
    }
  });

  it('should have positive terminalVelocity for all presets', () => {
    for (const key of PRESET_KEYS) {
      const p = PHYSICS_PRESETS[key];
      expect(p.terminalVelocity).toBeGreaterThan(0);
    }
  });

  it('should have positive acceleration for all presets', () => {
    for (const key of PRESET_KEYS) {
      const p = PHYSICS_PRESETS[key];
      expect(p.acceleration).toBeGreaterThan(0);
    }
  });

  it('should have positive deceleration for all presets', () => {
    for (const key of PRESET_KEYS) {
      const p = PHYSICS_PRESETS[key];
      expect(p.deceleration).toBeGreaterThan(0);
    }
  });

  it('should have non-empty name and description for all presets', () => {
    for (const key of PRESET_KEYS) {
      const p = PHYSICS_PRESETS[key];
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it('should have unique names across presets', () => {
    const names = PRESET_KEYS.map((k) => PHYSICS_PRESETS[k].name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

describe('interpolateProfiles', () => {
  const a = PHYSICS_PRESETS.platformer_floaty;
  const b = PHYSICS_PRESETS.rpg_weighty;

  it('should return profile A when t=0', () => {
    const result = interpolateProfiles(a, b, 0);
    expect(result.gravity).toBe(a.gravity);
    expect(result.jumpForce).toBe(a.jumpForce);
    expect(result.moveSpeed).toBe(a.moveSpeed);
    expect(result.friction).toBe(a.friction);
    expect(result.airControl).toBe(a.airControl);
    expect(result.description).toBe(a.description);
  });

  it('should return profile B when t=1', () => {
    const result = interpolateProfiles(a, b, 1);
    expect(result.gravity).toBeCloseTo(b.gravity);
    expect(result.jumpForce).toBeCloseTo(b.jumpForce);
    expect(result.moveSpeed).toBeCloseTo(b.moveSpeed);
    expect(result.friction).toBeCloseTo(b.friction);
    expect(result.airControl).toBeCloseTo(b.airControl);
    expect(result.description).toBe(b.description);
  });

  it('should return midpoint when t=0.5', () => {
    const result = interpolateProfiles(a, b, 0.5);
    expect(result.gravity).toBeCloseTo((a.gravity + b.gravity) / 2);
    expect(result.jumpForce).toBeCloseTo((a.jumpForce + b.jumpForce) / 2);
    expect(result.moveSpeed).toBeCloseTo((a.moveSpeed + b.moveSpeed) / 2);
    expect(result.friction).toBeCloseTo((a.friction + b.friction) / 2);
    expect(result.airControl).toBeCloseTo((a.airControl + b.airControl) / 2);
  });

  it('should clamp t to 0-1 range', () => {
    const below = interpolateProfiles(a, b, -5);
    expect(below.gravity).toBe(a.gravity);

    const above = interpolateProfiles(a, b, 10);
    expect(above.gravity).toBe(b.gravity);
  });

  it('should use name of A when t < 0.5', () => {
    const result = interpolateProfiles(a, b, 0.3);
    expect(result.name).toBe(a.name);
  });

  it('should use name of B when t >= 0.5', () => {
    const result = interpolateProfiles(a, b, 0.7);
    expect(result.name).toBe(b.name);
  });

  it('should produce blend description when t is between 0 and 1 exclusive', () => {
    const result = interpolateProfiles(a, b, 0.5);
    expect(result.description).toContain('Blend');
  });

  it('should interpolate between same profile and return same values', () => {
    const result = interpolateProfiles(a, a, 0.5);
    expect(result.gravity).toBe(a.gravity);
    expect(result.friction).toBe(a.friction);
  });
});

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

describe('analyzePhysicsFeel', () => {
  it('should classify a floaty scene correctly', () => {
    const ctx: PhysicsSceneContext = {
      entities: [
        {
          entityId: 'e1',
          physics: { gravityScale: 0.5, friction: 0.3 },
          gameComponents: [
            {
              type: 'characterController',
              characterController: { speed: 6, jumpHeight: 8, gravityScale: 0.5 },
            },
          ],
        },
      ],
    };
    const analysis = analyzePhysicsFeel(ctx);
    expect(analysis.closestPreset).toBe('platformer_floaty');
    expect(analysis.similarity).toBeGreaterThan(0);
    expect(analysis.similarity).toBeLessThanOrEqual(1);
    expect(analysis.currentFeel).toBe('Floaty Platformer');
  });

  it('should classify high-gravity scene as weighty', () => {
    const ctx: PhysicsSceneContext = {
      entities: [
        {
          entityId: 'e1',
          physics: { gravityScale: 2.0, friction: 0.6 },
          gameComponents: [
            {
              type: 'characterController',
              characterController: { speed: 4, jumpHeight: 12, gravityScale: 2.0 },
            },
          ],
        },
      ],
    };
    const analysis = analyzePhysicsFeel(ctx);
    expect(analysis.closestPreset).toBe('rpg_weighty');
  });

  it('should handle empty scene with suggestions', () => {
    const ctx: PhysicsSceneContext = { entities: [] };
    const analysis = analyzePhysicsFeel(ctx);
    expect(analysis.suggestions.length).toBeGreaterThan(0);
    expect(analysis.suggestions[0]).toContain('No physics entities');
  });

  it('should handle entities without physics components', () => {
    const ctx: PhysicsSceneContext = {
      entities: [{ entityId: 'e1' }],
    };
    const analysis = analyzePhysicsFeel(ctx);
    expect(analysis.suggestions.some((s) => s.includes('No physics entities'))).toBe(true);
  });

  it('should return similarity between 0 and 1', () => {
    const ctx: PhysicsSceneContext = {
      entities: [
        {
          entityId: 'e1',
          physics: { gravityScale: 1.0, friction: 0.4 },
        },
      ],
    };
    const analysis = analyzePhysicsFeel(ctx);
    expect(analysis.similarity).toBeGreaterThanOrEqual(0);
    expect(analysis.similarity).toBeLessThanOrEqual(1);
  });

  it('should suggest reducing gravity when gravity is very high', () => {
    const ctx: PhysicsSceneContext = {
      entities: [
        {
          entityId: 'e1',
          physics: { gravityScale: 2.5, friction: 0.4 },
          gameComponents: [
            {
              type: 'characterController',
              characterController: { speed: 7, jumpHeight: 10, gravityScale: 2.5 },
            },
          ],
        },
      ],
    };
    const analysis = analyzePhysicsFeel(ctx);
    expect(analysis.suggestions.some((s) => s.includes('Gravity is very high'))).toBe(true);
  });

  it('should suggest increasing friction when very low', () => {
    const ctx: PhysicsSceneContext = {
      entities: [
        {
          entityId: 'e1',
          physics: { gravityScale: 1.0, friction: 0.05 },
        },
      ],
    };
    const analysis = analyzePhysicsFeel(ctx);
    expect(analysis.suggestions.some((s) => s.includes('Very low friction'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

describe('applyPhysicsProfile', () => {
  it('should dispatch update_physics for each entity', () => {
    const dispatch = vi.fn() as CommandDispatcher;
    const profile = PHYSICS_PRESETS.platformer_floaty;
    const ids = ['e1', 'e2'];

    applyPhysicsProfile(profile, dispatch, ids);

    // 2 entities x 2 commands each = 4 calls
    expect(dispatch).toHaveBeenCalledTimes(4);
  });

  it('should dispatch correct gravity scale', () => {
    const dispatch = vi.fn() as CommandDispatcher;
    const profile = PHYSICS_PRESETS.platformer_floaty;

    applyPhysicsProfile(profile, dispatch, ['e1']);

    expect(dispatch).toHaveBeenCalledWith('update_physics', expect.objectContaining({
      entityId: 'e1',
      gravityScale: profile.gravity / 10,
      friction: profile.friction,
    }));
  });

  it('should dispatch character controller update', () => {
    const dispatch = vi.fn() as CommandDispatcher;
    const profile = PHYSICS_PRESETS.rpg_weighty;

    applyPhysicsProfile(profile, dispatch, ['e1']);

    expect(dispatch).toHaveBeenCalledWith('update_game_component', expect.objectContaining({
      entityId: 'e1',
      componentType: 'character_controller',
      speed: profile.moveSpeed,
      jumpHeight: profile.jumpForce,
    }));
  });

  it('should handle empty entity list', () => {
    const dispatch = vi.fn() as CommandDispatcher;
    applyPhysicsProfile(PHYSICS_PRESETS.arcade_classic, dispatch, []);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Custom profile generation
// ---------------------------------------------------------------------------

describe('generateCustomProfile', () => {
  it('should return a valid profile', () => {
    const result = generateCustomProfile('A fast and floaty space game');
    expect(result.name).toBe('Custom');
    expect(result.gravity).toBeGreaterThan(0);
    expect(result.moveSpeed).toBeGreaterThan(0);
  });

  it('should apply floaty modifiers for "floaty" description', () => {
    const result = generateCustomProfile('A floaty platformer');
    expect(result.gravity).toBeLessThan(6);
    expect(result.airControl).toBeGreaterThan(0.8);
  });

  it('should apply heavy modifiers for "weighty" description', () => {
    const result = generateCustomProfile('A weighty action game');
    expect(result.gravity).toBeGreaterThan(15);
    expect(result.acceleration).toBeLessThan(10);
  });

  it('should apply fast modifiers for "fast" description', () => {
    const result = generateCustomProfile('A fast paced runner');
    expect(result.moveSpeed).toBeGreaterThan(20);
  });

  it('should apply ice modifiers for "slippery" description', () => {
    const result = generateCustomProfile('An ice world with slippery surfaces');
    expect(result.friction).toBeLessThan(0.1);
    expect(result.deceleration).toBeLessThan(5);
  });

  it('should apply underwater modifiers', () => {
    const result = generateCustomProfile('Swimming underwater');
    expect(result.gravity).toBeLessThan(5);
    expect(result.friction).toBeGreaterThan(0.7);
  });

  it('should apply space modifiers for "zero gravity"', () => {
    const result = generateCustomProfile('A zero gravity space station');
    expect(result.gravity).toBeLessThan(1);
    expect(result.airControl).toBe(1.0);
  });

  it('should store description in the returned profile', () => {
    const desc = 'My custom game feel';
    const result = generateCustomProfile(desc);
    expect(result.description).toBe(desc);
  });

  it('should handle empty description gracefully', () => {
    const result = generateCustomProfile('');
    expect(result.name).toBe('Custom');
    expect(result.gravity).toBeGreaterThan(0);
  });

  it('should apply bouncy modifiers', () => {
    const result = generateCustomProfile('A bouncy trampoline game');
    expect(result.jumpForce).toBeGreaterThan(15);
  });

  it('should apply racing modifiers for vehicle description', () => {
    const result = generateCustomProfile('A vehicle racing game');
    expect(result.jumpForce).toBe(0);
    expect(result.moveSpeed).toBeGreaterThan(25);
  });

  it('should apply sticky/precise modifiers', () => {
    const result = generateCustomProfile('A precise grid-based puzzle');
    expect(result.friction).toBeGreaterThan(0.8);
  });
});
