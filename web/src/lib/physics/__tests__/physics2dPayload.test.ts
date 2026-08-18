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
  JOINT2D_PARAMS_BY_TYPE,
  defaultPhysics2dData,
  buildSetPhysics2dPayload,
  buildSetJoint2dPayload,
  buildUpdatePhysics2dPayload,
  parsePhysics2dWire,
  parseJoint2dWire,
} from '../physics2dPayload';
import type { Joint2dData, Physics2dData } from '@/stores/slices/types';

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

  // The variant tables are plain objects, so a bare `TABLE[raw]` resolves an
  // inherited member for each of these names — and every one is TRUTHY, so the
  // `if (mapped)` guard passes and a `Function` or `Object.prototype` lands where
  // an enum value is declared. That is the hole `variantValue` was added to close,
  // and it is the read direction: these strings arrive in an engine event payload,
  // not from a caller. Reverting `variantValue` to `table[raw]` makes every case
  // below fail with `bodyType`/`colliderShape` set to an inherited value.
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'drops the inherited enum-table member %s instead of mapping it',
    (hostile) => {
      const parsed = parsePhysics2dWire({
        entityId: 'e1',
        body_type: hostile,
        collider_shape: hostile,
        mass: 3,
      });
      // `mass` proves the parse ran rather than bailing out early.
      expect(parsed?.data).toEqual({ mass: 3 });
    },
  );
});

// ===========================================================================
// 2D joints
// ===========================================================================

/**
 * `set_joint_2d` was a hard serde reject on THREE independent axes at once:
 * the engine expected the data nested under `jointData`, read snake_case keys,
 * and typed `jointType` as an externally-tagged enum that can only accept
 * `{"Revolute": {…}}`. The store spread a flat camelCase object with a bare
 * mode string, so every 2D joint the editor ever created was dropped before it
 * reached the simulation while the store kept its own optimistic copy — and
 * `dispatchCommand` returns `void`, so nothing reported it (PF-1167).
 */
describe('buildSetJoint2dPayload', () => {
  function makeJoint(overrides: Partial<Joint2dData> = {}): Joint2dData {
    return {
      targetEntityId: 'entity-b',
      jointType: 'revolute',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
      ...overrides,
    };
  }

  it('builds the flat vocabulary the engine reads', () => {
    expect(
      buildSetJoint2dPayload(
        'entity-a',
        makeJoint({ limits: [-0.5, 0.5], motorVelocity: 3, motorMaxForce: 40 }),
      ),
    ).toEqual({
      entityId: 'entity-a',
      targetEntityId: 'entity-b',
      jointType: 'revolute',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
      limits: [-0.5, 0.5],
      motorVelocity: 3,
      motorMaxForce: 40,
    });
  });

  it('omits params the caller did not set, so the engine applies its own defaults', () => {
    expect(buildSetJoint2dPayload('entity-a', makeJoint())).toEqual({
      entityId: 'entity-a',
      targetEntityId: 'entity-b',
      jointType: 'revolute',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
    });
  });

  it('sends only the params the target variant reads', () => {
    // `maxDistance` belongs to rope and `axis` to prismatic. Forwarding either
    // alongside a spring joint would be silently ignored by `from_flat`.
    const payload = buildSetJoint2dPayload(
      'entity-a',
      makeJoint({ jointType: 'spring', restLength: 2, maxDistance: 99, axis: [0, 1] }),
    );
    expect(payload).toEqual({
      entityId: 'entity-a',
      targetEntityId: 'entity-b',
      jointType: 'spring',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
      restLength: 2,
    });
  });

  // Every variant's params at once. Handing all eight to each variant is what
  // makes the rows below a test of the FILTERING rather than of the pass-through:
  // each one has to keep its own three or four and drop the rest.
  const ALL_JOINT_PARAMS: Partial<Joint2dData> = {
    limits: [-3, 3],
    motorVelocity: 4,
    motorMaxForce: 50,
    axis: [0, 1],
    maxDistance: 5,
    restLength: 2,
    stiffness: 12,
    damping: 0.4,
  };

  const VARIANT_PARAMS: [Joint2dData['jointType'], Partial<Joint2dData>][] = [
    ['revolute', { limits: [-3, 3], motorVelocity: 4, motorMaxForce: 50 }],
    ['prismatic', { axis: [0, 1], limits: [-3, 3], motorVelocity: 4, motorMaxForce: 50 }],
    ['rope', { maxDistance: 5 }],
    ['spring', { restLength: 2, stiffness: 12, damping: 0.4 }],
  ];

  it.each(VARIANT_PARAMS)(
    'carries the %s variant through with only its own params',
    (jointType, expectedParams) => {
      const payload = buildSetJoint2dPayload(
        'entity-a',
        makeJoint({ ...ALL_JOINT_PARAMS, jointType }),
      );
      // `toEqual` on the whole payload rather than a read of `payload.jointType`.
      // The payload IS the behaviour of a builder like this one, and an assertion
      // on one key passes for every shape the builder could emit — including one
      // carrying a foreign variant's params, which is the case these rows exist
      // to rule out.
      expect(payload).toEqual({
        entityId: 'entity-a',
        targetEntityId: 'entity-b',
        jointType,
        localAnchor1: [1, 2],
        localAnchor2: [-1, -2],
        ...expectedParams,
      });
    },
  );

  it('still sends the identity fields when the joint type is unrecognized', () => {
    // The engine rejects by NAME with a message that lists the four valid types,
    // and `reportCommandRejected` surfaces that. Silently dropping the field here
    // would turn a named error into a shapeless one.
    const payload = buildSetJoint2dPayload('entity-a', {
      ...makeJoint(),
      jointType: 'welded' as Joint2dData['jointType'],
    });
    expect(payload).toEqual({
      entityId: 'entity-a',
      targetEntityId: 'entity-b',
      jointType: 'welded',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
    });
  });

  it.each(['constructor', 'toString', 'valueOf', '__proto__'])(
    'does not treat the inherited table member %s as a joint type',
    (hostile) => {
      const payload = buildSetJoint2dPayload('entity-a', {
        ...makeJoint(),
        jointType: hostile as Joint2dData['jointType'],
      });
      // Identity fields only: a bare `TABLE[raw]` would resolve an inherited
      // member here and index `JOINT2D_PARAMS_BY_TYPE` with it.
      expect(Object.keys(payload).sort()).toEqual([
        'entityId',
        'jointType',
        'localAnchor1',
        'localAnchor2',
        'targetEntityId',
      ]);
    },
  );
});

