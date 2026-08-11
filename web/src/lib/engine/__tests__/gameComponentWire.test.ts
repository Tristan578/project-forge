import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  toWireComponent,
  parseGameComponentWire,
  parseEmittedGameComponent,
  toEngineComponentType,
  toStoreComponentType,
  buildStoreComponent,
  normalizeGameComponent,
  ENGINE_COMPONENT_TYPES,
  ENGINE_COMPONENT_CATALOG,
  ENGINE_PROP_RANGES,
  ENGINE_PROP_MAXIMA,
  PLATFORM_LOOP_MODES,
  WIN_CONDITION_TYPES,
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

  /**
   * `waypoints` is the one field on this wire that is a list, and it was
   * unbounded and unvalidated on the JS side while the engine `filter_map`ped
   * every entry and (as of PF-1143) caps the result.
   *
   * The cap is read out of the Rust rather than re-typed here. A hand-copied
   * number is exactly the kind of second copy that drifts, and because
   * `dispatchCommand` returns `void` the drift would be silent: the store would
   * hold one route and the engine another, with nothing to report it.
   */
  describe('waypoint cap, pinned against the engine', () => {
    const rustSource = readFileSync(
      resolve(__dirname, '../../../../../engine/src/core/game_components.rs'),
      'utf8',
    );

    const capMatch = rustSource.match(/^pub const MAX_WAYPOINTS: usize = (\d+);$/m);
    const RUST_MAX = Number(capMatch?.[1]);

    const route = (n: number): [number, number, number][] =>
      Array.from({ length: n }, (_, i) => [i, 0, 0] as [number, number, number]);

    // Narrows rather than casts: a `!` here would type-check even if
    // `buildStoreComponent` stopped returning a movingPlatform at all, and the
    // waypoint reads below would then be against `undefined`.
    const built = (props: Record<string, unknown>) => {
      const component = buildStoreComponent('moving_platform', props);
      if (component?.type !== 'movingPlatform') {
        throw new Error(`expected a movingPlatform component, got ${component?.type ?? 'null'}`);
      }
      return component.movingPlatform.waypoints;
    };

    it('finds the cap in the engine source', () => {
      // Self-check. Without it, a renamed constant makes `RUST_MAX` NaN and every
      // comparison below silently passes on nothing.
      expect(capMatch, 'MAX_WAYPOINTS not found in game_components.rs').not.toBeNull();
      expect(Number.isInteger(RUST_MAX)).toBe(true);
      expect(RUST_MAX).toBeGreaterThan(2);
    });

    it('applies the engine cap to the constant it also applies', () => {
      // The point of the scan: the store must truncate at whatever the Rust
      // says, not at whatever was typed into the TS file.
      expect(built({ waypoints: route(RUST_MAX + 10) })).toHaveLength(RUST_MAX);
    });

    it('leaves a route exactly at the cap intact', () => {
      // Off-by-one guard in the other direction — a cap applied as `>` rather
      // than `>=`, or a `slice(0, n - 1)`, would pass the truncation test alone.
      const exact = route(RUST_MAX);
      expect(built({ waypoints: exact })).toEqual(exact);
    });

    it('truncates from the front, keeping the route the author authored', () => {
      const kept = built({ waypoints: route(RUST_MAX + 5) });
      expect(kept[0]).toEqual([0, 0, 0]);
      expect(kept[RUST_MAX - 1]).toEqual([RUST_MAX - 1, 0, 0]);
      // The tail is what goes, not the head — asserting the last kept point is
      // what makes this test fail if the cap stops truncating at all.
      expect(kept.at(-1)).toEqual([RUST_MAX - 1, 0, 0]);
    });

    it('counts only waypoints the platform can visit toward the cap', () => {
      // The engine `take`s AFTER the `filter_map`, so malformed entries must not
      // eat the budget. Interleaving junk with a full-length route has to leave
      // a full-length route.
      const interleaved: unknown[] = [];
      for (const point of route(RUST_MAX)) {
        interleaved.push('not a point', [1, 2], point);
      }
      expect(built({ waypoints: interleaved })).toHaveLength(RUST_MAX);
    });

    it('drops entries the engine drops instead of showing a route it will not follow', () => {
      // Mirrors the engine's `filter_map`: 3-element arrays of finite numbers.
      expect(
        built({
          waypoints: [[0, 0, 0], [1, 2], 'nope', [1, 'x', 3], [Infinity, 0, 0], [4, 5, 6], null],
        }),
      ).toEqual([
        [0, 0, 0],
        [4, 5, 6],
      ]);
    });

    it('rejects a double the engine cannot hold as an f32', () => {
      // `as_f64() as f32` overflows to infinity in Rust and the entry is dropped.
      // `Number.isFinite(1e300)` is true, so a plain finite check kept it.
      // Three points in, two out: the survivors have to clear the two-point
      // minimum below, or the default route would mask which entry was dropped.
      expect(built({ waypoints: [[1e300, 0, 0], [1, 2, 3], [7, 8, 9]] })).toEqual([
        [1, 2, 3],
        [7, 8, 9],
      ]);
    });

    it('falls back to the Rust default route when fewer than two points survive', () => {
      // `system_moving_platform` early-returns at `data.waypoints.len() < 2`, so a
      // route with one usable point is a platform the store draws and the engine
      // never moves — and `dispatchCommand` returns `void`, so nothing reports it.
      // The default route is what both sides then hold.
      const fallback = [
        [0, 0, 0],
        [0, 3, 0],
      ];
      expect(built({ waypoints: ['junk', []] })).toEqual(fallback);
      expect(built({ waypoints: [] })).toEqual(fallback);
      expect(built({ waypoints: [[1, 2, 3]] })).toEqual(fallback);
      expect(built({ waypoints: [[1, 2, 3], 'junk'] })).toEqual(fallback);
      expect(built({ waypoints: 'not an array' })).toEqual(fallback);
    });

    it('survives the round trip to the wire at the cap', () => {
      const wire = toWireComponent(
        buildStoreComponent('moving_platform', { waypoints: route(RUST_MAX + 100) })!,
      );
      expect(wire.properties.waypoints).toHaveLength(RUST_MAX);
    });

    it('drops a waypoint with a hole in it, which the length check alone lets through', () => {
      // `[0, , 0]` has `length === 3`, and `Array.prototype.every` SKIPS holes —
      // so the callback never sees index 1 and the entry cleared the guard. The
      // tuple was then built by re-reading the same indices, where the hole reads
      // as `undefined` and crosses the wire as `null`; the engine's `as_f64()`
      // returns `None` for that and drops the point, while the store keeps it.
      // The hole below is deliberate — it IS the input under test.
      expect(built({ waypoints: [[0, , 0], [4, 5, 6], [7, 8, 9]] })).toEqual([
        [4, 5, 6],
        [7, 8, 9],
      ]);
    });

    it('drops a waypoint that is nothing but holes', () => {
      // `new Array(3)` — a pre-sized accumulator whose slots were never all
      // filled in — is all holes, and so passes `.every` outright.
      expect(built({ waypoints: [new Array(3), [4, 5, 6], [7, 8, 9]] })).toEqual([
        [4, 5, 6],
        [7, 8, 9],
      ]);
    });

    it('does not let a sparse waypoint eat the cap budget', () => {
      // Same rule as the malformed-entry test above: the engine `take`s after the
      // `filter_map`, so an entry it drops must not cost a slot here either.
      // Asserting the CONTENT, not just the length: 64 sparse entries kept in
      // place of the real ones also produce a length of 64, so `toHaveLength`
      // alone passes on exactly the behaviour this test exists to reject.
      const interleaved: unknown[] = [];
      for (const point of route(RUST_MAX)) {
        interleaved.push(new Array(3), point);
      }
      expect(built({ waypoints: interleaved })).toEqual(route(RUST_MAX));
    });

    it('keeps no hole anywhere in the route it hands the engine', () => {
      // The assertion this test would naturally reach for —
      // `kept.every((p) => p.every(Number.isFinite))` — is the very bug: it skips
      // holes and reports `true` on the array that caused this ticket. Serializing
      // is the check that cannot skip anything, because `JSON.stringify` writes a
      // hole as `null` exactly as the wire does.
      const kept = built({ waypoints: [[1, 2, 3], new Array(3), [4, 5, 6]] });
      expect(JSON.stringify(kept)).not.toContain('null');
      expect(kept).toEqual([
        [1, 2, 3],
        [4, 5, 6],
      ]);
    });
  });

  /**
   * The engine CLAMPS every numeric field; the store used to check finiteness and
   * nothing else. A `speed` of `1e9` was kept verbatim here and became `1000`
   * there, and since `dispatchCommand` returns `void` nothing reported it — the
   * inspector, the export and the running game each held a different number.
   *
   * The ranges are read out of the Rust rather than re-typed, for the reason the
   * waypoint cap above is: a hand-copied bound is a second copy that drifts, and
   * this particular drift is silent by construction. Adding a clamped field to
   * `build_game_component` without adding it to the TypeScript table fails here.
   *
   * The two string enums are the same category of hand-mirrored table, so they
   * are pinned out of the same scan at the end of this block rather than from a
   * second read of the file.
   */
  describe('tables pinned against the engine source', () => {
    const rustSource = readFileSync(
      resolve(__dirname, '../../../../../engine/src/core/game_components.rs'),
      'utf8',
    );

    // Scope the scan to `build_game_component`'s body. Its arms are the only
    // place `prop_f32`/`prop_u32` are called, but the helpers' own definitions
    // and the unit tests further down the file mention them too, and a match in
    // either would attribute a range to whichever arm happened to precede it.
    const fnStart = rustSource.indexOf('pub fn build_game_component');
    const fnEnd = rustSource.indexOf('\n}\n', fnStart);
    const body = fnStart >= 0 && fnEnd > fnStart ? rustSource.slice(fnStart, fnEnd) : '';

    /** A Rust numeric literal as a JS number: `1_000_000.0`, `0.1`, `u32::MAX`. */
    const literal = (token: string): number => {
      const text = token.trim();
      return text === 'u32::MAX' ? 4294967295 : Number(text.replace(/_/g, ''));
    };

    const scannedRanges: Record<string, Record<string, { min: number; max: number }>> = {};
    const scannedMaxima: Record<string, Record<string, number>> = {};

    // Each component is one `"name" => { ... }` arm at a fixed indent, so the arm
    // headers delimit the slices. Keys repeat across components with DIFFERENT
    // bounds — `speed` is `0..1000` on a follower and `0..10_000` on a projectile
    // — so a file-wide scan keyed by field name alone would be wrong.
    const armHeader = /^ {8}"([a-z_]+)" => \{$/gm;
    const armStarts: { name: string; start: number }[] = [];
    for (let match = armHeader.exec(body); match !== null; match = armHeader.exec(body)) {
      armStarts.push({ name: match[1], start: match.index });
    }
    /** Each arm's own source text, so the enum scans below read the same slices. */
    const armText: Record<string, string> = {};
    armStarts.forEach((arm, i) => {
      const text = body.slice(arm.start, armStarts[i + 1]?.start ?? body.length);
      armText[arm.name] = text;
      for (const [, key, min, max] of text.matchAll(
        /prop_f32\(&props,\s*"(\w+)",\s*([^,]+),\s*([^)]+)\)/g,
      )) {
        (scannedRanges[arm.name] ??= {})[key] = { min: literal(min), max: literal(max) };
      }
      for (const [, key, max] of text.matchAll(/prop_u32\(&props,\s*"(\w+)",\s*([^)]+)\)/g)) {
        (scannedMaxima[arm.name] ??= {})[key] = literal(max);
      }
    });

    /**
     * Round-trip one field through the store and back out to the wire.
     *
     * Reading the result off `toWireComponent` rather than off the store object
     * means the assertion is in the engine's own vocabulary, so the one component
     * whose field names diverge needs no reverse mapping here.
     */
    const STORE_PROP_KEY: Record<string, string> = { interactionRadius: 'triggerRadius' };
    const wireValue = (engineType: string, key: string, value: number): unknown => {
      const built = buildStoreComponent(engineType, { [STORE_PROP_KEY[key] ?? key]: value });
      if (built === null) throw new Error(`buildStoreComponent rejected ${engineType}`);
      return toWireComponent(built).properties[key];
    };

    it('finds the clamp sites in the engine source', () => {
      // Self-check. A renamed function or a reindented match arm would leave both
      // scanned tables empty, and an empty scan makes the drift comparisons below
      // pass on nothing in one direction.
      expect(fnStart, 'build_game_component not found').toBeGreaterThanOrEqual(0);
      expect(fnEnd, 'end of build_game_component not found').toBeGreaterThan(fnStart);
      expect(armStarts.map(arm => arm.name).sort()).toEqual([...ENGINE_NAMES].sort());
      expect(Object.keys(scannedRanges).length).toBeGreaterThan(0);
      expect(Object.keys(scannedMaxima).length).toBeGreaterThan(0);
      for (const fields of [...Object.values(scannedRanges), ...Object.values(scannedMaxima)]) {
        for (const bound of Object.values(fields)) {
          for (const n of typeof bound === 'number' ? [bound] : [bound.min, bound.max]) {
            expect(Number.isFinite(n), 'unparseable Rust literal').toBe(true);
          }
        }
      }
    });

    it('accounts for every prop_f32 / prop_u32 call site in the file', () => {
      // "Not zero" is not enough. Every step of the extraction above can drop a
      // call site QUIETLY: an arm head reindented out of the 8-space anchor
      // takes its whole arm with it, and a call spelled in a way the regex does
      // not match — a line break after `&props`, an extra space — simply is not
      // seen. Either way the two `toEqual`s below still pass, because they
      // compare the table against a scan that no longer covers the file. That is
      // the same silent drift the tables exist to prevent, one level up.
      //
      // So pin the COUNT against the whole file rather than the scanned slice: a
      // call site that moves OUT of `build_game_component` fails here too, and
      // deliberately — whether the scan should follow it is a human decision,
      // not something a test should absorb.
      const occurrences = (fn: string) =>
        [...rustSource.matchAll(new RegExp(String.raw`\b${fn}\(\s*&props\b`, 'g'))].length;
      const extracted = (table: Record<string, Record<string, unknown>>) =>
        Object.values(table).reduce((n, fields) => n + Object.keys(fields).length, 0);

      expect(extracted(scannedRanges), 'prop_f32 call sites the scan did not reach').toBe(
        occurrences('prop_f32'),
      );
      expect(extracted(scannedMaxima), 'prop_u32 call sites the scan did not reach').toBe(
        occurrences('prop_u32'),
      );
    });

    it('holds exactly the float ranges the engine applies', () => {
      // One bidirectional comparison: a changed bound, a field the engine gained,
      // and a field the engine dropped all fail here.
      expect(scannedRanges).toEqual(ENGINE_PROP_RANGES);
    });

    it('holds exactly the u32 ceilings the engine applies', () => {
      expect(scannedMaxima).toEqual(ENGINE_PROP_MAXIMA);
    });

    for (const [engineType, fields] of Object.entries(ENGINE_PROP_RANGES)) {
      for (const [key, range] of Object.entries(fields)) {
        it(`clamps ${engineType}.${key} onto the number the engine keeps`, () => {
          expect(wireValue(engineType, key, range.max * 10 + 1)).toBe(range.max);
          expect(wireValue(engineType, key, range.min - 1)).toBe(range.min);
          // In range is left alone — a clamp that also rounds or rescales would
          // pass the two bounds above.
          const inside = (range.min + range.max) / 2;
          expect(wireValue(engineType, key, inside)).toBe(inside);
        });
      }
    }

    for (const [engineType, fields] of Object.entries(ENGINE_PROP_MAXIMA)) {
      for (const [key, max] of Object.entries(fields)) {
        it(`rounds and clamps ${engineType}.${key} the way prop_u32 does`, () => {
          expect(wireValue(engineType, key, max + 10)).toBe(max);
          // `prop_u32` clamps at 0 rather than taking a minimum, so a negative is
          // zero on both sides rather than an error on either.
          expect(wireValue(engineType, key, -5)).toBe(0);
          expect(wireValue(engineType, key, 2.6)).toBe(3);
          // The u32 path takes the OPPOSITE branch to the float path on the same
          // input, and that asymmetry is deliberate rather than an oversight:
          // `prop_f32` narrows through `as f32` and drops what overflows, while
          // `prop_u32` clamps the `as_f64()` directly and never narrows. So the
          // finite check here has to stay `Number.isFinite` where the float path
          // needs `isEngineFinite` — tightening this one to match its neighbour
          // would put the store on `0` where the engine sits on `max`.
          expect(wireValue(engineType, key, 1e300)).toBe(max);
        });
      }
    }

    it('drops a double the engine cannot hold rather than clamping it to the ceiling', () => {
      // `as_f64() as f32` overflows to infinity, `is_finite()` is false, and the
      // Rust `Default` stands. Clamping a `1e300` to `max` would look like the
      // careful thing to do and would put the two sides on different numbers.
      expect(wireValue('projectile', 'speed', 1e300)).toBe(15);
      expect(wireValue('character_controller', 'speed', 1e300)).toBe(5);
    });

    it('defaults currentHp to a maxHp that has already been clamped', () => {
      // `num` returns its fallback verbatim — it does not clamp it — so the fact
      // that `currentHp`'s fallback is the ALREADY-clamped `maxHp` is what keeps
      // the two in range together. Falling back to the raw `props.maxHp` would
      // read as the same line and would hand the engine a `currentHp` it caps at
      // a million while the store held five.
      expect(buildStoreComponent('health', { maxHp: 5_000_000 })).toEqual({
        type: 'health',
        health: {
          maxHp: 1_000_000,
          currentHp: 1_000_000,
          invincibilitySecs: 0.5,
          respawnOnDeath: true,
          respawnPoint: [0, 1, 0],
          despawnOnDeath: true,
        },
      });
    });

    it('clamps a whole component handed back by the inspector', () => {
      // The inspector never calls `buildStoreComponent` — it edits one field and
      // hands the whole object to the store, which normalizes it. Same coercions
      // or the panel becomes a way around the table.
      const wild: GameComponentData = {
        type: 'follower',
        follower: { targetEntityId: null, speed: 9999, stopDistance: -3, lookAtTarget: true },
      };
      expect(normalizeGameComponent(wild)).toEqual({
        type: 'follower',
        follower: { targetEntityId: null, speed: 1000, stopDistance: 0, lookAtTarget: true },
      });
    });

    it('normalizes the one component whose store names are not the engine names', () => {
      // `normalizeGameComponent` reads the component back through `propsOf`
      // (store names), not the `propertiesOf` used on the way out to the wire.
      // They agree everywhere except `dialogueTrigger`, so this is the only
      // component that can tell the two apart — read through the wire spelling,
      // every field here misses and the inspector's edit silently reverts to the
      // defaults instead of being clamped.
      const edited: GameComponentData = {
        type: 'dialogueTrigger',
        dialogueTrigger: {
          treeId: 'tree_intro',
          triggerRadius: 9999,
          requireInteract: false,
          interactKey: 'use',
          oneShot: true,
        },
      };
      expect(normalizeGameComponent(edited)).toEqual({
        type: 'dialogueTrigger',
        dialogueTrigger: {
          treeId: 'tree_intro',
          triggerRadius: 100,
          requireInteract: false,
          interactKey: 'use',
          oneShot: true,
        },
      });
    });

    /**
     * Both helpers go through the real production path rather than calling `oneOf`
     * directly. Every `collectAll` elsewhere in the suite is a hand-built object
     * literal that never touches coercion, so nothing proved the vocabulary was
     * reachable — only that its declared members were well-typed.
     */
    const oneOfLoopMode = (v: unknown) => {
      const c = parseGameComponentWire({
        componentType: 'moving_platform',
        properties: { loopMode: v },
      });
      return c?.type === 'movingPlatform' ? c.movingPlatform.loopMode : null;
    };
    const oneOfConditionType = (v: unknown) => {
      const c = parseGameComponentWire({
        componentType: 'win_condition',
        properties: { conditionType: v },
      });
      return c?.type === 'winCondition' ? c.winCondition.conditionType : null;
    };

    it('round-trips every declared enum member through coercion', () => {
      // Each member must survive `oneOf` as itself. A member deleted from the
      // vocabulary collapses to the fallback here, which is the failure the type
      // system cannot see.
      for (const mode of PLATFORM_LOOP_MODES) expect(oneOfLoopMode(mode)).toBe(mode);
      for (const type of WIN_CONDITION_TYPES) expect(oneOfConditionType(type)).toBe(type);
    });

    /**
     * The two string enums are the same category of hand-mirrored table as the
     * numeric bounds above, so they get the same treatment. The engine's `match`
     * lists only the non-default members; its `_ =>` arm supplies the rest. So the
     * vocabulary the TypeScript must accept is `explicit arms ∪ {fallback}`, and
     * its own fallback must be the Rust's. Renaming `collectAll` on either side
     * alone fails here.
     */
    const rustEnum = (arm: string, enumName: string): { members: string[]; fallback: string } => {
      const members = [
        ...arm.matchAll(new RegExp(String.raw`"(\w+)"\s*=>\s*${enumName}::(\w+)`, 'g')),
      ].map(m => m[1]);
      const fallbackMatch = arm.match(new RegExp(String.raw`_\s*=>\s*${enumName}::(\w+)`));
      if (!fallbackMatch) throw new Error(`no \`_ =>\` fallback arm found for ${enumName}`);
      // Rust variant `PingPong` ⇒ wire member `pingPong`; the enum derives camelCase.
      const fallback = fallbackMatch[1].charAt(0).toLowerCase() + fallbackMatch[1].slice(1);
      return { members, fallback };
    };

    it('accepts exactly the platform loop modes the engine understands', () => {
      const { members, fallback } = rustEnum(armText.moving_platform, 'PlatformLoopMode');
      expect(members.length, 'no explicit loopMode arms found — the scan broke').toBeGreaterThan(0);
      expect([...PLATFORM_LOOP_MODES].sort()).toEqual([...new Set([...members, fallback])].sort());
      // The fallback is what an unknown string collapses to on both sides.
      expect(oneOfLoopMode('nonsense')).toBe(fallback);
    });

    it('accepts exactly the win condition types the engine understands', () => {
      const { members, fallback } = rustEnum(armText.win_condition, 'WinConditionType');
      expect(members.length, 'no explicit conditionType arms found — the scan broke').toBeGreaterThan(
        0,
      );
      expect([...WIN_CONDITION_TYPES].sort()).toEqual([...new Set([...members, fallback])].sort());
      expect(oneOfConditionType('nonsense')).toBe(fallback);
    });
  });

  describe('sparse vec3 fields', () => {
    // `vec3` backs three fields, and each one was reached by the same defect:
    // validate with `.every`, then re-read by index. A field is not covered by
    // its siblings — they are three separate call sites.
    const propOf = (type: string, props: Record<string, unknown>) =>
      toWireComponent(buildStoreComponent(type, props)!).properties;

    it('falls back when respawnPoint has a hole', () => {
      // The hole below is deliberate — it IS the input under test.
      expect(propOf('health', { respawnPoint: [1, , 3] }).respawnPoint).toEqual([0, 1, 0]);
    });

    it('falls back when targetPosition has a hole', () => {
      expect(propOf('teleporter', { targetPosition: new Array(3) }).targetPosition).toEqual([
        0, 1, 0,
      ]);
    });

    it('falls back when spawnOffset has a hole', () => {
      // The hole below is deliberate — it IS the input under test.
      expect(propOf('spawner', { spawnOffset: [, 1, 2] }).spawnOffset).toEqual([0, 1, 0]);
    });

    it('still accepts a well-formed vector', () => {
      // Without this, a `vec3` that returned the fallback unconditionally passes
      // all three tests above.
      expect(propOf('health', { respawnPoint: [7, 8, 9] }).respawnPoint).toEqual([7, 8, 9]);
    });

    it('reads each slot once, so a getter cannot answer differently the second time', () => {
      // Validate-then-re-read is a TOCTOU seam as well as a hole seam: the value
      // that passed the check need not be the value that crosses the wire. This
      // array answers finite on the first read of index 1 and `NaN` on the second,
      // which is a shape only the capture-first form is immune to.
      let reads = 0;
      const shifty = [0, 0, 0];
      Object.defineProperty(shifty, 1, {
        configurable: true,
        get: () => (reads++ === 0 ? 5 : NaN),
      });
      expect(propOf('health', { respawnPoint: shifty }).respawnPoint).toEqual([0, 5, 0]);
      expect(reads).toBe(1);
    });
  });
});

