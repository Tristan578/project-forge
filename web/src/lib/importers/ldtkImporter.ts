/**
 * LDtk (.ldtk) level file importer.
 *
 * Parses the LDtk JSON format (https://ldtk.io/json/) into SpawnForge-native
 * TilemapData structures and entity spawn requests.
 *
 * LDtk JSON structure (simplified):
 * {
 *   defs: { tilesets: LdtkTilesetDef[] },
 *   levels: LdtkLevelRaw[]
 * }
 *
 * Each level contains layerInstances[] with __type:
 *   "IntGrid"   -> collision/value grid, mapped to TilemapLayer with isCollision=true
 *   "Tiles"     -> explicit tile placement (gridTiles)
 *   "AutoLayer" -> auto-tiling (autoLayerTiles)
 *   "Entities"  -> entity instances (entityInstances)
 */

import type { TilemapData, TilemapLayer } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// LDtk raw JSON types (subset of the full spec)
// ---------------------------------------------------------------------------

interface LdtkTilesetDefRaw {
  uid: number;
  identifier: string;
  relPath: string | null;
  tileGridSize: number;
  pxWid: number;
  pxHei: number;
  spacing: number;
  padding: number;
}

interface LdtkGridTileRaw {
  /** Pixel x,y in the tileset */
  src: [number, number];
  /** Flip flags: 0=none, 1=x, 2=y, 3=both */
  f: number;
  /** Pixel x,y in the level */
  px: [number, number];
  /** Tile ID in tileset */
  t: number;
  /** Stack index (for stacked tiles) */
  a: number;
}

interface LdtkEntityFieldRaw {
  __identifier: string;
  __type: string;
  __value: unknown;
}

interface LdtkEntityInstanceRaw {
  __identifier: string;
  __grid: [number, number];
  __worldX: number;
  __worldY: number;
  px: [number, number];
  width: number;
  height: number;
  fieldInstances: LdtkEntityFieldRaw[];
}

interface LdtkLayerInstanceRaw {
  __identifier: string;
  __type: 'IntGrid' | 'Tiles' | 'Entities' | 'AutoLayer';
  __cWid: number;
  __cHei: number;
  __gridSize: number;
  __tilesetDefUid: number | null;
  __tilesetRelPath: string | null;
  __opacity: number;
  visible: boolean;
  intGridCsv: number[];
  gridTiles: LdtkGridTileRaw[];
  autoLayerTiles: LdtkGridTileRaw[];
  entityInstances: LdtkEntityInstanceRaw[];
  /** LDtk tile override: int value -> tileset tile ID */
  autoTilesetDefUid: number | null;
}

interface LdtkLevelRaw {
  identifier: string;
  uid: number;
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
  bgColor: string | null;
  layerInstances: LdtkLayerInstanceRaw[] | null;
}

// Documented for reference — the full root project shape.
// Not used as a type annotation in code (root is validated manually via assertObject).
type _LdtkProjectRaw = {
  jsonVersion: string;
  defs: {
    tilesets: LdtkTilesetDefRaw[];
    layers: Array<{
      uid: number;
      identifier: string;
      __type: string;
      gridSize: number;
      intGridValues?: Array<{ value: number; identifier: string | null; color: string }>;
    }>;
  };
  levels: LdtkLevelRaw[];
  worldGridWidth?: number;
  worldGridHeight?: number;
};

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

/** A field on a spawned entity (from LDtk Entity layer field instances). */
export interface LdtkEntityField {
  identifier: string;
  type: string;
  value: unknown;
}

/** A spawn request produced from an LDtk Entities layer. */
export interface LdtkEntitySpawn {
  identifier: string;
  /** Grid cell coordinates [col, row] */
  gridX: number;
  gridY: number;
  /** Pixel coordinates in level space */
  pixelX: number;
  pixelY: number;
  width: number;
  height: number;
  fieldInstances: LdtkEntityField[];
}

/** A parsed tileset definition extracted from defs.tilesets[]. */
export interface LdtkTilesetDef {
  uid: number;
  identifier: string;
  /** Relative path to the tileset image (may be null for internal tilesets). */
  relPath: string | null;
  tileSize: number;
  gridSize: [number, number];
  spacing: number;
  padding: number;
}