describe('parseJoint2dWire', () => {
  function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      entityId: 'entity-a',
      targetEntityId: 'entity-b',
      jointType: 'revolute',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
      ...overrides,
    };
  }

  it('reads the flat vocabulary the engine emits', () => {
    expect(parseJoint2dWire(wire({ limits: [-1, 1], motorVelocity: 2, motorMaxForce: 30 }))).toEqual(
      {
        entityId: 'entity-a',
        data: {
          targetEntityId: 'entity-b',
          jointType: 'revolute',
          localAnchor1: [1, 2],
          localAnchor2: [-1, -2],
          limits: [-1, 1],
          motorVelocity: 2,
          motorMaxForce: 30,
        },
      },
    );
  });

  it.each([
    ['a non-object payload', 'nope'],
    ['null', null],
    ['a missing entityId', { targetEntityId: 'b', jointType: 'revolute' }],
    ['an empty entityId', wire({ entityId: '' })],
    ['a numeric entityId', wire({ entityId: 7 })],
    ['a missing targetEntityId', { entityId: 'a', jointType: 'revolute' }],
    ['an empty targetEntityId', wire({ targetEntityId: '' })],
    ['a numeric targetEntityId', wire({ targetEntityId: 7 })],
    ['an unknown jointType', wire({ jointType: 'welded' })],
    ['a PascalCase jointType', wire({ jointType: 'Revolute' })],
    ['a missing jointType', { entityId: 'a', targetEntityId: 'b' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseJoint2dWire(payload)).toBeNull();
  });

  it('falls back to a zero anchor rather than dropping the joint', () => {
    const parsed = parseJoint2dWire(wire({ localAnchor1: undefined, localAnchor2: 'nope' }));
    expect(parsed?.data.localAnchor1).toEqual([0, 0]);
    expect(parsed?.data.localAnchor2).toEqual([0, 0]);
  });

  it('drops params that are not finite numbers', () => {
    const parsed = parseJoint2dWire(
      wire({ motorVelocity: Number.NaN, motorMaxForce: '40', limits: [0, Number.POSITIVE_INFINITY] }),
    );
    expect(parsed?.data).toEqual({
      targetEntityId: 'entity-b',
      jointType: 'revolute',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
    });
  });

  it('rejects a gapped anchor array instead of reporting it valid', () => {
    // A hole is skipped by `.every`/`.some`, so a callback-form check would
    // report this pair as two valid numbers (PF-1143). The engine emits dense
    // arrays, but a hole degrades to `null` across a JSON round trip.
    const gapped = [1];
    gapped.length = 2;
    const parsed = parseJoint2dWire(wire({ localAnchor1: gapped }));
    expect(parsed?.data.localAnchor1).toEqual([0, 0]);
    expect(parseJoint2dWire(wire({ localAnchor1: [1, null] }))?.data.localAnchor1).toEqual([0, 0]);
  });

  it('ignores params belonging to a different variant', () => {
    const parsed = parseJoint2dWire(wire({ jointType: 'rope', maxDistance: 5, stiffness: 12 }));
    expect(parsed?.data).toEqual({
      targetEntityId: 'entity-b',
      jointType: 'rope',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
      maxDistance: 5,
    });
  });

  // Every variant, not just the widest one. The builder and the parser each own a
  // per-variant key list, and a round-trip that exercises one variant proves only
  // that those two lists agree about that variant — a key dropped from `rope` or
  // `spring` on either side survives a prismatic-only round-trip untouched.
  const ROUND_TRIP_CASES: Joint2dData[] = [
    {
      targetEntityId: 'entity-b',
      jointType: 'revolute',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
      limits: [-3, 3],
      motorVelocity: 4,
      motorMaxForce: 50,
    },
    {
      targetEntityId: 'entity-b',
      jointType: 'prismatic',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
      axis: [0, 1],
      limits: [-3, 3],
      motorVelocity: 4,
      motorMaxForce: 50,
    },
    {
      targetEntityId: 'entity-b',
      jointType: 'rope',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
      maxDistance: 5,
    },
    {
      targetEntityId: 'entity-b',
      jointType: 'spring',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
      restLength: 2,
      stiffness: 12,
      damping: 0.4,
    },
  ];

  it.each(ROUND_TRIP_CASES)(
    'round-trips a built $jointType payload back into the same joint',
    (data) => {
      expect(parseJoint2dWire(buildSetJoint2dPayload('entity-a', data))).toEqual({
        entityId: 'entity-a',
        data,
      });
    },
  );

  it('does not read an inherited property as a joint param', () => {
    const polluted = Object.create({ maxDistance: 99 }) as Record<string, unknown>;
    Object.assign(polluted, wire({ jointType: 'rope' }));
    expect(parseJoint2dWire(polluted)?.data).toEqual({
      targetEntityId: 'entity-b',
      jointType: 'rope',
      localAnchor1: [1, 2],
      localAnchor2: [-1, -2],
    });
  });
});

