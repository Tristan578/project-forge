import { describe, it, expect } from 'vitest';
import {
  parseLdtkProject,
  type LdtkEntitySpawnRequest,
  type LdtkProjectResult,
} from '../ldtkImporter';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid LDtk project with one level and no layers. */
function makeMinimalProject(overrides: Record<string, unknown> = {}): unknown {
  return {
    jsonVersion: '1.5.3',
    worldLayout: 'Free',
    defaultGridSize: 16,
    defs: {
      tilesets: [],
      layers: [],
      entities: [],
    },
    levels: [
      {
        identifier: 'Level_0',
        uid: 0,
        worldX: 0,
        worldY: 0,
        pxWid: 256,
        pxHei: 256,
        fieldInstances: [],
        layerInstances: [],
      },
    ],
    ...overrides,
  };
}

/** Build a project fixture containing a single IntGrid layer. */
function makeIntGridProject(): unknown {
  return {
    jsonVersion: '1.5.3',
    worldLayout: 'Free',
    defaultGridSize: 16,
    defs: {
      tilesets: [],
      layers: [],
      entities: [],
    },
    levels: [
      {
        identifier: 'Level_0',
        uid: 0,
        worldX: 0,
        worldY: 0,
        pxWid: 64,
        pxHei: 32,
        fieldInstances: [],
        layerInstances: [
          {
            __identifier: 'Collisions',
            __type: 'IntGrid',
            __cWid: 4,
            __cHei: 2,
            __gridSize: 16,
            __opacity: 1,
            __tilesetDefUid: null,
            __pxTotalOffsetX: 0,
            __pxTotalOffsetY: 0,
            visible: true,
            intGridCsv: [
              1, 0, 0, 1,
              1, 1, 1, 1,
            ],
            gridTiles: [],
            entityInstances: [],
          },
        ],
      },
    ],
  };
}

/** Build a project with a Tiles layer referencing a tileset definition. */
function makeTilesProject(): unknown {
  return {
    jsonVersion: '1.5.3',
    worldLayout: 'GridVania',
    defaultGridSize: 16,
    defs: {
      tilesets: [
        {
          uid: 10,
          identifier: 'World_Atlas',
          relPath: 'assets/world_atlas.png',
          pxWid: 256,
          pxHei: 256,
          tileGridSize: 16,
          spacing: 0,
          padding: 0,
        },
      ],
      layers: [],
      entities: [],
    },
    levels: [
      {
        identifier: 'Level_0',
        uid: 1,
        worldX: 0,
        worldY: 0,
        pxWid: 48,
        pxHei: 32,
        fieldInstances: [],
        layerInstances: [
          {
            __identifier: 'Ground',
            __type: 'Tiles',
            __cWid: 3,
            __cHei: 2,
            __gridSize: 16,
            __opacity: 1,
            __tilesetDefUid: 10,
            __pxTotalOffsetX: 0,
            __pxTotalOffsetY: 0,
            visible: true,
            intGridCsv: [],
            gridTiles: [
              { px: [0, 0], src: [0, 0], t: 0, f: 0 },
              { px: [16, 0], src: [16, 0], t: 1, f: 0 },
              { px: [32, 0], src: [32, 0], t: 2, f: 0 },
              { px: [0, 16], src: [0, 16], t: 16, f: 0 },
            ],
            entityInstances: [],
          },
        ],
      },
    ],
  };
}

/** Build a project with an AutoLayer that stores tiles in autoLayerTiles. */
function makeAutoLayerProject(): unknown {
  return {
    jsonVersion: '1.5.3',
    worldLayout: 'Free',
    defaultGridSize: 16,
    defs: {
      tilesets: [
        {
          uid: 20,
          identifier: 'Auto_Tileset',
          relPath: 'assets/auto_tileset.png',
          pxWid: 256,
          pxHei: 256,
          tileGridSize: 16,
          spacing: 0,
          padding: 0,
        },
      ],
      layers: [],
      entities: [],
    },
    levels: [
      {
        identifier: 'Level_0',
        uid: 0,
        worldX: 0,
        worldY: 0,
        pxWid: 48,
        pxHei: 32,
        fieldInstances: [],
        layerInstances: [
          {
            __identifier: 'AutoGround',
            __type: 'AutoLayer',
            __cWid: 3,
            __cHei: 2,
            __gridSize: 16,
            __opacity: 0.9,
            __tilesetDefUid: 20,
            __pxTotalOffsetX: 0,
            __pxTotalOffsetY: 0,
            visible: true,
            intGridCsv: [],
            gridTiles: [],
            autoLayerTiles: [
              { px: [0, 0], src: [0, 0], t: 5, f: 0 },
              { px: [16, 0], src: [16, 0], t: 6, f: 0 },
              { px: [0, 16], src: [0, 16], t: 10, f: 0 },
            ],
            entityInstances: [],
          },
        ],
      },
    ],
  };
}

