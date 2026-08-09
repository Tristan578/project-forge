/**
 * Tests for the `update_physics` wire contract.
 *
 * This module exists because the engine CANNOT reject a bad key: `PhysicsPatch`
 * is all-`Option` (so a partial payload is legal) and `#[serde(deny_unknown_fields)]`
 * is incompatible with the `#[serde(flatten)]` on `UpdatePhysicsPayload`. A typo
 * therefore deserializes to `None` and silently no-ops. The allowlist below is the
 * only thing standing between a caller-shaped object and a dispatch that quietly
 * does nothing, so it is tested as behaviour, not as a formality.
 */
import { describe, it, expect } from 'vitest';
import { buildPhysicsPatch, PHYSICS_PATCH_KEYS } from '../updatePhysicsPayload';
import type { PhysicsData } from '@/stores/slices/types';

describe('PHYSICS_PATCH_KEYS', () => {
  it('lists exactly the 13 PhysicsData fields the engine accepts', () => {
    // Hard-coded rather than derived from the type: a test that regenerates the
    // list from the same source it is checking proves nothing. If Rust's
    // PhysicsData gains a field, this fails and forces a deliberate update on
    // both sides of the bridge.
    expect([...PHYSICS_PATCH_KEYS].sort()).toEqual([
      'bodyType',
      'colliderShape',
      'density',
      'friction',
      'gravityScale',
      'isSensor',
      'lockRotationX',
      'lockRotationY',
      'lockRotationZ',
      'lockTranslationX',
      'lockTranslationY',
      'lockTranslationZ',
      'restitution',
    ]);
  });

  it('has no duplicate keys', () => {
    expect(new Set(PHYSICS_PATCH_KEYS).size).toBe(PHYSICS_PATCH_KEYS.length);
  });
});

describe('buildPhysicsPatch', () => {
  it('emits only entityId when the patch is empty', () => {
    // A bare `{ entityId }` is a legal no-op patch — every engine-side field
    // stays at its live value. What must NOT happen is the old behaviour of
    // synthesizing 13 defaults and overwriting the entity.
    expect(buildPhysicsPatch('ent-1', {})).toEqual({ entityId: 'ent-1' });
  });

  it('carries through exactly the fields that were supplied', () => {
    const payload = buildPhysicsPatch('ground', { restitution: 0.9 });
    expect(payload).toEqual({ entityId: 'ground', restitution: 0.9 });
  });

  it('omits explicitly-undefined fields rather than emitting the key', () => {
    // `{ friction: undefined }` is what an optional destructure produces when the
    // caller said nothing about friction. Emitting the key would be honest only
    // if it meant "leave it alone" — it does not read that way to a reviewer, and
    // `JSON.stringify` drops it on the wire anyway.
    const payload = buildPhysicsPatch('ent-1', {
      friction: undefined,
      density: 2,
    } as Partial<PhysicsData>);
    expect(payload).toEqual({ entityId: 'ent-1', density: 2 });
    expect(Object.hasOwn(payload, 'friction')).toBe(false);
  });

  it('preserves falsy values that are NOT undefined', () => {
    // `0` and `false` are meaningful physics values — a truthiness filter here
    // would silently refuse to zero out gravity or unlock an axis.
    const payload = buildPhysicsPatch('ent-1', {
      gravityScale: 0,
      restitution: 0,
      isSensor: false,
      lockRotationX: false,
    });
    expect(payload).toEqual({
      entityId: 'ent-1',
      gravityScale: 0,
      restitution: 0,
      isSensor: false,
      lockRotationX: false,
    });
  });

  it('drops keys the engine does not accept instead of forwarding them', () => {
    // The defect this module closes. A misspelled `gravtiyScale` (or a stray
    // field from a caller-shaped object) deserializes to `None` engine-side and
    // no-ops with no error anywhere, so it has to be stopped here.
    const payload = buildPhysicsPatch('ent-1', {
      gravityScale: 3,
      gravtiyScale: 99,
      mass: 10,
      colliderSize: [1, 1, 1],
    } as unknown as Partial<PhysicsData>);
    expect(payload).toEqual({ entityId: 'ent-1', gravityScale: 3 });
  });

  it('reads own properties only, never inherited ones', () => {
    // A bare `patch[key]` read walks the prototype chain, so an object literal
    // with a `__proto__:` key contributes values the caller never set — and they
    // would reach the engine indistinguishable from deliberate ones.
    const viaProtoLiteral = buildPhysicsPatch('ent-1', {
      __proto__: { isSensor: true },
    } as unknown as Partial<PhysicsData>);
    expect(viaProtoLiteral).toEqual({ entityId: 'ent-1' });

    const viaObjectCreate = buildPhysicsPatch(
      'ent-2',
      Object.create({ gravityScale: 99 }, {
        friction: { value: 0.5, enumerable: true },
      }) as Partial<PhysicsData>,
    );
    expect(viaObjectCreate).toEqual({ entityId: 'ent-2', friction: 0.5 });
  });

  it('treats a literal "__proto__" data key as an unknown field and drops it', () => {
    // What `JSON.parse('{"__proto__":…}')` produces: an OWN key, not a prototype
    // swap. It is simply not on the allowlist.
    const payload = buildPhysicsPatch(
      'ent-1',
      JSON.parse('{"__proto__":{"isSensor":true},"friction":0.2}') as Partial<PhysicsData>,
    );
    expect(payload).toEqual({ entityId: 'ent-1', friction: 0.2 });
    expect(({} as Record<string, unknown>).isSensor).toBeUndefined();
  });

  it('accepts a full 13-field patch unchanged', () => {
    const full: PhysicsData = {
      bodyType: 'dynamic',
      colliderShape: 'ball',
      restitution: 0.5,
      friction: 0.4,
      density: 1.2,
      gravityScale: 1,
      lockTranslationX: true,
      lockTranslationY: false,
      lockTranslationZ: true,
      lockRotationX: false,
      lockRotationY: true,
      lockRotationZ: false,
      isSensor: true,
    };
    expect(buildPhysicsPatch('ent-1', full)).toEqual({ entityId: 'ent-1', ...full });
  });

  it('does not mutate the caller\'s patch object', () => {
    const patch: Partial<PhysicsData> = { friction: 0.3 };
    buildPhysicsPatch('ent-1', patch);
    expect(patch).toEqual({ friction: 0.3 });
  });
});
