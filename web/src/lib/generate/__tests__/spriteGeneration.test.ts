import { describe, it, expect } from 'vitest';
import { postProcess, sanitizeAssetName } from '../postProcess';

describe('sprite post-processing', () => {
  it('should return sprite metadata with asset name', () => {
    const result = postProcess('sprite', 'a cute pixel cat');
    expect(result.ok).toBe(true);
    expect(result.metadata.spriteType).toBe('sprite');
    expect(result.metadata.assetName).toBe('Sprite_a_cute_pixel_cat');
    expect(result.metadata.importedAt).toBeGreaterThan(0);
  });

  it('should return sprite_sheet metadata with asset name', () => {
    const result = postProcess('sprite_sheet', 'walking animation character');
    expect(result.ok).toBe(true);
    expect(result.metadata.spriteType).toBe('sprite_sheet');
    expect(result.metadata.assetName).toBe('SpriteSheet_walking_animation_character');
  });

  it('should return tileset metadata with asset name', () => {
    const result = postProcess('tileset', 'grass and dirt terrain tiles');
    expect(result.ok).toBe(true);
    expect(result.metadata.spriteType).toBe('tileset');
    expect(result.metadata.assetName).toBe('Tileset_grass_and_dirt_terrain_tiles');
  });

  it('should produce no warnings for sprites', () => {
    const result = postProcess('sprite', 'test sprite');
    expect(result.warnings).toHaveLength(0);
  });

  it('should handle empty prompt gracefully', () => {
    const result = postProcess('sprite', '');
    expect(result.ok).toBe(true);
    expect(result.metadata.assetName).toBe('Sprite_Generated');
  });

  it('should sanitize special characters in asset name', () => {
    const result = postProcess('sprite', 'player@#$%sprite!!');
    expect(result.ok).toBe(true);
    expect(result.metadata.assetName).toBe('Sprite_playersprite');
  });
});

describe('sanitizeAssetName', () => {
  it('should truncate long names to 30 chars', () => {
    const longPrompt = 'a very long prompt that exceeds the thirty character limit by quite a bit';
    const result = sanitizeAssetName(longPrompt, 'Sprite');
    // Should truncate the prompt portion to 30 chars before cleaning
    expect(result.length).toBeLessThanOrEqual(50); // prefix + underscore + 30 chars max
    expect(result.startsWith('Sprite_')).toBe(true);
  });

  it('should replace spaces with underscores', () => {
    expect(sanitizeAssetName('hello world', 'Test')).toBe('Test_hello_world');
  });

  it('should strip non-alphanumeric characters', () => {
    expect(sanitizeAssetName('hi!@#$there', 'X')).toBe('X_hithere');
  });

  it('should use fallback for empty cleaned name', () => {
    expect(sanitizeAssetName('!!!', 'Sprite')).toBe('Sprite_Generated');
  });
});
