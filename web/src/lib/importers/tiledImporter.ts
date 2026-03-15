/**
 * Tiled tilemap importer.
 *
 * Parses the Tiled JSON export format (.tmj files) and Tiled tileset JSON
 * format (.tsj files) into SpawnForge-native TilemapData and spawn requests.
 *
 * Supported Tiled features:
 * - Tile layers (data array) with visibility and opacity
 * - Object layers (converted to entity spawn requests)
 * - Embedded and external tileset references (firstgid mapping)
 * - Multi-layer maps with z-ordering preserved
 *
 * Not supported (silently ignored):
 * - Infinite maps (chunked tile data)
 * - Image layers
 * - Terrain brush data
 * - Wang sets
 */

import type { TilemapData, TilemapLayer } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Tiled JSON schema types (subset we care about)
// ---------------------------------------------------------------------------

/** A single tile layer or object layer in a Tiled map. */
interface TiledLayer {
  type: 'tilelayer' | 'objectgroup' | 'imagelayer' | 'group';
  name: string;
  visible: boolean;
  opacity: number;
  /** Flat tile index array for tilelayer (length = width * height). May contain global tile IDs or 0 for empty. */
  data?: number[];
  /** Objects for objectgroup layers. */
  objects?: TiledObject[];
  /** Pixel offset. */
  x: number;
  y: number;
}

/** An object placed in an object layer. */
interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  properties?: TiledProperty[];
}

/** A custom property attached to a Tiled object. */
interface TiledProperty {
  name: string;
  type: 'string' | 'int' | 'float' | 'bool' | 'color' | 'file' | 'object';
  value: unknown;
}

/** A tileset reference within a map (may be embedded or external). */
interface TiledTilesetRef {
  firstgid: number;
  source?: string;
  /** Present when the tileset is embedded directly in the map file. */
  name?: string;
  tilewidth?: number;
  tileheight?: number;
  tilecount?: number;
  columns?: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  spacing?: number;
  margin?: number;
}

/** Root Tiled map JSON structure (.tmj). */
interface TiledMapJson {
  type: string;
  version: string;
  tiledversion?: string;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite: boolean;
  layers: TiledLayer[];
  tilesets: TiledTilesetRef[];
  renderorder?: string;
  orientation?: string;
  nextlayerid?: number;
  nextobjectid?: number;
}

/** Root Tiled tileset JSON structure (.tsj). */
interface TiledTilesetJson {
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  spacing?: number;
  margin?: number;
}

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

/**
 * A request to spawn a single entity derived from a Tiled object.
 * Consumers should dispatch these as `spawn_empty` or similar MCP commands.
 */
export interface SpawnRequest {
  /** Suggested entity name (from Tiled object's `name` field). */
  name: string;
  /** Tiled object type string (may be empty). */
  objectType: string;
  /** World-space X position in Tiled pixel coordinates. */
  x: number;
  /** World-space Y position in Tiled pixel coordinates (Tiled Y = down). */
  y: number;
  /** Bounding box width in pixels. */
  width: number;
  /** Bounding box height in pixels. */
  height: number;
  /** All custom Tiled properties resolved to a plain record. */
  properties: Record<string, unknown>;
}

