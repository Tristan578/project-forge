import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SPRITE_ANCHORS,
  TILEMAP_ORIGINS,
  spriteAnchorToWire,
  spriteAnchorFromWire,
  buildSetSpriteDataPayload,
  parseSpriteWire,
  parseCamera2dWire,
  parseTilemapWire,
} from '../sprite2dPayload';
import type { SpriteData } from '@/stores/slices/types';

const ENGINE = join(__dirname, '..', '..', '..', '..', '..', 'engine', 'src');
const CORE_SPRITE = join(ENGINE, 'core', 'sprite.rs');
const BRIDGE_SPRITE = join(ENGINE, 'bridge', 'sprite.rs');
const CORE_TILEMAP = join(ENGINE, 'core', 'tilemap.rs');

function sample(): SpriteData {
  return {
    textureAssetId: 'tex-1',
    colorTint: [0.5, 0.25, 0.125, 1],
    flipX: true,
    flipY: false,
    customSize: [64, 32],
    sortingLayer: 'Foreground',
    sortingOrder: 3,
    anchor: 'bottom_right',
  };
}

describe('sprite anchor vocabulary', () => {
  it('maps every store spelling to its engine spelling', () => {
    expect(SPRITE_ANCHORS.map(spriteAnchorToWire)).toEqual([
      'Center',
      'TopLeft',
      'TopCenter',
      'TopRight',
      'MiddleLeft',
      'MiddleRight',
      'BottomLeft',
      'BottomCenter',
      'BottomRight',
    ]);
  });

  it('round-trips in both directions', () => {
    for (const anchor of SPRITE_ANCHORS) {
      expect(spriteAnchorFromWire(spriteAnchorToWire(anchor))).toBe(anchor);
    }
  });

  it('falls back to the engine default for an unknown value', () => {
    expect(spriteAnchorToWire('top-left')).toBe('Center');
    expect(spriteAnchorToWire(undefined)).toBe('Center');
    expect(spriteAnchorFromWire('topLeft')).toBe('center');
    expect(spriteAnchorFromWire(null)).toBe('center');
  });

  it('does not resolve inherited Object.prototype keys', () => {
    // A bare `TABLE[key]` read finds `constructor`/`toString` on the prototype and
    // would return a function where an anchor is expected.
    expect(spriteAnchorToWire('constructor')).toBe('Center');
    expect(spriteAnchorFromWire('__proto__')).toBe('center');
  });
});

describe('buildSetSpriteDataPayload', () => {
  it('sends the engine spelling of the anchor', () => {
    // The whole point of the builder: the store spells this `bottom_right`, and the
    // engine's match silently coerced every non-centre spelling to `Center`.
    expect(buildSetSpriteDataPayload('ent-1', sample())).toEqual({
      entityId: 'ent-1',
      textureAssetId: 'tex-1',
      colorTint: [0.5, 0.25, 0.125, 1],
      flipX: true,
      flipY: false,
      customSize: [64, 32],
      sortingLayer: 'Foreground',
      sortingOrder: 3,
      anchor: 'BottomRight',
    });
  });

  it('carries an absent texture and custom size through as null', () => {
    const payload = buildSetSpriteDataPayload('ent-1', {
      ...sample(),
      textureAssetId: null,
      customSize: null,
    });
    expect(payload.textureAssetId).toBeNull();
    expect(payload.customSize).toBeNull();
  });

  it('replaces a non-finite tint channel rather than sending NaN', () => {
    const payload = buildSetSpriteDataPayload('ent-1', {
      ...sample(),
      colorTint: [Number.NaN, 0.5, Number.POSITIVE_INFINITY, 1],
    });
    expect(payload.colorTint).toEqual([1, 0.5, 1, 1]);
  });

  it('fills a tuple hole instead of letting undefined through', () => {
    // A hole is skipped by every callback form, so `.map`/`.every` guards never see
    // it and it reaches the engine as `null` after serialization (PF-1143).
    const holed = [0.5, , 0.25, 1] as unknown as SpriteData['colorTint'];
    expect(buildSetSpriteDataPayload('ent-1', { ...sample(), colorTint: holed }).colorTint)
      .toEqual([0.5, 1, 0.25, 1]);
  });

  it('truncates a fractional sorting order to the i32 the engine expects', () => {
    expect(buildSetSpriteDataPayload('ent-1', { ...sample(), sortingOrder: 2.7 }).sortingOrder)
      .toBe(2);
  });
});

