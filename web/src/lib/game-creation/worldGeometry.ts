/**
 * World geometry — the model-authored `worldConfig` turned into concrete spawn
 * descriptors (PF-1138).
 *
 * `worldConfig` used to be accepted by the `scene_create` schema and then
 * dropped on the floor: the executor's own comment said so. The consequence was
 * that EVERY generated game was an empty room — the player and the collectibles
 * were spawned into a void with no ground under them.
 *
 * This module is deliberately PURE. It takes an untrusted config bag and returns
 * a list of descriptors plus a list of warnings; it dispatches nothing, imports
 * no store, and holds no engine handle. That is what makes the hostile-input
 * cases (NaN, Infinity, negative sizes, absurd counts, inherited keys, sparse
 * arrays) testable at all.
 *
 * RSC boundary: this file is reachable from `/api/game/decompose` through the
 * executor/system barrels, so it must never take a VALUE import on `@/stores/…`
 * or `@/hooks/useEngine`. It currently imports nothing at all.
 *
 * Three constraints from the engine shape every number that leaves here:
 *
 *  1. `update_transform` REJECTS the entire command if any scale component has
 *     `abs < f32::EPSILON`, or if any position/scale component is non-finite.
 *     `dispatchCommand` returns void, so that rejection would be invisible — a
 *     zero-width platform would silently take the whole transform with it.
 *  2. The payload is deserialized into `f32`. A value past the f32 range becomes
 *     `inf` on the Rust side and trips the same finite check, so an "absurd but
 *     finite" JS number is not safe merely for being finite in JS.
 *  3. `spawn_entity` carries `position` but has no `scale` field, so sizing an
 *     entity always costs a second command.
 *
 * Geometry is built from `cube` primitives in both project types. `plane` is
 * spawnable but is a zero-thickness XZ quad, which is invisible edge-on in the
 * side view a 2D game uses; a cube reads correctly from every angle and takes a
 * real scale on all three axes.
 */

// ---------------------------------------------------------------------------
// Descriptor shape
// ---------------------------------------------------------------------------

export type WorldDescriptorRole = 'ground' | 'platform' | 'wall';

/** One entity to spawn. Carries no id — ids are minted at plan time. */
export interface WorldEntityDescriptor {
  role: WorldDescriptorRole;
  name: string;
  entityType: 'cube';
  /** World-space [x, y, z]. */
  position: [number, number, number];
  /** Non-uniform [x, y, z]; every component is >= MIN_SCALE. */
  scale: [number, number, number];
}

export interface WorldGeometryResult {
  descriptors: WorldEntityDescriptor[];
  /** Player-facing reasons a piece of the config had no effect. */
  warnings: string[];
}

export interface WorldGeometryInput {
  worldType?: unknown;
  worldConfig?: unknown;
  projectType: '2d' | '3d';
}

// ---------------------------------------------------------------------------
// Bounds. Every one of these exists because the engine rejects, or the player
// cannot see, what lies outside it.
// ---------------------------------------------------------------------------

/** Anything past this is a typo, not a level. Also keeps us inside f32. */
const MAX_ABS_COORD = 10_000;
/** `abs < f32::EPSILON` is a hard reject; 0.01 is comfortably clear of it. */
const MIN_SCALE = 0.01;
const MAX_SCALE = 1000;

const MIN_GROUND = 4;
const MAX_GROUND = 400;

const DEFAULT_GROUND_3D = 40;
const DEFAULT_GROUND_2D = 60;
const GROUND_THICKNESS = 1;

const DEFAULT_PLATFORM_WIDTH = 6;
const DEFAULT_PLATFORM_HEIGHT = 1;
const DEFAULT_PLATFORM_DEPTH = 6;

const DEFAULT_WALL_HEIGHT = 4;
const MAX_WALL_HEIGHT = 100;
const WALL_THICKNESS = 1;

/** A world type that reads as a platformer gets a run of platforms for free. */
const INFERRED_PLATFORM_COUNT = 5;

export const MAX_PLATFORMS = 24;
/** Ground + platforms + walls. A generated scene is not a voxel engine. */
export const MAX_WORLD_DESCRIPTORS = 64;

const SIZE_KEYWORDS: Record<string, number> = {
  tiny: 12,
  small: 20,
  medium: 40,
  large: 80,
  huge: 160,
};