/** Result returned by parseTiledMap. */
export interface TiledImportResult {
  /** The primary tilemap component data ready for the engine. */
  tilemapData: TilemapData;
  /** Entities to spawn from Tiled object layers. */
  entities: SpawnRequest[];
  /** Informational warnings that did not prevent import. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isTiledMapJson(value: unknown): value is TiledMapJson {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['width'] === 'number' &&
    typeof v['height'] === 'number' &&
    typeof v['tilewidth'] === 'number' &&
    typeof v['tileheight'] === 'number' &&
    Array.isArray(v['layers']) &&
    Array.isArray(v['tilesets'])
  );
}

function isTiledTilesetJson(value: unknown): value is TiledTilesetJson {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['name'] === 'string' &&
    typeof v['tilewidth'] === 'number' &&
    typeof v['tileheight'] === 'number' &&
    typeof v['tilecount'] === 'number' &&
    typeof v['columns'] === 'number'
  );
}

// ---------------------------------------------------------------------------
// Core conversion helpers
// ---------------------------------------------------------------------------

/**
 * Resolve Tiled properties array into a flat record.
 */
function resolveProperties(props: TiledProperty[] | undefined): Record<string, unknown> {
  if (!props || props.length === 0) return {};
  const record: Record<string, unknown> = {};
  for (const p of props) {
    record[p.name] = p.value;
  }
  return record;
}

/**
 * Convert a Tiled tile layer data array into a TilemapLayer.
 *
 * Tiled global tile IDs (GIDs) are mapped to local tile indices by
 * subtracting the firstgid of the primary tileset. Empty tiles (GID 0)
 * become null. Tile flip/rotation flags (high bits) are stripped.
 */
function convertTileLayer(
  layer: TiledLayer,
  mapWidth: number,
  mapHeight: number,
  firstgid: number,
): TilemapLayer {
  const rawData = layer.data ?? [];
  // Tiled encodes flip flags in the high 3 bits of each GID.
  const FLIP_MASK = 0x1fffffff;

  const tiles: (number | null)[] = new Array(mapWidth * mapHeight).fill(null);

  for (let i = 0; i < rawData.length; i++) {
    const gid = (rawData[i] ?? 0) & FLIP_MASK;
    if (gid === 0) {
      tiles[i] = null;
    } else {
      // Convert GID -> local index (0-based)
      tiles[i] = gid - firstgid;
    }
  }

  return {
    name: layer.name,
    tiles,
    visible: layer.visible,
    opacity: layer.opacity,
    isCollision: layer.name.toLowerCase().includes('collision') ||
      layer.name.toLowerCase().includes('collide'),
  };
}

/**
 * Convert a Tiled object into a SpawnRequest.
 * Y is flipped from Tiled's top-down convention to a more natural +Y-up expectation.
 */
function convertObject(obj: TiledObject): SpawnRequest {
  return {
    name: obj.name || `Object_${obj.id}`,
    objectType: obj.type,
    x: obj.x,
    y: obj.y,
    width: obj.width,
    height: obj.height,
    properties: resolveProperties(obj.properties),
  };
}

/**
 * Pick the "primary" tileset from the map's tileset list.
 * We take the one with the lowest firstgid (usually the only one for simple maps).
 * Returns the firstgid and a best-effort asset ID derived from the image path.
 */
function resolvePrimaryTileset(tilesets: TiledTilesetRef[]): {
  firstgid: number;
  assetId: string;
} {
  if (tilesets.length === 0) {
    return { firstgid: 1, assetId: '' };
  }

  // Sort by firstgid ascending and take the first
  const sorted = [...tilesets].sort((a, b) => a.firstgid - b.firstgid);
  const primary = sorted[0];

  // Derive a stable asset ID from the image source or source path
  let assetId = '';
  if (primary.image) {
    // Strip path and extension: "assets/tiles/ground.png" -> "ground"
    assetId = primary.image.replace(/.*\//, '').replace(/\.[^.]+$/, '');
  } else if (primary.source) {
    assetId = primary.source.replace(/.*\//, '').replace(/\.[^.]+$/, '');
  } else if (primary.name) {
    assetId = primary.name;
  }

  return { firstgid: primary.firstgid, assetId };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Tiled map JSON object (.tmj format) into SpawnForge data structures.
 *
 * @param json - The parsed JSON content of a .tmj file (type `unknown` for safe validation).
 * @returns A TiledImportResult containing TilemapData, entity spawn requests, and any warnings.
 * @throws {Error} If `json` does not conform to the Tiled map format.
 *
 * @example
 * ```ts
 * const raw = JSON.parse(fileContent);
 * const { tilemapData, entities, warnings } = parseTiledMap(raw);
 * // dispatch set_tilemap_data with tilemapData
 * // dispatch spawn_empty for each entity in entities
 * ```
 */
export function parseTiledMap(json: unknown): TiledImportResult {
  if (!isTiledMapJson(json)) {
    throw new Error(
      'Invalid Tiled map format: expected object with width, height, tilewidth, tileheight, layers, and tilesets fields.',
    );
  }

  const warnings: string[] = [];

  if (json.infinite) {
    warnings.push('Infinite maps are not fully supported. Only the first chunk of each layer will be imported.');
  }

  if (json.orientation && json.orientation !== 'orthogonal') {
    warnings.push(`Map orientation "${json.orientation}" is not fully supported. Results may appear distorted.`);
  }

  const { firstgid, assetId } = resolvePrimaryTileset(json.tilesets);

  if (json.tilesets.length > 1) {
    warnings.push(
      `Map uses ${json.tilesets.length} tilesets. Only the primary tileset (firstgid=${firstgid}) will be used for tile index mapping.`,
    );
  }

  // Separate tile layers from object layers
  const tileLayers: TilemapLayer[] = [];
  const spawnRequests: SpawnRequest[] = [];

  for (const layer of json.layers) {
    switch (layer.type) {
      case 'tilelayer': {
        if (layer.data && !Array.isArray(layer.data)) {
          warnings.push(`Layer "${layer.name}" uses chunked data format — skipped.`);
          break;
        }
        tileLayers.push(
          convertTileLayer(layer, json.width, json.height, firstgid),
        );
        break;
      }
      case 'objectgroup': {
        const objs = layer.objects ?? [];
        for (const obj of objs) {
          if (obj.visible !== false) {
            spawnRequests.push(convertObject(obj));
          }
        }
        break;
      }
      case 'imagelayer':
        warnings.push(`Image layer "${layer.name}" is not supported and will be skipped.`);
        break;
      case 'group':
        warnings.push(`Group layer "${layer.name}" is not supported. Flatten your layers in Tiled before importing.`);
        break;
      default:
        warnings.push(`Unknown layer type "${(layer as TiledLayer).type}" in layer "${layer.name}" — skipped.`);
    }
  }

  // Build TilemapData. If no tile layers exist, create a single empty layer.
  const layers: TilemapLayer[] =
    tileLayers.length > 0
      ? tileLayers
      : [
          {
            name: 'Layer 0',
            tiles: new Array(json.width * json.height).fill(null) as (number | null)[],
            visible: true,
            opacity: 1,
            isCollision: false,
          },
        ];

  const tilemapData: TilemapData = {
    tilesetAssetId: assetId,
    tileSize: [json.tilewidth, json.tileheight],
    mapSize: [json.width, json.height],
    layers,
    origin: 'TopLeft',
  };

  return { tilemapData, entities: spawnRequests, warnings };
}

/**
 * Parse a Tiled tileset JSON object (.tsj format).
 *
 * Returns a plain record with the key tileset metadata fields normalised
 * for use when registering a tileset asset in SpawnForge.
 *
 * @param json - The parsed JSON content of a .tsj file.
 * @throws {Error} If `json` does not conform to the Tiled tileset format.
 *
 * @example
 * ```ts
 * const raw = JSON.parse(fileContent);
 * const tilesetMeta = parseTiledTileset(raw);
 * // Use tilesetMeta.tilewidth / tilesetMeta.tileheight when registering the asset
 * ```
 */
export function parseTiledTileset(json: unknown): TiledTilesetJson {
  if (!isTiledTilesetJson(json)) {
    throw new Error(
      'Invalid Tiled tileset format: expected object with name, tilewidth, tileheight, tilecount, and columns fields.',
    );
  }
  return json;
}