/** A single parsed LDtk level ready for use in SpawnForge. */
export interface LdtkLevel {
  identifier: string;
  uid: number;
  /** Level position in world space (pixels). */
  worldX: number;
  worldY: number;
  /** Level dimensions in pixels. */
  pxWidth: number;
  pxHeight: number;
  bgColor: string | null;
  /** TilemapData for the tile/intgrid layers (null if no renderable layers). */
  tilemapData: TilemapData | null;
  /** Tileset UID used for the tilemap (null if none). */
  tilesetUid: number | null;
  /** Entity spawn requests from Entities layers. */
  entitySpawns: LdtkEntitySpawn[];
}

/** Result of parseLdtkProject(). */
export interface LdtkParseResult {
  levels: LdtkLevel[];
  tilesets: LdtkTilesetDef[];
  /** LDtk JSON version string. */
  jsonVersion: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LdtkParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LdtkParseError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Validate that a value is a non-null object (not array). */
function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LdtkParseError(`Expected ${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new LdtkParseError(`Expected ${label} to be an array`);
  }
  return value;
}

/** Convert an LDtk gridTiles / autoLayerTiles array into a flat tile index array.
 *  The output has one slot per cell (colCount * rowCount), containing the tile ID
 *  or null if no tile occupies that cell. Stacked tiles: last one wins.
 */
function gridTilesToLayer(
  tiles: LdtkGridTileRaw[],
  colCount: number,
  rowCount: number,
  gridSize: number,
): (number | null)[] {
  const result: (number | null)[] = new Array(colCount * rowCount).fill(null);
  for (const tile of tiles) {
    const col = Math.floor(tile.px[0] / gridSize);
    const row = Math.floor(tile.px[1] / gridSize);
    if (col >= 0 && col < colCount && row >= 0 && row < rowCount) {
      result[row * colCount + col] = tile.t;
    }
  }
  return result;
}

/** Convert an LDtk IntGrid CSV into a flat tile index array.
 *  Non-zero values map to the same integer as a tile ID (value 0 = empty).
 */
function intGridCsvToLayer(
  csv: number[],
  colCount: number,
  rowCount: number,
): (number | null)[] {
  const result: (number | null)[] = new Array(colCount * rowCount).fill(null);
  const len = Math.min(csv.length, colCount * rowCount);
  for (let i = 0; i < len; i++) {
    result[i] = csv[i] !== 0 ? csv[i] : null;
  }
  return result;
}

/** Pick the first non-null tilesetUid from a set of layer instances. */
function resolveTilesetUid(layers: LdtkLayerInstanceRaw[]): number | null {
  for (const layer of layers) {
    if (layer.__tilesetDefUid !== null && layer.__tilesetDefUid !== undefined) {
      return layer.__tilesetDefUid;
    }
    if (layer.autoTilesetDefUid !== null && layer.autoTilesetDefUid !== undefined) {
      return layer.autoTilesetDefUid;
    }
  }
  return null;
}

/** Parse a single layer instance into a TilemapLayer, or null for Entities layers. */
function parseLayer(layer: LdtkLayerInstanceRaw): TilemapLayer | null {
  const colCount = layer.__cWid;
  const rowCount = layer.__cHei;
  const gridSize = layer.__gridSize;

  switch (layer.__type) {
    case 'IntGrid': {
      const tiles = intGridCsvToLayer(layer.intGridCsv ?? [], colCount, rowCount);
      return {
        name: layer.__identifier,
        tiles,
        visible: layer.visible ?? true,
        opacity: layer.__opacity ?? 1,
        isCollision: true,
      };
    }

    case 'Tiles': {
      const tiles = gridTilesToLayer(layer.gridTiles ?? [], colCount, rowCount, gridSize);
      return {
        name: layer.__identifier,
        tiles,
        visible: layer.visible ?? true,
        opacity: layer.__opacity ?? 1,
        isCollision: false,
      };
    }

    case 'AutoLayer': {
      const tiles = gridTilesToLayer(layer.autoLayerTiles ?? [], colCount, rowCount, gridSize);
      return {
        name: layer.__identifier,
        tiles,
        visible: layer.visible ?? true,
        opacity: layer.__opacity ?? 1,
        isCollision: false,
      };
    }

    case 'Entities':
      // Entity layers are handled separately.
      return null;

    default:
      return null;
  }
}

/** Parse entity instances from all Entities-type layers. */
function parseEntitySpawns(layers: LdtkLayerInstanceRaw[]): LdtkEntitySpawn[] {
  const spawns: LdtkEntitySpawn[] = [];
  for (const layer of layers) {
    if (layer.__type !== 'Entities') continue;
    for (const entity of layer.entityInstances ?? []) {
      spawns.push({
        identifier: entity.__identifier,
        gridX: entity.__grid[0],
        gridY: entity.__grid[1],
        pixelX: entity.__worldX ?? entity.px[0],
        pixelY: entity.__worldY ?? entity.px[1],
        width: entity.width,
        height: entity.height,
        fieldInstances: (entity.fieldInstances ?? []).map((f) => ({
          identifier: f.__identifier,
          type: f.__type,
          value: f.__value,
        })),
      });
    }
  }
  return spawns;
}

/** Parse a raw level into an LdtkLevel. */
function parseLevel(
  raw: LdtkLevelRaw,
  tilesetMap: Map<number, LdtkTilesetDef>,
): LdtkLevel {
  const layers: LdtkLayerInstanceRaw[] = raw.layerInstances ?? [];

  // Separate tile/intgrid layers from entity layers.
  const tileLayers = layers.filter((l) => l.__type !== 'Entities');
  const entityLayers = layers.filter((l) => l.__type === 'Entities');

  // Build TilemapLayers.
  const tilemapLayers: TilemapLayer[] = [];
  for (const layer of tileLayers) {
    const parsed = parseLayer(layer);
    if (parsed !== null) {
      tilemapLayers.push(parsed);
    }
  }

  // Determine grid size (use first tile layer's gridSize, or 16 as default).
  const firstTileLayer = tileLayers[0];
  const gridSize = firstTileLayer?.__gridSize ?? 16;
  const colCount = firstTileLayer?.__cWid ?? Math.ceil(raw.pxWid / gridSize);
  const rowCount = firstTileLayer?.__cHei ?? Math.ceil(raw.pxHei / gridSize);

  // Resolve tileset.
  const tilesetUid = resolveTilesetUid(tileLayers);
  const tilesetDef = tilesetUid !== null ? tilesetMap.get(tilesetUid) : undefined;

  // Build TilemapData only if there are renderable layers.
  let tilemapData: TilemapData | null = null;
  if (tilemapLayers.length > 0) {
    tilemapData = {
      tilesetAssetId: tilesetDef?.relPath ?? `ldtk-tileset-${tilesetUid ?? 'unknown'}`,
      tileSize: [gridSize, gridSize],
      mapSize: [colCount, rowCount],
      layers: tilemapLayers,
      origin: 'TopLeft',
    };
  }

  return {
    identifier: raw.identifier,
    uid: raw.uid,
    worldX: raw.worldX,
    worldY: raw.worldY,
    pxWidth: raw.pxWid,
    pxHeight: raw.pxHei,
    bgColor: raw.bgColor ?? null,
    tilemapData,
    tilesetUid,
    entitySpawns: parseEntitySpawns(entityLayers),
  };
}

/** Parse tileset definitions from `defs.tilesets`. */
function parseTilesets(raw: LdtkTilesetDefRaw[]): LdtkTilesetDef[] {
  return raw.map((t) => {
    const tileSize = t.tileGridSize;
    const cols = tileSize > 0 ? Math.floor((t.pxWid - t.padding * 2 + t.spacing) / (tileSize + t.spacing)) : 0;
    const rows = tileSize > 0 ? Math.floor((t.pxHei - t.padding * 2 + t.spacing) / (tileSize + t.spacing)) : 0;
    return {
      uid: t.uid,
      identifier: t.identifier,
      relPath: t.relPath,
      tileSize,
      gridSize: [cols, rows],
      spacing: t.spacing,
      padding: t.padding,
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a raw LDtk project JSON (already decoded from JSON.parse) into a
 * structured LdtkParseResult containing levels and tileset definitions.
 *
 * @throws {LdtkParseError} if the JSON is not a valid LDtk project.
 */
export function parseLdtkProject(json: unknown): LdtkParseResult {
  const root = assertObject(json, 'root');

  if (typeof root['jsonVersion'] !== 'string') {
    throw new LdtkParseError('Missing or invalid jsonVersion — not a valid LDtk file');
  }

  const defs = assertObject(root['defs'], 'defs');
  const rawTilesets = assertArray(defs['tilesets'], 'defs.tilesets') as LdtkTilesetDefRaw[];
  const rawLevels = assertArray(root['levels'], 'levels') as LdtkLevelRaw[];

  const tilesets = parseTilesets(rawTilesets);
  const tilesetMap = new Map(tilesets.map((t) => [t.uid, t]));

  const levels = rawLevels.map((rawLevel) => {
    const levelObj = assertObject(rawLevel, 'level');
    return parseLevel(levelObj as unknown as LdtkLevelRaw, tilesetMap);
  });

  return {
    levels,
    tilesets,
    jsonVersion: root['jsonVersion'] as string,
  };
}
