import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  toWireComponent,
  parseGameComponentWire,
  parseEmittedGameComponent,
  toEngineComponentType,
  toStoreComponentType,
  buildStoreComponent,
  ENGINE_COMPONENT_TYPES,
  ENGINE_COMPONENT_CATALOG,
  F32_RANGES,
  U32_MAXES,
} from '../gameComponentWire';
import type { GameComponentData } from '@/stores/slices/types';

/**
 * These tests pin the JS side of the game-component wire contract against the
 * Rust side. Every expectation below was read off
 * `engine/src/core/game_components.rs` — the `component_name()` table and the
 * `#[serde(rename_all = "camelCase")]` struct fields.
 *
 * `build_game_component` in the engine merges each recognised field onto the
 * type's `Default`, so the key sets here are not about avoiding a rejection —
 * they are about the store and the engine holding the SAME value. A key the
 * store omits leaves the Rust default standing while the store shows whatever
 * the store put there, and the two silently disagree for the rest of the
 * session.
 */

/** engine `component_name()` -> the exact serde field names of its Rust struct. */
const ENGINE_PROPERTY_KEYS: Record<string, string[]> = {
  character_controller: ['speed', 'jumpHeight', 'gravityScale', 'canDoubleJump'],
  // `despawnOnDeath` carries `#[serde(default = "default_true")]` on the Rust
  // side, so omitting it would still deserialize — but the store now authors it
  // explicitly, and listing it here is what makes a future divergence fail.
  health: [
    'maxHp',
    'currentHp',
    'invincibilitySecs',
    'respawnOnDeath',
    'respawnPoint',
    'despawnOnDeath',
  ],
  collectible: ['value', 'destroyOnCollect', 'pickupSoundAsset', 'rotateSpeed'],
  damage_zone: ['damagePerSecond', 'oneShot'],
  checkpoint: ['autoSave'],
  teleporter: ['targetPosition', 'cooldownSecs'],
  moving_platform: ['speed', 'waypoints', 'pauseDuration', 'loopMode'],
  trigger_zone: ['eventName', 'oneShot'],
  spawner: ['entityType', 'intervalSecs', 'maxCount', 'spawnOffset', 'onTrigger'],
  follower: ['targetEntityId', 'speed', 'stopDistance', 'lookAtTarget'],
  projectile: ['speed', 'damage', 'lifetimeSecs', 'gravity', 'destroyOnHit'],
  win_condition: ['conditionType', 'targetScore', 'targetEntityId'],
  dialogue_trigger: [
    'dialogueTreeId',
    'interactionRadius',
    'autoStart',
    'oneShot',
    'interactionKey',
  ],
};

/** Store discriminant -> engine name, mirroring the engine's own table. */
const STORE_TO_ENGINE: Record<GameComponentData['type'], string> = {
  characterController: 'character_controller',
  health: 'health',
  collectible: 'collectible',
  damageZone: 'damage_zone',
  checkpoint: 'checkpoint',
  teleporter: 'teleporter',
  movingPlatform: 'moving_platform',
  triggerZone: 'trigger_zone',
  spawner: 'spawner',
  follower: 'follower',
  projectile: 'projectile',
  winCondition: 'win_condition',
  dialogueTrigger: 'dialogue_trigger',
};

const ENGINE_NAMES = Object.keys(ENGINE_PROPERTY_KEYS);

