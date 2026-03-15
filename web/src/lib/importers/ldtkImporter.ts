/**
 * LDtk level importer.
 *
 * Parses the LDtk JSON project format (.ldtk files) and converts levels,
 * layers, and entity instances into SpawnForge-native data structures.
 *
 * Supported LDtk features:
 * - IntGrid layers (converted to collision TilemapLayer)
 * - Tiles layers (auto-layer and explicit tile layers)
 * - Entity layers (converted to entity spawn requests with fieldInstances)
 * - Tileset definitions from defs.tilesets[]
 * - Multi-level projects
 * - World layouts: Free, GridVania, LinearHorizontal, LinearVertical
 *
 * Not supported (silently ignored):
 * - Level backgrounds (image overlays)
 * - __neighbours metadata
 * - External level files (externalRelPath)
 */

import type { TilemapData, TilemapLayer } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// LDtk JSON schema types (subset we care about)
// ---------------------------------------------------------------------------

/** A field instance attached to an entity or level. */
interface LdtkFieldInstance {
  __identifier: string;
  __type: string;
  __value: unknown;
}

/** A grid tile entry within a Tiles layer instance. */
interface LdtkGridTile {
  /** Pixel X on the source tileset image. */
  src: [number, number];
  /** Pixel coordinates within the level. */
  px: [number, number];
  /** Local tile index (t) derived from the tileset. */
  t: number;
  /** Flip flags: bit0=horizontal, bit1=vertical. */
  f: number;
}

/** An entity placed inside an Entity layer instance. */
interface LdtkEntityInstance {
  __identifier: string;
  __worldX: number;
  __worldY: number;
  px: [number, number];
  width: number;
  height: number;
  fieldInstances: LdtkFieldInstance[];
}

/** A layer instance (the rendered data for one layer in one level). */
interface LdtkLayerInstance {
  __identifier: string;
  __type: 'IntGrid' | 'Tiles' | 'AutoLayer' | 'Entities';
  __cWid: number;
  __cHei: number;
  __gridSize: number;
  /** IntGrid cell values (1 = first registered value, 0 = empty). Present for IntGrid layers. */
  intGridCsv: number[];
  /** Tile data for Tiles and AutoLayer layers. */
  gridTiles: LdtkGridTile[];
  /** Entity instances for Entity layers. */
  entityInstances: LdtkEntityInstance[];
  visible: boolean;
  __opacity: number;
  /** UID of the tileset definition used by this layer (may be null). */
  __tilesetDefUid: number | null;
  /** Pixel offset of this layer within the level. */
  __pxTotalOffsetX: number;
  __pxTotalOffsetY: number;
}

/** A single level in the project. */
interface LdtkLevel {
  identifier: string;
  uid: number;
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
  /** Layer instances are null when using external level files. */
  layerInstances: LdtkLayerInstance[] | null;
  fieldInstances: LdtkFieldInstance[];
}

/** A tileset definition inside defs. */
interface LdtkTilesetDef {
  uid: number;
  identifier: string;
  relPath: string | null;
  pxWid: number;
  pxHei: number;
  tileGridSize: number;
  spacing: number;
  padding: number;
}

/** Root LDtk project JSON. */
interface LdtkProjectJson {
  jsonVersion: string;
  worldLayout: 'Free' | 'GridVania' | 'LinearHorizontal' | 'LinearVertical' | null;
  defaultGridSize: number;
  levels: LdtkLevel[];
  defs: {
    tilesets: LdtkTilesetDef[];
    layers: unknown[];
    entities: unknown[];
  };
}

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

/** A request to spawn a single entity derived from an LDtk entity instance. */
export interface LdtkEntitySpawnRequest {
  /** Entity identifier from LDtk (e.g. "Player", "Enemy"). */
  identifier: string;
  /** Suggested name for the spawned entity. */
  name: string;
  /** World-space pixel X (LDtk top-left origin). */
  x: number;
  /** World-space pixel Y (LDtk top-left origin). */
  y: number;
  /** Bounding box width in pixels. */
  width: number;
  /** Bounding box height in pixels. */
  height: number;
  /** All LDtk field instances resolved to a plain record. */
  fields: Record<string, unknown>;
}

/** Metadata about a tileset definition extracted from defs. */
export interface LdtkTilesetInfo {
  uid: number;
  identifier: string;
  /** Relative path to the image asset (null for "no image" tilesets). */
  relPath: string | null;
  /** Grid tile size in pixels. */
  tileGridSize: number;
}

/** The parsed representation of a single LDtk level. */
export interface LdtkLevelResult {
  /** Level identifier string (e.g. "Level_0"). */
  identifier: string;
  /** World-space position in pixels. */
  worldX: number;
  worldY: number;
  /** Level dimensions in pixels. */
  pxWid: number;
  pxHei: number;
  /** Tilemap-ready data covering all tile/intgrid layers in this level. */
  tilemapData: TilemapData | null;
  /** Entity spawn requests from Entity layers. */
  entities: LdtkEntitySpawnRequest[];
  /** Level-scoped field instances. */
  fields: Record<string, unknown>;
  /** Non-fatal warnings emitted during parsing of this level. */
  warnings: string[];
}

