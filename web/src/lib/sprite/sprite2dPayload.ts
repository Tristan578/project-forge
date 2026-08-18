/**
 * The ONLY place the browser and engine 2D-sprite vocabularies meet, in both
 * directions: sprites, the 2D camera, and tilemaps.
 *
 * Three separate wire mismatches live here, each of which was a silent no-op or a
 * silent data loss before this module existed (PF-1170):
 *
 * 1. `SpriteAnchor` — the store spells anchors `top_left`, the engine matches
 *    `"TopLeft"` with a `_ => SpriteAnchor::Center` fallthrough
 *    (`bridge/sprite.rs`). So every one of the eight non-centre anchors the
 *    inspector or the `set_sprite_anchor` tool could send was coerced to Centre
 *    while the store kept its own optimistic copy — the button lit up and nothing
 *    moved.
 * 2. `SpriteData` is the ONE 2D component with no `#[serde(rename_all)]`, so it
 *    arrives on the wire in snake_case while every sibling is camelCase. Casting
 *    the payload yields a record whose every field is `undefined`.
 * 3. `emit_sprite_changed` / `emit_tilemap_changed` take `Option<&T>`, and `None`
 *    is how the engine says the selected entity has no such component. `null` on
 *    the wire must therefore DROP the store entry, not be written into it.
 *
 * Payloads are built key-by-key from an allowlist rather than spread-and-annotated:
 * `{ ...input } satisfies T` is inert, because TypeScript's excess-property check
 * never applies to spread properties (see `.claude/rules/gotchas.md` → the
 * `dispatchCommand`-returns-`void` entry).
 */

// Type-only, deliberately: this module is reachable from an API route, and a value
// import of `@/stores/` drags the client-only store into a server graph and breaks
// `next build` (see `.claude/rules/gotchas.md` → the RSC-boundary entry).
import type {
  SpriteData,
  SpriteAnchor,
  Camera2dData,
  TilemapData,
  TilemapLayer,
} from '@/stores/slices/types';

/**
 * Store spelling → engine spelling. Mirrors `SpriteAnchor` in
 * `engine/src/core/sprite.rs`; the `satisfies` proves both that every store
 * spelling is mapped and that none is invented, and the test pins the right-hand
 * side against the Rust enum textually.
 */
const ANCHOR_TO_WIRE = {
  center: 'Center',
  top_left: 'TopLeft',
  top_center: 'TopCenter',
  top_right: 'TopRight',
  middle_left: 'MiddleLeft',
  middle_right: 'MiddleRight',
  bottom_left: 'BottomLeft',
  bottom_center: 'BottomCenter',
  bottom_right: 'BottomRight',
} as const satisfies Record<SpriteAnchor, string>;

export type WireSpriteAnchor = (typeof ANCHOR_TO_WIRE)[SpriteAnchor];

/**
 * Derived from `ANCHOR_TO_WIRE` rather than written out a second time, so the two
 * directions cannot drift apart — a hand-mirrored table is exactly how the anchor
 * vocabulary broke in the first place.
 */
const ANCHOR_FROM_WIRE: Record<string, SpriteAnchor> = {};
for (const key of Object.keys(ANCHOR_TO_WIRE) as SpriteAnchor[]) {
  ANCHOR_FROM_WIRE[ANCHOR_TO_WIRE[key]] = key;
}

export const SPRITE_ANCHORS = Object.keys(ANCHOR_TO_WIRE) as readonly SpriteAnchor[];

/** Tilemap origin values, which the store already carries in the engine's spelling. */
export const TILEMAP_ORIGINS = ['TopLeft', 'Center'] as const;

/** The engine's own default, so an unrecognized value lands where serde would put it. */
const DEFAULT_ANCHOR: SpriteAnchor = 'center';

export function spriteAnchorToWire(anchor: unknown): WireSpriteAnchor {
  if (typeof anchor === 'string' && Object.hasOwn(ANCHOR_TO_WIRE, anchor)) {
    return ANCHOR_TO_WIRE[anchor as SpriteAnchor];
  }
  return ANCHOR_TO_WIRE[DEFAULT_ANCHOR];
}

export function spriteAnchorFromWire(anchor: unknown): SpriteAnchor {
  if (typeof anchor === 'string' && Object.hasOwn(ANCHOR_FROM_WIRE, anchor)) {
    return ANCHOR_FROM_WIRE[anchor];
  }
  return DEFAULT_ANCHOR;
}

// ---------------------------------------------------------------------------
// Shared numeric helpers. Indexed loops throughout, never `.map`/`.every`: a
// callback form skips array holes, so a hole in an incoming tuple survives every
// guard and reaches the consumer as `undefined` (PF-1143).
// ---------------------------------------------------------------------------

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Fixed-length numeric tuple, hole- and NaN-safe. */
function numTuple(source: unknown, length: number, fallback: number): number[] {
  const out: number[] = [];
  const arr = Array.isArray(source) ? source : [];
  for (let i = 0; i < length; i += 1) {
    out.push(finite(arr[i], fallback));
  }
  return out;
}

