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
  // `despawnOnDeath` is the one Rust field with no TS counterpart. Omitting it
  // leaves the Rust default (`true`) standing, which is the behaviour we want,
  // so the gap is currently benign — but it is not authorable from the editor.
  // Listed nowhere below on purpose.
  health: ['maxHp', 'currentHp', 'invincibilitySecs', 'respawnOnDeath', 'respawnPoint'],
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