/** Top-level result returned by parseLdtkProject. */
export interface LdtkProjectResult {
  levels: LdtkLevelResult[];
  tilesets: LdtkTilesetInfo[];
  worldLayout: 'Free' | 'GridVania' | 'LinearHorizontal' | 'LinearVertical' | null;
  /** Non-fatal warnings emitted during project-level parsing. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isLdtkProjectJson(value: unknown): value is LdtkProjectJson {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['jsonVersion'] === 'string' &&
    Array.isArray(v['levels']) &&
    typeof v['defs'] === 'object' &&
    v['defs'] !== null &&
    Array.isArray((v['defs'] as Record<string, unknown>)['tilesets'])
  );
}

// ---------------------------------------------------------------------------
// Core conversion helpers
// ---------------------------------------------------------------------------

/** Resolve LDtk fieldInstances array into a plain record. */
function resolveFields(instances: LdtkFieldInstance[]): Record<string, unknown> {
  if (!instances || instances.length === 0) return {};
  const record: Record<string, unknown> = {};
  for (const f of instances) {
    record[f.__identifier] = f.__value;
  }
  return record;
}

/**
 * Derive a stable asset ID string from a tileset definition.
 * Uses the file name without extension from relPath, falling back to identifier.
 */
function tilesetAssetId(def: LdtkTilesetDef): string {
  if (def.relPath) {
    return def.relPath.replace(/.*\//, '').replace(/\.[^.]+$/, '');
  }
  return def.identifier;
}

/**
 * Convert an IntGrid layer instance to a collision TilemapLayer.
 * Any cell with value > 0 is treated as a solid/collision tile (index = value - 1).
 * Empty cells (value 0) become null.
 */
function convertIntGridLayer(layer: LdtkLayerInstance): TilemapLayer {
  const tiles: (number | null)[] = layer.intGridCsv.map(v => (v > 0 ? v - 1 : null));
  return {
    name: layer.__identifier,
    tiles,
    visible: layer.visible,
    opacity: layer.__opacity,
    isCollision: true,
  };
}

/**
 * Convert a Tiles or AutoLayer instance to a TilemapLayer.
 * gridTiles are placed into the flat array by computing the cell index from
 * the pixel position divided by the grid size.
 */
function convertTilesLayer(layer: LdtkLayerInstance): TilemapLayer {
  const cellCount = layer.__cWid * layer.__cHei;
  const tiles: (number | null)[] = new Array(cellCount).fill(null);

  for (const gt of layer.gridTiles) {
    const cellX = Math.floor(gt.px[0] / layer.__gridSize);
    const cellY = Math.floor(gt.px[1] / layer.__gridSize);
    if (cellX >= 0 && cellX < layer.__cWid && cellY >= 0 && cellY < layer.__cHei) {
      const idx = cellY * layer.__cWid + cellX;
      tiles[idx] = gt.t;
    }
  }

  return {
    name: layer.__identifier,
    tiles,
    visible: layer.visible,
    opacity: layer.__opacity,
    isCollision: false,
  };
}

/**
 * Convert an Entity layer instance to a list of spawn requests.
 * Position uses px (level-local pixel coords). __worldX/__worldY include
 * the level's world offset, which is available from the level itself.
 */
function convertEntityLayer(
  layer: LdtkLayerInstance,
  entityCount: { value: number },
): LdtkEntitySpawnRequest[] {
  return layer.entityInstances.map(ent => {
    entityCount.value += 1;
    const name = ent.__identifier;
    return {
      identifier: ent.__identifier,
      name,
      x: ent.__worldX,
      y: ent.__worldY,
      width: ent.width,
      height: ent.height,
      fields: resolveFields(ent.fieldInstances),
    };
  });
}

/**
 * Find the primary tileset UID referenced by any Tiles/AutoLayer/IntGrid layer
 * in this level's layer instances. Falls back to null if none found.
 */
function resolvePrimaryTilesetUid(layers: LdtkLayerInstance[]): number | null {
  for (const l of layers) {
    if (l.__tilesetDefUid !== null && l.__tilesetDefUid !== undefined) {
      return l.__tilesetDefUid;
    }
  }
  return null;
}

/**
 * Parse a single LDtk level into a LdtkLevelResult.
 */
function parseLevel(
  level: LdtkLevel,
  tilesetDefsById: Map<number, LdtkTilesetDef>,
  defaultGridSize: number,
): LdtkLevelResult {
  const warnings: string[] = [];
  const entities: LdtkEntitySpawnRequest[] = [];
  const tilemapLayers: TilemapLayer[] = [];
  const entityCount = { value: 0 };

  if (level.layerInstances === null) {
    warnings.push(
      `Level "${level.identifier}" uses external level files — layer data was not included. Load the external .ldtkl file separately.`,
    );
    return {
      identifier: level.identifier,
      worldX: level.worldX,
      worldY: level.worldY,
      pxWid: level.pxWid,
      pxHei: level.pxHei,
      tilemapData: null,
      entities: [],
      fields: resolveFields(level.fieldInstances),
      warnings,
    };
  }

  // LDtk stores layers bottom-to-top; reverse to match typical render order
  const reversedLayers = [...level.layerInstances].reverse();

  for (const layer of reversedLayers) {
    switch (layer.__type) {
      case 'IntGrid':
        tilemapLayers.push(convertIntGridLayer(layer));
        break;
      case 'Tiles':
      case 'AutoLayer':
        tilemapLayers.push(convertTilesLayer(layer));
        break;
      case 'Entities':
        entities.push(...convertEntityLayer(layer, entityCount));
        break;
      default:
        warnings.push(
          `Layer "${layer.__identifier}" has unknown type "${(layer as LdtkLayerInstance).__type}" — skipped.`,
        );
    }
  }

  // Resolve tileset asset ID for TilemapData
  let tilesetAssetIdStr = '';
  let tileSize: [number, number] = [defaultGridSize, defaultGridSize];

  const primaryUid = resolvePrimaryTilesetUid(level.layerInstances);
  if (primaryUid !== null) {
    const def = tilesetDefsById.get(primaryUid);
    if (def) {
      tilesetAssetIdStr = tilesetAssetId(def);
      tileSize = [def.tileGridSize, def.tileGridSize];
    }
  }

  // Determine map size from the level pixel dimensions
  const mapW = tileSize[0] > 0 ? Math.ceil(level.pxWid / tileSize[0]) : 1;
  const mapH = tileSize[1] > 0 ? Math.ceil(level.pxHei / tileSize[1]) : 1;

  // If no tile layers, create one empty placeholder layer
  const finalLayers: TilemapLayer[] =
    tilemapLayers.length > 0
      ? tilemapLayers
      : [
          {
            name: 'Layer_0',
            tiles: new Array(mapW * mapH).fill(null) as (number | null)[],
            visible: true,
            opacity: 1,
            isCollision: false,
          },
        ];

  const tilemapData: TilemapData = {
    tilesetAssetId: tilesetAssetIdStr,
    tileSize,
    mapSize: [mapW, mapH],
    layers: finalLayers,
    origin: 'TopLeft',
  };

  return {
    identifier: level.identifier,
    worldX: level.worldX,
    worldY: level.worldY,
    pxWid: level.pxWid,
    pxHei: level.pxHei,
    tilemapData,
    entities,
    fields: resolveFields(level.fieldInstances),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an LDtk project JSON object into SpawnForge data structures.
 *
 * @param json - The parsed JSON content of a .ldtk file (type `unknown` for safe validation).
 * @returns An LdtkProjectResult with one LdtkLevelResult per level, tileset info, and warnings.
 * @throws {Error} If `json` does not conform to the LDtk project format.
 *
 * @example
 * ```ts
 * const raw = JSON.parse(fileContent);
 * const { levels, tilesets } = parseLdtkProject(raw);
 * for (const level of levels) {
 *   if (level.tilemapData) {
 *     // dispatch set_tilemap_data with level.tilemapData
 *   }
 *   for (const entity of level.entities) {
 *     // dispatch spawn_empty for each entity
 *   }
 * }
 * ```
 */
export function parseLdtkProject(json: unknown): LdtkProjectResult {
  if (!isLdtkProjectJson(json)) {
    throw new Error(
      'Invalid LDtk project format: expected object with jsonVersion, levels[], and defs.tilesets[] fields.',
    );
  }

  const warnings: string[] = [];

  // Index tileset definitions by UID for fast lookup
  const tilesetDefsById = new Map<number, LdtkTilesetDef>();
  for (const def of json.defs.tilesets) {
    tilesetDefsById.set(def.uid, def);
  }

  // Extract tileset info for the caller
  const tilesets: LdtkTilesetInfo[] = json.defs.tilesets.map(def => ({
    uid: def.uid,
    identifier: def.identifier,
    relPath: def.relPath,
    tileGridSize: def.tileGridSize,
  }));

  // Parse each level
  const levels: LdtkLevelResult[] = json.levels.map(level =>
    parseLevel(level, tilesetDefsById, json.defaultGridSize),
  );

  // Collect level-scoped warnings into top-level warnings list
  for (const l of levels) {
    for (const w of l.warnings) {
      warnings.push(`[${l.identifier}] ${w}`);
    }
    // Clear so they're not duplicated at both levels
    l.warnings = [];
  }

  return {
    levels,
    tilesets,
    worldLayout: json.worldLayout ?? null,
    warnings,
  };
}
