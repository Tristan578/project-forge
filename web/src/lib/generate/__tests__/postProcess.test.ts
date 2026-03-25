import { describe, it, expect } from 'vitest';
import {
  postProcess,
  sanitizeAssetName,
  isPow2,
  nextPow2,
  inferSfxCategory,
  getSpatialDefaults,
  validateTextureDimensions,
} from '../postProcess';

describe('sanitizeAssetName', () => {
  it('should prefix the name', () => {
    expect(sanitizeAssetName('cube', 'Model')).toBe('Model_cube');
  });

  it('should truncate to 30 characters before cleaning', () => {
    const longPrompt = 'a'.repeat(50);
    const result = sanitizeAssetName(longPrompt, 'Model');
    // 30 chars of 'a' + prefix
    expect(result).toBe('Model_' + 'a'.repeat(30));
  });

  it('should replace non-alphanumeric characters', () => {
    expect(sanitizeAssetName('my cool model!@#', 'Model')).toBe('Model_my_cool_model');
  });

  it('should collapse multiple spaces into single underscore', () => {
    expect(sanitizeAssetName('a   b   c', 'Sprite')).toBe('Sprite_a_b_c');
  });

  it('should use "Generated" for empty input', () => {
    expect(sanitizeAssetName('', 'Model')).toBe('Model_Generated');
  });

  it('should use "Generated" when all characters are special', () => {
    expect(sanitizeAssetName('!!!@@@', 'Texture')).toBe('Texture_Generated');
  });
});

describe('isPow2', () => {
  it('should return true for powers of 2', () => {
    expect(isPow2(1)).toBe(true);
    expect(isPow2(2)).toBe(true);
    expect(isPow2(4)).toBe(true);
    expect(isPow2(256)).toBe(true);
    expect(isPow2(1024)).toBe(true);
    expect(isPow2(4096)).toBe(true);
  });

  it('should return false for non-powers of 2', () => {
    expect(isPow2(0)).toBe(false);
    expect(isPow2(3)).toBe(false);
    expect(isPow2(5)).toBe(false);
    expect(isPow2(100)).toBe(false);
    expect(isPow2(255)).toBe(false);
  });

  it('should return false for negative numbers', () => {
    expect(isPow2(-1)).toBe(false);
    expect(isPow2(-4)).toBe(false);
  });
});

describe('nextPow2', () => {
  it('should return the next power of 2', () => {
    expect(nextPow2(3)).toBe(4);
    expect(nextPow2(5)).toBe(8);
    expect(nextPow2(100)).toBe(128);
    expect(nextPow2(1000)).toBe(1024);
  });

  it('should return the same value if already a power of 2', () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(256)).toBe(256);
    expect(nextPow2(4096)).toBe(4096);
  });

  it('should return 1 for 0 or negative', () => {
    expect(nextPow2(0)).toBe(1);
    expect(nextPow2(-5)).toBe(1);
  });
});

describe('inferSfxCategory', () => {
  it('should detect UI sounds', () => {
    expect(inferSfxCategory('button click sound')).toBe('ui');
    expect(inferSfxCategory('menu hover effect')).toBe('ui');
    expect(inferSfxCategory('notification chime')).toBe('ui');
  });

  it('should detect footsteps', () => {
    expect(inferSfxCategory('footstep on gravel')).toBe('footstep');
    expect(inferSfxCategory('character walk sound')).toBe('footstep');
    expect(inferSfxCategory('run on concrete')).toBe('footstep');
  });

  it('should detect impacts', () => {
    expect(inferSfxCategory('sword slash impact')).toBe('impact');
    expect(inferSfxCategory('glass shatter sound')).toBe('impact');
  });

  it('should detect explosions', () => {
    expect(inferSfxCategory('big explosion')).toBe('explosion');
    expect(inferSfxCategory('grenade blast')).toBe('explosion');
    expect(inferSfxCategory('rocket launch boom')).toBe('explosion');
  });

  it('should detect ambient', () => {
    expect(inferSfxCategory('forest ambient sounds')).toBe('ambient');
    expect(inferSfxCategory('ocean waves')).toBe('ambient');
    expect(inferSfxCategory('rain on roof')).toBe('ambient');
  });

  it('should detect collectibles', () => {
    expect(inferSfxCategory('coin pickup')).toBe('collectible');
    expect(inferSfxCategory('gem collect sound')).toBe('collectible');
    expect(inferSfxCategory('power-up effect')).toBe('collectible');
  });

  it('should detect projectiles', () => {
    expect(inferSfxCategory('laser beam')).toBe('projectile');
    expect(inferSfxCategory('bullet fire')).toBe('projectile');
    expect(inferSfxCategory('arrow shoot')).toBe('projectile');
  });

  it('should detect voice', () => {
    expect(inferSfxCategory('character grunt')).toBe('voice');
    expect(inferSfxCategory('NPC dialogue')).toBe('voice');
  });

  it('should detect music', () => {
    expect(inferSfxCategory('battle music')).toBe('music');
    expect(inferSfxCategory('melody loop')).toBe('music');
  });

  it('should default to impact for unknown', () => {
    expect(inferSfxCategory('something completely random xyz')).toBe('impact');
  });
});

