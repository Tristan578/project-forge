/**
 * Pins the 2D-physics payload builders AND the hand-mirrored engine tables in
 * `physics2dPayload.ts` against `engine/src/core/physics_2d.rs`.
 *
 * The drift half of this suite exists because the TS suite cannot call Rust and
 * `cargo test` cannot see a TS constant, so a table mirroring engine state has no
 * compiler holding the two sides together — exactly how `ENGINE_CAMERA_DEFAULTS`
 * drifted on two of eight entries before anything read it (PF-1126). The Rust file
 * is therefore read textually. Every parse failure is a test failure, never a skip:
 * a suite that silently stops checking when its input moves is worse than no suite,
 * because it still reports green.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PHYSICS2D_PATCH_KEYS,
  defaultPhysics2dData,
  buildSetPhysics2dPayload,
  buildUpdatePhysics2dPayload,
  parsePhysics2dWire,
} from '../physics2dPayload';
import type { Physics2dData } from '@/stores/slices/types';

const RUST_PATH = path.resolve(__dirname, '../../../../../engine/src/core/physics_2d.rs');

function readRust(): string {
  let source: string;
  try {
    source = readFileSync(RUST_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read ${RUST_PATH}: ${err instanceof Error ? err.message : String(err)}. ` +
        'This suite pins TypeScript tables against the Rust source — if the file moved, ' +
        'repoint RUST_PATH rather than deleting the assertions.',
    );
  }
  if (source.length === 0) {
    throw new Error(`${RUST_PATH} is empty — refusing to pass vacuously.`);
  }
  return source;
}

/** Extract the body of a braced block that starts at the given match. */
function blockAfter(source: string, header: RegExp, label: string): string {
  const match = header.exec(source);
  if (!match) {
    throw new Error(`Could not find ${label} in physics_2d.rs — the pin cannot be evaluated.`);
  }
  const open = source.indexOf('{', match.index + match[0].length - 1);
  if (open === -1) throw new Error(`No opening brace for ${label}.`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`Unbalanced braces while reading ${label}.`);
}

/** snake_case -> camelCase, matching serde's `rename_all = "camelCase"`. */
function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * PascalCase serde variant -> the snake_case value the store vocabulary uses.
 *
 * Derived rather than tabulated so the expectation cannot drift into agreement
 * with the implementation: `ConvexPolygon` must become `convex_polygon`, and a
 * lowercase-only mapping (`convexpolygon`) is a value no consumer can match.
 */