describe('parseSpriteWire', () => {
  it('reads the engine snake_case field names', () => {
    expect(
      parseSpriteWire({
        texture_asset_id: 'tex-1',
        color_tint: [0.5, 0.25, 0.125, 1],
        flip_x: true,
        flip_y: false,
        custom_size: [64, 32],
        sorting_layer: 'Foreground',
        sorting_order: 3,
        anchor: 'BottomRight',
      })
    ).toEqual(sample());
  });

  it('finds nothing in a camelCase body', () => {
    // Documents WHY the snake_case reads above are load-bearing: `SpriteData` is the
    // one 2D component with no `rename_all`, so a camelCase read produces defaults.
    const parsed = parseSpriteWire({ textureAssetId: 'tex-1', flipX: true, sortingOrder: 9 });
    expect(parsed).toEqual({
      textureAssetId: null,
      colorTint: [1, 1, 1, 1],
      flipX: false,
      flipY: false,
      customSize: null,
      sortingLayer: 'Default',
      sortingOrder: 0,
      anchor: 'center',
    });
  });

  it('rejects a non-object body', () => {
    expect(parseSpriteWire(null)).toBeNull();
    expect(parseSpriteWire('nope')).toBeNull();
    expect(parseSpriteWire([1, 2])).toBeNull();
  });

  it('round-trips through the outbound builder', () => {
    const wire = buildSetSpriteDataPayload('ent-1', sample());
    // The outbound payload is camelCase (the command handler reads it manually);
    // re-serialize into the snake_case emit shape to prove the vocabularies agree.
    expect(
      parseSpriteWire({
        texture_asset_id: wire.textureAssetId,
        color_tint: wire.colorTint,
        flip_x: wire.flipX,
        flip_y: wire.flipY,
        custom_size: wire.customSize,
        sorting_layer: wire.sortingLayer,
        sorting_order: wire.sortingOrder,
        anchor: wire.anchor,
      })
    ).toEqual(sample());
  });
});

describe('parseCamera2dWire', () => {
  it('reads the flat camelCase payload the emitter builds', () => {
    expect(
      parseCamera2dWire({
        zoom: 2,
        pixelPerfect: true,
        bounds: { minX: -1, maxX: 1, minY: -2, maxY: 2 },
      })
    ).toEqual({ zoom: 2, pixelPerfect: true, bounds: { minX: -1, maxX: 1, minY: -2, maxY: 2 } });
  });

  it('treats absent bounds as null', () => {
    expect(parseCamera2dWire({ zoom: 1, pixelPerfect: false })).toEqual({
      zoom: 1,
      pixelPerfect: false,
      bounds: null,
    });
  });

  it('defaults a non-finite zoom to 1 rather than rendering NaN', () => {
    expect(parseCamera2dWire({ zoom: Number.NaN })?.zoom).toBe(1);
    expect(parseCamera2dWire({ zoom: '2' })?.zoom).toBe(1);
  });

  it('rejects a non-object payload', () => {
    expect(parseCamera2dWire(undefined)).toBeNull();
  });
});

