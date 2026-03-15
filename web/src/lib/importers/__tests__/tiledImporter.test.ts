import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseTiledMap,
  parseTiledTileset,
  type SpawnRequest,
  type TiledImportResult,
} from '../tiledImporter';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid 4x4 map with a single tile layer. */
function makeMinimalMap(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: 'map',
    version: '1.10',
    width: 4,
    height: 4,
    tilewidth: 16,
    tileheight: 16,
    infinite: false,
    layers: [
      {
        type: 'tilelayer',
        name: 'Ground',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        data: [
          1, 2, 3, 4,
          5, 0, 0, 6,
          7, 0, 0, 8,
          9, 10, 11, 12,
        ],
      },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'ground_tiles',
        image: 'assets/ground_tiles.png',
        tilewidth: 16,
        tileheight: 16,
        tilecount: 64,
        columns: 8,
      },
    ],
    ...overrides,
  };
}

/** Map with a tile layer AND an object layer. */
function makeMapWithObjects(): unknown {
  return {
    type: 'map',
    version: '1.10',
    width: 8,
    height: 8,
    tilewidth: 32,
    tileheight: 32,
    infinite: false,
    layers: [
      {
        type: 'tilelayer',
        name: 'Background',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        data: new Array(64).fill(1),
      },
      {
        type: 'objectgroup',
        name: 'Entities',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        objects: [
          {
            id: 1,
            name: 'Player',
            type: 'spawn_point',
            x: 64,
            y: 96,
            width: 32,
            height: 32,
            visible: true,
            properties: [
              { name: 'team', type: 'string', value: 'blue' },
              { name: 'speed', type: 'float', value: 5.5 },
            ],
          },
          {
            id: 2,
            name: 'Coin',
            type: 'collectible',
            x: 128,
            y: 32,
            width: 16,
            height: 16,
            visible: true,
          },
          {
            id: 3,
            name: 'HiddenTrigger',
            type: 'trigger',
            x: 200,
            y: 200,
            width: 32,
            height: 32,
            visible: false, // Hidden — should be skipped
          },
        ],
      },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'tiles',
        image: 'tiles.png',
        tilewidth: 32,
        tileheight: 32,
        tilecount: 16,
        columns: 4,
      },
    ],
  };
}

