import { describe, it, expect } from 'vitest';
import { parseLdtkProject, LdtkParseError } from '../ldtkImporter';
import type { LdtkLevel, LdtkTilesetDef, LdtkParseResult } from '../ldtkImporter';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal valid LDtk project structure. */
function makeMinimalProject(overrides: Record<string, unknown> = {}): unknown {
  return {
    jsonVersion: '1.5.3',
    defs: {
      tilesets: [],
      layers: [],
    },
    levels: [],
    ...overrides,
  };
}

/** A single LDtk tileset definition. */
function makeTilesetDef(overrides: Partial<{
  uid: number;
  identifier: string;
  relPath: string | null;
  tileGridSize: number;
  pxWid: number;
  pxHei: number;
  spacing: number;
  padding: number;
}> = {}) {
  return {
    uid: 100,
    identifier: 'Terrain',
    relPath: 'assets/terrain.png',
    tileGridSize: 16,
    pxWid: 160,
    pxHei: 96,
    spacing: 0,
    padding: 0,
    ...overrides,
  };
}

/** A Tiles-type layer instance. */
function makeTilesLayer(overrides: Partial<{
  __identifier: string;
  __type: string;
  __cWid: number;
  __cHei: number;
  __gridSize: number;
  __tilesetDefUid: number | null;
  __tilesetRelPath: string | null;
  __opacity: number;
  visible: boolean;
  gridTiles: unknown[];
  autoLayerTiles: unknown[];
  intGridCsv: number[];
  entityInstances: unknown[];
  autoTilesetDefUid: number | null;
}> = {}): unknown {
  return {
    __identifier: 'Ground',
    __type: 'Tiles',
    __cWid: 10,
    __cHei: 8,
    __gridSize: 16,
    __tilesetDefUid: 100,
    __tilesetRelPath: 'assets/terrain.png',
    __opacity: 1,
    visible: true,
    gridTiles: [],
    autoLayerTiles: [],
    intGridCsv: [],
    entityInstances: [],
    autoTilesetDefUid: null,
    ...overrides,
  };
}

/** An IntGrid-type layer instance. */
function makeIntGridLayer(overrides: Partial<{
  __identifier: string;
  __cWid: number;
  __cHei: number;
  __gridSize: number;
  __tilesetDefUid: number | null;
  __opacity: number;
  visible: boolean;
  intGridCsv: number[];
  autoTilesetDefUid: number | null;
}> = {}): unknown {
  return {
    __identifier: 'Collision',
    __type: 'IntGrid',
    __cWid: 10,
    __cHei: 8,
    __gridSize: 16,
    __tilesetDefUid: null,
    __tilesetRelPath: null,
    __opacity: 1,
    visible: true,
    gridTiles: [],
    autoLayerTiles: [],
    intGridCsv: [],
    entityInstances: [],
    autoTilesetDefUid: null,
    ...overrides,
  };
}

/** An AutoLayer-type layer instance. */
function makeAutoLayer(overrides: Partial<{
  __identifier: string;
  __cWid: number;
  __cHei: number;
  __gridSize: number;
  __tilesetDefUid: number | null;
  __opacity: number;
  visible: boolean;
  autoLayerTiles: unknown[];
  autoTilesetDefUid: number | null;
}> = {}): unknown {
  return {
    __identifier: 'AutoGround',
    __type: 'AutoLayer',
    __cWid: 10,
    __cHei: 8,
    __gridSize: 16,
    __tilesetDefUid: null,
    __tilesetRelPath: null,
    __opacity: 1,
    visible: true,
    gridTiles: [],
    autoLayerTiles: [],
    intGridCsv: [],
    entityInstances: [],
    autoTilesetDefUid: 100,
    ...overrides,
  };
}

/** An Entities-type layer instance. */
function makeEntitiesLayer(entities: unknown[] = []): unknown {
  return {
    __identifier: 'Entities',
    __type: 'Entities',
    __cWid: 10,
    __cHei: 8,
    __gridSize: 16,
    __tilesetDefUid: null,
    __tilesetRelPath: null,
    __opacity: 1,
    visible: true,
    gridTiles: [],
    autoLayerTiles: [],
    intGridCsv: [],
    entityInstances: entities,
    autoTilesetDefUid: null,
  };
}