describe('getSpatialDefaults', () => {
  it('should return non-spatial for UI', () => {
    const defaults = getSpatialDefaults('ui');
    expect(defaults.spatial).toBe(false);
    expect(defaults.loopAudio).toBe(false);
  });

  it('should return spatial with loop for ambient', () => {
    const defaults = getSpatialDefaults('ambient');
    expect(defaults.spatial).toBe(true);
    expect(defaults.loopAudio).toBe(true);
  });

  it('should return non-spatial with loop for music', () => {
    const defaults = getSpatialDefaults('music');
    expect(defaults.spatial).toBe(false);
    expect(defaults.loopAudio).toBe(true);
  });

  it('should have maximum volume for explosions', () => {
    const defaults = getSpatialDefaults('explosion');
    expect(defaults.volume).toBe(1.0);
    expect(defaults.maxDistance).toBe(80);
  });

  it('should have short range for collectibles', () => {
    const defaults = getSpatialDefaults('collectible');
    expect(defaults.maxDistance).toBe(10);
    expect(defaults.rolloffFactor).toBe(2.0);
  });

  it('should return valid defaults for all categories', () => {
    const categories = ['ui', 'footstep', 'impact', 'explosion', 'ambient', 'collectible', 'projectile', 'voice', 'music'] as const;
    for (const cat of categories) {
      const defaults = getSpatialDefaults(cat);
      expect(defaults.volume).toBeGreaterThan(0);
      expect(defaults.volume).toBeLessThanOrEqual(1);
      expect(defaults.maxDistance).toBeGreaterThan(0);
    }
  });
});

describe('validateTextureDimensions', () => {
  it('should accept power-of-2 dimensions', () => {
    const result = validateTextureDimensions(512, 512, 'albedo');
    expect(result.isPowerOfTwo).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.slot).toBe('albedo');
    expect(result.channels).toBe(4);
  });

  it('should warn about non-power-of-2 dimensions', () => {
    const result = validateTextureDimensions(300, 300, 'normal');
    expect(result.isPowerOfTwo).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('not power-of-2');
    expect(result.warnings[0]).toContain('512x512'); // next power of 2
  });

  it('should warn about oversized textures', () => {
    const result = validateTextureDimensions(8192, 8192, 'albedo');
    expect(result.warnings.some(w => w.includes('very large'))).toBe(true);
  });

  it('should report both warnings for large non-power-of-2', () => {
    const result = validateTextureDimensions(5000, 5000, 'roughness');
    expect(result.warnings.length).toBe(2);
  });

  it('should handle 1x1 textures', () => {
    const result = validateTextureDimensions(1, 1, 'ao');
    expect(result.isPowerOfTwo).toBe(true);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });
});

describe('postProcess', () => {
  it('should process model type', () => {
    const result = postProcess('model', 'a red dragon');
    expect(result.ok).toBe(true);
    expect(result.metadata.assetName).toContain('Model_');
    expect(result.metadata.orientation).toBe('y-up');
  });

  it('should process texture type', () => {
    const result = postProcess('texture', 'brick wall');
    expect(result.ok).toBe(true);
    expect(result.metadata.pipelineVersion).toBe(1);
  });

  it('should process sfx type with category inference', () => {
    const result = postProcess('sfx', 'explosion boom');
    expect(result.ok).toBe(true);
    expect(result.metadata.sfxCategory).toBe('explosion');
    expect(result.metadata.spatialDefaults).not.toBeUndefined();
  });

  it('should process sfx with explicit config', () => {
    const result = postProcess('sfx', 'some sound', { sfxCategory: 'ui' });
    expect(result.metadata.sfxCategory).toBe('ui');
  });

  it('should process music type', () => {
    const result = postProcess('music', 'epic battle theme');
    expect(result.ok).toBe(true);
    expect(result.metadata.shouldLoop).toBe(true);
    expect(result.metadata.targetVolume).toBe(0.6);
  });

  it('should process music with custom config', () => {
    const result = postProcess('music', 'test', { shouldLoop: false, targetVolume: 0.3 });
    expect(result.metadata.shouldLoop).toBe(false);
    expect(result.metadata.targetVolume).toBe(0.3);
  });

  it('should process skybox type', () => {
    const result = postProcess('skybox', 'sunset sky');
    expect(result.ok).toBe(true);
    expect(result.metadata.format).toBe('equirectangular');
  });

  it('should process sprite types', () => {
    for (const type of ['sprite', 'sprite_sheet', 'tileset'] as const) {
      const result = postProcess(type, 'character idle');
      expect(result.ok).toBe(true);
      expect(result.metadata.spriteType).toBe(type);
      expect(result.metadata.assetName).not.toBeUndefined();
    }
  });

  it('should handle unknown types gracefully', () => {
    const result = postProcess('unknown' as never, 'test');
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
