/**
 * Comprehensive edge case tests for physics-related query and command handlers.
 *
 * Covers: get_physics, get_joint, update_physics (all body types, all collider
 * shapes, lock combinations), toggle_physics, toggle_debug_physics, apply_force,
 * create_joint / update_joint / remove_joint (all joint types), get_physics2d,
 * and raycasting-adjacent handler validation.
 */
import { describe, it, expect, vi } from 'vitest';
import { invokeHandler, createMockStore } from './handlerTestUtils';
import { physicsJointHandlers } from '../physicsJointHandlers';
import { handlers2d } from '../handlers2d';
import type { PhysicsData } from '@/stores/editorStore';

// ---------------------------------------------------------------------------
// get_physics — edge cases
// ---------------------------------------------------------------------------

describe('get_physics — edge cases', () => {
  it('returns all PhysicsData fields when set', async () => {
    const fullPhysics: PhysicsData = {
      bodyType: 'kinematic_velocity',
      colliderShape: 'capsule',
      restitution: 0.8,
      friction: 0.1,
      density: 3.0,
      gravityScale: 0.5,
      lockTranslationX: true,
      lockTranslationY: false,
      lockTranslationZ: true,
      lockRotationX: false,
      lockRotationY: true,
      lockRotationZ: false,
      isSensor: true,
    };

    const { result } = await invokeHandler(
      physicsJointHandlers,
      'get_physics',
      {},
      { primaryPhysics: fullPhysics, physicsEnabled: true }
    );

    expect(result.success).toBe(true);
    const data = result.result as { physics: PhysicsData; enabled: boolean };
    expect(data.physics).toEqual(fullPhysics);
    expect(data.enabled).toBe(true);
  });

  it('returns physics with all locks false when no locks set', async () => {
    const physics: PhysicsData = {
      bodyType: 'dynamic',
      colliderShape: 'ball',
      restitution: 0.5,
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
    };

    const { result } = await invokeHandler(
      physicsJointHandlers,
      'get_physics',
      {},
      { primaryPhysics: physics, physicsEnabled: true }
    );

    const data = result.result as { physics: PhysicsData };
    expect(data.physics.lockTranslationX).toBe(false);
    expect(data.physics.lockRotationZ).toBe(false);
  });

  it('returns physicsEnabled=false independently of physics data existence', async () => {
    const physics: PhysicsData = {
      bodyType: 'fixed',
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
    };

    // Physics data exists but is disabled
    const { result } = await invokeHandler(
      physicsJointHandlers,
      'get_physics',
      {},
      { primaryPhysics: physics, physicsEnabled: false }
    );

    const data = result.result as { physics: PhysicsData; enabled: boolean };
    expect(data.physics).toEqual(physics);
    expect(data.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// get_joint — edge cases
// ---------------------------------------------------------------------------

describe('get_joint — edge cases', () => {
  const allJointTypes = ['fixed', 'revolute', 'spherical', 'prismatic', 'rope', 'spring'] as const;

  for (const jointType of allJointTypes) {
    it(`returns correct data for jointType=${jointType}`, async () => {
      const joint = {
        jointType,
        connectedEntityId: 'connected-entity',
        anchorSelf: [0, 0, 0] as [number, number, number],
        anchorOther: [0, 1, 0] as [number, number, number],
        axis: [0, 1, 0] as [number, number, number],
        limits: null,
        motor: null,
      };

      const { result } = await invokeHandler(
        physicsJointHandlers,
        'get_joint',
        {},
        { primaryJoint: joint }
      );

      expect(result.success).toBe(true);
      const data = result.result as { joint: typeof joint };
      expect(data.joint.jointType).toBe(jointType);
    });
  }

  it('returns joint with limits set correctly', async () => {
    const joint = {
      jointType: 'revolute' as const,
      connectedEntityId: 'ent-b',
      anchorSelf: [0, 0, 0] as [number, number, number],
      anchorOther: [0, 0, 0] as [number, number, number],
      axis: [0, 1, 0] as [number, number, number],
      limits: { min: -90, max: 90 },
      motor: null,
    };

    const { result } = await invokeHandler(
      physicsJointHandlers,
      'get_joint',
      {},
      { primaryJoint: joint }
    );

    const data = result.result as { joint: typeof joint };
    expect(data.joint.limits).toEqual({ min: -90, max: 90 });
  });

  it('returns joint with motor set correctly', async () => {
    const joint = {
      jointType: 'prismatic' as const,
      connectedEntityId: 'ent-b',
      anchorSelf: [0, 0, 0] as [number, number, number],
      anchorOther: [0, 0, 0] as [number, number, number],
      axis: [1, 0, 0] as [number, number, number],
      limits: { min: 0, max: 10 },
      motor: { targetVelocity: 3.0, maxForce: 200.0 },
    };

    const { result } = await invokeHandler(
      physicsJointHandlers,
      'get_joint',
      {},
      { primaryJoint: joint }
    );

    const data = result.result as { joint: typeof joint };
    expect(data.joint.motor).toEqual({ targetVelocity: 3.0, maxForce: 200.0 });
  });
});

// ---------------------------------------------------------------------------
// update_physics — all body types and collider shapes
// ---------------------------------------------------------------------------

describe('update_physics — all bodyType variants', () => {
  const bodyTypes = ['dynamic', 'fixed', 'kinematic_position', 'kinematic_velocity'] as const;

  for (const bodyType of bodyTypes) {
    it(`updates bodyType=${bodyType} correctly`, async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
        entityId: 'ent1',
        bodyType,
      });

      expect(result.success).toBe(true);
      expect(store.updatePhysics).toHaveBeenCalledWith(
        'ent1',
        expect.objectContaining({ bodyType })
      );
    });
  }
});

describe('update_physics — all colliderShape variants', () => {
  const shapes = ['cuboid', 'ball', 'cylinder', 'capsule', 'auto'] as const;

  for (const colliderShape of shapes) {
    it(`updates colliderShape=${colliderShape} correctly`, async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
        entityId: 'ent1',
        colliderShape,
      });

      expect(result.success).toBe(true);
      expect(store.updatePhysics).toHaveBeenCalledWith(
        'ent1',
        expect.objectContaining({ colliderShape })
      );
    });
  }
});