/**
 * Drift pin: `JOINT2D_PARAMS_BY_TYPE` must name exactly the keys each
 * `JointType2d::from_flat` arm reads. Sending a key the arm does not name is a
 * silent no-op, and omitting one the arm DOES name makes that parameter
 * unreachable from the editor — neither shows up as a failure anywhere else.
 */
describe('JOINT2D_PARAMS_BY_TYPE vs JointType2d::from_flat', () => {
  function fromFlatArms(): Record<string, string[]> {
    const source = readRust();
    const start = source.indexOf('pub fn from_flat(joint_type: &str');
    if (start === -1) {
      throw new Error(
        'Could not find `JointType2d::from_flat` in physics_2d.rs. If it was renamed, ' +
          'repoint this parser rather than deleting the assertion.',
      );
    }
    const end = source.indexOf('\n    }', start);
    if (end === -1) throw new Error('Could not find the end of `from_flat`.');
    const body = source.slice(start, end);

    const arms: Record<string, string[]> = {};
    // Each arm opens `"<mode>" => Ok(JointType2d::…` and runs to the next arm.
    const armPattern = /"([a-z]+)" => Ok\(/g;
    const starts: Array<{ mode: string; at: number }> = [];
    let match = armPattern.exec(body);
    while (match !== null) {
      starts.push({ mode: match[1], at: match.index });
      match = armPattern.exec(body);
    }
    if (starts.length === 0) throw new Error('Parsed zero `from_flat` arms — refusing to pass.');

    for (let i = 0; i < starts.length; i += 1) {
      const slice = body.slice(starts[i].at, starts[i + 1]?.at ?? body.length);
      const keys: string[] = [];
      const keyPattern = /flat_(?:f32|vec2)\(params, "([A-Za-z]+)"\)/g;
      let keyMatch = keyPattern.exec(slice);
      while (keyMatch !== null) {
        keys.push(keyMatch[1]);
        keyMatch = keyPattern.exec(slice);
      }
      arms[starts[i].mode] = keys;
    }
    return arms;
  }

  it('names every mode the engine accepts, and no others', () => {
    expect(Object.keys(fromFlatArms()).sort()).toEqual(
      Object.keys(JOINT2D_PARAMS_BY_TYPE).sort(),
    );
  });

  it.each(Object.keys(JOINT2D_PARAMS_BY_TYPE) as Joint2dData['jointType'][])(
    'reads the same params as the %s arm',
    (mode) => {
      const rustKeys = fromFlatArms()[mode];
      expect(rustKeys.length).toBeGreaterThan(0);
      expect([...rustKeys].sort()).toEqual([...JOINT2D_PARAMS_BY_TYPE[mode]].sort());
    },
  );
});
