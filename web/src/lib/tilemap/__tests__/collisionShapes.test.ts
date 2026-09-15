import { describe, it, expect } from 'vitest';
import { applyCollisionShapeToLayers, getCollisionShapeFromLayers } from '../collisionShapes';
import type { CollisionShape, TilemapLayer } from '@/stores/slices/types';

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

  it.each([undefined, [], ['none'] as CollisionShape[]])('preserves absent or partial metadata when none is already effective (%j)', (collisionShapes) => {
    const layers = [{ ...layer(4), collisionShapes }];
    const result = applyCollisionShapeToLayers(layers, [4, 1], 0, 3, 0, 'none');
    expect(result).toEqual({ layers, changed: false });
    expect(result.layers).toBe(layers);
    expect(result.layers[0].collisionShapes).toBe(collisionShapes);
  });

  it('does not allocate or report a change for an already authored shape', () => {
    const layers = [{ ...layer(2), collisionShapes: ['halfTop', 'none'] as CollisionShape[] }];
    const result = applyCollisionShapeToLayers(layers, [2, 1], 0, 0, 0, 'halfTop');
    expect(result.changed).toBe(false);
    expect(result.layers).toBe(layers);
  });

  it('rejects unknown runtime shape values without writing them', () => {
    const layers = [layer(2)];
    const result = applyCollisionShapeToLayers(layers, [2, 1], 0, 0, 0, 'wedge' as CollisionShape);
    expect(result.error).toMatch(/Unknown collision shape/);
    expect(result.layers).toBe(layers);
  });

  it.each([-1, 0.5, NaN, Infinity, 0x1_0000_0000])('rejects invalid coordinates and reads them as unknown (%s)', (coordinate) => {
    const layers = [layer(2)];
    const result = applyCollisionShapeToLayers(layers, [2, 1], 0, coordinate, 0, 'full');
    expect(result.changed).toBe(false);
    expect(result.layers).toBe(layers);
    expect(getCollisionShapeFromLayers(layers, [2, 1], 0, coordinate, 0)).toBeNull();
  });

  it('rejects fractional map dimensions and cells beyond a short tile vector', () => {
    const layers = [layer(2)];
    expect(applyCollisionShapeToLayers(layers, [2.5, 1], 0, 0, 0, 'full').changed).toBe(false);
    expect(applyCollisionShapeToLayers(layers, [4, 1], 0, 3, 0, 'full').changed).toBe(false);
    expect(getCollisionShapeFromLayers(layers, [4, 1], 0, 3, 0)).toBeNull();
  });
});
