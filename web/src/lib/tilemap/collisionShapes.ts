/**
 * Shared collision-shape authoring logic for tilemaps (OP-04).
 *
 * The manual path (`spriteSlice.setTileCollisionShape`) and the in-app AI path
 * (the `set_tile_collision_shape` chat handler) must apply the SAME mutation and
 * reject the SAME invalid inputs, so both call `applyCollisionShapeToLayers`.
 * Keeping it here — dependency-free, no store, no React — means neither entry
 * point can drift from the other, and it can be unit-tested in isolation.
 *
 * The mutation mirrors the engine's `set_layer_collision_shape`
 * (`engine/src/core/tilemap.rs`): the per-cell `collisionShapes` array is grown
 * to match `tiles.length` (defaulting every cell to `'none'`) the first time a
 * shape is authored on a layer, and an out-of-range layer/coordinate writes
 * nothing at all.
 */
import type { CollisionShape, TilemapLayer } from '@/stores/slices/types';

export interface ApplyCollisionShapeResult {
  /** The (possibly new) layer array. Referentially unchanged when `changed` is false. */
  layers: TilemapLayer[];
  /** Whether a cell was actually written. */
  changed: boolean;
}

/**
 * Return a new `layers` array with the collision shape of one cell set.
 *
 * `changed` is `false` — and `layers` is returned untouched — when the layer
 * index or the `(x, y)` coordinate is out of range, so callers can skip the
 * store write and the engine dispatch for a refused edit exactly as the engine
 * skips history and the re-emit.
 */
export function applyCollisionShapeToLayers(
  layers: TilemapLayer[],
  mapSize: [number, number],
  layerIndex: number,
  x: number,
  y: number,
  shape: CollisionShape,
): ApplyCollisionShapeResult {
  const [w, h] = mapSize;
  if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= layers.length) {
    return { layers, changed: false };
  }
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= w || y >= h) {
    return { layers, changed: false };
  }
  const idx = y * w + x;
  const layer = layers[layerIndex];
  if (idx >= layer.tiles.length) {
    // The declared map is larger than the layer's own vector — refuse rather
    // than grow past the tiles it actually has (matches `tile_flat_index`).
    return { layers, changed: false };
  }

  const shapes: CollisionShape[] =
    layer.collisionShapes && layer.collisionShapes.length === layer.tiles.length
      ? [...layer.collisionShapes]
      : sizedShapes(layer, layer.tiles.length);
  shapes[idx] = shape;

  const nextLayers = layers.map((l, i) => (i === layerIndex ? { ...l, collisionShapes: shapes } : l));
  return { layers: nextLayers, changed: true };
}

/** A collision-shapes array of `len` cells, seeded from any existing shapes. */
function sizedShapes(layer: TilemapLayer, len: number): CollisionShape[] {
  const out: CollisionShape[] = new Array<CollisionShape>(len).fill('none');
  const existing = layer.collisionShapes;
  if (existing) {
    for (let i = 0; i < Math.min(existing.length, len); i++) {
      out[i] = existing[i];
    }
  }
  return out;
}