function isPlainObject(source: unknown): source is Record<string, unknown> {
  return typeof source === 'object' && source !== null && !Array.isArray(source);
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/**
 * Built key-by-key because the engine reads each field by name out of the raw
 * JSON (`handle_set_sprite_data`) — a key it does not recognize is dropped with
 * no error, and `anchor` in the store's spelling is dropped by the inner match.
 */
export function buildSetSpriteDataPayload(
  entityId: string,
  data: SpriteData
): Record<string, unknown> {
  return {
    entityId,
    textureAssetId: data.textureAssetId,
    colorTint: numTuple(data.colorTint, 4, 1),
    flipX: data.flipX === true,
    flipY: data.flipY === true,
    customSize: data.customSize === null || data.customSize === undefined
      ? null
      : numTuple(data.customSize, 2, 0),
    sortingLayer: typeof data.sortingLayer === 'string' ? data.sortingLayer : 'Default',
    sortingOrder: Math.trunc(finite(data.sortingOrder, 0)),
    anchor: spriteAnchorToWire(data.anchor),
  };
}

/**
 * Inbound `SPRITE_CHANGED`. Reads the engine's snake_case field names — this is
 * the one 2D component serialized without `rename_all`, so a camelCase read finds
 * nothing. Returns `null` for a payload that is not a plain object, which the
 * caller treats as "leave the store alone" rather than writing a default sprite
 * over a real one.
 */
export function parseSpriteWire(source: unknown): SpriteData | null {
  if (!isPlainObject(source)) return null;

  const [r, g, b, a] = numTuple(source.color_tint, 4, 1);
  const rawCustom = source.custom_size;
  let customSize: [number, number] | null = null;
  if (Array.isArray(rawCustom)) {
    const [w, h] = numTuple(rawCustom, 2, 0);
    customSize = [w, h];
  }

  return {
    textureAssetId: typeof source.texture_asset_id === 'string' ? source.texture_asset_id : null,
    colorTint: [r, g, b, a],
    flipX: source.flip_x === true,
    flipY: source.flip_y === true,
    customSize,
    sortingLayer: typeof source.sorting_layer === 'string' ? source.sorting_layer : 'Default',
    sortingOrder: Math.trunc(finite(source.sorting_order, 0)),
    anchor: spriteAnchorFromWire(source.anchor),
  };
}

// ---------------------------------------------------------------------------
// 2D camera
// ---------------------------------------------------------------------------

/**
 * Inbound `CAMERA_2D_CHANGED`. The emitter builds its own camelCase payload, so
 * the field names line up with the store — but `bounds` is an `Option`, and the
 * numbers still need finite guards before they reach an inspector that renders
 * them.
 */
export function parseCamera2dWire(source: unknown): Camera2dData | null {
  if (!isPlainObject(source)) return null;

  let bounds: Camera2dData['bounds'] = null;
  if (isPlainObject(source.bounds)) {
    bounds = {
      minX: finite(source.bounds.minX, 0),
      maxX: finite(source.bounds.maxX, 0),
      minY: finite(source.bounds.minY, 0),
      maxY: finite(source.bounds.maxY, 0),
    };
  }

  return {
    zoom: finite(source.zoom, 1),
    pixelPerfect: source.pixelPerfect === true,
    bounds,
  };
}

// ---------------------------------------------------------------------------
// Tilemaps
// ---------------------------------------------------------------------------

/**
 * Inbound `TILEMAP_CHANGED`. `TilemapData` carries `rename_all`, so the field
 * names and the `origin` spelling already match the store; what needs checking is
 * the structure, because a cast would let a malformed `layers` reach a panel that
 * indexes into `layers[i].tiles`.
 *
 * Deliberately structural and NOT per-tile: `tiles` is a flat `width * height`
 * array and the inspector permits 1000x1000, so validating every scalar would be
 * a million checks per event on a payload the engine itself produced. Layer count
 * is small, so each layer's own shape IS checked.
 */
export function parseTilemapWire(source: unknown): TilemapData | null {
  if (!isPlainObject(source)) return null;
  if (typeof source.tilesetAssetId !== 'string') return null;
  if (!Array.isArray(source.layers)) return null;

  const [tileW, tileH] = numTuple(source.tileSize, 2, 0);
  const [mapW, mapH] = numTuple(source.mapSize, 2, 0);

  const layers: TilemapLayer[] = [];
  for (let i = 0; i < source.layers.length; i += 1) {
    const raw = source.layers[i];
    if (!isPlainObject(raw)) return null;
    if (!Array.isArray(raw.tiles)) return null;
    layers.push({
      name: typeof raw.name === 'string' ? raw.name : `Layer ${i + 1}`,
      tiles: raw.tiles as (number | null)[],
      visible: raw.visible !== false,
      opacity: finite(raw.opacity, 1),
      isCollision: raw.isCollision === true,
    });
  }

  return {
    tilesetAssetId: source.tilesetAssetId,
    tileSize: [tileW, tileH],
    mapSize: [mapW, mapH],
    layers,
    origin: source.origin === 'Center' ? 'Center' : 'TopLeft',
  };
}