/** Build a project with an Entity layer. */
function makeEntityLayerProject(): unknown {
  return {
    jsonVersion: '1.5.3',
    worldLayout: 'Free',
    defaultGridSize: 16,
    defs: {
      tilesets: [],
      layers: [],
      entities: [],
    },
    levels: [
      {
        identifier: 'Level_0',
        uid: 0,
        worldX: 100,
        worldY: 200,
        pxWid: 256,
        pxHei: 256,
        fieldInstances: [
          { __identifier: 'levelName', __type: 'String', __value: 'Intro' },
        ],
        layerInstances: [
          {
            __identifier: 'Entities',
            __type: 'Entities',
            __cWid: 16,
            __cHei: 16,
            __gridSize: 16,
            __opacity: 1,
            __tilesetDefUid: null,
            __pxTotalOffsetX: 0,
            __pxTotalOffsetY: 0,
            visible: true,
            intGridCsv: [],
            gridTiles: [],
            entityInstances: [
              {
                __identifier: 'Player',
                __worldX: 164,
                __worldY: 232,
                px: [64, 32],
                width: 16,
                height: 24,
                fieldInstances: [
                  { __identifier: 'speed', __type: 'Float', __value: 5.0 },
                  { __identifier: 'team', __type: 'String', __value: 'red' },
                ],
              },
              {
                __identifier: 'Coin',
                __worldX: 180,
                __worldY: 248,
                px: [80, 48],
                width: 8,
                height: 8,
                fieldInstances: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Build a multi-level project (GridVania layout). */
function makeMultiLevelProject(): unknown {
  return {
    jsonVersion: '1.5.3',
    worldLayout: 'LinearHorizontal',
    defaultGridSize: 16,
    defs: {
      tilesets: [],
      layers: [],
      entities: [],
    },
    levels: [
      {
        identifier: 'World_0',
        uid: 0,
        worldX: 0,
        worldY: 0,
        pxWid: 128,
        pxHei: 64,
        fieldInstances: [],
        layerInstances: [],
      },
      {
        identifier: 'World_1',
        uid: 1,
        worldX: 128,
        worldY: 0,
        pxWid: 128,
        pxHei: 64,
        fieldInstances: [],
        layerInstances: [],
      },
      {
        identifier: 'World_2',
        uid: 2,
        worldX: 256,
        worldY: 0,
        pxWid: 128,
        pxHei: 64,
        fieldInstances: [],
        layerInstances: [],
      },
    ],
  };
}

/** Build a project with an external level (null layerInstances). */
function makeExternalLevelProject(): unknown {
  return {
    jsonVersion: '1.5.3',
    worldLayout: 'Free',
    defaultGridSize: 16,
    defs: {
      tilesets: [],
      layers: [],
      entities: [],
    },
    levels: [
      {
        identifier: 'External_0',
        uid: 0,
        worldX: 0,
        worldY: 0,
        pxWid: 256,
        pxHei: 256,
        fieldInstances: [],
        layerInstances: null,  // external level file
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('parseLdtkProject — input validation', () => {
  it('throws on null input', () => {
    expect(() => parseLdtkProject(null)).toThrow('Invalid LDtk project format');
  });

  it('throws on string input', () => {
    expect(() => parseLdtkProject('{}' as unknown)).toThrow('Invalid LDtk project format');
  });

  it('throws when jsonVersion is missing', () => {
    expect(() =>
      parseLdtkProject({ levels: [], defs: { tilesets: [] } }),
    ).toThrow('Invalid LDtk project format');
  });

  it('throws when levels is missing', () => {
    expect(() =>
      parseLdtkProject({ jsonVersion: '1.5.3', defs: { tilesets: [] } }),
    ).toThrow('Invalid LDtk project format');
  });

  it('throws when defs.tilesets is missing', () => {
    expect(() =>
      parseLdtkProject({ jsonVersion: '1.5.3', levels: [], defs: {} }),
    ).toThrow('Invalid LDtk project format');
  });

  it('throws on plain array input', () => {
    expect(() => parseLdtkProject([])).toThrow('Invalid LDtk project format');
  });
});

// ---------------------------------------------------------------------------
// Minimal project
// ---------------------------------------------------------------------------

describe('parseLdtkProject — minimal project', () => {
  let result: LdtkProjectResult;

  beforeEach(() => {
    result = parseLdtkProject(makeMinimalProject());
  });

  it('returns one level', () => {
    expect(result.levels).toHaveLength(1);
  });

  it('sets level identifier', () => {
    expect(result.levels[0].identifier).toBe('Level_0');
  });

  it('sets level world position', () => {
    expect(result.levels[0].worldX).toBe(0);
    expect(result.levels[0].worldY).toBe(0);
  });

  it('sets level pixel dimensions', () => {
    expect(result.levels[0].pxWid).toBe(256);
    expect(result.levels[0].pxHei).toBe(256);
  });

  it('creates one empty placeholder layer when no tile layers exist', () => {
    const td = result.levels[0].tilemapData;
    expect(td).not.toBeNull();
    expect(td!.layers).toHaveLength(1);
    expect(td!.layers[0].name).toBe('Layer_0');
    expect(td!.layers[0].isCollision).toBe(false);
  });

  it('produces no entity spawn requests', () => {
    expect(result.levels[0].entities).toHaveLength(0);
  });

  it('returns empty tilesets list', () => {
    expect(result.tilesets).toHaveLength(0);
  });

  it('preserves worldLayout', () => {
    expect(result.worldLayout).toBe('Free');
  });

  it('produces no warnings', () => {
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Empty level (no layerInstances but valid empty array)
// ---------------------------------------------------------------------------

describe('parseLdtkProject — empty level', () => {
  it('returns tilemapData with a single empty layer', () => {
    const result = parseLdtkProject(makeMinimalProject());
    const td = result.levels[0].tilemapData;
    expect(td).not.toBeNull();
    const cells = td!.mapSize[0] * td!.mapSize[1];
    expect(td!.layers[0].tiles).toHaveLength(cells);
    expect(td!.layers[0].tiles.every(t => t === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IntGrid layer parsing
// ---------------------------------------------------------------------------

describe('parseLdtkProject — IntGrid layer', () => {
  let result: LdtkProjectResult;

  beforeEach(() => {
    result = parseLdtkProject(makeIntGridProject());
  });

  it('creates a tile layer from the IntGrid layer', () => {
    const td = result.levels[0].tilemapData!;
    expect(td.layers).toHaveLength(1);
  });

  it('marks the IntGrid layer as isCollision = true', () => {
    const layer = result.levels[0].tilemapData!.layers[0];
    expect(layer.isCollision).toBe(true);
  });

  it('maps non-zero IntGrid cells to tile indices (value - 1)', () => {
    const tiles = result.levels[0].tilemapData!.layers[0].tiles;
    // intGridCsv: [1, 0, 0, 1, 1, 1, 1, 1]
    // value=1 -> index 0, value=0 -> null
    expect(tiles[0]).toBe(0);
    expect(tiles[1]).toBeNull();
    expect(tiles[2]).toBeNull();
    expect(tiles[3]).toBe(0);
    expect(tiles[4]).toBe(0);
  });

  it('maps zero IntGrid cells to null', () => {
    const tiles = result.levels[0].tilemapData!.layers[0].tiles;
    expect(tiles[1]).toBeNull();
    expect(tiles[2]).toBeNull();
  });

  it('preserves layer name', () => {
    expect(result.levels[0].tilemapData!.layers[0].name).toBe('Collisions');
  });

  it('sets map dimensions from pixel size / grid size', () => {
    const td = result.levels[0].tilemapData!;
    // pxWid=64, pxHei=32, gridSize=16 -> 4x2
    expect(td.mapSize).toEqual([4, 2]);
  });
});

// ---------------------------------------------------------------------------
// Tiles layer parsing
// ---------------------------------------------------------------------------

describe('parseLdtkProject — Tiles layer', () => {
  let result: LdtkProjectResult;

  beforeEach(() => {
    result = parseLdtkProject(makeTilesProject());
  });

  it('creates a tile layer from the Tiles layer', () => {
    const td = result.levels[0].tilemapData!;
    expect(td.layers).toHaveLength(1);
  });

  it('marks the Tiles layer as isCollision = false', () => {
    expect(result.levels[0].tilemapData!.layers[0].isCollision).toBe(false);
  });

  it('maps gridTile positions to flat tile array', () => {
    const tiles = result.levels[0].tilemapData!.layers[0].tiles;
    // Ground layer: 3x2 cells
    // px [0,0] -> cell (0,0) -> idx 0 -> t=0
    // px [16,0] -> cell (1,0) -> idx 1 -> t=1
    // px [32,0] -> cell (2,0) -> idx 2 -> t=2
    // px [0,16] -> cell (0,1) -> idx 3 -> t=16
    expect(tiles[0]).toBe(0);
    expect(tiles[1]).toBe(1);
    expect(tiles[2]).toBe(2);
    expect(tiles[3]).toBe(16);
    expect(tiles[4]).toBeNull();
    expect(tiles[5]).toBeNull();
  });

  it('resolves tileset asset ID from relPath', () => {
    expect(result.levels[0].tilemapData!.tilesetAssetId).toBe('world_atlas');
  });

  it('sets tile size from tileset definition', () => {
    expect(result.levels[0].tilemapData!.tileSize).toEqual([16, 16]);
  });

  it('returns tileset info from defs', () => {
    expect(result.tilesets).toHaveLength(1);
    expect(result.tilesets[0].identifier).toBe('World_Atlas');
    expect(result.tilesets[0].tileGridSize).toBe(16);
    expect(result.tilesets[0].relPath).toBe('assets/world_atlas.png');
  });

  it('derives tileset asset ID as filename without extension', () => {
    expect(result.tilesets[0].relPath).toBe('assets/world_atlas.png');
    // tilesetAssetId already verified above as 'world_atlas'
    expect(result.levels[0].tilemapData!.tilesetAssetId).toBe('world_atlas');
  });
});

// ---------------------------------------------------------------------------
// AutoLayer tile parsing
// ---------------------------------------------------------------------------

describe('parseLdtkProject — AutoLayer tiles', () => {
  let result: LdtkProjectResult;

  beforeEach(() => {
    result = parseLdtkProject(makeAutoLayerProject());
  });

  it('creates a tile layer from the AutoLayer', () => {
    const td = result.levels[0].tilemapData!;
    expect(td.layers).toHaveLength(1);
    expect(td.layers[0].name).toBe('AutoGround');
  });

  it('reads tiles from autoLayerTiles, not gridTiles', () => {
    const tiles = result.levels[0].tilemapData!.layers[0].tiles;
    expect(tiles[0]).toBe(5);
    expect(tiles[1]).toBe(6);
    expect(tiles[2]).toBeNull();
    expect(tiles[3]).toBe(10);
    expect(tiles[4]).toBeNull();
    expect(tiles[5]).toBeNull();
  });

  it('marks AutoLayer as isCollision = false', () => {
    expect(result.levels[0].tilemapData!.layers[0].isCollision).toBe(false);
  });

  it('preserves layer opacity', () => {
    expect(result.levels[0].tilemapData!.layers[0].opacity).toBe(0.9);
  });

  it('resolves tileset asset ID from AutoLayer tileset def', () => {
    expect(result.levels[0].tilemapData!.tilesetAssetId).toBe('auto_tileset');
  });
});

// ---------------------------------------------------------------------------
// Entity instance extraction
// ---------------------------------------------------------------------------

describe('parseLdtkProject — entity instances', () => {
  let result: LdtkProjectResult;

  beforeEach(() => {
    result = parseLdtkProject(makeEntityLayerProject());
  });

  it('produces two entity spawn requests', () => {
    expect(result.levels[0].entities).toHaveLength(2);
  });

  it('maps Player identifier and world position', () => {
    const player = result.levels[0].entities.find(
      (e: LdtkEntitySpawnRequest) => e.identifier === 'Player',
    );
    expect(player).toBeDefined();
    expect(player!.x).toBe(164);
    expect(player!.y).toBe(232);
  });

  it('maps Player bounding box', () => {
    const player = result.levels[0].entities.find(
      (e: LdtkEntitySpawnRequest) => e.identifier === 'Player',
    )!;
    expect(player.width).toBe(16);
    expect(player.height).toBe(24);
  });

  it('resolves field instances for Player', () => {
    const player = result.levels[0].entities.find(
      (e: LdtkEntitySpawnRequest) => e.identifier === 'Player',
    )!;
    expect(player.fields['speed']).toBe(5.0);
    expect(player.fields['team']).toBe('red');
  });

  it('maps Coin with no fields', () => {
    const coin = result.levels[0].entities.find(
      (e: LdtkEntitySpawnRequest) => e.identifier === 'Coin',
    )!;
    expect(coin).toBeDefined();
    expect(coin.fields).toEqual({});
  });

  it('uses identifier as name', () => {
    const player = result.levels[0].entities.find(
      (e: LdtkEntitySpawnRequest) => e.name === 'Player',
    );
    expect(player).toBeDefined();
  });

  it('resolves level-scoped field instances', () => {
    expect(result.levels[0].fields['levelName']).toBe('Intro');
  });
});

// ---------------------------------------------------------------------------
// Multi-level project
// ---------------------------------------------------------------------------

describe('parseLdtkProject — multi-level project', () => {
  let result: LdtkProjectResult;

  beforeEach(() => {
    result = parseLdtkProject(makeMultiLevelProject());
  });

  it('returns three levels', () => {
    expect(result.levels).toHaveLength(3);
  });

  it('preserves level identifiers in order', () => {
    expect(result.levels[0].identifier).toBe('World_0');
    expect(result.levels[1].identifier).toBe('World_1');
    expect(result.levels[2].identifier).toBe('World_2');
  });

  it('preserves world positions', () => {
    expect(result.levels[0].worldX).toBe(0);
    expect(result.levels[1].worldX).toBe(128);
    expect(result.levels[2].worldX).toBe(256);
  });

  it('sets worldLayout to LinearHorizontal', () => {
    expect(result.worldLayout).toBe('LinearHorizontal');
  });

  it('each level has an empty placeholder layer', () => {
    for (const level of result.levels) {
      expect(level.tilemapData!.layers).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// External level files
// ---------------------------------------------------------------------------

describe('parseLdtkProject — external level files', () => {
  it('emits a warning for null layerInstances', () => {
    const result = parseLdtkProject(makeExternalLevelProject());
    expect(result.warnings.some(w => w.includes('external level files'))).toBe(true);
  });

  it('returns null tilemapData for external levels', () => {
    const result = parseLdtkProject(makeExternalLevelProject());
    expect(result.levels[0].tilemapData).toBeNull();
  });

  it('returns empty entities for external levels', () => {
    const result = parseLdtkProject(makeExternalLevelProject());
    expect(result.levels[0].entities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tileset definitions
// ---------------------------------------------------------------------------

describe('parseLdtkProject — tileset definitions', () => {
  it('falls back to identifier when relPath is null', () => {
    const project = makeMinimalProject({
      defs: {
        tilesets: [
          {
            uid: 1,
            identifier: 'EmbeddedTiles',
            relPath: null,
            pxWid: 128,
            pxHei: 128,
            tileGridSize: 16,
            spacing: 0,
            padding: 0,
          },
        ],
        layers: [],
        entities: [],
      },
      levels: [
        {
          identifier: 'Level_0',
          uid: 0,
          worldX: 0,
          worldY: 0,
          pxWid: 64,
          pxHei: 64,
          fieldInstances: [],
          layerInstances: [
            {
              __identifier: 'Ground',
              __type: 'Tiles',
              __cWid: 4,
              __cHei: 4,
              __gridSize: 16,
              __opacity: 1,
              __tilesetDefUid: 1,
              __pxTotalOffsetX: 0,
              __pxTotalOffsetY: 0,
              visible: true,
              intGridCsv: [],
              gridTiles: [],
              entityInstances: [],
            },
          ],
        },
      ],
    });
    const result = parseLdtkProject(project);
    expect(result.levels[0].tilemapData!.tilesetAssetId).toBe('EmbeddedTiles');
  });

  it('returns correct uid and tileGridSize in tileset info', () => {
    const result = parseLdtkProject(makeTilesProject());
    expect(result.tilesets[0].uid).toBe(10);
    expect(result.tilesets[0].tileGridSize).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// worldLayout variations
// ---------------------------------------------------------------------------

describe('parseLdtkProject — worldLayout', () => {
  it.each([
    ['Free'],
    ['GridVania'],
    ['LinearHorizontal'],
    ['LinearVertical'],
  ] as const)('preserves %s layout', layout => {
    const result = parseLdtkProject(makeMinimalProject({ worldLayout: layout }));
    expect(result.worldLayout).toBe(layout);
  });

  it('returns null for missing worldLayout', () => {
    const project = makeMinimalProject();
    delete (project as Record<string, unknown>)['worldLayout'];
    const result = parseLdtkProject(project);
    expect(result.worldLayout).toBeNull();
  });
});

// Needed by describe/beforeEach in the same file scope
import { beforeEach } from 'vitest';