describe('update_physics — lock field combinations', () => {
  it('can lock all translation axes', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent1',
      lockTranslationX: true,
      lockTranslationY: true,
      lockTranslationZ: true,
    });

    expect(result.success).toBe(true);
    expect(store.updatePhysics).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({
        lockTranslationX: true,
        lockTranslationY: true,
        lockTranslationZ: true,
      })
    );
  });

  it('can lock all rotation axes', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent1',
      lockRotationX: true,
      lockRotationY: true,
      lockRotationZ: true,
    });

    expect(result.success).toBe(true);
    expect(store.updatePhysics).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({
        lockRotationX: true,
        lockRotationY: true,
        lockRotationZ: true,
      })
    );
  });

  it('can enable isSensor flag', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'trigger-entity',
      isSensor: true,
    });

    expect(result.success).toBe(true);
    expect(store.updatePhysics).toHaveBeenCalledWith(
      'trigger-entity',
      expect.objectContaining({ isSensor: true })
    );
  });

  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      bodyType: 'dynamic',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('entityId');
  });

  it('returns error when bodyType is invalid enum value', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent1',
      bodyType: 'rigid_body',
    });

    expect(result.success).toBe(false);
  });

  it('returns error when colliderShape is invalid enum value', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent1',
      colliderShape: 'triangle',
    });

    expect(result.success).toBe(false);
  });

  it('returns error when density is Infinity', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent1',
      density: Infinity,
    });

    expect(result.success).toBe(false);
  });

  it('returns error when friction is NaN', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent1',
      friction: NaN,
    });

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toggle_physics — additional cases
// ---------------------------------------------------------------------------

describe('toggle_physics — additional cases', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'toggle_physics', {
      enabled: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('entityId');
  });

  it('returns error when enabled is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'toggle_physics', {
      entityId: 'ent1',
    });

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// create_joint — all joint type variants
// ---------------------------------------------------------------------------

describe('create_joint — all jointType variants', () => {
  const jointTypes = ['fixed', 'revolute', 'spherical', 'prismatic', 'rope', 'spring'] as const;

  for (const jointType of jointTypes) {
    it(`creates jointType=${jointType} with correct type in dispatch`, async () => {
      const { result, store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
        entityId: 'ent1',
        jointType,
        connectedEntityId: 'ent2',
      });

      expect(result.success).toBe(true);
      expect(store.createJoint).toHaveBeenCalledWith(
        'ent1',
        expect.objectContaining({ jointType })
      );
      expect((result.result as { message: string }).message).toContain(jointType);
    });
  }
});