describe('parseTilemapWire', () => {
  const wire = {
    tilesetAssetId: 'tiles-1',
    tileSize: [16, 16],
    mapSize: [2, 2],
    layers: [
      { name: 'Ground', tiles: [0, null, 1, 2], visible: true, opacity: 1, isCollision: false },
      { name: 'Walls', tiles: [null, null, null, null], visible: false, opacity: 0.5, isCollision: true },
    ],
    origin: 'Center',
  };

  it('accepts the engine payload as-is', () => {
    expect(parseTilemapWire(wire)).toEqual(wire);
  });

  it('rejects a payload with no tileset or no layers array', () => {
    expect(parseTilemapWire({ ...wire, tilesetAssetId: 42 })).toBeNull();
    expect(parseTilemapWire({ ...wire, layers: null })).toBeNull();
    expect(parseTilemapWire({ ...wire, layers: [{ name: 'x', tiles: 'no' }] })).toBeNull();
    expect(parseTilemapWire({ ...wire, layers: [null] })).toBeNull();
  });

  it('defaults an unrecognized origin to the engine default', () => {
    expect(parseTilemapWire({ ...wire, origin: 'bottomLeft' })?.origin).toBe('TopLeft');
  });

  it('names an unnamed layer by position instead of leaving it undefined', () => {
    const parsed = parseTilemapWire({ ...wire, layers: [{ tiles: [] }] });
    expect(parsed?.layers[0]?.name).toBe('Layer 1');
  });

  it('accepts a full-size tilemap without walking every tile', () => {
    // `tiles` is a flat `width * height` array and the inspector permits 1000x1000,
    // so validation is deliberately O(layers), not O(tiles) — a per-tile pass would
    // be a million checks per event (same reasoning as the PF-1149 container count).
    const tiles = new Array(1000 * 1000).fill(0);
    const parsed = parseTilemapWire({
      ...wire,
      mapSize: [1000, 1000],
      layers: [{ name: 'Ground', tiles, visible: true, opacity: 1, isCollision: false }],
    });
    expect(parsed?.layers[0]?.tiles).toHaveLength(1000 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Drift pins against the Rust source. The TS suite cannot call into the engine
// and `cargo test` cannot see these tables, so the only way to keep the two
// vocabularies honest is to read the `.rs` files textually. Fails closed: an
// unreadable file or an unparseable declaration is a failure, never a skip.
// ---------------------------------------------------------------------------

describe('drift pins', () => {
  /** Variant names of a unit-only Rust enum, in declaration order. */
  function enumVariants(file: string, name: string): string[] {
    const source = readFileSync(file, 'utf8');
    const start = source.indexOf(`pub enum ${name} {`);
    expect(start, `no 'pub enum ${name}' in ${file}`).toBeGreaterThan(-1);
    const end = source.indexOf('\n}', start);
    expect(end, `unterminated 'pub enum ${name}' in ${file}`).toBeGreaterThan(start);
    const variants = [...source.slice(start, end).matchAll(/^ {4}(\w+),/gm)].map(m => m[1]!);
    expect(variants.length, `no variants parsed from ${name}`).toBeGreaterThan(0);
    return variants;
  }

  it('every SpriteAnchor variant has a store spelling, and vice versa', () => {
    // A unit-variant enum serializes as its bare PascalCase name, so these ARE the
    // wire values.
    expect(enumVariants(CORE_SPRITE, 'SpriteAnchor').slice().sort())
      .toEqual(SPRITE_ANCHORS.map(spriteAnchorToWire).slice().sort());
  });

  it('every anchor the store can send is matched by the bridge', () => {
    // This is the pin for the bug itself: the bridge match ends `_ => Center`, so an
    // unmatched spelling is silently coerced instead of rejected.
    const source = readFileSync(BRIDGE_SPRITE, 'utf8');
    const start = source.indexOf('sprite_data.anchor = match');
    expect(start, `no anchor match in ${BRIDGE_SPRITE}`).toBeGreaterThan(-1);
    const end = source.indexOf('};', start);
    expect(end, 'unterminated anchor match').toBeGreaterThan(start);
    const arm = source.slice(start, end);
    const matched = [...arm.matchAll(/"(\w+)"\s*=>/g)].map(m => m[1]!);
    expect(matched.length, 'no anchor match arms parsed').toBeGreaterThan(0);
    expect(arm, 'anchor match has no fallback arm — re-read this pin').toContain('_ =>');

    // `Center` is the fallback and needs no explicit arm; everything else must have
    // one, or that anchor is silently discarded.
    const explicit = SPRITE_ANCHORS.map(spriteAnchorToWire).filter(w => w !== 'Center');
    expect(matched.slice().sort()).toEqual(explicit.slice().sort());
  });

  it('TilemapOrigin variants match the store union', () => {
    expect(enumVariants(CORE_TILEMAP, 'TilemapOrigin').slice().sort())
      .toEqual([...TILEMAP_ORIGINS].slice().sort());
  });

  it('SpriteData is still serialized without rename_all', () => {
    // If this ever gains `rename_all`, every snake_case read in `parseSpriteWire`
    // silently starts returning defaults — the exact failure this module exists to
    // fix, in reverse.
    const source = readFileSync(CORE_SPRITE, 'utf8');
    const start = source.indexOf('pub struct SpriteData {');
    expect(start, `no 'pub struct SpriteData' in ${CORE_SPRITE}`).toBeGreaterThan(-1);
    const attrsStart = source.lastIndexOf('#[derive', start);
    expect(attrsStart, 'no derive block before SpriteData').toBeGreaterThan(-1);
    expect(source.slice(attrsStart, start)).not.toContain('rename_all');
  });

  it('SpriteData fields match the names the parser reads', () => {
    const source = readFileSync(CORE_SPRITE, 'utf8');
    const start = source.indexOf('pub struct SpriteData {');
    const end = source.indexOf('\n}', start);
    expect(end, 'unterminated SpriteData struct').toBeGreaterThan(start);
    const fields = [...source.slice(start, end).matchAll(/^ {4}pub (\w+):/gm)].map(m => m[1]!);
    expect(fields.length, 'no SpriteData fields parsed').toBeGreaterThan(0);

    // Store key → engine field. Adding a field on either side fails this.
    const FIELD_MAP: Record<keyof SpriteData, string> = {
      textureAssetId: 'texture_asset_id',
      colorTint: 'color_tint',
      flipX: 'flip_x',
      flipY: 'flip_y',
      customSize: 'custom_size',
      sortingLayer: 'sorting_layer',
      sortingOrder: 'sorting_order',
      anchor: 'anchor',
    };
    expect(Object.values(FIELD_MAP).slice().sort()).toEqual(fields.slice().sort());
    expect(Object.keys(FIELD_MAP).slice().sort()).toEqual(Object.keys(sample()).slice().sort());
  });
});
