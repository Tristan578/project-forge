/**
 * The one rule for which slot an image goes to when the caller named none
 * (#10399): a 2D sprite's own slot, or a material's base colour.
 */
import { describe, expect, it } from 'vitest';
import { defaultTextureSlot } from '../textureSlot';

describe('defaultTextureSlot', () => {
  const sprites = { 'ent-sprite': { textureAssetId: null } };

  it('sends a 2D sprite to its own slot', () => {
    expect(defaultTextureSlot('ent-sprite', sprites)).toBe('sprite');
  });

  it('keeps the base colour for an entity with no sprite data', () => {
    expect(defaultTextureSlot('ent-mesh', sprites)).toBe('base_color');
    expect(defaultTextureSlot('ent-mesh', {})).toBe('base_color');
  });

  it('keeps the base colour when there is no entity', () => {
    expect(defaultTextureSlot(null, sprites)).toBe('base_color');
    expect(defaultTextureSlot(undefined, sprites)).toBe('base_color');
    expect(defaultTextureSlot('', { '': {} })).toBe('base_color');
  });
});
