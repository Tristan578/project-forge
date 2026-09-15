/**
 * Validation and immutable authoring of stored tile collision silhouettes.
 * Runtime collider generation is not implemented yet (#9814).
 */
import { TILE_COLLISION_SHAPES, type CollisionShape, type TilemapLayer } from '@/stores/slices/types';

/** Largest coordinate or layer index accepted by the engine's unsigned 32-bit fields. */
export const TILE_COLLISION_FIELD_MAX = 0xffff_ffff;

type ShapeLayer = Pick<TilemapLayer, 'tiles' | 'collisionShapes'>;

/**
 * @param value Runtime input from a script, command, or saved metadata.
 * @returns Whether the value is one of the six supported authoring silhouettes.
 */
export function isCollisionShape(value: unknown): value is CollisionShape {
  return typeof value === 'string' && TILE_COLLISION_SHAPES.some((shape) => shape === value);
}

function cellIndex(
  layers: readonly ShapeLayer[],
  mapSize: readonly [number, number],
  layerIndex: number,
  x: number,
  y: number,
): number | null {
  const [width, height] = mapSize;
  if (![width, height, layerIndex, x, y].every(
    (value) => Number.isSafeInteger(value) && value >= 0 && value <= TILE_COLLISION_FIELD_MAX,
  ) || width === 0 || height === 0 || !Number.isSafeInteger(width * height)) return null;
  const layer = layers[layerIndex];
  if (!layer || !Array.isArray(layer.tiles) || x >= width || y >= height) return null;
  const index = y * width + x;
  return index < layer.tiles.length ? index : null;
}

/**
 * Read authored metadata without dispatching or changing the input.
 * @param layers Mirrored tile layers; absent shape entries mean none.
 * @param mapSize Declared map width and height in cells.
 * @param layerIndex Zero-based layer index; no flooring is performed.
 * @param x Zero-based integer column.
 * @param y Zero-based integer row.
 * @returns The authored shape, or null for invalid dimensions, coordinates, or missing cells.
 */
export function getCollisionShapeFromLayers(
  layers: readonly ShapeLayer[],
  mapSize: readonly [number, number],
  layerIndex: number,
  x: number,
  y: number,
): CollisionShape | null {
  const index = cellIndex(layers, mapSize, layerIndex, x, y);
  if (index === null) return null;
  const shape = layers[layerIndex].collisionShapes?.[index] ?? 'none';
  return isCollisionShape(shape) ? shape : null;
}

export interface ApplyCollisionShapeResult {
  /** Referentially unchanged for invalid inputs and edits to the current shape. */
  layers: TilemapLayer[];
  changed: boolean;
  error?: string;
}

/**
 * Compute a metadata edit without mutating its input or dispatching a command.
 * @param layers Existing full tile layers.
 * @param mapSize Declared map width and height in cells.
 * @param layerIndex Zero-based layer to edit.
 * @param x Zero-based integer column.
 * @param y Zero-based integer row.
 * @param shape Supported authoring silhouette; runtime values are validated.
 * @returns New layers when changed, unchanged references for no-ops, or an error for invalid input.
 */
export function applyCollisionShapeToLayers(
  layers: TilemapLayer[],
  mapSize: [number, number],
  layerIndex: number,
  x: number,
  y: number,
  shape: CollisionShape,
): ApplyCollisionShapeResult {
  if (!isCollisionShape(shape)) {
    return { layers, changed: false, error: `Unknown collision shape. Choose ${TILE_COLLISION_SHAPES.join(', ')}.` };
  }
  const index = cellIndex(layers, mapSize, layerIndex, x, y);
  if (index === null) {
    return { layers, changed: false, error: 'The layer or tile coordinate is invalid or outside the stored tilemap.' };
  }
  const layer = layers[layerIndex];
  if ((layer.collisionShapes?.[index] ?? 'none') === shape) {
    return { layers, changed: false };
  }
  const shapes = Array.from({ length: layer.tiles.length }, (_, i) => layer.collisionShapes?.[i] ?? 'none');
  shapes[index] = shape;
  return {
    layers: layers.map((entry, i) => i === layerIndex ? { ...entry, collisionShapes: shapes } : entry),
    changed: true,
  };
}
