import { describe, it, expect } from 'vitest';
import {
  postProcess,
  inferSfxCategory,
  getSpatialDefaults,
  sanitizeAssetName,
  isPow2,
  nextPow2,
  validateTextureDimensions,
} from './postProcess';

describe('postProcess pipeline', () => {
  describe('postProcess dispatcher', () => {
    it('processes model type', () => {
      const result = postProcess('model', 'A medieval sword');
      expect(result.ok).toBe(true);
      expect(result.metadata).toHaveProperty('assetName');
      expect(result.metadata).toHaveProperty('orientation', 'y-up');
      expect(result.metadata).toHaveProperty('scaleUnit', 'meter');
    });

    it('processes texture type', () => {
      const result = postProcess('texture', 'Stone wall texture');
      expect(result.ok).toBe(true);
      expect(result.metadata).toHaveProperty('pipelineVersion', 1);
    });

    it('processes sfx type with category inference', () => {
      const result = postProcess('sfx', 'Explosion sound effect');
      expect(result.ok).toBe(true);
      expect(result.metadata.sfxCategory).toBe('explosion');
      expect(result.metadata.spatialDefaults).toBeDefined();
    });

    it('processes music type', () => {
      const result = postProcess('music', 'Epic battle theme');
      expect(result.ok).toBe(true);
      expect(result.metadata.shouldLoop).toBe(true);
      expect(result.metadata.targetVolume).toBe(0.6);
    });

    it('processes skybox type', () => {
      const result = postProcess('skybox', 'Sunset sky');
      expect(result.ok).toBe(true);
      expect(result.metadata).toHaveProperty('format', 'equirectangular');
    });

    it('processes sprite types', () => {
      const result = postProcess('sprite', 'Character sprite');
      expect(result.ok).toBe(true);
      expect(result.metadata).toHaveProperty('spriteType', 'sprite');
    });

    it('processes voice type as sfx', () => {
      const result = postProcess('voice', 'Villain dialogue');
      expect(result.ok).toBe(true);
      expect(result.metadata).toHaveProperty('sfxCategory');
    });

    it('accepts config overrides for sfx', () => {
      const result = postProcess('sfx', 'Custom sound', {
        sfxCategory: 'ambient',
        shouldLoop: true,
      });
      expect(result.metadata.sfxCategory).toBe('ambient');
    });

    it('accepts config overrides for music', () => {
      const result = postProcess('music', 'Calm theme', {
        shouldLoop: false,
        targetVolume: 0.3,
      });
      expect(result.metadata.shouldLoop).toBe(false);
      expect(result.metadata.targetVolume).toBe(0.3);
    });
  });

  describe('inferSfxCategory', () => {
    it('detects UI sounds', () => {
      expect(inferSfxCategory('button click')).toBe('ui');
      expect(inferSfxCategory('menu hover')).toBe('ui');
      expect(inferSfxCategory('notification beep')).toBe('ui');
    });

    it('detects footsteps', () => {
      expect(inferSfxCategory('walking footstep on gravel')).toBe('footstep');
      expect(inferSfxCategory('running stomp')).toBe('footstep');
    });

    it('detects impacts', () => {
      expect(inferSfxCategory('sword slash')).toBe('impact');
      expect(inferSfxCategory('punch hit')).toBe('impact');
      expect(inferSfxCategory('glass shatter')).toBe('impact');
    });

    it('detects explosions', () => {
      expect(inferSfxCategory('grenade explosion')).toBe('explosion');
      expect(inferSfxCategory('bomb blast')).toBe('explosion');
      expect(inferSfxCategory('big boom')).toBe('explosion');
    });

    it('detects ambient sounds', () => {
      expect(inferSfxCategory('forest ambient')).toBe('ambient');
      expect(inferSfxCategory('rain and wind')).toBe('ambient');
      expect(inferSfxCategory('ocean waves')).toBe('ambient');
    });

    it('detects collectibles', () => {
      expect(inferSfxCategory('coin pickup')).toBe('collectible');
      expect(inferSfxCategory('power-up collect')).toBe('collectible');
    });

    it('detects projectiles', () => {
      expect(inferSfxCategory('laser shoot')).toBe('projectile');
      expect(inferSfxCategory('arrow fire')).toBe('projectile');
    });

    it('detects voice', () => {
      expect(inferSfxCategory('character grunt')).toBe('voice');
      expect(inferSfxCategory('dialogue voice')).toBe('voice');
    });

    it('defaults to impact for unknown', () => {
      expect(inferSfxCategory('mysterious whoosh')).toBe('impact');
    });
  });

  describe('getSpatialDefaults', () => {
    it('UI sounds are non-spatial', () => {
      const defaults = getSpatialDefaults('ui');
      expect(defaults.spatial).toBe(false);
      expect(defaults.loopAudio).toBe(false);
    });

    it('explosions have large range', () => {
      const defaults = getSpatialDefaults('explosion');
      expect(defaults.spatial).toBe(true);
      expect(defaults.maxDistance).toBeGreaterThanOrEqual(50);
      expect(defaults.refDistance).toBeGreaterThanOrEqual(3);
    });

    it('ambient sounds loop', () => {
      const defaults = getSpatialDefaults('ambient');
      expect(defaults.spatial).toBe(true);
      expect(defaults.loopAudio).toBe(true);
    });

    it('music is non-spatial and loops', () => {
      const defaults = getSpatialDefaults('music');
      expect(defaults.spatial).toBe(false);
      expect(defaults.loopAudio).toBe(true);
    });

    it('footsteps have short range', () => {
      const defaults = getSpatialDefaults('footstep');
      expect(defaults.spatial).toBe(true);
      expect(defaults.maxDistance).toBeLessThanOrEqual(20);
    });

    it('collectibles have very short range', () => {
      const defaults = getSpatialDefaults('collectible');
      expect(defaults.spatial).toBe(true);
      expect(defaults.maxDistance).toBeLessThanOrEqual(15);
    });

    it('all categories have valid volume range', () => {
      const categories = ['ui', 'footstep', 'impact', 'explosion', 'ambient', 'collectible', 'projectile', 'voice', 'music'] as const;
      for (const cat of categories) {
        const defaults = getSpatialDefaults(cat);
        expect(defaults.volume).toBeGreaterThan(0);
        expect(defaults.volume).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('validateTextureDimensions', () => {
    it('validates power-of-two dimensions', () => {
      const result = validateTextureDimensions(1024, 1024, 'base_color');
      expect(result.isPowerOfTwo).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('warns for non-power-of-two dimensions', () => {
      const result = validateTextureDimensions(1000, 1000, 'base_color');
      expect(result.isPowerOfTwo).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('not power-of-2');
    });

    it('warns for oversized textures', () => {
      const result = validateTextureDimensions(8192, 8192, 'normal');
      expect(result.warnings.some((w) => w.includes('very large'))).toBe(true);
    });

    it('returns correct metadata', () => {
      const result = validateTextureDimensions(512, 256, 'metallic_roughness');
      expect(result.width).toBe(512);
      expect(result.height).toBe(256);
      expect(result.slot).toBe('metallic_roughness');
      expect(result.channels).toBe(4);
    });
  });

  describe('sanitizeAssetName', () => {
    it('creates valid name from prompt', () => {
      expect(sanitizeAssetName('A medieval sword', 'Model')).toBe('Model_A_medieval_sword');
    });

    it('strips special characters', () => {
      expect(sanitizeAssetName('Cool! @#$% thing', 'SFX')).toBe('SFX_Cool_thing');
    });

    it('truncates long prompts', () => {
      const longPrompt = 'A'.repeat(100);
      const name = sanitizeAssetName(longPrompt, 'Tex');
      expect(name.length).toBeLessThan(40);
    });

    it('uses default for empty prompt', () => {
      expect(sanitizeAssetName('', 'Model')).toBe('Model_Generated');
      expect(sanitizeAssetName('!@#$', 'Model')).toBe('Model_Generated');
    });
  });

  describe('isPow2', () => {
    it('identifies powers of 2', () => {
      expect(isPow2(1)).toBe(true);
      expect(isPow2(2)).toBe(true);
      expect(isPow2(256)).toBe(true);
      expect(isPow2(1024)).toBe(true);
      expect(isPow2(4096)).toBe(true);
    });

    it('rejects non-powers of 2', () => {
      expect(isPow2(0)).toBe(false);
      expect(isPow2(3)).toBe(false);
      expect(isPow2(100)).toBe(false);
      expect(isPow2(1000)).toBe(false);
    });
  });

  describe('nextPow2', () => {
    it('finds next power of 2', () => {
      expect(nextPow2(1)).toBe(1);
      expect(nextPow2(3)).toBe(4);
      expect(nextPow2(100)).toBe(128);
      expect(nextPow2(1000)).toBe(1024);
      expect(nextPow2(1025)).toBe(2048);
    });

    it('returns same if already power of 2', () => {
      expect(nextPow2(256)).toBe(256);
      expect(nextPow2(1024)).toBe(1024);
    });

    it('handles edge cases', () => {
      expect(nextPow2(0)).toBe(1);
      expect(nextPow2(-5)).toBe(1);
    });
  });
});