// ---------------------------------------------------------------------------
// Config vocabulary. An LLM spells the same idea several ways, so each concept
// owns a list rather than a single key.
// ---------------------------------------------------------------------------

const WIDTH_KEYS = ['width', 'worldWidth', 'levelWidth', 'gridWidth', 'sizeX', 'columns', 'cols'];
const DEPTH_KEYS = ['depth', 'worldDepth', 'levelDepth', 'gridDepth', 'sizeZ', 'rows'];
const HEIGHT_KEYS = ['height', 'worldHeight', 'levelHeight', 'gridHeight', 'sizeY'];
const SIZE_KEYS = ['size', 'worldSize', 'levelSize'];
const TILE_SIZE_KEYS = ['tileSize', 'cellSize', 'gridSize'];
const PLATFORM_LIST_KEYS = ['platforms', 'platformList', 'ledges'];
const PLATFORM_COUNT_KEYS = ['platformCount', 'numPlatforms', 'platformNum', 'ledgeCount'];
const BOUNDS_KEYS = ['bounds', 'walls', 'boundaries', 'enclosed', 'bounded', 'worldBounds'];

const PLATFORM_WIDTH_KEYS = ['width', 'w', 'sizeX'];
const PLATFORM_HEIGHT_KEYS = ['height', 'h', 'thickness', 'sizeY'];
const PLATFORM_DEPTH_KEYS = ['depth', 'd', 'sizeZ'];

const PLATFORMER_WORLD_TYPE = /platform|side[\s_-]?scroll|jump|parkour/i;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Snap to 3 decimals so a derived coordinate is a number, not float noise. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function coord(value: number): number {
  return round3(clamp(value, -MAX_ABS_COORD, MAX_ABS_COORD));
}

function scaleAxis(value: number): number {
  return round3(clamp(value, MIN_SCALE, MAX_SCALE));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a strictly positive finite number under any of `keys`.
 *
 * `Object.hasOwn`, never a bare index: `config['constructor']` resolves up the
 * prototype chain, so a bare read can hand back a function as a world size.
 *
 * A key that is PRESENT but unusable is reported, because that is a design
 * decision that silently did nothing — exactly the failure this module exists
 * to end.
 */
function readPositive(
  config: Record<string, unknown>,
  keys: string[],
  consumed: Set<string>,
  warnings: string[],
  label: string,
): number | null {
  let found: number | null = null;

  for (const key of keys) {
    if (!Object.hasOwn(config, key)) continue;
    consumed.add(key);

    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      if (found === null) {
        found = value;
      } else if (value !== found) {
        // Two spellings, both usable, disagreeing. Key order decides, which is
        // deterministic but arbitrary from the design's point of view — and the
        // number that lost is the likelier authoring mistake of the two.
        warnings.push(
          `The world's ${label} was given two different values and "${key}" (${describe(value)}) was not the one used; ${describe(found)} was.`,
        );
      }
      continue;
    }
    // The consequence differs depending on whether another spelling of the same
    // concept already supplied a usable number, and saying "the default was
    // used" when it was not is a false explanation of the game the user got.
    warnings.push(
      found === null
        ? `The world's ${label} was set to a value the engine cannot use ("${describe(value)}"), so the default was used instead.`
        : `The world's ${label} was written twice and one spelling ("${key}") was a value the engine cannot use ("${describe(value)}"), so the usable one was kept.`,
    );
  }

  return found;
}

/**
 * Only a real boolean. A truthy string is not a design decision.
 *
 * A present-but-unusable key is reported for the same reason `readPositive`
 * reports one, and here it matters more: the key is marked consumed, so the
 * leftover-key sweep at the end will not mention it either. Without this the
 * design asks for walls, gets an open level, and nothing anywhere says why.
 */