describe('create_joint — validation', () => {
  it('returns error for invalid jointType', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent1',
      jointType: 'hinge',
    });

    expect(result.success).toBe(false);
  });

  it('creates joint with limits', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent1',
      jointType: 'revolute',
      connectedEntityId: 'ent2',
      limits: { min: -180, max: 180 },
    });

    expect(result.success).toBe(true);
    expect(store.createJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({ limits: { min: -180, max: 180 } })
    );
  });

  it('creates joint with motor config', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent1',
      jointType: 'prismatic',
      connectedEntityId: 'ent2',
      motor: { targetVelocity: 5.0, maxForce: 1000.0 },
    });

    expect(result.success).toBe(true);
    expect(store.createJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({ motor: { targetVelocity: 5.0, maxForce: 1000.0 } })
    );
  });

  it('creates joint with custom anchors', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent1',
      connectedEntityId: 'ent2',
      anchorSelf: [0.5, 1.0, 0.0],
      anchorOther: [-0.5, -1.0, 0.0],
    });

    expect(result.success).toBe(true);
    expect(store.createJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({
        anchorSelf: [0.5, 1.0, 0.0],
        anchorOther: [-0.5, -1.0, 0.0],
      })
    );
  });

  it('creates joint with custom axis', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent1',
      connectedEntityId: 'ent2',
      axis: [1, 0, 0],
    });

    expect(result.success).toBe(true);
    expect(store.createJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({ axis: [1, 0, 0] })
    );
  });

  it('defaults limits to null when not provided', async () => {
    const { store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent1',
      connectedEntityId: 'ent2',
    });

    expect(store.createJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({ limits: null })
    );
  });

  it('defaults motor to null when not provided', async () => {
    const { store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent1',
      connectedEntityId: 'ent2',
    });

    expect(store.createJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({ motor: null })
    );
  });
});

// ---------------------------------------------------------------------------
// update_joint — edge cases
// ---------------------------------------------------------------------------

describe('update_joint — edge cases', () => {
  it('can update only limits', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_joint', {
      entityId: 'ent1',
      limits: { min: -45, max: 45 },
    });

    expect(result.success).toBe(true);
    expect(store.updateJoint).toHaveBeenCalledWith('ent1', { limits: { min: -45, max: 45 } });
  });

  it('can update only motor config', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_joint', {
      entityId: 'ent1',
      motor: { targetVelocity: 10.0, maxForce: 500.0 },
    });

    expect(result.success).toBe(true);
    expect(store.updateJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({ motor: { targetVelocity: 10.0, maxForce: 500.0 } })
    );
  });

  it('can set limits to null (remove limits)', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_joint', {
      entityId: 'ent1',
      limits: null,
    });

    expect(result.success).toBe(true);
    expect(store.updateJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({ limits: null })
    );
  });

  it('can set motor to null (remove motor)', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_joint', {
      entityId: 'ent1',
      motor: null,
    });

    expect(result.success).toBe(true);
    expect(store.updateJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({ motor: null })
    );
  });

  it('can update connectedEntityId to point to a different entity', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_joint', {
      entityId: 'ent1',
      connectedEntityId: 'new-target',
    });

    expect(result.success).toBe(true);
    expect(store.updateJoint).toHaveBeenCalledWith(
      'ent1',
      expect.objectContaining({ connectedEntityId: 'new-target' })
    );
  });

  it('result message contains entityId', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_joint', {
      entityId: 'my-entity-xyz',
      jointType: 'spherical',
    });

    expect(result.success).toBe(true);
    expect((result.result as { message: string }).message).toContain('my-entity-xyz');
  });
});

// ---------------------------------------------------------------------------
// remove_joint — additional cases
// ---------------------------------------------------------------------------

describe('remove_joint — additional cases', () => {
  it('result message contains the removed entityId', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'remove_joint', {
      entityId: 'some-entity',
    });

    expect(result.success).toBe(true);
    expect((result.result as { message: string }).message).toContain('some-entity');
  });
});