function toSnake(pascal: string): string {
  return pascal.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Field name -> raw Rust initializer text. Only top-level `name: value,` pairs
 * are taken, so a nested `vec![]` or `[1.0, 1.0]` stays intact as one value.
 */
function topLevelPairs(block: string): Map<string, string> {
  const pairs = new Map<string, string>();
  const record = (chunk: string) => {
    const pair = chunk.trim();
    if (pair.length === 0) return;
    const colon = pair.indexOf(':');
    if (colon === -1) return;
    pairs.set(pair.slice(0, colon).trim(), pair.slice(colon + 1).trim());
  };

  let depth = 0;
  let buffer = '';
  for (const char of block) {
    if (char === '[' || char === '(' || char === '{') depth += 1;
    if (char === ']' || char === ')' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      record(buffer);
      buffer = '';
      continue;
    }
    buffer += char;
  }
  record(buffer);
  return pairs;
}

/** The `impl Default for Physics2dData` initializers, keyed by Rust field name. */
function rustDefaultFields(): Map<string, string> {
  return topLevelPairs(
    blockAfter(
      readRust(),
      /impl\s+Default\s+for\s+Physics2dData\s*\{[\s\S]*?fn\s+default\s*\(\s*\)\s*->\s*Self\s*\{\s*Self\s*\{/,
      'impl Default for Physics2dData',
    ),
  );
}

/** The variant names declared by a `pub enum <name>` in physics_2d.rs. */
function rustEnumVariants(name: string): string[] {
  const block = blockAfter(readRust(), new RegExp(`pub\\s+enum\\s+${name}\\s*\\{`), `enum ${name}`);
  const variants = [...block.matchAll(/^\s*([A-Z][A-Za-z0-9]*)\s*,/gm)].map((m) => m[1]);
  if (variants.length === 0) {
    throw new Error(`Parsed no variants out of enum ${name} — refusing to pass vacuously.`);
  }
  return variants;
}

describe('Physics2dData default table vs the Rust engine', () => {
  const rustDefaults = rustDefaultFields();

  it('parsed a plausible default block', () => {
    // Guards the parser itself: an initializer shape it cannot read would otherwise
    // yield an empty map, and every per-field assertion below would vacuously pass.
    expect(rustDefaults.size).toBe(PHYSICS2D_PATCH_KEYS.length);
  });

  it('covers every field the patch carries, and no others', () => {
    const rustCamel = [...rustDefaults.keys()].map(toCamel).sort();
    expect(rustCamel).toEqual([...PHYSICS2D_PATCH_KEYS].sort());
  });

  it.each([
    ['body_type', 'BodyType2d::Dynamic', 'dynamic'],
    ['collider_shape', 'ColliderShape2d::Box', 'box'],
    ['radius', '0.5', 0.5],
    ['mass', '1.0', 1],
    ['friction', '0.5', 0.5],
    ['restitution', '0.0', 0],
    ['gravity_scale', '1.0', 1],
    ['is_sensor', 'false', false],
    ['lock_rotation', 'false', false],
    ['continuous_detection', 'false', false],
    ['one_way_platform', 'false', false],
  ])('%s defaults to %s in Rust and %o in TS', (rustField, expectedRust, expectedTs) => {
    expect(rustDefaults.get(rustField)).toBe(expectedRust);
    const ts = defaultPhysics2dData() as unknown as Record<string, unknown>;
    expect(ts[toCamel(rustField)]).toBe(expectedTs);
  });

  it.each([
    ['size', '[1.0, 1.0]', [1, 1]],
    ['surface_velocity', '[0.0, 0.0]', [0, 0]],
    ['vertices', 'vec![]', []],
  ])('%s defaults to %s in Rust and %o in TS', (rustField, expectedRust, expectedTs) => {
    expect(rustDefaults.get(rustField)).toBe(expectedRust);
    const ts = defaultPhysics2dData() as unknown as Record<string, unknown>;
    expect(ts[toCamel(rustField)]).toEqual(expectedTs);
  });

  it('hands out a fresh object so a caller cannot mutate shared state', () => {
    const first = defaultPhysics2dData();
    first.size[0] = 99;
    expect(defaultPhysics2dData().size).toEqual([1, 1]);
  });
});

describe('Physics2dPatch field set vs the Rust struct', () => {
  const source = readRust();
  const patchBlock = blockAfter(
    source,
    /pub\s+struct\s+Physics2dPatch\s*\{/,
    'pub struct Physics2dPatch',
  );

  it('declares exactly the fields the TS allowlist carries', () => {
    // `pub name: Option<...>` lines only; attributes and doc comments are skipped
    // because they never match the `pub <ident>:` shape.
    const fields = [...patchBlock.matchAll(/^\s*pub\s+([a-z0-9_]+)\s*:/gm)].map((m) =>
      toCamel(m[1]),
    );
    expect(fields.length).toBeGreaterThan(0);
    expect([...fields].sort()).toEqual([...PHYSICS2D_PATCH_KEYS].sort());
  });
});

describe('enum variant tables vs the Rust enums', () => {
  const bodyTypes = rustEnumVariants('BodyType2d');
  const colliderShapes = rustEnumVariants('ColliderShape2d');

  it.each([
    ['BodyType2d', bodyTypes, ['Dynamic', 'Static', 'Kinematic']],
    [
      'ColliderShape2d',
      colliderShapes,
      ['Box', 'Circle', 'Capsule', 'ConvexPolygon', 'Edge', 'Auto'],
    ],
  ])('%s declares exactly the variants the wire parser maps', (_name, parsed, expected) => {
    expect([...parsed].sort()).toEqual([...expected].sort());
  });

  // The variant list comes from the Rust enum, not a literal here, so a variant
  // added to the engine and not to the TS table fails this rather than sitting
  // unmapped. And the expectation is the EXACT mapped value, not `toBeDefined()`:
  // presence is the weak half of the property, and it is satisfied by `Kinematic`
  // mapping to `'static'` — a body the simulation moves being reported as one it
  // never will. Same weakness class as `expect.objectContaining` (PF-1167).
  it.each(bodyTypes)('maps body type %s to its store value', (variant) => {
    const parsed = parsePhysics2dWire({ entityId: 'e1', body_type: variant });
    expect(parsed?.data.bodyType).toBe(toSnake(variant));
  });

  it.each(colliderShapes)('maps collider shape %s to its store value', (variant) => {
    const parsed = parsePhysics2dWire({ entityId: 'e1', collider_shape: variant });
    expect(parsed?.data.colliderShape).toBe(toSnake(variant));
  });
});

describe('buildUpdatePhysics2dPayload', () => {
  it('emits only the fields the caller set', () => {
    // toEqual, not objectContaining: the payload IS the behaviour here, and
    // objectContaining is blind to an invented key sitting alongside a correct one.
    expect(buildUpdatePhysics2dPayload('e1', { gravityScale: 0 })).toEqual({
      entityId: 'e1',
      gravityScale: 0,
    });
  });

  it('keeps a legitimate zero rather than treating it as absent', () => {
    const payload = buildUpdatePhysics2dPayload('e1', { friction: 0, restitution: 0 });
    expect(payload).toEqual({ entityId: 'e1', friction: 0, restitution: 0 });
  });

  it('drops keys the engine has no field for', () => {
    const rogue = { bodyType: 'static', gravtiyScale: 3, hp: 10 } as unknown as Partial<Physics2dData>;
    expect(buildUpdatePhysics2dPayload('e1', rogue)).toEqual({ entityId: 'e1', bodyType: 'static' });
  });

  it('ignores an explicitly-undefined field instead of sending null', () => {
    const payload = buildUpdatePhysics2dPayload('e1', { mass: undefined, friction: 0.9 });
    expect(payload).toEqual({ entityId: 'e1', friction: 0.9 });
  });

  it('does not forward inherited values from a prototype-polluted patch', () => {
    const polluted = Object.create({ mass: 999 }) as Partial<Physics2dData>;
    polluted.friction = 0.2;
    expect(buildUpdatePhysics2dPayload('e1', polluted)).toEqual({ entityId: 'e1', friction: 0.2 });
  });
});

describe('buildSetPhysics2dPayload', () => {
  it('nests the patch under physicsData', () => {
    expect(buildSetPhysics2dPayload('e1', { bodyType: 'static' })).toEqual({
      entityId: 'e1',
      physicsData: { bodyType: 'static' },
    });
  });

  it('omits enabled entirely when the caller did not pass one', () => {
    // An `enabled: undefined` key would deserialize to `Some(false)` nowhere, but it
    // does make the payload claim to speak about the enabled state; the engine reads
    // an absent field as "leave it alone", so absence must be literal.
    const payload = buildSetPhysics2dPayload('e1', { mass: 2 });
    expect('enabled' in payload).toBe(false);
  });

  it('emits enabled for both boolean values', () => {
    expect(buildSetPhysics2dPayload('e1', {}, true)).toEqual({
      entityId: 'e1',
      physicsData: {},
      enabled: true,
    });
    expect(buildSetPhysics2dPayload('e1', {}, false)).toEqual({
      entityId: 'e1',
      physicsData: {},
      enabled: false,
    });
  });
});

describe('parsePhysics2dWire', () => {
  it('translates the flattened snake_case event into store vocabulary', () => {
    const parsed = parsePhysics2dWire({
      entityId: 'e1',
      enabled: true,
      body_type: 'Static',
      collider_shape: 'ConvexPolygon',
      gravity_scale: 0,
      is_sensor: true,
      surface_velocity: [3, 0],
    });
    expect(parsed).toEqual({
      entityId: 'e1',
      enabled: true,
      data: {
        bodyType: 'static',
        colliderShape: 'convex_polygon',
        gravityScale: 0,
        isSensor: true,
        surfaceVelocity: [3, 0],
      },
    });
  });

  /**
   * One wire value per field, keyed by the store's camelCase name.
   *
   * Every value differs from the engine default, so a field silently dropped by a
   * mis-spelled `WIRE_KEY_BY_FIELD` entry cannot coincidentally match what the
   * store would have held anyway.
   */
  const WIRE_SAMPLES: Record<string, { wire: unknown; parsed: unknown }> = {
    bodyType: { wire: 'Kinematic', parsed: 'kinematic' },
    colliderShape: { wire: 'ConvexPolygon', parsed: 'convex_polygon' },
    size: { wire: [3, 4], parsed: [3, 4] },
    radius: { wire: 1.25, parsed: 1.25 },
    mass: { wire: 9, parsed: 9 },
    friction: { wire: 0.125, parsed: 0.125 },
    restitution: { wire: 0.875, parsed: 0.875 },
    gravityScale: { wire: 0, parsed: 0 },
    isSensor: { wire: true, parsed: true },
    lockRotation: { wire: true, parsed: true },
    continuousDetection: { wire: true, parsed: true },
    oneWayPlatform: { wire: true, parsed: true },
    surfaceVelocity: { wire: [-2, 5], parsed: [-2, 5] },
    vertices: {
      wire: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      parsed: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    },
  };

  it('has a sample for every field the Rust struct declares, and no others', () => {
    // Keeps the round-trip below honest as the struct grows: a field added in Rust
    // has no sample, fails here, and gets one — rather than quietly staying outside
    // the only test that proves its wire key is spelled correctly.
    const rustCamel = [...rustDefaultFields().keys()].map(toCamel).sort();
    expect(Object.keys(WIRE_SAMPLES).sort()).toEqual(rustCamel);
  });

  it('round-trips every field, with the wire key taken from the Rust field name', () => {
    // The full field set, not a representative five. `WIRE_KEY_BY_FIELD`'s values
    // are unconstrained `string`s — `satisfies Record<keyof Physics2dData, string>`
    // constrains the KEYS only — so a stale or mistyped snake_case spelling
    // type-checks cleanly and reads `undefined` at runtime. Deriving each wire key
    // from the Rust field name here is the only thing that can catch that.
    const wire: Record<string, unknown> = { entityId: 'e1', enabled: true };
    const expected: Record<string, unknown> = {};
    for (const rustField of rustDefaultFields().keys()) {
      const field = toCamel(rustField);
      const sample = WIRE_SAMPLES[field];
      wire[rustField] = sample.wire;
      expected[field] = sample.parsed;
    }

    expect(parsePhysics2dWire(wire)).toEqual({ entityId: 'e1', enabled: true, data: expected });
  });

  it('returns null without a usable entityId', () => {
    expect(parsePhysics2dWire({ enabled: true })).toBeNull();
    expect(parsePhysics2dWire({ entityId: '' })).toBeNull();
    expect(parsePhysics2dWire({ entityId: 7 })).toBeNull();
    expect(parsePhysics2dWire(null)).toBeNull();
    expect(parsePhysics2dWire('e1')).toBeNull();
  });

  it('drops an unrecognised enum variant rather than defaulting it', () => {
    // Defaulting would be indistinguishable from the engine reporting that value,
    // and 'dynamic' is the one value that makes a platform fall out of the world.
    const parsed = parsePhysics2dWire({ entityId: 'e1', body_type: 'Ragdoll', mass: 4 });
    expect(parsed?.data).toEqual({ mass: 4 });
  });

  it('ignores camelCase data keys — the flattened struct never emits them', () => {
    const parsed = parsePhysics2dWire({ entityId: 'e1', gravityScale: 0.25 });
    expect(parsed?.data).toEqual({});
  });

  it('skips null and undefined values', () => {
    const parsed = parsePhysics2dWire({ entityId: 'e1', mass: null, friction: undefined, radius: 2 });
    expect(parsed?.data).toEqual({ radius: 2 });
  });

  it('treats a missing or non-true enabled as disabled', () => {
    expect(parsePhysics2dWire({ entityId: 'e1' })?.enabled).toBe(false);
    expect(parsePhysics2dWire({ entityId: 'e1', enabled: 'yes' })?.enabled).toBe(false);
  });

  it('does not read inherited wire keys', () => {
    const polluted = Object.create({ mass: 999 }) as Record<string, unknown>;
    polluted.entityId = 'e1';
    expect(parsePhysics2dWire(polluted)?.data).toEqual({});
  });
});