function readBoolean(
  config: Record<string, unknown>,
  keys: string[],
  consumed: Set<string>,
  warnings: string[],
  label: string,
): boolean {
  let found: boolean | null = null;

  for (const key of keys) {
    if (!Object.hasOwn(config, key)) continue;
    consumed.add(key);

    const value = config[key];
    if (typeof value === 'boolean') {
      if (found === null) {
        found = value;
      } else if (value !== found) {
        warnings.push(
          `The design both asked for and declined ${label}; "${key}" (${describe(value)}) was not the one used.`,
        );
      }
      continue;
    }
    warnings.push(
      found === null
        ? `The design asked for ${label} with a value the engine cannot read as yes or no ("${describe(value)}"), so it was treated as no.`
        : `The design asked for ${label} twice and one spelling ("${key}") was a value the engine cannot read as yes or no ("${describe(value)}"), so the usable one was kept.`,
    );
  }

  return found ?? false;
}

function describe(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.slice(0, 40);
  if (value === null) return 'null';
  return typeof value;
}

/** A positive finite number read out of an entry bag, or `null`. */
function entryNumber(entry: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!Object.hasOwn(entry, key)) continue;
    const value = entry[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/** A finite (possibly negative) coordinate read out of an entry bag. */
function entryCoord(entry: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!Object.hasOwn(entry, key)) continue;
    const value = entry[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Size resolution
// ---------------------------------------------------------------------------

function readSizeKeyword(
  config: Record<string, unknown>,
  consumed: Set<string>,
  warnings: string[],
): number | null {
  for (const key of SIZE_KEYS) {
    if (!Object.hasOwn(config, key)) continue;
    consumed.add(key);

    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value === 'string') {
      const keyword = value.trim().toLowerCase();
      if (Object.hasOwn(SIZE_KEYWORDS, keyword)) return SIZE_KEYWORDS[keyword];
    }
    warnings.push(
      `The world size "${describe(value)}" was not recognized, so the default size was used.`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

interface PlatformSpec {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

/**
 * Parse one entry of an authored platform list.
 *
 * Returns `null` for anything unusable — including a HOLE, which arrives here as
 * `undefined` only because the caller reads by index. `.map`/`.filter`/`.every`
 * skip holes outright, so a callback-based reader would report the list fully
 * processed while quietly losing a slot; `.map` is worse still, since it
 * PRESERVES the hole positionally and hands it to a `for...of` downstream as
 * `undefined`. A JSON round trip turns a hole into `null`, so both spellings are
 * rejected here.
 */
function parsePlatformEntry(entry: unknown, is2d: boolean): PlatformSpec | null {
  let x: number | null = null;
  let y: number | null = null;
  let z: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let depth: number | null = null;

  if (Array.isArray(entry)) {
    // Indexed reads: a nested hole is as real as an outer one.
    const ax = entry.length > 0 ? entry[0] : undefined;
    const ay = entry.length > 1 ? entry[1] : undefined;
    const az = entry.length > 2 ? entry[2] : undefined;
    if (typeof ax === 'number' && Number.isFinite(ax)) x = ax;
    if (typeof ay === 'number' && Number.isFinite(ay)) y = ay;
    if (typeof az === 'number' && Number.isFinite(az)) z = az;
  } else if (isPlainRecord(entry)) {
    x = entryCoord(entry, ['x', 'posX', 'left']);
    y = entryCoord(entry, ['y', 'posY', 'top']);
    z = entryCoord(entry, ['z', 'posZ']);
    width = entryNumber(entry, PLATFORM_WIDTH_KEYS);
    height = entryNumber(entry, PLATFORM_HEIGHT_KEYS);
    depth = entryNumber(entry, PLATFORM_DEPTH_KEYS);
  } else {
    return null;
  }

  if (x === null || y === null) return null;

  return {
    x,
    y,
    z: is2d ? 0 : (z ?? 0),
    width: width ?? DEFAULT_PLATFORM_WIDTH,
    height: height ?? DEFAULT_PLATFORM_HEIGHT,
    depth: is2d ? 1 : (depth ?? DEFAULT_PLATFORM_DEPTH),
  };
}

/**
 * A run of evenly-spaced platforms across the world, rising in a three-step
 * staircase. Deterministic on purpose — a generated level a player can learn
 * beats a random one they cannot.
 */
function generatePlatforms(count: number, groundWidth: number, is2d: boolean): PlatformSpec[] {
  const specs: PlatformSpec[] = [];
  const spacing = groundWidth / (count + 1);
  const half = groundWidth / 2;

  for (let i = 0; i < count; i += 1) {
    specs.push({
      x: -half + (i + 1) * spacing,
      y: 2 + (i % 3) * 2,
      z: 0,
      width: DEFAULT_PLATFORM_WIDTH,
      height: DEFAULT_PLATFORM_HEIGHT,
      depth: is2d ? 1 : DEFAULT_PLATFORM_DEPTH,
    });
  }

  return specs;
}

function toDescriptor(spec: PlatformSpec, index: number): WorldEntityDescriptor {
  return {
    role: 'platform',
    name: `Platform ${index + 1}`,
    entityType: 'cube',
    position: [coord(spec.x), coord(spec.y), coord(spec.z)],
    scale: [scaleAxis(spec.width), scaleAxis(spec.height), scaleAxis(spec.depth)],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildWorldGeometry(input: WorldGeometryInput): WorldGeometryResult {
  const warnings: string[] = [];
  const is2d = input.projectType === '2d';
  const worldType = typeof input.worldType === 'string' ? input.worldType : '';

  let config: Record<string, unknown> = {};
  if (input.worldConfig !== undefined && input.worldConfig !== null) {
    if (isPlainRecord(input.worldConfig)) {
      config = input.worldConfig;
    } else {
      warnings.push(
        'The world description was not in a form the builder could read, so the world was created at its default size.',
      );
    }
  }

  const consumed = new Set<string>();

  // --- ground -------------------------------------------------------------
  const keywordSize = readSizeKeyword(config, consumed, warnings);
  const rawWidth = readPositive(config, WIDTH_KEYS, consumed, warnings, 'width');
  const rawDepth = readPositive(config, DEPTH_KEYS, consumed, warnings, 'depth');
  const rawHeight = readPositive(config, HEIGHT_KEYS, consumed, warnings, 'height');

  // Tile size is recognized so it is not reported as gibberish, but it is not
  // applied: a `tileSize` of 32 is a PIXEL measurement, and multiplying a 40-tile
  // grid by it would ask the engine for a 1280-metre floor. One tile is one unit.
  for (const key of TILE_SIZE_KEYS) {
    if (!Object.hasOwn(config, key)) continue;
    consumed.add(key);
    warnings.push(
      `The tile size was not applied — the world is measured in engine units, one unit per tile.`,
    );
  }

  const defaultGround = is2d ? DEFAULT_GROUND_2D : DEFAULT_GROUND_3D;
  const groundWidth = clamp(rawWidth ?? keywordSize ?? defaultGround, MIN_GROUND, MAX_GROUND);

  let groundDepth = GROUND_THICKNESS;
  if (is2d) {
    if (rawDepth !== null) {
      warnings.push(
        'The world depth was left out: a 2D game is seen from the side, so only width and height are visible.',
      );
    }
  } else {
    groundDepth = clamp(rawDepth ?? keywordSize ?? defaultGround, MIN_GROUND, MAX_GROUND);
  }

  const descriptors: WorldEntityDescriptor[] = [
    {
      role: 'ground',
      name: 'Ground',
      entityType: 'cube',
      position: [0, round3(-GROUND_THICKNESS / 2), 0],
      scale: [scaleAxis(groundWidth), scaleAxis(GROUND_THICKNESS), scaleAxis(groundDepth)],
    },
  ];

  // --- platforms ----------------------------------------------------------
  let specs: PlatformSpec[] = [];
  let authoredList: unknown = undefined;

  for (const key of PLATFORM_LIST_KEYS) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (Array.isArray(value)) {
      consumed.add(key);
      if (authoredList === undefined) authoredList = value;
      continue;
    }
    // `platforms: 5` is the count spelling of the same key.
    if (typeof value === 'number') continue;
    consumed.add(key);
    warnings.push(
      `The list of platforms was not in a readable form ("${describe(value)}"), so no platforms were placed.`,
    );
  }

  if (Array.isArray(authoredList)) {
    let dropped = 0;
    // Indexed loop, never `.map`/`.filter` — see parsePlatformEntry.
    for (let i = 0; i < authoredList.length; i += 1) {
      if (specs.length >= MAX_PLATFORMS) {
        dropped += authoredList.length - i;
        break;
      }
      const spec = parsePlatformEntry(authoredList[i], is2d);
      if (spec === null) {
        dropped += 1;
        continue;
      }
      specs.push(spec);
    }
    if (dropped > 0) {
      warnings.push(
        `${dropped} platform${dropped === 1 ? '' : 's'} in the design could not be placed and ${dropped === 1 ? 'was' : 'were'} left out.`,
      );
    }
  } else {
    const rawCount =
      readPositive(config, PLATFORM_COUNT_KEYS, consumed, warnings, 'platform count') ??
      readPlatformsAsCount(config, consumed);

    let count = rawCount === null ? 0 : Math.floor(rawCount);
    if (count > MAX_PLATFORMS) {
      warnings.push(
        `The design asked for ${count} platforms; only the first ${MAX_PLATFORMS} were placed.`,
      );
      count = MAX_PLATFORMS;
    }

    if (count === 0 && rawCount === null && PLATFORMER_WORLD_TYPE.test(worldType)) {
      count = INFERRED_PLATFORM_COUNT;
    }

    if (count > 0) specs = generatePlatforms(count, groundWidth, is2d);
  }

  for (let i = 0; i < specs.length; i += 1) {
    descriptors.push(toDescriptor(specs[i], i));
  }

  // --- bounds -------------------------------------------------------------
  const wantsBounds = readBoolean(config, BOUNDS_KEYS, consumed, warnings, 'walls around the level');
  if (wantsBounds) {
    const wallHeight = clamp(rawHeight ?? DEFAULT_WALL_HEIGHT, MIN_SCALE, MAX_WALL_HEIGHT);
    const halfWidth = groundWidth / 2;
    const y = round3(wallHeight / 2);

    if (is2d) {
      descriptors.push(wall('Wall East', halfWidth, y, 0, WALL_THICKNESS, wallHeight, 1));
      descriptors.push(wall('Wall West', -halfWidth, y, 0, WALL_THICKNESS, wallHeight, 1));
    } else {
      const halfDepth = groundDepth / 2;
      descriptors.push(wall('Wall North', 0, y, -halfDepth, groundWidth, wallHeight, WALL_THICKNESS));
      descriptors.push(wall('Wall South', 0, y, halfDepth, groundWidth, wallHeight, WALL_THICKNESS));
      descriptors.push(wall('Wall East', halfWidth, y, 0, WALL_THICKNESS, wallHeight, groundDepth));
      descriptors.push(wall('Wall West', -halfWidth, y, 0, WALL_THICKNESS, wallHeight, groundDepth));
    }
  } else if (rawHeight !== null) {
    warnings.push(
      'The world height had no effect: the design did not ask for walls around the level.',
    );
  }

  // --- leftovers ----------------------------------------------------------
  const unknownKeys: string[] = [];
  for (const key of Object.keys(config)) {
    if (consumed.has(key)) continue;
    unknownKeys.push(key);
  }
  if (unknownKeys.length > 0) {
    warnings.push(
      `Part of the world description could not be built yet and was skipped: ${unknownKeys.slice(0, 8).join(', ')}.`,
    );
  }

  // Unreachable by construction today: the maximum this builder can emit is one
  // ground + MAX_PLATFORMS platforms + the bounding walls, which is well under
  // the cap. It stays as a backstop for a future descriptor source, and
  // `worldGeometry.test.ts` pins the arithmetic so raising MAX_PLATFORMS past
  // the cap reddens a test rather than silently arming a path nothing has run.
  if (descriptors.length > MAX_WORLD_DESCRIPTORS) {
    warnings.push(
      `The world description produced more than ${MAX_WORLD_DESCRIPTORS} objects; the extra ones were left out.`,
    );
    descriptors.length = MAX_WORLD_DESCRIPTORS;
  }

  return { descriptors, warnings };
}

/** `platforms: 5` — the same key spelled as a count instead of a list. */
function readPlatformsAsCount(
  config: Record<string, unknown>,
  consumed: Set<string>,
): number | null {
  for (const key of PLATFORM_LIST_KEYS) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      consumed.add(key);
      return value;
    }
  }
  return null;
}

function wall(
  name: string,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
): WorldEntityDescriptor {
  return {
    role: 'wall',
    name,
    entityType: 'cube',
    position: [coord(x), coord(y), coord(z)],
    scale: [scaleAxis(sx), scaleAxis(sy), scaleAxis(sz)],
  };
}
