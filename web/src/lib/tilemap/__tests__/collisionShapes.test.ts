import { describe, it, expect } from 'vitest';
import { applyCollisionShapeToLayers } from '../collisionShapes';
import type { TilemapLayer } from '@/stores/slices/types';

function layer(tiles: number): TilemapLayer {
  return {
    name: 'L',
    tiles: new Array<number | null>(tiles).fill(null),
    visible: true,
    opacity: 1,
    isCollision: true,
  };
}

describe('applyCollisionShapeToLayers', () => {
  it('grows collisionShapes to match tiles on first write, defaulting the rest to none', () => {
    const layers = [layer(4)]; // 4x1
    const { layers: next, changed } = applyCollisionShapeToLayers(layers, [4, 1], 0, 2, 0, 'halfBottom');
    expect(changed).toBe(true);
    expect(next[0].collisionShapes).toEqual(['none', 'none', 'halfBottom', 'none']);
  });

  it('does not mutate the input layers array (immutable update)', () => {
    const layers = [layer(4)];
    const result = applyCollisionShapeToLayers(layers, [4, 1], 0, 0, 0, 'full');
    expect(result.layers).not.toBe(layers);
    expect(layers[0].collisionShapes).toBeUndefined();
  });

  it('preserves earlier shapes on a second write', () => {
    const layers = [layer(3)];
    const a = applyCollisionShapeToLayers(layers, [3, 1], 0, 0, 0, 'full');
    const b = applyCollisionShapeToLayers(a.layers, [3, 1], 0, 2, 0, 'halfTop');
    expect(b.layers[0].collisionShapes).toEqual(['full', 'none', 'halfTop']);
  });

  it('reports no change and returns the array untouched for an out-of-range cell', () => {
    const layers = [layer(4)];
    const offX = applyCollisionShapeToLayers(layers, [4, 1], 0, 9, 0, 'slopeLeft');
    expect(offX.changed).toBe(false);
    expect(offX.layers).toBe(layers);
    const offY = applyCollisionShapeToLayers(layers, [4, 1], 0, 0, 9, 'slopeLeft');
    expect(offY.changed).toBe(false);
    expect(offY.layers).toBe(layers);
  });

  it('reports no change for an out-of-range layer index', () => {
    const layers = [layer(4)];
    const result = applyCollisionShapeToLayers(layers, [4, 1], 5, 0, 0, 'full');
    expect(result.changed).toBe(false);
    expect(result.layers).toBe(layers);
  });

  it('leaves other layers referentially unchanged', () => {
    const layers = [layer(2), layer(2)];
    const { layers: next } = applyCollisionShapeToLayers(layers, [2, 1], 0, 0, 0, 'full');
    expect(next[1]).toBe(layers[1]);
    expect(next[0]).not.toBe(layers[0]);
  });
});
