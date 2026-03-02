/**
 * Unit tests for the physicsSlice — 2D and 3D physics state management.
 *
 * Tests cover: state CRUD for physics2d, joints2d, debug toggles,
 * dispatch command calls, and 3D physics state.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPhysicsSlice, setPhysicsDispatcher, type PhysicsSlice } from '../slices/physicsSlice';

// Minimal Zustand-like test harness
function createTestStore() {
  const store = { state: null as unknown as PhysicsSlice };
  const listeners: (() => void)[] = [];

  const set = (partial: Partial<PhysicsSlice> | ((s: PhysicsSlice) => Partial<PhysicsSlice>)) => {
    if (typeof partial === 'function') {
      Object.assign(store.state, partial(store.state));
    } else {
      Object.assign(store.state, partial);
    }
    listeners.forEach(l => l());
  };

  const get = () => store.state;

  store.state = createPhysicsSlice(set as never, get as never, {} as never);
  return { getState: () => store.state, setState: set };
}

describe('physicsSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setPhysicsDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should initialize with null primaryPhysics', () => {
      expect(store.getState().primaryPhysics).toBeNull();
    });

    it('should initialize with physics disabled', () => {
      expect(store.getState().physicsEnabled).toBe(false);
    });

    it('should initialize with debug physics off', () => {
      expect(store.getState().debugPhysics).toBe(false);
    });

    it('should initialize with null primaryJoint', () => {
      expect(store.getState().primaryJoint).toBeNull();
    });

    it('should initialize with empty 2D physics maps', () => {
      expect(store.getState().physics2d).toEqual({});
      expect(store.getState().physics2dEnabled).toEqual({});
      expect(store.getState().joints2d).toEqual({});
    });
  });

  describe('3D Physics', () => {
    const samplePhysics = {
      bodyType: 'dynamic' as const,
      colliderShape: 'cuboid' as const,
      restitution: 0.5,
      friction: 0.3,
      density: 1.0,
      gravityScale: 1.0,
      lockTranslationX: false,
      lockTranslationY: false,
      lockTranslationZ: false,
      lockRotationX: false,
      lockRotationY: false,
      lockRotationZ: false,
      isSensor: false,
    };

    it('setPrimaryPhysics sets data and enabled flag', () => {
      store.getState().setPrimaryPhysics(samplePhysics, true);
      expect(store.getState().primaryPhysics).toEqual(samplePhysics);
      expect(store.getState().physicsEnabled).toBe(true);
    });

    it('setPrimaryPhysics can set to null', () => {
      store.getState().setPrimaryPhysics(samplePhysics, true);
      store.getState().setPrimaryPhysics(null, false);
      expect(store.getState().primaryPhysics).toBeNull();
      expect(store.getState().physicsEnabled).toBe(false);
    });

    it('updatePhysics dispatches command and updates state', () => {
      store.getState().updatePhysics('entity-1', samplePhysics);
      expect(store.getState().primaryPhysics).toEqual(samplePhysics);
      expect(store.getState().physicsEnabled).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith('update_physics', {
        entityId: 'entity-1',
        ...samplePhysics,
      });
    });

    it('togglePhysics dispatches command', () => {
      store.getState().togglePhysics('entity-1', false);
      expect(mockDispatch).toHaveBeenCalledWith('toggle_physics', {
        entityId: 'entity-1',
        enabled: false,
      });
    });

    it('toggleDebugPhysics dispatches command', () => {
      store.getState().toggleDebugPhysics();
      expect(mockDispatch).toHaveBeenCalledWith('toggle_debug_physics', {});
    });

    it('setDebugPhysics sets state without dispatch', () => {
      store.getState().setDebugPhysics(true);
      expect(store.getState().debugPhysics).toBe(true);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('3D Joints', () => {
    const sampleJoint = {
      jointType: 'fixed' as const,
      connectedEntityId: 'entity-2',
      anchorSelf: [0, 0, 0] as [number, number, number],
      anchorOther: [0, 0, 0] as [number, number, number],
      axis: [0, 1, 0] as [number, number, number],
      limits: null,
      motor: null,
    };

    it('setPrimaryJoint sets joint data', () => {
      store.getState().setPrimaryJoint(sampleJoint);
      expect(store.getState().primaryJoint).toEqual(sampleJoint);
    });

    it('createJoint dispatches command', () => {
      store.getState().createJoint('entity-1', sampleJoint);
      expect(mockDispatch).toHaveBeenCalledWith('create_joint', {
        entityId: 'entity-1',
        ...sampleJoint,
      });
    });

    it('updateJoint dispatches partial updates', () => {
      store.getState().updateJoint('entity-1', { jointType: 'revolute' as const });
      expect(mockDispatch).toHaveBeenCalledWith('update_joint', {
        entityId: 'entity-1',
        jointType: 'revolute',
      });
    });

    it('removeJoint dispatches command', () => {
      store.getState().removeJoint('entity-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_joint', {
        entityId: 'entity-1',
      });
    });
  });

  describe('2D Physics', () => {
    const samplePhysics2d = {
      bodyType: 'dynamic' as const,
      colliderShape: 'box' as const,
      size: [1.0, 1.0] as [number, number],
      radius: 0.5,
      vertices: [] as [number, number][],
      mass: 1.0,
      restitution: 0.3,
      friction: 0.5,
      gravityScale: 1.0,
      isSensor: false,
      lockRotation: false,
      continuousDetection: false,
      oneWayPlatform: false,
      surfaceVelocity: [0, 0] as [number, number],
    };

    it('setPhysics2d adds entity to maps', () => {
      store.getState().setPhysics2d('entity-1', samplePhysics2d, true);
      expect(store.getState().physics2d['entity-1']).toEqual(samplePhysics2d);
      expect(store.getState().physics2dEnabled['entity-1']).toBe(true);
    });

    it('setPhysics2d dispatches command', () => {
      store.getState().setPhysics2d('entity-1', samplePhysics2d, true);
      expect(mockDispatch).toHaveBeenCalledWith('set_physics_2d', {
        entityId: 'entity-1',
        ...samplePhysics2d,
        enabled: true,
      });
    });

    it('updatePhysics2d updates entity in map', () => {
      store.getState().setPhysics2d('entity-1', samplePhysics2d, true);
      const updated = { ...samplePhysics2d, mass: 5.0 };
      store.getState().updatePhysics2d('entity-1', updated);
      expect(store.getState().physics2d['entity-1']).toEqual(updated);
    });

    it('removePhysics2d removes entity from maps', () => {
      store.getState().setPhysics2d('entity-1', samplePhysics2d, true);
      store.getState().removePhysics2d('entity-1');
      expect(store.getState().physics2d['entity-1']).toBeUndefined();
      expect(store.getState().physics2dEnabled['entity-1']).toBeUndefined();
    });

    it('togglePhysics2d updates enabled map and dispatches', () => {
      store.getState().setPhysics2d('entity-1', samplePhysics2d, true);
      store.getState().togglePhysics2d('entity-1', false);
      expect(store.getState().physics2dEnabled['entity-1']).toBe(false);
      expect(mockDispatch).toHaveBeenCalledWith('toggle_physics_2d', {
        entityId: 'entity-1',
        enabled: false,
      });
    });

    it('multiple entities coexist independently', () => {
      const physics2 = { ...samplePhysics2d, mass: 10.0 };
      store.getState().setPhysics2d('entity-1', samplePhysics2d, true);
      store.getState().setPhysics2d('entity-2', physics2, false);

      expect(Object.keys(store.getState().physics2d)).toHaveLength(2);
      expect(store.getState().physics2d['entity-1']?.mass).toBe(1.0);
      expect(store.getState().physics2d['entity-2']?.mass).toBe(10.0);

      store.getState().removePhysics2d('entity-1');
      expect(store.getState().physics2d['entity-2']).toEqual(physics2);
      expect(store.getState().physics2d['entity-1']).toBeUndefined();
    });
  });

  describe('2D Joints', () => {
    const sampleJoint2d = {
      targetEntityId: 2,
      jointType: 'revolute' as const,
      localAnchor1: [0, 0] as [number, number],
      localAnchor2: [0, 0] as [number, number],
    };

    it('setJoint2d adds joint to map', () => {
      store.getState().setJoint2d('entity-1', sampleJoint2d);
      expect(store.getState().joints2d['entity-1']).toEqual(sampleJoint2d);
    });

    it('setJoint2d dispatches command', () => {
      store.getState().setJoint2d('entity-1', sampleJoint2d);
      expect(mockDispatch).toHaveBeenCalledWith('set_joint_2d', {
        entityId: 'entity-1',
        ...sampleJoint2d,
      });
    });

    it('removeJoint2d removes from map and dispatches', () => {
      store.getState().setJoint2d('entity-1', sampleJoint2d);
      store.getState().removeJoint2d('entity-1');
      expect(store.getState().joints2d['entity-1']).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_joint_2d', {
        entityId: 'entity-1',
      });
    });
  });

  describe('2D Gravity and Debug', () => {
    it('setGravity2d dispatches command', () => {
      store.getState().setGravity2d(0, -20);
      expect(mockDispatch).toHaveBeenCalledWith('set_gravity2d', {
        gravityX: 0,
        gravityY: -20,
      });
    });

    it('setDebugPhysics2d dispatches command', () => {
      store.getState().setDebugPhysics2d(true);
      expect(mockDispatch).toHaveBeenCalledWith('set_debug_physics2d', {
        enabled: true,
      });
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setPhysicsDispatcher(null as never);
      store = createTestStore();
      // Should not throw
      expect(() => store.getState().toggleDebugPhysics()).not.toThrow();
      expect(() => store.getState().setGravity2d(0, -10)).not.toThrow();
    });
  });
});