/** A single entity instance inside an Entities layer. */
function makeEntityInstance(overrides: Partial<{
  __identifier: string;
  __grid: [number, number];
  __worldX: number;
  __worldY: number;
  px: [number, number];
  width: number;
  height: number;
  fieldInstances: unknown[];
}> = {}): unknown {
  return {
    __identifier: 'Player',
    __grid: [2, 3],
    __worldX: 32,
    __worldY: 48,
    px: [32, 48],
    width: 16,
    height: 16,
    fieldInstances: [],
    ...overrides,
  };
}

/** A single grid tile for Tiles/AutoLayer layers. */
function makeTile(col: number, row: number, tileId: number, gridSize = 16): unknown {
  return {
    src: [0, 0] as [number, number],
    f: 0,
    px: [col * gridSize, row * gridSize] as [number, number],
    t: tileId,
    a: 1,
  };
}

/** A minimal LDtk level. */
function makeLevel(overrides: Partial<{
  identifier: string;
  uid: number;
  worldX: number;
  worldY: number;
  pxWid: number;
  pxHei: number;
  bgColor: string | null;
  layerInstances: unknown[] | null;
}> = {}): unknown {
  return {
    identifier: 'Level_0',
    uid: 0,
    worldX: 0,
    worldY: 0,
    pxWid: 160,
    pxHei: 128,
    bgColor: null,
    layerInstances: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Parsing: top-level structure
// ---------------------------------------------------------------------------

describe('parseLdtkProject - top-level structure', () => {
  it('returns jsonVersion from the project', () => {
    const result = parseLdtkProject(makeMinimalProject());
    expect(result.jsonVersion).toBe('1.5.3');
  });

  it('returns empty levels and tilesets for empty project', () => {
    const result = parseLdtkProject(makeMinimalProject());
    expect(result.levels).toEqual([]);
    expect(result.tilesets).toEqual([]);
  });

  it('parses multiple levels in order', () => {
    const project = makeMinimalProject({
      levels: [
        makeLevel({ identifier: 'Level_0', uid: 0 }),
        makeLevel({ identifier: 'Level_1', uid: 1 }),
        makeLevel({ identifier: 'Level_2', uid: 2 }),
      ],
    });
    const result = parseLdtkProject(project);
    expect(result.levels).toHaveLength(3);
    expect(result.levels[0].identifier).toBe('Level_0');
    expect(result.levels[1].identifier).toBe('Level_1');
    expect(result.levels[2].identifier).toBe('Level_2');
  });

  it('parses multiple tileset definitions', () => {
    const project = makeMinimalProject({
      defs: {
        tilesets: [
          makeTilesetDef({ uid: 1, identifier: 'Terrain' }),
          makeTilesetDef({ uid: 2, identifier: 'Decoration' }),
        ],
        layers: [],
      },
    });
    const result = parseLdtkProject(project);
    expect(result.tilesets).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Parsing: level metadata
// ---------------------------------------------------------------------------

describe('parseLdtkProject - level metadata', () => {
  it('captures level identifier and uid', () => {
    const project = makeMinimalProject({
      levels: [makeLevel({ identifier: 'Forest', uid: 42 })],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.identifier).toBe('Forest');
    expect(level.uid).toBe(42);
  });

  it('captures world position', () => {
    const project = makeMinimalProject({
      levels: [makeLevel({ worldX: 256, worldY: 512 })],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.worldX).toBe(256);
    expect(level.worldY).toBe(512);
  });

  it('captures pixel dimensions', () => {
    const project = makeMinimalProject({
      levels: [makeLevel({ pxWid: 320, pxHei: 240 })],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.pxWidth).toBe(320);
    expect(level.pxHeight).toBe(240);
  });

  it('preserves bgColor when set', () => {
    const project = makeMinimalProject({
      levels: [makeLevel({ bgColor: '#3a1f00' })],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.bgColor).toBe('#3a1f00');
  });

  it('sets bgColor to null when absent', () => {
    const project = makeMinimalProject({
      levels: [makeLevel({ bgColor: null })],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.bgColor).toBeNull();
  });

  it('produces null tilemapData for level with no layers', () => {
    const project = makeMinimalProject({
      levels: [makeLevel({ layerInstances: [] })],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.tilemapData).toBeNull();
  });

  it('handles null layerInstances as empty (external level files)', () => {
    const project = makeMinimalProject({
      levels: [makeLevel({ layerInstances: null })],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.tilemapData).toBeNull();
    expect(level.entitySpawns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Parsing: Tiles layers
// ---------------------------------------------------------------------------

describe('parseLdtkProject - Tiles layers', () => {
  it('creates a TilemapLayer for a Tiles-type layer', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef({ uid: 100 })], layers: [] },
      levels: [makeLevel({ layerInstances: [makeTilesLayer()] })],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.tilemapData).not.toBeNull();
    expect(level.tilemapData!.layers).toHaveLength(1);
    expect(level.tilemapData!.layers[0].name).toBe('Ground');
    expect(level.tilemapData!.layers[0].isCollision).toBe(false);
  });

  it('maps grid tile positions to correct flat array indices', () => {
    // 4x3 grid, tile at col=1 row=2 -> index = 2*4+1 = 9
    const gridTiles = [makeTile(1, 2, 7, 16)];
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef({ uid: 100 })], layers: [] },
      levels: [
        makeLevel({
          layerInstances: [
            makeTilesLayer({
              __cWid: 4,
              __cHei: 3,
              gridTiles,
            }),
          ],
        }),
      ],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    expect(layer.tiles[9]).toBe(7);
  });

  it('fills unoccupied cells with null', () => {
    const gridTiles = [makeTile(0, 0, 5)];
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [makeLevel({ layerInstances: [makeTilesLayer({ __cWid: 2, __cHei: 2, gridTiles })] })],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    // 2x2 = 4 cells; only index 0 has a tile
    expect(layer.tiles[0]).toBe(5);
    expect(layer.tiles[1]).toBeNull();
    expect(layer.tiles[2]).toBeNull();
    expect(layer.tiles[3]).toBeNull();
  });

  it('respects the opacity field from LDtk', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [makeLevel({ layerInstances: [makeTilesLayer({ __opacity: 0.5 })] })],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    expect(layer.opacity).toBe(0.5);
  });

  it('respects the visible flag from LDtk', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [makeLevel({ layerInstances: [makeTilesLayer({ visible: false })] })],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    expect(layer.visible).toBe(false);
  });

  it('uses layer identifier as layer name', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [makeLevel({ layerInstances: [makeTilesLayer({ __identifier: 'BackgroundDecor' })] })],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    expect(layer.name).toBe('BackgroundDecor');
  });

  it('stacks multiple Tiles layers in order', () => {
    const layer1 = makeTilesLayer({ __identifier: 'Background' });
    const layer2 = makeTilesLayer({ __identifier: 'Foreground' });
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [makeLevel({ layerInstances: [layer1, layer2] })],
    });
    const tilemapData = parseLdtkProject(project).levels[0].tilemapData!;
    expect(tilemapData.layers).toHaveLength(2);
    expect(tilemapData.layers[0].name).toBe('Background');
    expect(tilemapData.layers[1].name).toBe('Foreground');
  });

  it('sets correct mapSize from layer dimensions', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [makeLevel({ layerInstances: [makeTilesLayer({ __cWid: 20, __cHei: 15 })] })],
    });
    const tilemapData = parseLdtkProject(project).levels[0].tilemapData!;
    expect(tilemapData.mapSize).toEqual([20, 15]);
  });

  it('sets correct tileSize from layer gridSize', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef({ tileGridSize: 32 })], layers: [] },
      levels: [makeLevel({ layerInstances: [makeTilesLayer({ __gridSize: 32 })] })],
    });
    const tilemapData = parseLdtkProject(project).levels[0].tilemapData!;
    expect(tilemapData.tileSize).toEqual([32, 32]);
  });

  it('last tile wins when multiple tiles occupy the same cell', () => {
    // Two tiles at the same pixel position, different tileIds
    const gridTiles = [makeTile(0, 0, 3), makeTile(0, 0, 9)];
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [makeLevel({ layerInstances: [makeTilesLayer({ __cWid: 2, __cHei: 2, gridTiles })] })],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    // The second tile (9) should overwrite the first (3)
    expect(layer.tiles[0]).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Parsing: IntGrid layers
// ---------------------------------------------------------------------------

describe('parseLdtkProject - IntGrid layers', () => {
  it('creates a TilemapLayer with isCollision=true for IntGrid layers', () => {
    const intGridCsv = [0, 1, 0, 0, 1, 0, 0, 0]; // 2x4 grid
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [
            makeIntGridLayer({
              __cWid: 2,
              __cHei: 4,
              intGridCsv,
            }),
          ],
        }),
      ],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    expect(layer.isCollision).toBe(true);
  });

  it('maps non-zero IntGrid values to tile indices', () => {
    // 3x1 grid: [0, 2, 1]
    const intGridCsv = [0, 2, 1];
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [makeIntGridLayer({ __cWid: 3, __cHei: 1, intGridCsv })],
        }),
      ],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    expect(layer.tiles[0]).toBeNull(); // 0 = empty
    expect(layer.tiles[1]).toBe(2);
    expect(layer.tiles[2]).toBe(1);
  });

  it('converts zero values to null in IntGrid', () => {
    const intGridCsv = [0, 0, 0, 0];
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [makeIntGridLayer({ __cWid: 4, __cHei: 1, intGridCsv })],
        }),
      ],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    expect(layer.tiles.every((t) => t === null)).toBe(true);
  });

  it('handles IntGrid CSV shorter than grid size gracefully', () => {
    // 10-cell grid, only 3 CSV values provided
    const intGridCsv = [1, 0, 1];
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [makeIntGridLayer({ __cWid: 5, __cHei: 2, intGridCsv })],
        }),
      ],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    expect(layer.tiles).toHaveLength(10);
    expect(layer.tiles[0]).toBe(1);
    expect(layer.tiles[1]).toBeNull();
    expect(layer.tiles[2]).toBe(1);
    expect(layer.tiles[3]).toBeNull(); // beyond CSV
  });

  it('uses IntGrid layer identifier as layer name', () => {
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [makeIntGridLayer({ __identifier: 'SolidCollision' })],
        }),
      ],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    expect(layer.name).toBe('SolidCollision');
  });
});

