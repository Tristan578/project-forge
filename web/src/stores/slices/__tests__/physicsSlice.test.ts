import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createPhysicsSlice, setPhysicsDispatcher, type PhysicsSlice } from '../physicsSlice';
import type { PhysicsData, JointData, Physics2dData, Joint2dData } from '../types';
import { defaultPhysics2dData } from '@/lib/physics/physics2dPayload';

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

describe('physicsSlice', () => {
  describe('initial state', () => {
    it('should have null primaryPhysics', () => {
      expect(store.getState().primaryPhysics).toBeNull();
    });

    it('should have false physicsEnabled', () => {
      expect(store.getState().physicsEnabled).toBe(false);
    });

    it('should have false debugPhysics', () => {
      expect(store.getState().debugPhysics).toBe(false);
    });

    it('should have empty physics2d and joints2d records', () => {
      const state = store.getState();
      expect(state.physics2d).toEqual({});
      expect(state.physics2dEnabled).toEqual({});
      expect(state.joints2d).toEqual({});
    });
  });

  describe('setPrimaryPhysics', () => {
    it('should set primaryPhysics and physicsEnabled (state only)', () => {
      const data: PhysicsData = { bodyType: 'dynamic', mass: 1.0 } as unknown as PhysicsData;
      store.getState().setPrimaryPhysics(data, true);

      expect(store.getState().primaryPhysics).toEqual(data);
      expect(store.getState().physicsEnabled).toBe(true);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should clear primaryPhysics when passed null', () => {
      const data: PhysicsData = { bodyType: 'dynamic' } as unknown as PhysicsData;
      store.getState().setPrimaryPhysics(data, true);
      store.getState().setPrimaryPhysics(null, false);

      expect(store.getState().primaryPhysics).toBeNull();
      expect(store.getState().physicsEnabled).toBe(false);
    });
  });

  describe('updatePhysics', () => {
    it('should update state and dispatch command', () => {
      const data: PhysicsData = { bodyType: 'dynamic', mass: 2.0 } as unknown as PhysicsData;
      store.getState().updatePhysics('entity1', data);

      expect(store.getState().primaryPhysics).toEqual(data);
      expect(mockDispatch).toHaveBeenCalledWith('update_physics', {
        entityId: 'entity1',
        ...data,
      });
    });
  });

  describe('togglePhysics', () => {
    it('should dispatch only (no state change)', () => {
      store.getState().togglePhysics('entity1', true);

      expect(mockDispatch).toHaveBeenCalledWith('toggle_physics', {
        entityId: 'entity1',
        enabled: true,
      });
    });
  });

  describe('toggleDebugPhysics', () => {
    it('should dispatch only (no state change)', () => {
      store.getState().toggleDebugPhysics();

      expect(mockDispatch).toHaveBeenCalledWith('toggle_debug_physics', {});
    });
  });

  describe('setDebugPhysics', () => {
    it('should set debugPhysics state only', () => {
      store.getState().setDebugPhysics(true);

      expect(store.getState().debugPhysics).toBe(true);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('setPrimaryJoint', () => {
    it('should set primaryJoint state only', () => {
      const data: JointData = { jointType: 'fixed' } as JointData;
      store.getState().setPrimaryJoint(data);

      expect(store.getState().primaryJoint).toEqual(data);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should clear primaryJoint when passed null', () => {
      const data: JointData = { jointType: 'fixed' } as JointData;
      store.getState().setPrimaryJoint(data);
      store.getState().setPrimaryJoint(null);

      expect(store.getState().primaryJoint).toBeNull();
    });
  });

  describe('createJoint', () => {
    it('should dispatch only', () => {
      const data: JointData = { jointType: 'fixed' } as JointData;
      store.getState().createJoint('entity1', data);

      expect(mockDispatch).toHaveBeenCalledWith('create_joint', {
        entityId: 'entity1',
        ...data,
      });
    });
  });

  describe('updateJoint', () => {
    it('should dispatch only', () => {
      const updates: Partial<JointData> = { jointType: 'revolute' };
      store.getState().updateJoint('entity1', updates);

      expect(mockDispatch).toHaveBeenCalledWith('update_joint', {
        entityId: 'entity1',
        ...updates,
      });
    });
  });

  describe('removeJoint', () => {
    it('should dispatch only', () => {
      store.getState().removeJoint('entity1');

      expect(mockDispatch).toHaveBeenCalledWith('remove_joint', {
        entityId: 'entity1',
      });
    });
  });

  describe('setPhysics2d', () => {
    it('should update state and dispatch', () => {
      const data: Physics2dData = { bodyType: 'dynamic', mass: 1.5 } as Physics2dData;
      store.getState().setPhysics2d('entity1', data, true);

      expect(store.getState().physics2d.entity1).toEqual(data);
      expect(store.getState().physics2dEnabled.entity1).toBe(true);
      // The engine reads a NESTED `physicsData`. This assertion used to spread the
      // fields flat next to `entityId`, which is a hard serde reject — and
      // `dispatchCommand` returns `void`, so the test passed while every 2D physics
      // edit was dropped before it reached the simulation (PF-1167).
      expect(mockDispatch).toHaveBeenCalledWith('set_physics_2d', {
        entityId: 'entity1',
        enabled: true,
        physicsData: data,
      });
    });

    it('should store physics data for multiple entities independently', () => {
      const data1: Physics2dData = { bodyType: 'dynamic' } as Physics2dData;
      const data2: Physics2dData = { bodyType: 'static' } as Physics2dData;
      store.getState().setPhysics2d('entity1', data1, true);
      store.getState().setPhysics2d('entity2', data2, false);

      expect(store.getState().physics2d.entity1).toEqual(data1);
      expect(store.getState().physics2d.entity2).toEqual(data2);
      expect(store.getState().physics2dEnabled.entity1).toBe(true);
      expect(store.getState().physics2dEnabled.entity2).toBe(false);
    });

    it('should set enabled to false when specified', () => {
      const data: Physics2dData = { bodyType: 'kinematic' } as Physics2dData;
      store.getState().setPhysics2d('entity1', data, false);

      expect(store.getState().physics2dEnabled.entity1).toBe(false);
      // `toEqual`, not `objectContaining`: the payload SHAPE is the behaviour here,
      // and `objectContaining({ enabled: false })` passes just as happily against
      // the old flat spread that the engine hard-rejected (PF-1167).
      expect(mockDispatch).toHaveBeenCalledWith('set_physics_2d', {
        entityId: 'entity1',
        physicsData: data,
        enabled: false,
      });
    });
  });

  describe('updatePhysics2d', () => {
    it('should update state and dispatch', () => {
      const data: Physics2dData = { bodyType: 'kinematic', mass: 0 } as Physics2dData;
      store.getState().updatePhysics2d('entity1', data);

      expect(store.getState().physics2d.entity1).toEqual(data);
      expect(mockDispatch).toHaveBeenCalledWith('update_physics_2d', {
        entityId: 'entity1',
        ...data,
      });
    });
  });

  describe('removePhysics2d', () => {
    it('should remove from both maps and dispatch', () => {
      const data: Physics2dData = { bodyType: 'dynamic', mass: 1.0 } as Physics2dData;
      store.getState().setPhysics2d('entity1', data, true);

      store.getState().removePhysics2d('entity1');

      expect(store.getState().physics2d.entity1).toBeUndefined();
      expect(store.getState().physics2dEnabled.entity1).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_physics_2d', {
        entityId: 'entity1',
      });
    });
  });

  describe('togglePhysics2d', () => {
    it('should update enabled map and dispatch', () => {
      store.getState().togglePhysics2d('entity1', true);

      expect(store.getState().physics2dEnabled.entity1).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith('toggle_physics_2d', {
        entityId: 'entity1',
        enabled: true,
      });
    });
  });

  describe('applyPhysics2dFromEngine', () => {
    it('should not dispatch anything', () => {
      // The whole reason this action exists. Routing the inbound
      // `PHYSICS2D_CHANGED` event through `setPhysics2d` would send
      // `set_physics_2d` straight back at the engine — a FULL REPLACE, so every
      // field the event did not carry would be reset on the entity the engine had
      // just finished describing, plus one echoed command per event (PF-1167).
      store.getState().applyPhysics2dFromEngine('entity1', { friction: 0.25 }, true);

      expect(store.getState().physics2d.entity1?.friction).toBe(0.25);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should merge onto existing state rather than replacing it', () => {
      const existing: Physics2dData = {
        ...defaultPhysics2dData(),
        bodyType: 'static',
        mass: 7,
        oneWayPlatform: true,
      };
      store.getState().setPhysics2d('entity1', existing, true);
      mockDispatch.mockClear();

      store.getState().applyPhysics2dFromEngine('entity1', { friction: 0.75 }, true);

      expect(store.getState().physics2d.entity1).toEqual({
        ...existing,
        friction: 0.75,
      });
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should merge onto engine defaults for an entity the store has never seen', () => {
      // A partial event about an unknown entity must not leave the other thirteen
      // fields `undefined` — the inspector reads them unconditionally
      // (`physics2d.mass.toFixed(1)`), so a hole here throws in the panel.
      store.getState().applyPhysics2dFromEngine('ghost', { bodyType: 'kinematic' }, true);

      expect(store.getState().physics2d.ghost).toEqual({
        ...defaultPhysics2dData(),
        bodyType: 'kinematic',
      });
    });

    it('should write enabled verbatim, including false', () => {
      store.getState().setPhysics2d('entity1', defaultPhysics2dData(), true);

      store.getState().applyPhysics2dFromEngine('entity1', {}, false);

      expect(store.getState().physics2dEnabled.entity1).toBe(false);
    });

    it('should not read an inherited key for an entity id from the prototype chain', () => {
      // `state.physics2d['__proto__']` is `Object.prototype` — truthy, so a bare
      // read would spread it as the "existing" state instead of falling back to
      // engine defaults. Hence the `Object.hasOwn` guard in the action.
      store.getState().applyPhysics2dFromEngine('__proto__', { mass: 3 }, true);

      expect(store.getState().physics2d['__proto__']).toEqual({
        ...defaultPhysics2dData(),
        mass: 3,
      });
    });
  });

  /**
   * Real joint fixtures, not `{ jointType } as unknown as Joint2dData`.
   *
   * The casts these replaced described a joint the type forbids — one had
   * `jointType: 'fixed'`, which is not one of the four variants — so they could
   * never have caught the wire-shape defect the payload builder exists to fix
   * (PF-1167).
   */
  function makeJoint2d(overrides: Partial<Joint2dData> = {}): Joint2dData {
    return {
      targetEntityId: 'entity2',
      jointType: 'revolute',
      localAnchor1: [0, 1],
      localAnchor2: [0, -1],
      ...overrides,
    };
  }

  describe('setJoint2d', () => {
    it('should update state and dispatch the full engine payload', () => {
      const data = makeJoint2d({ motorVelocity: 3, motorMaxForce: 40 });
      store.getState().setJoint2d('entity1', data);

      expect(store.getState().joints2d.entity1).toEqual(data);
      // Whole-payload assertion: the spread this replaced sent a shape the
      // engine rejected outright, and `objectContaining` cannot see that.
      expect(mockDispatch).toHaveBeenCalledWith('set_joint_2d', {
        entityId: 'entity1',
        targetEntityId: 'entity2',
        jointType: 'revolute',
        localAnchor1: [0, 1],
        localAnchor2: [0, -1],
        motorVelocity: 3,
        motorMaxForce: 40,
      });
    });

    it('should not send params belonging to another joint type', () => {
      // `maxDistance` is a rope parameter. `JointType2d::from_flat` reads only
      // the keys its own arm names, so a stray key would be silently ignored —
      // the same "looks sent, never applied" shape this whole fix is about.
      const data = makeJoint2d({ jointType: 'spring', stiffness: 12, maxDistance: 99 });
      store.getState().setJoint2d('entity1', data);

      expect(mockDispatch).toHaveBeenCalledWith('set_joint_2d', {
        entityId: 'entity1',
        targetEntityId: 'entity2',
        jointType: 'spring',
        localAnchor1: [0, 1],
        localAnchor2: [0, -1],
        stiffness: 12,
      });
    });

    it('should store joints for multiple entities independently', () => {
      const data1 = makeJoint2d();
      const data2 = makeJoint2d({ jointType: 'prismatic', axis: [1, 0] });
      store.getState().setJoint2d('entity1', data1);
      store.getState().setJoint2d('entity2', data2);

      expect(store.getState().joints2d.entity1).toEqual(data1);
      expect(store.getState().joints2d.entity2).toEqual(data2);
    });
  });

  describe('applyJoint2dFromEngine', () => {
    it('should write the joint WITHOUT dispatching back at the engine', () => {
      const data = makeJoint2d({ jointType: 'rope', maxDistance: 5 });
      store.getState().applyJoint2dFromEngine('entity1', data);

      expect(store.getState().joints2d.entity1).toEqual(data);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('removeJoint2d', () => {
    it('should remove from map and dispatch', () => {
      store.getState().setJoint2d('entity1', makeJoint2d());

      store.getState().removeJoint2d('entity1');

      expect(store.getState().joints2d.entity1).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_joint_2d', {
        entityId: 'entity1',
      });
    });

    it('should not affect other joints when removing one', () => {
      const data2 = makeJoint2d({ jointType: 'rope', maxDistance: 4 });
      store.getState().setJoint2d('entity1', makeJoint2d());
      store.getState().setJoint2d('entity2', data2);

      store.getState().removeJoint2d('entity1');

      expect(store.getState().joints2d.entity2).toEqual(data2);
    });
  });

  describe('setGravity2d', () => {
    it('should dispatch with gravity values', () => {
      store.getState().setGravity2d(0, -9.81);

      expect(mockDispatch).toHaveBeenCalledWith('set_gravity2d', {
        gravityX: 0,
        gravityY: -9.81,
      });
    });

    it('should dispatch with zero gravity', () => {
      store.getState().setGravity2d(0, 0);

      expect(mockDispatch).toHaveBeenCalledWith('set_gravity2d', {
        gravityX: 0,
        gravityY: 0,
      });
    });

    it('should not modify local state', () => {
      const physics2dBefore = JSON.parse(JSON.stringify(store.getState().physics2d));
      const physics2dEnabledBefore = JSON.parse(JSON.stringify(store.getState().physics2dEnabled));
      store.getState().setGravity2d(5, -10);

      expect(store.getState().physics2d).toEqual(physics2dBefore);
      expect(store.getState().physics2dEnabled).toEqual(physics2dEnabledBefore);
    });
  });

  describe('setDebugPhysics2d', () => {
    it('should dispatch with enabled=true', () => {
      store.getState().setDebugPhysics2d(true);

      expect(mockDispatch).toHaveBeenCalledWith('set_debug_physics2d', {
        enabled: true,
      });
    });

    it('should dispatch with enabled=false', () => {
      store.getState().setDebugPhysics2d(false);

      expect(mockDispatch).toHaveBeenCalledWith('set_debug_physics2d', {
        enabled: false,
      });
    });

    it('should not modify local state', () => {
      store.getState().setDebugPhysics2d(true);

      expect(store.getState().debugPhysics).toBe(false);
    });
  });
});
