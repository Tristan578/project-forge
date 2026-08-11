import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  toWireComponent,
  toEngineComponentType,
  toStoreComponentType,
  buildStoreComponent,
  ENGINE_COMPONENT_TYPES,
  ENGINE_COMPONENT_CATALOG,
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
      expect(built({ waypoints: [[1e300, 0, 0], [1, 2, 3]] })).toEqual([[1, 2, 3]]);
    });

    it('falls back to the Rust default route when nothing survives', () => {
      // `if !waypoints.is_empty()` in the engine — an empty list would leave
      // `system_moving_platform` refusing to move the platform at all.
      const fallback = [
        [0, 0, 0],
        [0, 3, 0],
      ];
      expect(built({ waypoints: ['junk', []] })).toEqual(fallback);
      expect(built({ waypoints: [] })).toEqual(fallback);
      expect(built({ waypoints: 'not an array' })).toEqual(fallback);
    });

    it('survives the round trip to the wire at the cap', () => {
      const wire = toWireComponent(
        buildStoreComponent('moving_platform', { waypoints: route(RUST_MAX + 100) })!,
      );
      expect(wire.properties.waypoints).toHaveLength(RUST_MAX);
    });
  });
});