describe('gameComponentWire', () => {
  describe('engine type table', () => {
    it('exposes exactly the 13 names the engine matches', () => {
      expect([...ENGINE_COMPONENT_TYPES].sort()).toEqual([...ENGINE_NAMES].sort());
    });

    it('describes every engine component type', () => {
      expect(ENGINE_COMPONENT_CATALOG.map(entry => entry.name).sort()).toEqual(
        [...ENGINE_COMPONENT_TYPES].sort()
      );
      for (const entry of ENGINE_COMPONENT_CATALOG) {
        expect(entry.description.length).toBeGreaterThan(0);
      }
    });

    it('uses snake_case for every multi-word name', () => {
      for (const name of ENGINE_COMPONENT_TYPES) {
        expect(name).toMatch(/^[a-z][a-z_]*$/);
      }
    });
  });

  describe('toEngineComponentType', () => {
    it.each(Object.entries(STORE_TO_ENGINE))(
      'maps the store name %s to the engine name %s',
      (storeType, engineType) => {
        expect(toEngineComponentType(storeType)).toBe(engineType);
      }
    );

    it.each(ENGINE_NAMES)('passes the engine name %s through unchanged', engineType => {
      expect(toEngineComponentType(engineType)).toBe(engineType);
    });

    it('returns null for a name the engine does not have', () => {
      // This is the literal string `autoIteration` used to emit for every
      // game-component fix, which the engine rejected outright.
      expect(toEngineComponentType('game_component')).toBeNull();
      expect(toEngineComponentType('CharacterController')).toBeNull();
      expect(toEngineComponentType('')).toBeNull();
    });
  });

  describe('toStoreComponentType', () => {
    it.each(Object.entries(STORE_TO_ENGINE))(
      'maps the engine name for %s back to the store name',
      (storeType, engineType) => {
        expect(toStoreComponentType(engineType)).toBe(storeType);
      }
    );

    it.each(Object.keys(STORE_TO_ENGINE))('passes the store name %s through unchanged', storeType => {
      expect(toStoreComponentType(storeType)).toBe(storeType);
    });

    it('returns null for a name neither side has', () => {
      expect(toStoreComponentType('game_component')).toBeNull();
      expect(toStoreComponentType('Checkpoint')).toBeNull();
    });
  });

  describe('buildStoreComponent + toWireComponent', () => {
    it.each(ENGINE_NAMES)(
      '%s: builds a complete payload the engine can deserialize',
      engineType => {
        const component = buildStoreComponent(engineType);
        expect(component).not.toBeNull();

        const wire = toWireComponent(component!);
        expect(wire.componentType).toBe(engineType);
        expect(Object.keys(wire.properties).sort()).toEqual(
          [...ENGINE_PROPERTY_KEYS[engineType]].sort()
        );
      }
    );

    it.each(Object.keys(STORE_TO_ENGINE))(
      'accepts the store name %s as well as the engine name',
      storeType => {
        const fromStoreName = buildStoreComponent(storeType);
        const fromEngineName = buildStoreComponent(
          STORE_TO_ENGINE[storeType as GameComponentData['type']]
        );
        expect(fromStoreName).toEqual(fromEngineName);
      }
    );

    it('returns null for an unknown name rather than a half-built component', () => {
      expect(buildStoreComponent('game_component')).toBeNull();
      expect(buildStoreComponent('not_a_component', { speed: 5 })).toBeNull();
    });

    it('merges supplied properties over the defaults', () => {
      const component = buildStoreComponent('character_controller', {
        speed: 12,
        canDoubleJump: true,
      });
      expect(toWireComponent(component!).properties).toEqual({
        speed: 12,
        jumpHeight: 8,
        gravityScale: 1,
        canDoubleJump: true,
      });
    });

    it('ignores a property whose value is the wrong type', () => {
      // A generator can hand us a string where the engine wants a number.
      // Coercing to the default keeps the payload deserializable instead of
      // failing the whole component.
      const component = buildStoreComponent('character_controller', { speed: 'fast' });
      expect(toWireComponent(component!).properties.speed).toBe(5);
    });

    it('keeps null in the nullable slots the engine models as Option<T>', () => {
      const collectible = toWireComponent(buildStoreComponent('collectible')!);
      expect(collectible.properties.pickupSoundAsset).toBeNull();

      const follower = toWireComponent(buildStoreComponent('follower')!);
      expect(follower.properties.targetEntityId).toBeNull();

      const spawner = toWireComponent(buildStoreComponent('spawner')!);
      expect(spawner.properties.onTrigger).toBeNull();
    });

    it('defaults despawnOnDeath to the engine default and round-trips an explicit false', () => {
      // The engine's `default_true` is what makes an entity vanish at zero hp.
      // A boss or destructible prop that must leave a corpse needs `false` to
      // survive the store -> wire hop, so both directions are pinned.
      expect(toWireComponent(buildStoreComponent('health')!).properties.despawnOnDeath).toBe(true);

      const persists = buildStoreComponent('health', { despawnOnDeath: false });
      expect(toWireComponent(persists!).properties.despawnOnDeath).toBe(false);
    });

    it('accepts maxHealth/currentHealth as aliases and defaults currentHp to maxHp', () => {
      const component = buildStoreComponent('health', { maxHealth: 250 });
      expect(toWireComponent(component!).properties).toMatchObject({
        maxHp: 250,
        currentHp: 250,
      });
    });

    it('emits enum values with the casing the Rust enums rename to', () => {
      // Both enums are `#[serde(rename_all = "camelCase")]`.
      const platform = toWireComponent(buildStoreComponent('moving_platform')!);
      expect(platform.properties.loopMode).toBe('pingPong');

      const win = toWireComponent(buildStoreComponent('win_condition')!);
      expect(win.properties.conditionType).toBe('score');
    });

    it('rejects a malformed vec3 rather than shipping it to the engine', () => {
      const component = buildStoreComponent('teleporter', { targetPosition: [1, 2] });
      expect(toWireComponent(component!).properties.targetPosition).toEqual([0, 1, 0]);
    });
  });

  describe('whole-number fields', () => {
    /**
     * Three fields on this wire are `u32` in Rust — `collectible.value`,
     * `spawner.maxCount` and `win_condition.targetScore`. The engine reads each
     * through `prop_u32`, which rounds to nearest and clamps into `0..=max`
     * (`game_components.rs`). The store used a plain finite-number check, so it
     * could hold `10.4` or `-5` or `1e9` — values the engine will never hold.
     * The divergence is invisible: the inspector shows the store's number while
     * the running game uses the engine's, so a collectible displayed as worth
     * 10.4 scores something else entirely.
     */
    const U32_FIELDS: {
      name: string;
      component: string;
      key: string;
      max: number;
    }[] = [
      { name: 'collectible.value', component: 'collectible', key: 'value', max: 1_000_000 },
      { name: 'spawner.maxCount', component: 'spawner', key: 'maxCount', max: 1000 },
      { name: 'win_condition.targetScore', component: 'win_condition', key: 'targetScore', max: 4294967295 },
    ];

    it.each(U32_FIELDS)('$name rounds a fractional value to nearest', ({ component, key }) => {
      const wire = toWireComponent(buildStoreComponent(component, { [key]: 10.4 })!);
      expect(wire.properties[key]).toBe(10);

      const up = toWireComponent(buildStoreComponent(component, { [key]: 10.6 })!);
      expect(up.properties[key]).toBe(11);
    });

    it.each(U32_FIELDS)('$name floors a negative value at zero', ({ component, key }) => {
      const wire = toWireComponent(buildStoreComponent(component, { [key]: -5 })!);
      expect(wire.properties[key]).toBe(0);
    });

    it.each(U32_FIELDS)('$name clamps to the engine ceiling', ({ component, key, max }) => {
      const wire = toWireComponent(buildStoreComponent(component, { [key]: max + 1000 })!);
      expect(wire.properties[key]).toBe(max);
    });

    it.each(U32_FIELDS)('$name keeps a whole in-range value untouched', ({ component, key }) => {
      const wire = toWireComponent(buildStoreComponent(component, { [key]: 42 })!);
      expect(wire.properties[key]).toBe(42);
    });

    it.each(U32_FIELDS)('$name falls back to its default for a non-number', ({ component, key }) => {
      const bogus = toWireComponent(buildStoreComponent(component, { [key]: 'lots' })!);
      const bare = toWireComponent(buildStoreComponent(component)!);
      expect(bogus.properties[key]).toBe(bare.properties[key]);
    });

    it.each(U32_FIELDS)('$name rejects a non-finite value', ({ component, key }) => {
      const bare = toWireComponent(buildStoreComponent(component)!);
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const wire = toWireComponent(buildStoreComponent(component, { [key]: bad })!);
        expect(wire.properties[key]).toBe(bare.properties[key]);
      }
    });

    // `targetScore` is `Option<u32>`, and an explicit null is how the store says
    // "this win condition is not score-based". Rounding must not swallow that.
    it('preserves an explicit null targetScore', () => {
      const wire = toWireComponent(
        buildStoreComponent('win_condition', { conditionType: 'reachGoal', targetScore: null })!,
      );
      expect(wire.properties.targetScore).toBeNull();
    });

    // Guard against the coercion leaking onto neighbouring float fields: the
    // engine reads these through `prop_f32`, which does not round.
    it('leaves float fields fractional', () => {
      const collectible = toWireComponent(
        buildStoreComponent('collectible', { rotateSpeed: 90.5 })!,
      );
      expect(collectible.properties.rotateSpeed).toBe(90.5);

      const spawner = toWireComponent(buildStoreComponent('spawner', { intervalSecs: 2.5 })!);
      expect(spawner.properties.intervalSecs).toBe(2.5);
    });
  });

  describe('dialogueTrigger field-name divergence', () => {
    // The only component whose store field names differ from the Rust struct.
    it('renames every field to what the engine expects', () => {
      const wire = toWireComponent({
        type: 'dialogueTrigger',
        dialogueTrigger: {
          treeId: 'intro',
          triggerRadius: 4,
          requireInteract: true,
          interactKey: 'e',
          oneShot: true,
        },
      });

      expect(wire.componentType).toBe('dialogue_trigger');
      expect(wire.properties).toEqual({
        dialogueTreeId: 'intro',
        interactionRadius: 4,
        autoStart: false,
        interactionKey: 'e',
        oneShot: true,
      });
    });

    it('inverts requireInteract into autoStart', () => {
      const wire = toWireComponent({
        type: 'dialogueTrigger',
        dialogueTrigger: {
          treeId: 'intro',
          triggerRadius: 3,
          requireInteract: false,
          interactKey: 'interact',
          oneShot: false,
        },
      });
      expect(wire.properties.autoStart).toBe(true);
    });

    it('defaults to the same values as the Rust Default impl', () => {
      const wire = toWireComponent(buildStoreComponent('dialogue_trigger')!);
      expect(wire.properties).toEqual({
        dialogueTreeId: '',
        interactionRadius: 3,
        autoStart: false,
        oneShot: false,
        interactionKey: 'interact',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// The clamp tables, pinned against the Rust that defines them.
//
// `F32_RANGES` and `U32_MAXES` are a hand-mirrored copy of the `prop_f32` /
// `prop_u32` call sites in `engine/src/core/game_components.rs`, and a
// hand-mirrored copy is exactly the thing that drifts: the engine widens a
// bound, nothing here hears about it, and the store starts clamping values the
// engine would have accepted — or worse, the engine narrows one and the store
// keeps storing a number the simulation never sees.
//
// A native `cargo test` cannot read the TypeScript table and the TS suite
// cannot call `prop_f32`, so reading the Rust source is the only check
// available. Deliberately textual, and it fails closed: an unreadable file, a
// missing match, a literal it cannot parse, or a scan that finds nothing is a
// failure, never a skip.
// ---------------------------------------------------------------------------

describe('clamp tables match build_game_component', () => {
  const RUST = join(
    __dirname, '..', '..', '..', '..', '..',
    'engine', 'src', 'core', 'game_components.rs',
  );

  /**
   * A Rust numeric literal as written at these call sites, plus the one
   * symbolic bound the file uses.
   *
   * Wider than `-?[0-9.]+` on purpose: `1_000_000.0`, `3600.0`, `0.1` and a
   * possible `1e3` or `5.0_f32` are all the same value to rustc, so a narrow
   * pattern stops matching the day someone re-spells a bound for readability —
   * and because the extractor asserts on a null match, that reads as "the call
   * site is gone", pointing at the wrong problem entirely.
   */
  const RUST_NUM = String.raw`u32::MAX|-?\d[\d_]*(?:\.(?:\d[\d_]*)?)?(?:[eE][+-]?\d+)?(?:_?f32)?`;

  function parseRustNum(literal: string, what: string): number {
    if (literal === 'u32::MAX') return 4294967295;
    const value = Number(literal.replace(/_?f32$/, '').replace(/_/g, ''));
    expect(
      Number.isFinite(value),
      `unparseable Rust numeric literal for ${what}: "${literal}"`,
    ).toBe(true);
    return value;
  }

  /** The body of each `"<engine_name>" => …` arm of `match component_type`. */
  function componentArms(): Record<string, string> {
    const source = readFileSync(RUST, 'utf8');
    const start = source.indexOf('match component_type {');
    expect(start, `no "match component_type" in ${RUST}`).toBeGreaterThan(-1);
    const body = source.slice(start);

    // Cut head-to-head rather than by a closing-brace shape: an arm's body is
    // whatever it happens to be, and the `other =>` fallback is what bounds the
    // last real arm.
    const heads = [...body.matchAll(/^ {8}(?:"(\w+)"|other) =>/gm)];
    expect(heads.length, 'no component match arms found').toBeGreaterThan(0);

    const arms: Record<string, string> = {};
    heads.forEach((head, i) => {
      const name = head[1];
      if (!name) return; // the `other =>` fallback — a bound, not an arm
      const from = head.index! + head[0].length;
      const to = i + 1 < heads.length ? heads[i + 1]!.index! : body.length;
      arms[name] = body.slice(from, to);
    });
    return arms;
  }

  const arms = componentArms();

  /** `{ component: { key: [min, max] } }`, read straight off the Rust. */
  const rustF32: Record<string, Record<string, [number, number]>> = {};
  /** `{ component: { key: max } }`, likewise. */
  const rustU32: Record<string, Record<string, number>> = {};

  for (const [name, arm] of Object.entries(arms)) {
    for (const m of arm.matchAll(
      new RegExp(
        String.raw`prop_f32\(\s*&props\s*,\s*"(\w+)"\s*,\s*(${RUST_NUM})\s*,\s*(${RUST_NUM})\s*\)`,
        'g',
      ),
    )) {
      (rustF32[name] ??= {})[m[1]!] = [
        parseRustNum(m[2]!, `${name}.${m[1]} min`),
        parseRustNum(m[3]!, `${name}.${m[1]} max`),
      ];
    }
    for (const m of arm.matchAll(
      new RegExp(String.raw`prop_u32\(\s*&props\s*,\s*"(\w+)"\s*,\s*(${RUST_NUM})\s*\)`, 'g'),
    )) {
      (rustU32[name] ??= {})[m[1]!] = parseRustNum(m[2]!, `${name}.${m[1]} max`);
    }
  }

  it('finds the call sites at all (guards against a vacuous scan)', () => {
    expect(Object.keys(rustF32).length).toBeGreaterThan(0);
    expect(Object.keys(rustU32).length).toBeGreaterThan(0);
  });

  // A "not zero" guard is not enough. Every extraction step above can drop a
  // call site QUIETLY: an arm head re-indented out of the 8-space anchor takes
  // its whole arm with it, and a call site spelled in a way the regex does not
  // match just is not seen. Either way the two `toEqual`s below still pass —
  // they compare the table against a scan that no longer covers the file, which
  // is the same failure mode the tables exist to prevent, one level up.
  //
  // So pin the COUNT: every `prop_f32(&props, …)` / `prop_u32(&props, …)` in
  // the file must be accounted for by exactly one extracted entry. A call site
  // added outside `build_game_component` fails this too — deliberately. That is
  // a human decision about what the scan should cover, not something a test
  // should absorb silently.
  it('accounts for every prop_f32 / prop_u32 call site in the file', () => {
    const source = readFileSync(RUST, 'utf8');
    const occurrences = (fn: string) =>
      [...source.matchAll(new RegExp(String.raw`\b${fn}\(\s*&props\b`, 'g'))].length;
    const extracted = (table: Record<string, Record<string, unknown>>) =>
      Object.values(table).reduce((n, fields) => n + Object.keys(fields).length, 0);

    expect(extracted(rustF32), 'prop_f32 call sites the scan did not reach').toBe(
      occurrences('prop_f32'),
    );
    expect(extracted(rustU32), 'prop_u32 call sites the scan did not reach').toBe(
      occurrences('prop_u32'),
    );
  });

  // `toEqual` in both directions at once: a bound that drifted fails, a field
  // the engine clamps and the table omits fails, and a table entry naming a
  // field the engine does not clamp fails too. That last one matters — it is
  // how a clamp survives in TypeScript after the engine dropped it, quietly
  // narrowing values the simulation would have taken.
  it('F32_RANGES matches every prop_f32 call site, and no others', () => {
    expect(F32_RANGES).toEqual(rustF32);
  });

  it('U32_MAXES matches every prop_u32 call site, and no others', () => {
    expect(U32_MAXES).toEqual(rustU32);
  });
});

// ---------------------------------------------------------------------------
// Round trip.
//
// Every other test in this file compares the builder's output against a table
// written by hand next to it, which cannot catch the two vocabularies being
// wired to each other wrongly — only the two vocabularies being *described*
// wrongly. A round trip can: `dialogueTrigger`'s five renamed fields and its
// inverted `autoStart` either survive store -> wire -> store or they do not.
// ---------------------------------------------------------------------------

describe('store -> wire -> store round trip', () => {
  /**
   * Store-vocabulary props per component, every field set away from its
   * default and inside the engine's clamps.
   *
   * Non-default throughout on purpose: a fixture that leaves a field alone
   * round-trips through a mapping that drops it, because both ends then hold
   * the same default. The completeness test below enforces it.
   */
  const NON_DEFAULT_PROPS: Record<string, Record<string, unknown>> = {
    character_controller: { speed: 7.5, jumpHeight: 12, gravityScale: 2.5, canDoubleJump: true },
    health: {
      maxHp: 250,
      currentHp: 120,
      invincibilitySecs: 1.25,
      respawnOnDeath: false,
      respawnPoint: [1, 2, 3],
      despawnOnDeath: false,
    },
    collectible: {
      value: 25,
      destroyOnCollect: false,
      pickupSoundAsset: 'asset-7',
      rotateSpeed: -45,
    },
    damage_zone: { damagePerSecond: 60, oneShot: true },
    checkpoint: { autoSave: false },
    teleporter: { targetPosition: [4, 5, 6], cooldownSecs: 12 },
    moving_platform: {
      speed: 6,
      waypoints: [[1, 1, 1], [2, 2, 2], [3, 3, 3]],
      pauseDuration: 2,
      loopMode: 'once',
    },
    trigger_zone: { eventName: 'boss-door', oneShot: true },
    spawner: {
      entityType: 'sphere',
      intervalSecs: 0.5,
      maxCount: 40,
      spawnOffset: [0, 2, 0],
      onTrigger: 'wave-start',
    },
    follower: { targetEntityId: 'entity-9', speed: 8, stopDistance: 4, lookAtTarget: false },
    projectile: { speed: 40, damage: 75, lifetimeSecs: 2, gravity: true, destroyOnHit: false },
    win_condition: { conditionType: 'reachGoal', targetScore: 99, targetEntityId: 'goal-1' },
    dialogue_trigger: {
      treeId: 'tree-3',
      triggerRadius: 8,
      requireInteract: false,
      interactKey: 'use',
      oneShot: true,
    },
  };

  /** The component's own data object, whichever key it hangs off. */
  function dataOf(component: GameComponentData): Record<string, unknown> {
    return (component as unknown as Record<string, Record<string, unknown>>)[component.type]!;
  }

  it('covers every component type', () => {
    expect(Object.keys(NON_DEFAULT_PROPS).sort()).toEqual([...ENGINE_COMPONENT_TYPES].sort());
  });

  it.each(ENGINE_COMPONENT_TYPES)('%s moves every field off its default', (name) => {
    const base = dataOf(buildStoreComponent(name)!);
    const moved = dataOf(buildStoreComponent(name, NON_DEFAULT_PROPS[name]!)!);

    for (const key of Object.keys(base)) {
      expect(moved[key], `${name}.${key} is still at its default`).not.toEqual(base[key]);
    }
  });

  it.each(ENGINE_COMPONENT_TYPES)('%s survives the trip unchanged', (name) => {
    const original = buildStoreComponent(name, NON_DEFAULT_PROPS[name]!)!;
    expect(parseGameComponentWire(toWireComponent(original))).toEqual(original);
  });

  it('rejects a payload the engine would reject', () => {
    // The engine's two hard errors: a type it has no systems for, and a body
    // that is not a JSON object.
    expect(parseGameComponentWire({ componentType: 'jetpack', properties: {} })).toBeNull();
    expect(parseGameComponentWire({ componentType: 'collectible', properties: [] })).toBeNull();
    expect(parseGameComponentWire({ componentType: 'collectible', properties: 'nope' })).toBeNull();
  });

  it('treats an absent properties bag as "all defaults"', () => {
    expect(parseGameComponentWire({ componentType: 'collectible' }))
      .toEqual(buildStoreComponent('collectible'));
  });
});

// ---------------------------------------------------------------------------
// The clamps themselves, exercised through the wire.
//
// Driven off the tables rather than written out per field, so a field added to
// the engine (and therefore to the pinned table above) is covered the moment it
// appears, instead of waiting for someone to remember this block.
// ---------------------------------------------------------------------------

describe('out-of-range values are clamped, not stored verbatim', () => {
  /** Send one engine-vocabulary property and read it back out of the wire. */
  function roundTrip(componentType: string, key: string, value: unknown): unknown {
    const parsed = parseGameComponentWire({ componentType, properties: { [key]: value } });
    expect(parsed, `${componentType} did not parse`).not.toBeNull();
    return toWireComponent(parsed!).properties[key];
  }

  function engineDefault(componentType: string, key: string): unknown {
    return toWireComponent(buildStoreComponent(componentType)!).properties[key];
  }

  const f32Cases = Object.entries(F32_RANGES).flatMap(([componentType, fields]) =>
    Object.entries(fields).map(([key, [min, max]]) =>
      [componentType, key, min, max] as const),
  );

  it.each(f32Cases)('%s.%s clamps to [%d, %d]', (componentType, key, min, max) => {
    expect(roundTrip(componentType, key, min - 1000)).toBe(min);
    expect(roundTrip(componentType, key, max + 1000)).toBe(max);
    expect(roundTrip(componentType, key, min)).toBe(min);
    expect(roundTrip(componentType, key, max)).toBe(max);
  });

  it.each(f32Cases)('%s.%s falls back to the default for a non-number', (componentType, key) => {
    const fallback = engineDefault(componentType, key);
    expect(roundTrip(componentType, key, Number.NaN)).toBe(fallback);
    expect(roundTrip(componentType, key, Number.POSITIVE_INFINITY)).toBe(fallback);
    expect(roundTrip(componentType, key, '5')).toBe(fallback);
    expect(roundTrip(componentType, key, null)).toBe(fallback);
  });

  const u32Cases = Object.entries(U32_MAXES).flatMap(([componentType, fields]) =>
    Object.entries(fields).map(([key, max]) => [componentType, key, max] as const),
  );

  it.each(u32Cases)('%s.%s rounds and clamps to [0, %d]', (componentType, key, max) => {
    // `prop_u32` parses through `as_f64`, so a fractional value rounds rather
    // than being rejected — and because `as_f64` accepts negatives, the engine
    // floors at zero explicitly.
    expect(roundTrip(componentType, key, 2.6)).toBe(3);
    expect(roundTrip(componentType, key, -5)).toBe(0);
    expect(roundTrip(componentType, key, max + 1000)).toBe(max);
  });
});

// ---------------------------------------------------------------------------
// The three casts these functions used to carry, and the prototype chain the
// name lookups used to walk.
// ---------------------------------------------------------------------------

describe('unvalidated values do not reach the engine', () => {
  it('does not report inherited Object properties as component names', () => {
    // The lookup tables come from object literals, so every one of these was
    // `true` under a bare `in` — and `toEngineComponentType` returned the name
    // verbatim, producing an `add_game_component` the engine has no systems
    // for. `dispatchCommand` returns void, so it was discarded in silence.
    for (const inherited of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      expect(toEngineComponentType(inherited), inherited).toBeNull();
      expect(toStoreComponentType(inherited), inherited).toBeNull();
      expect(buildStoreComponent(inherited), inherited).toBeNull();
    }
  });

  it('drops waypoints that are not finite 3-vectors', () => {
    const waypoints = (props: unknown) =>
      (buildStoreComponent('moving_platform', { waypoints: props }) as
        Extract<GameComponentData, { type: 'movingPlatform' }>).movingPlatform.waypoints;

    // Matches `build_game_component`'s `filter_map`: bad entries are dropped,
    // the rest are kept.
    expect(waypoints([[1, 1, 1], 'nope', [2, 2], [3, 3, 3], [4, 4, Number.NaN]]))
      .toEqual([[1, 1, 1], [3, 3, 3]]);

    // ...and a list with nothing usable left leaves the default standing,
    // rather than producing a platform with nowhere to go.
    const fallback = waypoints(undefined);
    expect(waypoints(['a', 'b'])).toEqual(fallback);
    expect(waypoints([])).toEqual(fallback);
    expect(waypoints('not a list')).toEqual(fallback);
  });

  it('replaces an unknown enum string with the engine default', () => {
    // The engine parses both of these with a trailing `_ =>` arm, so an
    // unrecognised string is not rejected there — it quietly becomes `PingPong`
    // or `Score`. An unvalidated cast here is therefore worse than a hard
    // error: the store keeps `'bounce'`, the engine runs ping-pong, and the two
    // only disagree at runtime.
    const platform = (loopMode: unknown) =>
      (buildStoreComponent('moving_platform', { loopMode }) as
        Extract<GameComponentData, { type: 'movingPlatform' }>).movingPlatform.loopMode;
    expect(platform('bounce')).toBe('pingPong');
    expect(platform('PingPong')).toBe('pingPong'); // the Rust spelling, not the store's
    expect(platform(7)).toBe('pingPong');
    expect(platform('once')).toBe('once');

    const win = (conditionType: unknown) =>
      (buildStoreComponent('win_condition', { conditionType }) as
        Extract<GameComponentData, { type: 'winCondition' }>).winCondition.conditionType;
    expect(win('survive')).toBe('score');
    expect(win('CollectAll')).toBe('score');
    expect(win('reachGoal')).toBe('reachGoal');
  });

  it('keeps a vec3 all-or-nothing, as prop_vec3 does', () => {
    const respawn = (respawnPoint: unknown) =>
      (buildStoreComponent('health', { respawnPoint }) as
        Extract<GameComponentData, { type: 'health' }>).health.respawnPoint;
    expect(respawn([1, 2, 3])).toEqual([1, 2, 3]);
    // A partial or malformed vector is not partially applied — the engine's
    // `prop_vec3` answers `None` for all of these, leaving its default.
    expect(respawn([1, 2])).toEqual([0, 1, 0]);
    expect(respawn([1, 2, 3, 4])).toEqual([0, 1, 0]);
    expect(respawn([1, 2, Number.NaN])).toEqual([0, 1, 0]);
    expect(respawn(['1', '2', '3'])).toEqual([0, 1, 0]);
  });
});

// ---------------------------------------------------------------------------
// The read direction.
//
// `emit_game_component_changed` sends the engine's own `GameComponentData`,
// which is `#[serde(tag = "type", rename_all = "camelCase")]` — an internally
// tagged enum, so every component arrives FLAT: engine field names sitting
// beside a camelCase discriminant. That is a third vocabulary, neither the
// store's nested shape nor the `{componentType, properties}` command shape, and
// casting one into another type-checks while being wrong at runtime.
// ---------------------------------------------------------------------------

describe('parseEmittedGameComponent', () => {
  it('turns the engine’s flat emitted shape into the store’s nested one', () => {
    expect(
      parseEmittedGameComponent({
        type: 'characterController',
        speed: 7,
        jumpHeight: 12,
        gravityScale: 2,
        canDoubleJump: true,
      }),
    ).toEqual({
      type: 'characterController',
      characterController: { speed: 7, jumpHeight: 12, gravityScale: 2, canDoubleJump: true },
    });
  });

  it('round-trips every component type back out through toWireComponent', () => {
    // The emitted shape is exactly `{type, ...engineProps}`, so flattening a
    // wire command produces a faithful stand-in for what the engine sends. If
    // the two vocabularies are wired together correctly, this is an identity.
    for (const engineName of ENGINE_COMPONENT_TYPES) {
      const built = buildStoreComponent(engineName);
      expect(built, `no store shape for ${engineName}`).not.toBeNull();

      const wire = toWireComponent(built!);
      const emitted = { type: wire.componentType, ...wire.properties };
      expect(parseEmittedGameComponent(emitted), `round trip for ${engineName}`).toEqual(built);
    }
  });

  it('clamps an emitted value the engine could never be holding', () => {
    // Nothing guarantees a well-formed payload on this path either — a stale
    // WASM binary or a hand-crafted event is enough. Storing 500 would show the
    // inspector a number the simulation cannot have.
    expect(parseEmittedGameComponent({ type: 'collectible', rotateSpeed: 500 })).toEqual({
      type: 'collectible',
      collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 100 },
    });
  });

  it('rejects anything that is not a tagged component object', () => {
    expect(parseEmittedGameComponent(null)).toBeNull();
    expect(parseEmittedGameComponent('health')).toBeNull();
    expect(parseEmittedGameComponent(42)).toBeNull();
    expect(parseEmittedGameComponent([{ type: 'health' }])).toBeNull();
    expect(parseEmittedGameComponent({ maxHp: 100 })).toBeNull(); // no discriminant
    expect(parseEmittedGameComponent({ type: 7 })).toBeNull();
    expect(parseEmittedGameComponent({ type: 'grappleHook' })).toBeNull();
  });

  it('does not read a component type off the prototype chain', () => {
    // A bare `in` check reported `toString` and `constructor` as component
    // types; both probes use `Object.hasOwn` for that reason.
    expect(parseEmittedGameComponent({ type: 'toString' })).toBeNull();
    expect(parseEmittedGameComponent({ type: 'constructor' })).toBeNull();
    expect(parseEmittedGameComponent({ type: 'hasOwnProperty' })).toBeNull();
  });

  it('ignores the sibling discriminant rather than merging it as a property', () => {
    // The flat object doubles as the properties bag, so `type` travels with it.
    // No component has a `type` field, and the builder reads named keys only.
    const parsed = parseEmittedGameComponent({ type: 'checkpoint', autoSave: false });
    expect(parsed).toEqual({ type: 'checkpoint', checkpoint: { autoSave: false } });
  });
});

describe('parseGameComponentWire properties handling', () => {
  it('treats an absent properties key as an empty bag, as the engine does', () => {
    // `handle_add_game_component` does
    // `payload.get("properties").cloned().unwrap_or(Value::Object(Map::new()))`,
    // so a missing key really is `{}` and every field takes its Rust default.
    expect(parseGameComponentWire({ componentType: 'checkpoint' })).toEqual({
      type: 'checkpoint',
      checkpoint: { autoSave: true },
    });
  });

  it('rejects an explicit null, which the engine also rejects', () => {
    // An explicit `null` survives that `unwrap_or` untouched and reaches
    // `build_game_component` as `Value::Null`, which fails its
    // `!props.is_object()` guard and errors out with nothing applied. Handing
    // back a fully-defaulted component here would show the store a component
    // the engine threw away.
    expect(parseGameComponentWire({ componentType: 'checkpoint', properties: null })).toBeNull();
  });

  it('rejects a properties bag that is not a plain object', () => {
    expect(parseGameComponentWire({ componentType: 'checkpoint', properties: [] })).toBeNull();
    expect(parseGameComponentWire({ componentType: 'checkpoint', properties: 'autoSave' })).toBeNull();
    expect(parseGameComponentWire({ componentType: 'checkpoint', properties: 3 })).toBeNull();
  });

  it('still returns null for a component type it does not know', () => {
    // `buildStoreComponent`'s switch carries no `default:` arm and no trailing
    // `return`, so a fourteenth component type is a TS2366 compile error rather
    // than a silent `null`. This pins that unknown NAMES keep answering null.
    expect(parseGameComponentWire({ componentType: 'grappleHook', properties: {} })).toBeNull();
    expect(buildStoreComponent('grappleHook')).toBeNull();
    expect(buildStoreComponent('')).toBeNull();
  });
});