// ---------------------------------------------------------------------------
// Parsing: AutoLayer layers
// ---------------------------------------------------------------------------

describe('parseLdtkProject - AutoLayer layers', () => {
  it('creates a TilemapLayer for AutoLayer-type layers', () => {
    const autoLayerTiles = [makeTile(0, 0, 3)];
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [
        makeLevel({
          layerInstances: [makeAutoLayer({ autoLayerTiles })],
        }),
      ],
    });
    const tilemapData = parseLdtkProject(project).levels[0].tilemapData;
    expect(tilemapData).not.toBeNull();
    expect(tilemapData!.layers[0].isCollision).toBe(false);
  });

  it('maps autoLayerTiles to flat tile array', () => {
    const autoLayerTiles = [makeTile(2, 1, 11)];
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [
        makeLevel({
          layerInstances: [makeAutoLayer({ __cWid: 4, __cHei: 4, autoLayerTiles })],
        }),
      ],
    });
    const layer = parseLdtkProject(project).levels[0].tilemapData!.layers[0];
    // col=2, row=1 -> index = 1*4+2 = 6
    expect(layer.tiles[6]).toBe(11);
  });

  it('resolves tileset from autoTilesetDefUid', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef({ uid: 200, relPath: 'auto_tiles.png' })], layers: [] },
      levels: [
        makeLevel({
          layerInstances: [makeAutoLayer({ autoTilesetDefUid: 200 })],
        }),
      ],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.tilesetUid).toBe(200);
    expect(level.tilemapData!.tilesetAssetId).toBe('auto_tiles.png');
  });
});

