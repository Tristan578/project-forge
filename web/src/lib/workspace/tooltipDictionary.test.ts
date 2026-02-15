import { describe, it, expect } from 'vitest';
import { TOOLTIP_DICTIONARY } from './tooltipDictionary';

describe('tooltipDictionary', () => {
  it('exports a non-empty dictionary', () => {
    expect(TOOLTIP_DICTIONARY).toBeDefined();
    expect(Object.keys(TOOLTIP_DICTIONARY).length).toBeGreaterThan(0);
  });

  describe('Transform properties', () => {
    it('has tooltip for position', () => {
      expect(TOOLTIP_DICTIONARY.position).toBeDefined();
      expect(TOOLTIP_DICTIONARY.position).toContain('3D world');
    });

    it('has tooltip for rotation', () => {
      expect(TOOLTIP_DICTIONARY.rotation).toBeDefined();
      expect(TOOLTIP_DICTIONARY.rotation).toContain('degrees');
    });

    it('has tooltip for scale', () => {
      expect(TOOLTIP_DICTIONARY.scale).toBeDefined();
      expect(TOOLTIP_DICTIONARY.scale).toContain('1 = normal size');
    });

    it('has tooltip for name', () => {
      expect(TOOLTIP_DICTIONARY.name).toBeDefined();
      expect(TOOLTIP_DICTIONARY.name).toContain('identify');
    });
  });

  describe('Post-processing properties', () => {
    it('has tooltip for bloom', () => {
      expect(TOOLTIP_DICTIONARY.bloom).toBeDefined();
      expect(TOOLTIP_DICTIONARY.bloom).toContain('bright areas glow');
    });

    it('has tooltip for fog', () => {
      expect(TOOLTIP_DICTIONARY.fog).toBeDefined();
      expect(TOOLTIP_DICTIONARY.fog).toContain('fades distant objects');
    });

    it('has tooltip for MSAA', () => {
      expect(TOOLTIP_DICTIONARY.msaa).toBeDefined();
      expect(TOOLTIP_DICTIONARY.msaa).toContain('jagged edges');
    });

    it('has tooltip for SSAO', () => {
      expect(TOOLTIP_DICTIONARY.ssao).toBeDefined();
      expect(TOOLTIP_DICTIONARY.ssao).toContain('shadows');
    });

    it('has tooltip for chromatic aberration', () => {
      expect(TOOLTIP_DICTIONARY.chromaticAberration).toBeDefined();
      expect(TOOLTIP_DICTIONARY.chromaticAberration).toContain('camera lens');
    });

    it('has tooltip for depth of field', () => {
      expect(TOOLTIP_DICTIONARY.depthOfField).toBeDefined();
      expect(TOOLTIP_DICTIONARY.depthOfField.toLowerCase()).toContain('blur');
    });

    it('has tooltip for motion blur', () => {
      expect(TOOLTIP_DICTIONARY.motionBlur).toBeDefined();
      expect(TOOLTIP_DICTIONARY.motionBlur).toContain('fast-moving');
    });
  });

  describe('Material properties', () => {
    it('has tooltip for metallic', () => {
      expect(TOOLTIP_DICTIONARY.metallic).toBeDefined();
      expect(TOOLTIP_DICTIONARY.metallic).toContain('metal');
    });

    it('has tooltip for roughness', () => {
      expect(TOOLTIP_DICTIONARY.roughness).toBeDefined();
      expect(TOOLTIP_DICTIONARY.roughness).toContain('mirror');
    });

    it('has tooltip for emissive', () => {
      expect(TOOLTIP_DICTIONARY.emissive).toBeDefined();
      expect(TOOLTIP_DICTIONARY.emissive).toContain('glow');
    });

    it('has tooltip for clearcoat', () => {
      expect(TOOLTIP_DICTIONARY.clearcoat).toBeDefined();
      expect(TOOLTIP_DICTIONARY.clearcoat).toContain('glossy layer');
    });

    it('has tooltip for opacity', () => {
      expect(TOOLTIP_DICTIONARY.opacity).toBeDefined();
      expect(TOOLTIP_DICTIONARY.opacity).toContain('see-through');
    });

    it('has tooltip for unlit', () => {
      expect(TOOLTIP_DICTIONARY.unlit).toBeDefined();
      expect(TOOLTIP_DICTIONARY.unlit).toContain('lighting');
    });
  });

  describe('Physics properties', () => {
    it('has tooltip for restitution', () => {
      expect(TOOLTIP_DICTIONARY.restitution).toBeDefined();
      expect(TOOLTIP_DICTIONARY.restitution).toContain('bounce');
    });

    it('has tooltip for friction', () => {
      expect(TOOLTIP_DICTIONARY.friction).toBeDefined();
      expect(TOOLTIP_DICTIONARY.friction).toContain('sliding');
    });

    it('has tooltip for density', () => {
      expect(TOOLTIP_DICTIONARY.density).toBeDefined();
      expect(TOOLTIP_DICTIONARY.density.toLowerCase()).toContain('weight');
    });

    it('has tooltip for gravityScale', () => {
      expect(TOOLTIP_DICTIONARY.gravityScale).toBeDefined();
      expect(TOOLTIP_DICTIONARY.gravityScale).toContain('gravity');
    });

    it('has tooltip for sensor', () => {
      expect(TOOLTIP_DICTIONARY.sensor).toBeDefined();
      expect(TOOLTIP_DICTIONARY.sensor).toContain('trigger');
    });
  });

  describe('Lighting properties', () => {
    it('has tooltip for intensity', () => {
      expect(TOOLTIP_DICTIONARY.intensity).toBeDefined();
      expect(TOOLTIP_DICTIONARY.intensity).toContain('bright');
    });

    it('has tooltip for range', () => {
      expect(TOOLTIP_DICTIONARY.range).toBeDefined();
      expect(TOOLTIP_DICTIONARY.range).toContain('far');
    });

    it('has tooltip for shadowDepthBias', () => {
      expect(TOOLTIP_DICTIONARY.shadowDepthBias).toBeDefined();
      expect(TOOLTIP_DICTIONARY.shadowDepthBias).toContain('flickering');
    });
  });

  describe('Audio properties', () => {
    it('has tooltip for audioVolume', () => {
      expect(TOOLTIP_DICTIONARY.audioVolume).toBeDefined();
      expect(TOOLTIP_DICTIONARY.audioVolume).toContain('loud');
    });

    it('has tooltip for audioPitch', () => {
      expect(TOOLTIP_DICTIONARY.audioPitch).toBeDefined();
      expect(TOOLTIP_DICTIONARY.audioPitch).toContain('speed');
    });

    it('has tooltip for audioSpatial', () => {
      expect(TOOLTIP_DICTIONARY.audioSpatial).toBeDefined();
      expect(TOOLTIP_DICTIONARY.audioSpatial).toContain('3D space');
    });

    it('has tooltip for audioLoop', () => {
      expect(TOOLTIP_DICTIONARY.audioLoop).toBeDefined();
      expect(TOOLTIP_DICTIONARY.audioLoop).toContain('repeat');
    });
  });

  describe('Particle properties', () => {
    it('has tooltip for particleLifetime', () => {
      expect(TOOLTIP_DICTIONARY.particleLifetime).toBeDefined();
      expect(TOOLTIP_DICTIONARY.particleLifetime).toContain('disappearing');
    });

    it('has tooltip for spawnRate', () => {
      expect(TOOLTIP_DICTIONARY.spawnRate).toBeDefined();
      expect(TOOLTIP_DICTIONARY.spawnRate).toContain('per second');
    });

    it('has tooltip for blendMode', () => {
      expect(TOOLTIP_DICTIONARY.blendMode).toBeDefined();
      expect(TOOLTIP_DICTIONARY.blendMode).toContain('Additive');
    });

    it('has tooltip for worldSpace', () => {
      expect(TOOLTIP_DICTIONARY.worldSpace).toBeDefined();
      expect(TOOLTIP_DICTIONARY.worldSpace).toContain('emitter');
    });
  });

  describe('Game component properties', () => {
    it('has tooltip for characterController', () => {
      expect(TOOLTIP_DICTIONARY.characterController).toBeDefined();
      expect(TOOLTIP_DICTIONARY.characterController).toContain('movement');
    });

    it('has tooltip for health', () => {
      expect(TOOLTIP_DICTIONARY.health).toBeDefined();
      expect(TOOLTIP_DICTIONARY.health).toContain('hit points');
    });

    it('has tooltip for collectible', () => {
      expect(TOOLTIP_DICTIONARY.collectible).toBeDefined();
      expect(TOOLTIP_DICTIONARY.collectible).toContain('pickup');
    });

    it('has tooltip for damageZone', () => {
      expect(TOOLTIP_DICTIONARY.damageZone).toBeDefined();
      expect(TOOLTIP_DICTIONARY.damageZone).toContain('damage');
    });

    it('has tooltip for teleporter', () => {
      expect(TOOLTIP_DICTIONARY.teleporter).toBeDefined();
      expect(TOOLTIP_DICTIONARY.teleporter).toContain('location');
    });
  });

  describe('Terrain properties', () => {
    it('has tooltip for terrainResolution', () => {
      expect(TOOLTIP_DICTIONARY.terrainResolution).toBeDefined();
      expect(TOOLTIP_DICTIONARY.terrainResolution).toContain('grid');
    });

    it('has tooltip for terrainOctaves', () => {
      expect(TOOLTIP_DICTIONARY.terrainOctaves).toBeDefined();
      expect(TOOLTIP_DICTIONARY.terrainOctaves).toContain('detail');
    });

    it('has tooltip for terrainSeed', () => {
      expect(TOOLTIP_DICTIONARY.terrainSeed).toBeDefined();
      expect(TOOLTIP_DICTIONARY.terrainSeed).toContain('random');
    });
  });

  describe('Animation properties', () => {
    it('has tooltip for animationClip', () => {
      expect(TOOLTIP_DICTIONARY.animationClip).toBeDefined();
      expect(TOOLTIP_DICTIONARY.animationClip).toContain('animation');
    });

    it('has tooltip for animationSpeed', () => {
      expect(TOOLTIP_DICTIONARY.animationSpeed).toBeDefined();
      expect(TOOLTIP_DICTIONARY.animationSpeed).toContain('speed');
    });

    it('has tooltip for clipDuration', () => {
      expect(TOOLTIP_DICTIONARY.clipDuration).toBeDefined();
      expect(TOOLTIP_DICTIONARY.clipDuration).toContain('seconds');
    });
  });

  describe('Tooltip quality', () => {
    it('all tooltips are strings', () => {
      Object.values(TOOLTIP_DICTIONARY).forEach((tooltip) => {
        expect(typeof tooltip).toBe('string');
      });
    });

    it('all tooltips are non-empty', () => {
      Object.values(TOOLTIP_DICTIONARY).forEach((tooltip) => {
        expect(tooltip.length).toBeGreaterThan(0);
      });
    });

    it('all tooltips are reasonably long (20+ chars)', () => {
      Object.values(TOOLTIP_DICTIONARY).forEach((tooltip) => {
        expect(tooltip.length).toBeGreaterThan(20);
      });
    });

    it('tooltips avoid excessive jargon (no "shader", "vertex", "fragment" in basic props)', () => {
      const basicProps = ['position', 'rotation', 'scale', 'name', 'visible'];
      basicProps.forEach((key) => {
        const tooltip = TOOLTIP_DICTIONARY[key];
        if (tooltip) {
          expect(tooltip.toLowerCase()).not.toContain('shader');
          expect(tooltip.toLowerCase()).not.toContain('vertex');
        }
      });
    });

    it('numeric properties mention units or ranges', () => {
      const numericProps = [
        'metallic',
        'roughness',
        'opacity',
        'restitution',
        'friction',
        'gravityScale',
      ];

      numericProps.forEach((key) => {
        const tooltip = TOOLTIP_DICTIONARY[key];
        if (tooltip) {
          expect(tooltip).toMatch(/[0-9]|range|scale|level|value/i);
        }
      });
    });
  });

  describe('Coverage', () => {
    it('has tooltips for common inspector fields', () => {
      const commonFields = [
        'position',
        'rotation',
        'scale',
        'name',
        'visible',
        'metallic',
        'roughness',
        'restitution',
        'friction',
        'intensity',
        'audioVolume',
        'particleLifetime',
      ];

      commonFields.forEach((field) => {
        expect(TOOLTIP_DICTIONARY[field]).toBeDefined();
      });
    });

    it('has at least 100 tooltip entries', () => {
      expect(Object.keys(TOOLTIP_DICTIONARY).length).toBeGreaterThanOrEqual(100);
    });
  });
});