// ---------------------------------------------------------------------------
// toggle_debug_physics — dispatch-only behaviour
// ---------------------------------------------------------------------------

describe('toggle_debug_physics', () => {
  it('calls toggleDebugPhysics with no arguments', async () => {
    const store = createMockStore();
    await physicsJointHandlers.toggle_debug_physics({}, { store, dispatchCommand: vi.fn() });

    expect(store.toggleDebugPhysics).toHaveBeenCalledWith();
  });

  it('returns success with message containing "debug"', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'toggle_debug_physics');

    expect(result.success).toBe(true);
    const msg = (result.result as { message: string }).message.toLowerCase();
    expect(msg).toContain('debug');
  });
});

// ---------------------------------------------------------------------------
// apply_force — additional cases
// ---------------------------------------------------------------------------

describe('apply_force — additional cases', () => {
  it('enables physics via togglePhysics', async () => {
    const { store } = await invokeHandler(physicsJointHandlers, 'apply_force', {
      entityId: 'dynamic-obj',
    });

    expect(store.togglePhysics).toHaveBeenCalledWith('dynamic-obj', true);
  });

  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'apply_force', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('entityId');
  });

  it('message mentions Play mode (force applies at runtime)', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'apply_force', {
      entityId: 'obj',
    });

    expect(result.success).toBe(true);
    const msg = (result.result as { message: string }).message;
    expect(msg).toContain('Play');
  });
});

// ---------------------------------------------------------------------------
// get_physics2d — edge cases (in queryHandlers)
// ---------------------------------------------------------------------------

describe('get_physics2d — edge cases', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(handlers2d, 'get_physics2d', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('entityId');
  });

  it('returns all Physics2dData fields when set', async () => {
    const physicsData = {
      bodyType: 'dynamic',
      colliderShape: 'capsule',
      size: [0.5, 2.0],
      radius: 0.25,
      vertices: [[0, 0], [1, 0], [0.5, 1]],
      mass: 2.5,
      friction: 0.3,
      restitution: 0.6,
      gravityScale: 0.8,
      isSensor: true,
      lockRotation: true,
      continuousDetection: true,
      oneWayPlatform: false,
      surfaceVelocity: [1.0, 0.0],
    };

    const { result } = await invokeHandler(
      handlers2d,
      'get_physics2d',
      { entityId: 'sprite-1' },
      { physics2d: { 'sprite-1': physicsData } }
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual(physicsData);
  });

  it('returns error when entity exists but has no 2D physics', async () => {
    const { result } = await invokeHandler(
      handlers2d,
      'get_physics2d',
      { entityId: 'cube-without-physics2d' },
      { physics2d: {} }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('2D physics');
  });

  it('returns different data for different entities', async () => {
    const dataA = {
      bodyType: 'dynamic', colliderShape: 'box', size: [1, 1], radius: 0, vertices: [],
      mass: 1.0, friction: 0.5, restitution: 0.0, gravityScale: 1.0, isSensor: false,
      lockRotation: false, continuousDetection: false, oneWayPlatform: false, surfaceVelocity: [0, 0],
    };
    const dataB = {
      bodyType: 'static', colliderShape: 'circle', size: [2, 2], radius: 1, vertices: [],
      mass: 0, friction: 0.8, restitution: 0.2, gravityScale: 0, isSensor: false,
      lockRotation: false, continuousDetection: false, oneWayPlatform: true, surfaceVelocity: [2.0, 0],
    };

    const { result: resultA } = await invokeHandler(
      handlers2d,
      'get_physics2d',
      { entityId: 'sprite-A' },
      { physics2d: { 'sprite-A': dataA, 'sprite-B': dataB } }
    );
    const { result: resultB } = await invokeHandler(
      handlers2d,
      'get_physics2d',
      { entityId: 'sprite-B' },
      { physics2d: { 'sprite-A': dataA, 'sprite-B': dataB } }
    );

    expect((resultA.result as { data: typeof dataA }).data.bodyType).toBe('dynamic');
    expect((resultB.result as { data: typeof dataB }).data.bodyType).toBe('static');
    expect((resultB.result as { data: typeof dataB }).data.oneWayPlatform).toBe(true);
  });
});