// ---------------------------------------------------------------------------
// Parsing: Entities layers
// ---------------------------------------------------------------------------

describe('parseLdtkProject - Entities layers', () => {
  it('does not include an Entities layer in tilemapData', () => {
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [makeEntitiesLayer([makeEntityInstance()])],
        }),
      ],
    });
    const level = parseLdtkProject(project).levels[0];
    // No tile layers → tilemapData is null
    expect(level.tilemapData).toBeNull();
  });

  it('extracts entity identifier', () => {
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [makeEntitiesLayer([makeEntityInstance({ __identifier: 'Chest' })])],
        }),
      ],
    });
    const spawns = parseLdtkProject(project).levels[0].entitySpawns;
    expect(spawns).toHaveLength(1);
    expect(spawns[0].identifier).toBe('Chest');
  });

  it('extracts grid coordinates', () => {
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [makeEntitiesLayer([makeEntityInstance({ __grid: [5, 3] })])],
        }),
      ],
    });
    const spawn = parseLdtkProject(project).levels[0].entitySpawns[0];
    expect(spawn.gridX).toBe(5);
    expect(spawn.gridY).toBe(3);
  });

  it('extracts world-space pixel coordinates', () => {
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [
            makeEntitiesLayer([makeEntityInstance({ __worldX: 80, __worldY: 48 })]),
          ],
        }),
      ],
    });
    const spawn = parseLdtkProject(project).levels[0].entitySpawns[0];
    expect(spawn.pixelX).toBe(80);
    expect(spawn.pixelY).toBe(48);
  });

  it('extracts entity width and height', () => {
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [makeEntitiesLayer([makeEntityInstance({ width: 32, height: 64 })])],
        }),
      ],
    });
    const spawn = parseLdtkProject(project).levels[0].entitySpawns[0];
    expect(spawn.width).toBe(32);
    expect(spawn.height).toBe(64);
  });

  it('extracts field instances with identifier, type, and value', () => {
    const entity = makeEntityInstance({
      fieldInstances: [
        { __identifier: 'hp', __type: 'Int', __value: 100 },
        { __identifier: 'name', __type: 'String', __value: 'Hero' },
      ],
    });
    const project = makeMinimalProject({
      levels: [makeLevel({ layerInstances: [makeEntitiesLayer([entity])] })],
    });
    const fields = parseLdtkProject(project).levels[0].entitySpawns[0].fieldInstances;
    expect(fields).toHaveLength(2);
    expect(fields[0]).toEqual({ identifier: 'hp', type: 'Int', value: 100 });
    expect(fields[1]).toEqual({ identifier: 'name', type: 'String', value: 'Hero' });
  });

  it('handles entities with no field instances', () => {
    const project = makeMinimalProject({
      levels: [
        makeLevel({
          layerInstances: [makeEntitiesLayer([makeEntityInstance({ fieldInstances: [] })])],
        }),
      ],
    });
    const spawn = parseLdtkProject(project).levels[0].entitySpawns[0];
    expect(spawn.fieldInstances).toEqual([]);
  });

  it('collects entities from multiple Entities layers', () => {
    const entityLayer1 = makeEntitiesLayer([makeEntityInstance({ __identifier: 'Player' })]);
    const entityLayer2 = makeEntitiesLayer([
      makeEntityInstance({ __identifier: 'Enemy1' }),
      makeEntityInstance({ __identifier: 'Enemy2' }),
    ]);
    const project = makeMinimalProject({
      levels: [makeLevel({ layerInstances: [entityLayer1, entityLayer2] })],
    });
    const spawns = parseLdtkProject(project).levels[0].entitySpawns;
    expect(spawns).toHaveLength(3);
    expect(spawns.map((s) => s.identifier)).toContain('Player');
    expect(spawns.map((s) => s.identifier)).toContain('Enemy1');
    expect(spawns.map((s) => s.identifier)).toContain('Enemy2');
  });

  it('returns empty entitySpawns when there are no Entities layers', () => {
    const project = makeMinimalProject({
      levels: [makeLevel({ layerInstances: [makeTilesLayer()] })],
    });
    const spawns = parseLdtkProject(project).levels[0].entitySpawns;
    expect(spawns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Parsing: tileset definitions
// ---------------------------------------------------------------------------

describe('parseLdtkProject - tileset definitions', () => {
  it('parses uid, identifier, and relPath', () => {
    const project = makeMinimalProject({
      defs: {
        tilesets: [makeTilesetDef({ uid: 42, identifier: 'Dungeon', relPath: 'tiles/dungeon.png' })],
        layers: [],
      },
    });
    const tileset = parseLdtkProject(project).tilesets[0];
    expect(tileset.uid).toBe(42);
    expect(tileset.identifier).toBe('Dungeon');
    expect(tileset.relPath).toBe('tiles/dungeon.png');
  });

  it('parses tileSize from tileGridSize', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef({ tileGridSize: 32 })], layers: [] },
    });
    const tileset = parseLdtkProject(project).tilesets[0];
    expect(tileset.tileSize).toBe(32);
  });

  it('computes gridSize (columns, rows) from image dimensions', () => {
    // 160px wide, 96px tall, 16px tiles, 0 spacing/padding
    // cols = (160 + 0) / (16 + 0) = 10, rows = (96 + 0) / 16 = 6
    const project = makeMinimalProject({
      defs: {
        tilesets: [makeTilesetDef({ pxWid: 160, pxHei: 96, tileGridSize: 16, spacing: 0, padding: 0 })],
        layers: [],
      },
    });
    const tileset = parseLdtkProject(project).tilesets[0];
    expect(tileset.gridSize).toEqual([10, 6]);
  });

  it('preserves spacing and padding', () => {
    const project = makeMinimalProject({
      defs: {
        tilesets: [makeTilesetDef({ spacing: 2, padding: 4 })],
        layers: [],
      },
    });
    const tileset = parseLdtkProject(project).tilesets[0];
    expect(tileset.spacing).toBe(2);
    expect(tileset.padding).toBe(4);
  });

  it('handles null relPath (internal tilesets)', () => {
    const project = makeMinimalProject({
      defs: {
        tilesets: [makeTilesetDef({ relPath: null })],
        layers: [],
      },
    });
    const tileset = parseLdtkProject(project).tilesets[0];
    expect(tileset.relPath).toBeNull();
  });

  it('links levels to their tilesets via tilesetUid', () => {
    const project = makeMinimalProject({
      defs: {
        tilesets: [makeTilesetDef({ uid: 100, relPath: 'terrain.png' })],
        layers: [],
      },
      levels: [makeLevel({ layerInstances: [makeTilesLayer({ __tilesetDefUid: 100 })] })],
    });
    const result = parseLdtkProject(project);
    const level = result.levels[0];
    expect(level.tilesetUid).toBe(100);
    expect(level.tilemapData!.tilesetAssetId).toBe('terrain.png');
  });

  it('uses fallback tilesetAssetId when tileset uid is unknown', () => {
    // Layer references uid 999, not in defs
    const project = makeMinimalProject({
      defs: { tilesets: [], layers: [] },
      levels: [makeLevel({ layerInstances: [makeTilesLayer({ __tilesetDefUid: 999 })] })],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.tilemapData!.tilesetAssetId).toBe('ldtk-tileset-999');
  });
});