// The clamp tables are pinned against the Rust that defines them by the
// `describe('clamp tables match build_game_component')` block earlier in this
// file, which arrived with `ENGINE_PROP_RANGES` / `ENGINE_PROP_MAXIMA`
// (PF-1147). This branch carried a second scan of the same call sites under the
// names `F32_RANGES` / `U32_MAXES`; the two tables held identical bounds for
// identical fields and differed only in representation, so the duplicate scan
// was dropped rather than reconciled — two textual scans of one Rust function
// is a second thing to keep in step, not a second guarantee.

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

  /**
   * The component's own data object, whichever key it hangs off.
   *
   * The `!` this used to carry made the helper fail open: a component whose data bag
   * is missing yielded `undefined`, and the completeness loop below then iterated zero
   * keys and passed having asserted nothing. Throw instead — a missing bag is the
   * failure, not a reason to skip.
   */
  function dataOf(component: GameComponentData): Record<string, unknown> {
    const bag = (component as unknown as Record<string, Record<string, unknown> | undefined>)[
      component.type
    ];
    if (bag === undefined) throw new Error(`component "${component.type}" has no data bag`);
    return bag;
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

  const f32Cases = Object.entries(ENGINE_PROP_RANGES).flatMap(([componentType, fields]) =>
    Object.entries(fields).map(([key, { min, max }]) =>
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

  const u32Cases = Object.entries(ENGINE_PROP_MAXIMA).flatMap(([componentType, fields]) =>
    Object.entries(fields).map(([key, max]) => [componentType, key, max] as const),
  );

  it.each(u32Cases)('%s.%s rounds and clamps to [0, %d]', (componentType, key, max) => {
    // `prop_u32` parses through `as_f64`, so a fractional value rounds rather
    // than being rejected — and because `as_f64` accepts negatives, the engine
    // floors at zero explicitly.
    expect(roundTrip(componentType, key, 2.6)).toBe(3);
    expect(roundTrip(componentType, key, -5)).toBe(0);
    expect(roundTrip(componentType, key, max + 1000)).toBe(max);
    // The exact bounds, which the f32 sweep covers and this one used to skip: an
    // off-by-one in the clamp is invisible to a max+1000 probe.
    expect(roundTrip(componentType, key, max)).toBe(max);
    expect(roundTrip(componentType, key, 0)).toBe(0);
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
