/**
 * Edge case and supplementary tests for physicsSlice.
 *
 * Covers: null dispatcher behaviour, multiple-entity state isolation,
 * state consistency after interleaved operations, gravity and 2D debug commands.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createPhysicsSlice, setPhysicsDispatcher, type PhysicsSlice } from '../physicsSlice';
import type { PhysicsData, JointData, Physics2dData, Joint2dData } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePhysicsData(overrides: Partial<PhysicsData> = {}): PhysicsData {
  return {
    bodyType: 'dynamic',
    colliderShape: 'cuboid',
    restitution: 0.3,
    friction: 0.5,
    density: 1.0,
    gravityScale: 1.0,
    lockTranslationX: false,
    lockTranslationY: false,
    lockTranslationZ: false,
    lockRotationX: false,
    lockRotationY: false,
    lockRotationZ: false,
    isSensor: false,
    ...overrides,
  };
}

function makePhysics2dData(overrides: Partial<Physics2dData> = {}): Physics2dData {
  return {
    bodyType: 'dynamic',
    colliderShape: 'box',
    size: [1, 1],
    radius: 0.5,
    vertices: [],
    mass: 1.0,
    friction: 0.5,
    restitution: 0.0,
    gravityScale: 1.0,
    isSensor: false,
    lockRotation: false,
    continuousDetection: false,
    oneWayPlatform: false,
    surfaceVelocity: [0, 0],
    ...overrides,
  };
}

function makeJointData(overrides: Partial<JointData> = {}): JointData {
  return {
    jointType: 'revolute',
    connectedEntityId: 'ent-b',
    anchorSelf: [0, 0, 0],
    anchorOther: [0, 0, 0],
    axis: [0, 1, 0],
    limits: null,
    motor: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('physicsSlice — edge cases', () => {
  let store: ReturnType<typeof createSliceStore<PhysicsSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    store = createSliceStore(createPhysicsSlice);
    mockDispatch = createMockDispatch();
    setPhysicsDispatcher(mockDispatch);
  });

  afterEach(() => {
    setPhysicsDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  // =========================================================================
  // Null dispatcher — all dispatch-only actions silently no-op
  // =========================================================================

  describe('null dispatcher — actions should not throw', () => {
    beforeEach(() => {
      setPhysicsDispatcher(null as unknown as (command: string, payload: unknown) => void);
    });

    it('updatePhysics does not throw when dispatcher is null', () => {
      expect(() => {
        store.getState().updatePhysics('ent1', makePhysicsData());
      }).not.toThrow();
    });

    it('togglePhysics does not throw when dispatcher is null', () => {
      expect(() => {
        store.getState().togglePhysics('ent1', true);
      }).not.toThrow();
    });

    it('toggleDebugPhysics does not throw when dispatcher is null', () => {
      expect(() => {
        store.getState().toggleDebugPhysics();
      }).not.toThrow();
    });

    it('createJoint does not throw when dispatcher is null', () => {
      expect(() => {
        store.getState().createJoint('ent1', makeJointData());
      }).not.toThrow();
    });

    it('updateJoint does not throw when dispatcher is null', () => {
      expect(() => {
        store.getState().updateJoint('ent1', { jointType: 'fixed' });
      }).not.toThrow();
    });

    it('removeJoint does not throw when dispatcher is null', () => {
      expect(() => {
        store.getState().removeJoint('ent1');
      }).not.toThrow();
    });

    it('setPhysics2d updates state even when dispatcher is null', () => {
      const data = makePhysics2dData({ bodyType: 'static' });
      store.getState().setPhysics2d('ent1', data, true);

      expect(store.getState().physics2d.ent1).toEqual(data);
      expect(store.getState().physics2dEnabled.ent1).toBe(true);
    });

    it('removePhysics2d updates state even when dispatcher is null', () => {
      const data = makePhysics2dData();
      store.getState().setPhysics2d('ent1', data, true);
      store.getState().removePhysics2d('ent1');

      expect(store.getState().physics2d.ent1).toBeUndefined();
    });

    it('setGravity2d does not throw when dispatcher is null', () => {
      expect(() => {
        store.getState().setGravity2d(0, -9.81);
      }).not.toThrow();
    });

    it('setDebugPhysics2d does not throw when dispatcher is null', () => {
      expect(() => {
        store.getState().setDebugPhysics2d(true);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Multiple entities — state isolation
  // =========================================================================

  describe('multiple entity state isolation', () => {
    it('stores physics2d for multiple entities independently', () => {
      const dataA = makePhysics2dData({ bodyType: 'dynamic', mass: 1.0 });
      const dataB = makePhysics2dData({ bodyType: 'static', mass: 0 });
      const dataC = makePhysics2dData({ bodyType: 'kinematic', isSensor: true });

      store.getState().setPhysics2d('entity-A', dataA, true);
      store.getState().setPhysics2d('entity-B', dataB, false);
      store.getState().setPhysics2d('entity-C', dataC, true);

      const state = store.getState();
      expect(state.physics2d['entity-A']).toEqual(dataA);
      expect(state.physics2d['entity-B']).toEqual(dataB);
      expect(state.physics2d['entity-C']).toEqual(dataC);
      expect(state.physics2dEnabled['entity-A']).toBe(true);
      expect(state.physics2dEnabled['entity-B']).toBe(false);
      expect(state.physics2dEnabled['entity-C']).toBe(true);
    });

    it('removing one entity does not affect others', () => {
      const dataA = makePhysics2dData({ bodyType: 'dynamic' });
      const dataB = makePhysics2dData({ bodyType: 'static' });

      store.getState().setPhysics2d('entity-A', dataA, true);
      store.getState().setPhysics2d('entity-B', dataB, true);
      store.getState().removePhysics2d('entity-A');

      const state = store.getState();
      expect(state.physics2d['entity-A']).toBeUndefined();
      expect(state.physics2dEnabled['entity-A']).toBeUndefined();
      expect(state.physics2d['entity-B']).toEqual(dataB);
      expect(state.physics2dEnabled['entity-B']).toBe(true);
    });

    it('togglePhysics2d for one entity does not change others', () => {
      const data = makePhysics2dData();
      store.getState().setPhysics2d('entity-A', data, true);
      store.getState().setPhysics2d('entity-B', data, true);

      store.getState().togglePhysics2d('entity-A', false);

      expect(store.getState().physics2dEnabled['entity-A']).toBe(false);
      expect(store.getState().physics2dEnabled['entity-B']).toBe(true);
    });

    it('stores multiple joints2d independently', () => {
      const jointA: Joint2dData = {
        targetEntityId: 10,
        jointType: 'revolute',
        localAnchor1: [0, 1],
        localAnchor2: [0, -1],
      };
      const jointB: Joint2dData = {
        targetEntityId: 20,
        jointType: 'prismatic',
        localAnchor1: [1, 0],
        localAnchor2: [-1, 0],
        axis: [1, 0],
        limits: [0, 5],
      };

      store.getState().setJoint2d('entity-A', jointA);
      store.getState().setJoint2d('entity-B', jointB);

      expect(store.getState().joints2d['entity-A']).toEqual(jointA);
      expect(store.getState().joints2d['entity-B']).toEqual(jointB);
    });

    it('removeJoint2d does not remove other joints', () => {
      const jointA: Joint2dData = {
        targetEntityId: 1,
        jointType: 'rope',
        localAnchor1: [0, 0],
        localAnchor2: [0, 0],
        maxDistance: 5,
      };
      const jointB: Joint2dData = {
        targetEntityId: 2,
        jointType: 'spring',
        localAnchor1: [0, 0],
        localAnchor2: [0, 0],
      };

      store.getState().setJoint2d('entity-A', jointA);
      store.getState().setJoint2d('entity-B', jointB);
      store.getState().removeJoint2d('entity-A');

      expect(store.getState().joints2d['entity-A']).toBeUndefined();
      expect(store.getState().joints2d['entity-B']).toEqual(jointB);
    });
  });

  // =========================================================================
  // State transitions and consistency
  // =========================================================================

  describe('state transitions and consistency', () => {
    it('setPrimaryPhysics to null clears physics data', () => {
      const data = makePhysicsData();
      store.getState().setPrimaryPhysics(data, true);
      expect(store.getState().primaryPhysics).toEqual(data);

      store.getState().setPrimaryPhysics(null, false);
      expect(store.getState().primaryPhysics).toBeNull();
      expect(store.getState().physicsEnabled).toBe(false);
    });

    it('setPrimaryJoint to null clears joint data', () => {
      const joint = makeJointData();
      store.getState().setPrimaryJoint(joint);
      expect(store.getState().primaryJoint).toEqual(joint);

      store.getState().setPrimaryJoint(null);
      expect(store.getState().primaryJoint).toBeNull();
    });

    it('setDebugPhysics toggling back and forth is consistent', () => {
      expect(store.getState().debugPhysics).toBe(false);

      store.getState().setDebugPhysics(true);
      expect(store.getState().debugPhysics).toBe(true);

      store.getState().setDebugPhysics(false);
      expect(store.getState().debugPhysics).toBe(false);

      store.getState().setDebugPhysics(true);
      expect(store.getState().debugPhysics).toBe(true);
    });

    it('updatePhysics overwrites all previous primaryPhysics fields', () => {
      const first = makePhysicsData({ bodyType: 'dynamic', density: 1.0 });
      const second = makePhysicsData({ bodyType: 'fixed', density: 5.0 });

      store.getState().updatePhysics('ent1', first);
      expect(store.getState().primaryPhysics).toEqual(first);

      store.getState().updatePhysics('ent1', second);
      expect(store.getState().primaryPhysics).toEqual(second);
    });

    it('updatePhysics2d updates data but does not change enabled state', () => {
      const initial = makePhysics2dData({ mass: 1.0 });
      store.getState().setPhysics2d('ent1', initial, false);

      const updated = makePhysics2dData({ mass: 5.0 });
      store.getState().updatePhysics2d('ent1', updated);

      // Data updated
      expect(store.getState().physics2d['ent1']).toEqual(updated);
      // Enabled state unchanged
      expect(store.getState().physics2dEnabled['ent1']).toBe(false);
    });
  });

  // =========================================================================
  // All 3D physics body types
  // =========================================================================

  describe('all bodyType variants', () => {
    const bodyTypes: PhysicsData['bodyType'][] = [
      'dynamic',
      'fixed',
      'kinematic_position',
      'kinematic_velocity',
    ];

    for (const bodyType of bodyTypes) {
      it(`correctly stores bodyType=${bodyType}`, () => {
        const data = makePhysicsData({ bodyType });
        store.getState().setPrimaryPhysics(data, true);
        expect(store.getState().primaryPhysics?.bodyType).toBe(bodyType);
      });
    }
  });

  // =========================================================================
  // All collider shapes
  // =========================================================================

  describe('all colliderShape variants', () => {
    const shapes: PhysicsData['colliderShape'][] = [
      'cuboid',
      'ball',
      'cylinder',
      'capsule',
      'auto',
    ];

    for (const colliderShape of shapes) {
      it(`correctly stores colliderShape=${colliderShape}`, () => {
        const data = makePhysicsData({ colliderShape });
        store.getState().setPrimaryPhysics(data, true);
        expect(store.getState().primaryPhysics?.colliderShape).toBe(colliderShape);
      });
    }
  });

  // =========================================================================
  // All joint types
  // =========================================================================

  describe('all jointType variants', () => {
    const jointTypes: JointData['jointType'][] = [
      'fixed',
      'revolute',
      'spherical',
      'prismatic',
      'rope',
      'spring',
    ];

    for (const jointType of jointTypes) {
      it(`createJoint dispatches correct command for jointType=${jointType}`, () => {
        const data = makeJointData({ jointType });
        store.getState().createJoint('ent1', data);
        expect(mockDispatch).toHaveBeenCalledWith('create_joint', expect.objectContaining({ jointType }));
      });
    }
  });

  // =========================================================================
  // Lock translation and rotation combinations
  // =========================================================================

  describe('translation and rotation lock combinations', () => {
    it('dispatches all-lock-true physics update correctly', () => {
      const data = makePhysicsData({
        lockTranslationX: true,
        lockTranslationY: true,
        lockTranslationZ: true,
        lockRotationX: true,
        lockRotationY: true,
        lockRotationZ: true,
      });

      store.getState().updatePhysics('ent-lock-all', data);

      const dispatched = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(dispatched.lockTranslationX).toBe(true);
      expect(dispatched.lockTranslationY).toBe(true);
      expect(dispatched.lockTranslationZ).toBe(true);
      expect(dispatched.lockRotationX).toBe(true);
      expect(dispatched.lockRotationY).toBe(true);
      expect(dispatched.lockRotationZ).toBe(true);
    });

    it('dispatches mixed lock states correctly', () => {
      const data = makePhysicsData({
        lockTranslationX: false,
        lockTranslationY: true,
        lockTranslationZ: false,
        lockRotationX: true,
        lockRotationY: false,
        lockRotationZ: false,
      });

      store.getState().updatePhysics('ent-lock-partial', data);

      const dispatched = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(dispatched.lockTranslationY).toBe(true);
      expect(dispatched.lockRotationX).toBe(true);
      expect(dispatched.lockTranslationX).toBe(false);
      expect(dispatched.lockTranslationZ).toBe(false);
      expect(dispatched.lockRotationY).toBe(false);
      expect(dispatched.lockRotationZ).toBe(false);
    });
  });

  // =========================================================================
  // 2D joint type variants
  // =========================================================================

  describe('2D joint types', () => {
    const joint2dTypes: Joint2dData['jointType'][] = [
      'revolute',
      'prismatic',
      'rope',
      'spring',
    ];

    for (const jointType of joint2dTypes) {
      it(`setJoint2d dispatches correct command for jointType=${jointType}`, () => {
        const data: Joint2dData = {
          targetEntityId: 5,
          jointType,
          localAnchor1: [0, 0],
          localAnchor2: [0, 0],
        };

        store.getState().setJoint2d('sprite-1', data);

        expect(mockDispatch).toHaveBeenCalledWith(
          'set_joint_2d',
          expect.objectContaining({ jointType })
        );
      });
    }
  });

  // =========================================================================
  // 2D physics body type variants
  // =========================================================================

  describe('2D body type variants', () => {
    const bodyTypes: Physics2dData['bodyType'][] = ['dynamic', 'static', 'kinematic'];

    for (const bodyType of bodyTypes) {
      it(`setPhysics2d stores correct bodyType=${bodyType}`, () => {
        const data = makePhysics2dData({ bodyType });
        store.getState().setPhysics2d('sprite-1', data, true);

        expect(store.getState().physics2d['sprite-1'].bodyType).toBe(bodyType);
      });
    }
  });

  // =========================================================================
  // 2D collider shape variants
  // =========================================================================

  describe('2D collider shape variants', () => {
    const shapes: Physics2dData['colliderShape'][] = [
      'box',
      'circle',
      'capsule',
      'convex_polygon',
      'edge',
      'auto',
    ];

    for (const colliderShape of shapes) {
      it(`setPhysics2d stores correct colliderShape=${colliderShape}`, () => {
        const data = makePhysics2dData({ colliderShape });
        store.getState().setPhysics2d('sprite-1', data, true);

        expect(store.getState().physics2d['sprite-1'].colliderShape).toBe(colliderShape);
      });
    }
  });

  // =========================================================================
  // Gravity and debug commands dispatch correctly
  // =========================================================================

  describe('gravity and debug dispatch', () => {
    it('setGravity2d dispatches with correct gravity values', () => {
      store.getState().setGravity2d(0, -9.81);
      expect(mockDispatch).toHaveBeenCalledWith('set_gravity2d', { gravityX: 0, gravityY: -9.81 });
    });

    it('setGravity2d can set positive (anti-gravity) values', () => {
      store.getState().setGravity2d(0, 9.81);
      expect(mockDispatch).toHaveBeenCalledWith('set_gravity2d', { gravityX: 0, gravityY: 9.81 });
    });

    it('setGravity2d can set horizontal gravity', () => {
      store.getState().setGravity2d(-5.0, 0);
      expect(mockDispatch).toHaveBeenCalledWith('set_gravity2d', { gravityX: -5.0, gravityY: 0 });
    });

    it('setDebugPhysics2d dispatches enabled=true', () => {
      store.getState().setDebugPhysics2d(true);
      expect(mockDispatch).toHaveBeenCalledWith('set_debug_physics2d', { enabled: true });
    });

    it('setDebugPhysics2d dispatches enabled=false', () => {
      store.getState().setDebugPhysics2d(false);
      expect(mockDispatch).toHaveBeenCalledWith('set_debug_physics2d', { enabled: false });
    });

    it('setGravity2d does not modify physics2d records', () => {
      const data = makePhysics2dData();
      store.getState().setPhysics2d('ent1', data, true);

      store.getState().setGravity2d(0, -20);

      expect(store.getState().physics2d['ent1']).toEqual(data);
    });
  });

  // =========================================================================
  // Joint limits and motor configuration
  // =========================================================================

  describe('joint limits and motor configuration', () => {
    it('createJoint with limits dispatches min/max correctly', () => {
      const data = makeJointData({
        jointType: 'revolute',
        limits: { min: -45, max: 45 },
      });

      store.getState().createJoint('ent1', data);

      const dispatched = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(dispatched.limits).toEqual({ min: -45, max: 45 });
    });

    it('createJoint with motor dispatches motor params correctly', () => {
      const data = makeJointData({
        jointType: 'prismatic',
        motor: { targetVelocity: 2.5, maxForce: 50.0 },
      });

      store.getState().createJoint('ent1', data);

      const dispatched = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(dispatched.motor).toEqual({ targetVelocity: 2.5, maxForce: 50.0 });
    });

    it('createJoint with null limits and motor dispatches nulls', () => {
      const data = makeJointData({ limits: null, motor: null });
      store.getState().createJoint('ent1', data);

      const dispatched = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(dispatched.limits).toBeNull();
      expect(dispatched.motor).toBeNull();
    });

    it('setPrimaryJoint stores limits correctly', () => {
      const joint = makeJointData({ limits: { min: 0, max: 180 } });
      store.getState().setPrimaryJoint(joint);

      expect(store.getState().primaryJoint?.limits).toEqual({ min: 0, max: 180 });
    });
  });

  // =========================================================================
  // isSensor flag behaviour
  // =========================================================================

  describe('isSensor flag behaviour', () => {
    it('physics body with isSensor=true stores correctly', () => {
      const data = makePhysicsData({ isSensor: true });
      store.getState().setPrimaryPhysics(data, true);

      expect(store.getState().primaryPhysics?.isSensor).toBe(true);
    });

    it('2D physics body with isSensor=true stores correctly', () => {
      const data = makePhysics2dData({ isSensor: true });
      store.getState().setPhysics2d('trigger-area', data, true);

      expect(store.getState().physics2d['trigger-area'].isSensor).toBe(true);
    });
  });

  // =========================================================================
  // oneWayPlatform and continuousDetection 2D flags
  // =========================================================================

  describe('2D-specific physics flags', () => {
    it('oneWayPlatform=true stores and dispatches correctly', () => {
      const data = makePhysics2dData({ oneWayPlatform: true });
      store.getState().setPhysics2d('platform', data, true);

      expect(store.getState().physics2d['platform'].oneWayPlatform).toBe(true);
      const dispatched = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(dispatched.oneWayPlatform).toBe(true);
    });

    it('continuousDetection=true stores and dispatches correctly', () => {
      const data = makePhysics2dData({ continuousDetection: true });
      store.getState().setPhysics2d('fast-bullet', data, true);

      expect(store.getState().physics2d['fast-bullet'].continuousDetection).toBe(true);
    });

    it('surfaceVelocity stores non-zero values correctly', () => {
      const data = makePhysics2dData({ surfaceVelocity: [3.5, 0] });
      store.getState().setPhysics2d('conveyor-belt', data, true);

      expect(store.getState().physics2d['conveyor-belt'].surfaceVelocity).toEqual([3.5, 0]);
    });
  });
});