// ---------------------------------------------------------------------------
// Mixed-layer scenarios
// ---------------------------------------------------------------------------

describe('parseLdtkProject - mixed layers', () => {
  it('combines IntGrid, Tiles, and Entities layers in same level', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
      levels: [
        makeLevel({
          layerInstances: [
            makeTilesLayer({ __identifier: 'Background' }),
            makeIntGridLayer({ __identifier: 'Walls' }),
            makeEntitiesLayer([makeEntityInstance({ __identifier: 'Coin' })]),
          ],
        }),
      ],
    });
    const level = parseLdtkProject(project).levels[0];
    expect(level.tilemapData!.layers).toHaveLength(2); // Tiles + IntGrid only
    expect(level.entitySpawns).toHaveLength(1);
    expect(level.entitySpawns[0].identifier).toBe('Coin');
  });

  it('sets origin to TopLeft for all parsed levels', () => {
    const project = makeMinimalProject({
      levels: [makeLevel({ layerInstances: [makeTilesLayer()] })],
    });
    const tilemapData = parseLdtkProject(project).levels[0].tilemapData!;
    expect(tilemapData.origin).toBe('TopLeft');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('parseLdtkProject - error handling', () => {
  it('throws LdtkParseError for null input', () => {
    expect(() => parseLdtkProject(null)).toThrow(LdtkParseError);
  });

  it('throws LdtkParseError for string input', () => {
    expect(() => parseLdtkProject('{}' as unknown)).toThrow(LdtkParseError);
  });

  it('throws LdtkParseError for array input', () => {
    expect(() => parseLdtkProject([])).toThrow(LdtkParseError);
  });

  it('throws LdtkParseError when jsonVersion is missing', () => {
    expect(() =>
      parseLdtkProject({ defs: { tilesets: [], layers: [] }, levels: [] }),
    ).toThrow(LdtkParseError);
  });

  it('throws LdtkParseError when jsonVersion is not a string', () => {
    expect(() =>
      parseLdtkProject({ jsonVersion: 123, defs: { tilesets: [], layers: [] }, levels: [] }),
    ).toThrow(LdtkParseError);
  });

  it('throws LdtkParseError when defs is missing', () => {
    expect(() =>
      parseLdtkProject({ jsonVersion: '1.5.3', levels: [] }),
    ).toThrow(LdtkParseError);
  });

  it('throws LdtkParseError when defs.tilesets is not an array', () => {
    expect(() =>
      parseLdtkProject({ jsonVersion: '1.5.3', defs: { tilesets: 'bad', layers: [] }, levels: [] }),
    ).toThrow(LdtkParseError);
  });

  it('throws LdtkParseError when levels is not an array', () => {
    expect(() =>
      parseLdtkProject({ jsonVersion: '1.5.3', defs: { tilesets: [], layers: [] }, levels: 'bad' }),
    ).toThrow(LdtkParseError);
  });

  it('LdtkParseError has correct name property', () => {
    try {
      parseLdtkProject(null);
    } catch (e) {
      expect((e as Error).name).toBe('LdtkParseError');
    }
  });

  it('LdtkParseError is an instance of Error', () => {
    const err = new LdtkParseError('test');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Type assertions (ensure return types match expected interfaces)
// ---------------------------------------------------------------------------

describe('parseLdtkProject - type conformance', () => {
  it('LdtkParseResult has levels, tilesets, and jsonVersion', () => {
    const result: LdtkParseResult = parseLdtkProject(makeMinimalProject());
    expect(Array.isArray(result.levels)).toBe(true);
    expect(Array.isArray(result.tilesets)).toBe(true);
    expect(typeof result.jsonVersion).toBe('string');
  });

  it('LdtkLevel has all required fields', () => {
    const project = makeMinimalProject({
      levels: [makeLevel()],
    });
    const level: LdtkLevel = parseLdtkProject(project).levels[0];
    expect(typeof level.identifier).toBe('string');
    expect(typeof level.uid).toBe('number');
    expect(typeof level.worldX).toBe('number');
    expect(typeof level.worldY).toBe('number');
    expect(typeof level.pxWidth).toBe('number');
    expect(typeof level.pxHeight).toBe('number');
    expect(Array.isArray(level.entitySpawns)).toBe(true);
  });

  it('LdtkTilesetDef has all required fields', () => {
    const project = makeMinimalProject({
      defs: { tilesets: [makeTilesetDef()], layers: [] },
    });
    const tileset: LdtkTilesetDef = parseLdtkProject(project).tilesets[0];
    expect(typeof tileset.uid).toBe('number');
    expect(typeof tileset.identifier).toBe('string');
    expect(typeof tileset.tileSize).toBe('number');
    expect(Array.isArray(tileset.gridSize)).toBe(true);
    expect(tileset.gridSize).toHaveLength(2);
  });
});
