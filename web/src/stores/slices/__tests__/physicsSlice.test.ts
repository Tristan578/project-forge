import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createPhysicsSlice, setPhysicsDispatcher, type PhysicsSlice } from '../physicsSlice';
import type { PhysicsData, JointData, Physics2dData, Joint2dData } from '../types';

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
      expect(mockDispatch).toHaveBeenCalledWith('set_physics_2d', {
        entityId: 'entity1',
        enabled: true,
        ...data,
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

  describe('setJoint2d', () => {
    it('should update state and dispatch', () => {
      const data: Joint2dData = { jointType: 'revolute' } as unknown as Joint2dData;
      store.getState().setJoint2d('entity1', data);

      expect(store.getState().joints2d.entity1).toEqual(data);
      expect(mockDispatch).toHaveBeenCalledWith('set_joint_2d', {
        entityId: 'entity1',
        ...data,
      });
    });
  });

  describe('removeJoint2d', () => {
    it('should remove from map and dispatch', () => {
      const data: Joint2dData = { jointType: 'fixed' } as unknown as Joint2dData;
      store.getState().setJoint2d('entity1', data);

      store.getState().removeJoint2d('entity1');

      expect(store.getState().joints2d.entity1).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_joint_2d', {
        entityId: 'entity1',
      });
    });
  });
});