/** Map with multiple tile layers. */
function makeMultiLayerMap(): unknown {
  const fill = (v: number) => new Array(4).fill(v);
  return {
    type: 'map',
    version: '1.10',
    width: 2,
    height: 2,
    tilewidth: 16,
    tileheight: 16,
    infinite: false,
    layers: [
      {
        type: 'tilelayer',
        name: 'Background',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        data: fill(1),
      },
      {
        type: 'tilelayer',
        name: 'Collision',
        visible: false,
        opacity: 0.5,
        x: 0,
        y: 0,
        data: [0, 2, 0, 0],
      },
      {
        type: 'tilelayer',
        name: 'Foreground',
        visible: true,
        opacity: 0.8,
        x: 0,
        y: 0,
        data: fill(3),
      },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'tiles',
        image: 'tiles.png',
        tilewidth: 16,
        tileheight: 16,
        tilecount: 16,
        columns: 4,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// parseTiledMap
// ---------------------------------------------------------------------------

describe('parseTiledMap — input validation', () => {
  it('throws on null input', () => {
    expect(() => parseTiledMap(null)).toThrow('Invalid Tiled map format');
  });

  it('throws on string input', () => {
    expect(() => parseTiledMap('not a map')).toThrow('Invalid Tiled map format');
  });

  it('throws on object missing required fields', () => {
    expect(() => parseTiledMap({ width: 4, height: 4 })).toThrow('Invalid Tiled map format');
  });

  it('throws when layers is missing', () => {
    expect(() =>
      parseTiledMap({ width: 4, height: 4, tilewidth: 16, tileheight: 16, tilesets: [] }),
    ).toThrow('Invalid Tiled map format');
  });
});

describe('parseTiledMap — empty map', () => {
  it('returns one empty layer when the map has no tile data', () => {
    const raw: unknown = {
      type: 'map',
      version: '1.10',
      width: 2,
      height: 3,
      tilewidth: 16,
      tileheight: 16,
      infinite: false,
      layers: [],
      tilesets: [],
    };

    const result = parseTiledMap(raw);
    expect(result.tilemapData.layers).toHaveLength(1);
    expect(result.tilemapData.layers[0].name).toBe('Layer 0');
    expect(result.tilemapData.layers[0].tiles).toHaveLength(6); // 2 * 3
    expect(result.tilemapData.layers[0].tiles.every(t => t === null)).toBe(true);
  });
});

describe('parseTiledMap — minimal map', () => {
  let result: TiledImportResult;

  beforeEach(() => {
    result = parseTiledMap(makeMinimalMap());
  });

  it('sets correct map dimensions', () => {
    expect(result.tilemapData.mapSize).toEqual([4, 4]);
  });

  it('sets correct tile size', () => {
    expect(result.tilemapData.tileSize).toEqual([16, 16]);
  });

  it('derives assetId from image path', () => {
    expect(result.tilemapData.tilesetAssetId).toBe('ground_tiles');
  });

  it('sets origin to TopLeft', () => {
    expect(result.tilemapData.origin).toBe('TopLeft');
  });

  it('produces exactly one tile layer', () => {
    expect(result.tilemapData.layers).toHaveLength(1);
  });

  it('preserves layer name', () => {
    expect(result.tilemapData.layers[0].name).toBe('Ground');
  });

  it('converts GIDs to 0-based local indices', () => {
    // firstgid=1, so tile GID 1 -> index 0, GID 12 -> index 11
    const tiles = result.tilemapData.layers[0].tiles;
    expect(tiles[0]).toBe(0);  // GID 1
    expect(tiles[3]).toBe(3);  // GID 4
    expect(tiles[15]).toBe(11); // GID 12
  });

  it('maps GID 0 to null (empty tile)', () => {
    const tiles = result.tilemapData.layers[0].tiles;
    expect(tiles[5]).toBeNull();
    expect(tiles[6]).toBeNull();
  });

  it('produces no entity spawn requests', () => {
    expect(result.entities).toHaveLength(0);
  });

  it('produces no warnings', () => {
    expect(result.warnings).toHaveLength(0);
  });
});

describe('parseTiledMap — object layer', () => {
  let result: TiledImportResult;

  beforeEach(() => {
    result = parseTiledMap(makeMapWithObjects());
  });

  it('produces spawn requests only for visible objects', () => {
    expect(result.entities).toHaveLength(2); // HiddenTrigger excluded
  });

  it('maps Player object correctly', () => {
    const player = result.entities.find(e => e.name === 'Player') as SpawnRequest;
    expect(player).toBeDefined();
    expect(player.objectType).toBe('spawn_point');
    expect(player.x).toBe(64);
    expect(player.y).toBe(96);
    expect(player.width).toBe(32);
    expect(player.height).toBe(32);
  });

  it('maps Tiled properties to plain record', () => {
    const player = result.entities.find(e => e.name === 'Player') as SpawnRequest;
    expect(player.properties['team']).toBe('blue');
    expect(player.properties['speed']).toBe(5.5);
  });

  it('creates default name for unnamed objects', () => {
    // All our test objects have names so this checks the Coin
    const coin = result.entities.find(e => e.name === 'Coin') as SpawnRequest;
    expect(coin).toBeDefined();
  });

  it('includes the tile layer alongside entity spawn requests', () => {
    expect(result.tilemapData.layers).toHaveLength(1);
  });
});

describe('parseTiledMap — multiple tile layers', () => {
  let result: TiledImportResult;

  beforeEach(() => {
    result = parseTiledMap(makeMultiLayerMap());
  });

  it('imports all three tile layers', () => {
    expect(result.tilemapData.layers).toHaveLength(3);
  });

  it('preserves layer visibility', () => {
    expect(result.tilemapData.layers[0].visible).toBe(true);
    expect(result.tilemapData.layers[1].visible).toBe(false);
  });

  it('preserves layer opacity', () => {
    expect(result.tilemapData.layers[1].opacity).toBe(0.5);
    expect(result.tilemapData.layers[2].opacity).toBe(0.8);
  });

  it('marks "Collision" layer as collision', () => {
    const col = result.tilemapData.layers.find(l => l.name === 'Collision');
    expect(col?.isCollision).toBe(true);
  });

  it('does not mark Background as collision', () => {
    const bg = result.tilemapData.layers.find(l => l.name === 'Background');
    expect(bg?.isCollision).toBe(false);
  });

  it('converts sparse tile data correctly (null for GID 0)', () => {
    const col = result.tilemapData.layers.find(l => l.name === 'Collision');
    // data: [0, 2, 0, 0] -> [null, 1, null, null]
    expect(col?.tiles[0]).toBeNull();
    expect(col?.tiles[1]).toBe(1); // GID 2 - firstgid 1 = 1
    expect(col?.tiles[2]).toBeNull();
  });
});

describe('parseTiledMap — flip bit stripping', () => {
  it('strips horizontal/vertical/diagonal flip flags from GIDs', () => {
    // Tiled encodes flips in bits 29-31. A flipped tile GID 1 might be:
    // 0x80000001 (horizontally flipped)
    const mapWithFlips = makeMinimalMap({
      layers: [
        {
          type: 'tilelayer',
          name: 'Ground',
          visible: true,
          opacity: 1,
          x: 0,
          y: 0,
          data: [
            0x80000001, // flipped GID 1 -> local 0
            0x40000002, // flipped GID 2 -> local 1
            0x20000003, // flipped GID 3 -> local 2
            0,
            0, 0, 0, 0,
            0, 0, 0, 0,
            0, 0, 0, 0,
          ],
        },
      ],
    });

    const result = parseTiledMap(mapWithFlips);
    const tiles = result.tilemapData.layers[0].tiles;
    expect(tiles[0]).toBe(0); // 1 - firstgid(1) = 0
    expect(tiles[1]).toBe(1);
    expect(tiles[2]).toBe(2);
  });
});

describe('parseTiledMap — warnings', () => {
  it('warns about infinite maps', () => {
    const result = parseTiledMap(makeMinimalMap({ infinite: true }));
    expect(result.warnings.some(w => w.includes('Infinite maps'))).toBe(true);
  });

  it('warns about non-orthogonal orientation', () => {
    const result = parseTiledMap(makeMinimalMap({ orientation: 'isometric' }));
    expect(result.warnings.some(w => w.includes('isometric'))).toBe(true);
  });

  it('warns when multiple tilesets are present', () => {
    const raw = makeMinimalMap({
      tilesets: [
        { firstgid: 1, name: 'tileset1', image: 't1.png', tilewidth: 16, tileheight: 16, tilecount: 16, columns: 4 },
        { firstgid: 17, name: 'tileset2', image: 't2.png', tilewidth: 16, tileheight: 16, tilecount: 16, columns: 4 },
      ],
    });
    const result = parseTiledMap(raw);
    expect(result.warnings.some(w => w.includes('2 tilesets'))).toBe(true);
  });

  it('warns about image layers', () => {
    const raw = makeMinimalMap({
      layers: [
        ...(makeMinimalMap() as { layers: unknown[] }).layers,
        { type: 'imagelayer', name: 'Background Image', visible: true, opacity: 1, x: 0, y: 0 },
      ],
    });
    const result = parseTiledMap(raw);
    expect(result.warnings.some(w => w.includes('Image layer'))).toBe(true);
  });

  it('warns about group layers', () => {
    const raw = makeMinimalMap({
      layers: [
        ...(makeMinimalMap() as { layers: unknown[] }).layers,
        { type: 'group', name: 'MyGroup', visible: true, opacity: 1, x: 0, y: 0, layers: [] },
      ],
    });
    const result = parseTiledMap(raw);
    expect(result.warnings.some(w => w.includes('Group layer'))).toBe(true);
  });
});

describe('parseTiledMap — tileset asset ID derivation', () => {
  it('uses image filename without extension as asset ID', () => {
    const raw = makeMinimalMap({
      tilesets: [{ firstgid: 1, name: 'tiles', image: 'path/to/my_tiles.png', tilewidth: 16, tileheight: 16, tilecount: 16, columns: 4 }],
    });
    const { tilemapData } = parseTiledMap(raw);
    expect(tilemapData.tilesetAssetId).toBe('my_tiles');
  });

  it('falls back to tileset name when image is absent', () => {
    const raw = makeMinimalMap({
      tilesets: [{ firstgid: 1, name: 'fallback_name', tilewidth: 16, tileheight: 16, tilecount: 16, columns: 4 }],
    });
    const { tilemapData } = parseTiledMap(raw);
    expect(tilemapData.tilesetAssetId).toBe('fallback_name');
  });

  it('returns empty asset ID for map with no tilesets', () => {
    const raw = makeMinimalMap({ tilesets: [] });
    const { tilemapData } = parseTiledMap(raw);
    expect(tilemapData.tilesetAssetId).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseTiledTileset
// ---------------------------------------------------------------------------

describe('parseTiledTileset', () => {
  const validTileset = {
    name: 'ground',
    tilewidth: 16,
    tileheight: 16,
    tilecount: 64,
    columns: 8,
    image: 'ground.png',
    imagewidth: 128,
    imageheight: 128,
    spacing: 0,
    margin: 0,
  };

  it('accepts a valid tileset JSON', () => {
    const result = parseTiledTileset(validTileset);
    expect(result.name).toBe('ground');
    expect(result.tilewidth).toBe(16);
    expect(result.tileheight).toBe(16);
    expect(result.tilecount).toBe(64);
    expect(result.columns).toBe(8);
  });

  it('throws on null input', () => {
    expect(() => parseTiledTileset(null)).toThrow('Invalid Tiled tileset format');
  });

  it('throws on missing required fields', () => {
    expect(() => parseTiledTileset({ name: 'foo' })).toThrow('Invalid Tiled tileset format');
  });

  it('throws on object with wrong field types', () => {
    expect(() =>
      parseTiledTileset({ name: 'foo', tilewidth: '16', tileheight: 16, tilecount: 1, columns: 1 }),
    ).toThrow('Invalid Tiled tileset format');
  });

  it('passes through all fields', () => {
    const result = parseTiledTileset(validTileset);
    expect(result.image).toBe('ground.png');
    expect(result.imagewidth).toBe(128);
    expect(result.spacing).toBe(0);
    expect(result.margin).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unnamed objects
// ---------------------------------------------------------------------------

describe('parseTiledMap — unnamed objects', () => {
  it('generates a default name from the object id when name is empty', () => {
    const raw: unknown = {
      type: 'map',
      version: '1.10',
      width: 2,
      height: 2,
      tilewidth: 16,
      tileheight: 16,
      infinite: false,
      layers: [
        {
          type: 'objectgroup',
          name: 'Objects',
          visible: true,
          opacity: 1,
          x: 0,
          y: 0,
          objects: [
            { id: 42, name: '', type: 'enemy', x: 10, y: 10, width: 16, height: 16, visible: true },
          ],
        },
      ],
      tilesets: [],
    };

    const result = parseTiledMap(raw);
    expect(result.entities[0].name).toBe('Object_42');
  });
});
