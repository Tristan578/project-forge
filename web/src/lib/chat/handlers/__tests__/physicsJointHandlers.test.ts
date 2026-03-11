/**
 * Tests for physicsJointHandlers — physics, joints, CSG, terrain,
 * extrude, lathe, array, and combine mesh commands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { physicsJointHandlers } from '../physicsJointHandlers';

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// update_physics
// ===========================================================================

describe('update_physics', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      bodyType: 'dynamic',
    });
    expect(result.success).toBe(false);
  });

  it('calls store.updatePhysics with merged defaults when no existing physics', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent-1',
      bodyType: 'fixed',
    }, { primaryPhysics: null });
    expect(result.success).toBe(true);
    expect(store.updatePhysics).toHaveBeenCalledTimes(1);
    const [entityId, physics] = (store.updatePhysics as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { bodyType: string; friction: number }];
    expect(entityId).toBe('ent-1');
    expect(physics.bodyType).toBe('fixed');
    expect(physics.friction).toBe(0.5); // default
  });

  it('merges onto existing primaryPhysics', async () => {
    const existingPhysics = {
      bodyType: 'dynamic',
      colliderShape: 'ball',
      restitution: 0.8,
      friction: 0.3,
      density: 2.0,
      gravityScale: 1.0,
      lockTranslationX: false, lockTranslationY: false, lockTranslationZ: false,
      lockRotationX: false, lockRotationY: false, lockRotationZ: false,
      isSensor: false,
    };
    const { store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent-1',
      restitution: 0.2,
    }, { primaryPhysics: existingPhysics });
    const [, physics] = (store.updatePhysics as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { restitution: number; friction: number }];
    expect(physics.restitution).toBe(0.2);
    expect(physics.friction).toBe(0.3); // preserved from existing
  });

  it('accepts all valid bodyType values', async () => {
    const bodyTypes = ['dynamic', 'fixed', 'kinematic_position', 'kinematic_velocity'];
    for (const bodyType of bodyTypes) {
      const { result } = await invokeHandler(physicsJointHandlers, 'update_physics', {
        entityId: 'ent-1',
        bodyType,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts all valid colliderShape values', async () => {
    const shapes = ['cuboid', 'ball', 'cylinder', 'capsule', 'auto'];
    for (const colliderShape of shapes) {
      const { result } = await invokeHandler(physicsJointHandlers, 'update_physics', {
        entityId: 'ent-1',
        colliderShape,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid bodyType', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent-1',
      bodyType: 'flying',
    });
    expect(result.success).toBe(false);
  });

  it('applies lock flags correctly', async () => {
    const { store } = await invokeHandler(physicsJointHandlers, 'update_physics', {
      entityId: 'ent-1',
      lockTranslationY: true,
      lockRotationX: true,
    }, { primaryPhysics: null });
    const [, physics] = (store.updatePhysics as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { lockTranslationY: boolean; lockRotationX: boolean; lockTranslationX: boolean }];
    expect(physics.lockTranslationY).toBe(true);
    expect(physics.lockRotationX).toBe(true);
    expect(physics.lockTranslationX).toBe(false); // default
  });
});

// ===========================================================================
// toggle_physics
// ===========================================================================

describe('toggle_physics', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'toggle_physics', {
      enabled: true,
    });
    expect(result.success).toBe(false);
  });

  it('returns error when enabled is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'toggle_physics', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(false);
  });

  it('enables physics and returns message', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'toggle_physics', {
      entityId: 'ent-1',
      enabled: true,
    });
    expect(result.success).toBe(true);
    expect(store.togglePhysics).toHaveBeenCalledWith('ent-1', true);
    const data = result.result as { message: string };
    expect(data.message).toContain('enabled');
  });

  it('disables physics and returns message', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'toggle_physics', {
      entityId: 'ent-1',
      enabled: false,
    });
    expect(result.success).toBe(true);
    expect(store.togglePhysics).toHaveBeenCalledWith('ent-1', false);
    const data = result.result as { message: string };
    expect(data.message).toContain('disabled');
  });
});

// ===========================================================================
// toggle_debug_physics
// ===========================================================================

describe('toggle_debug_physics', () => {
  it('calls store.toggleDebugPhysics and returns success', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'toggle_debug_physics', {});
    expect(result.success).toBe(true);
    expect(store.toggleDebugPhysics).toHaveBeenCalledTimes(1);
  });

  it('returns message confirming toggle', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'toggle_debug_physics', {});
    const data = result.result as { message: string };
    expect(data.message).toContain('Toggled');
  });
});

// ===========================================================================
// get_physics
// ===========================================================================

describe('get_physics', () => {
  it('returns physics data and enabled state from store', async () => {
    const physics = { bodyType: 'dynamic', colliderShape: 'ball' };
    const { result } = await invokeHandler(physicsJointHandlers, 'get_physics', {}, {
      primaryPhysics: physics,
      physicsEnabled: true,
    });
    expect(result.success).toBe(true);
    const data = result.result as { physics: unknown; enabled: boolean };
    expect(data.physics).toEqual(physics);
    expect(data.enabled).toBe(true);
  });

  it('returns null physics when entity has no physics', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'get_physics', {}, {
      primaryPhysics: null,
      physicsEnabled: false,
    });
    const data = result.result as { physics: null; enabled: boolean };
    expect(data.physics).toBeNull();
    expect(data.enabled).toBe(false);
  });
});

// ===========================================================================
// apply_force
// ===========================================================================

describe('apply_force', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'apply_force', {});
    expect(result.success).toBe(false);
  });

  it('enables physics and returns queued message', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'apply_force', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    expect(store.togglePhysics).toHaveBeenCalledWith('ent-1', true);
    const data = result.result as { message: string };
    expect(data.message).toContain('Play');
  });
});

// ===========================================================================
// create_joint
// ===========================================================================

describe('create_joint', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'create_joint', {});
    expect(result.success).toBe(false);
  });

  it('creates revolute joint by default', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    expect(store.createJoint).toHaveBeenCalledTimes(1);
    const [entityId, jointData] = (store.createJoint as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { jointType: string }];
    expect(entityId).toBe('ent-1');
    expect(jointData.jointType).toBe('revolute');
  });

  it('creates joint with specified type', async () => {
    const { store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent-1',
      jointType: 'fixed',
    });
    const [, jointData] = (store.createJoint as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { jointType: string }];
    expect(jointData.jointType).toBe('fixed');
  });

  it('accepts all valid joint types', async () => {
    const types = ['fixed', 'revolute', 'spherical', 'prismatic', 'rope', 'spring'];
    for (const jointType of types) {
      const { result } = await invokeHandler(physicsJointHandlers, 'create_joint', {
        entityId: 'ent-1',
        jointType,
      });
      expect(result.success).toBe(true);
    }
  });

  it('applies limits and motor when provided', async () => {
    const { store } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent-1',
      limits: { min: -1.5, max: 1.5 },
      motor: { targetVelocity: 2.0, maxForce: 100 },
    });
    const [, jointData] = (store.createJoint as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { limits: { min: number; max: number }; motor: { targetVelocity: number } },
    ];
    expect(jointData.limits).toEqual({ min: -1.5, max: 1.5 });
    expect(jointData.motor.targetVelocity).toBe(2.0);
  });

  it('result message includes joint type and entity id', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'create_joint', {
      entityId: 'ent-1',
      jointType: 'spring',
    });
    const data = result.result as { message: string };
    expect(data.message).toContain('spring');
    expect(data.message).toContain('ent-1');
  });
});

// ===========================================================================
// update_joint
// ===========================================================================

describe('update_joint', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_joint', {
      jointType: 'fixed',
    });
    expect(result.success).toBe(false);
  });

  it('updates only provided fields', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_joint', {
      entityId: 'ent-1',
      connectedEntityId: 'ent-2',
    });
    expect(result.success).toBe(true);
    const [entityId, updates] = (store.updateJoint as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(entityId).toBe('ent-1');
    expect(updates.connectedEntityId).toBe('ent-2');
    // jointType not passed, so should not be in updates
    expect(updates.jointType).toBeUndefined();
  });

  it('result message includes entity id', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_joint', {
      entityId: 'ent-1',
      jointType: 'rope',
    });
    const data = result.result as { message: string };
    expect(data.message).toContain('ent-1');
  });
});

// ===========================================================================
// remove_joint
// ===========================================================================

describe('remove_joint', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'remove_joint', {});
    expect(result.success).toBe(false);
  });

  it('calls store.removeJoint with correct entityId', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'remove_joint', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(true);
    expect(store.removeJoint).toHaveBeenCalledWith('ent-1');
  });
});

// ===========================================================================
// get_joint
// ===========================================================================

describe('get_joint', () => {
  it('returns primaryJoint from store', async () => {
    const joint = { jointType: 'revolute', connectedEntityId: 'ent-2' };
    const { result } = await invokeHandler(physicsJointHandlers, 'get_joint', {}, {
      primaryJoint: joint,
    });
    expect(result.success).toBe(true);
    const data = result.result as { joint: unknown };
    expect(data.joint).toEqual(joint);
  });

  it('returns null joint when no joint present', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'get_joint', {}, {
      primaryJoint: null,
    });
    const data = result.result as { joint: null };
    expect(data.joint).toBeNull();
  });
});

// ===========================================================================
// csg_union / csg_subtract / csg_intersect
// ===========================================================================

describe('csg operations', () => {
  it('csg_union returns error when entityIdA is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'csg_union', {
      entityIdB: 'ent-2',
    });
    expect(result.success).toBe(false);
  });

  it('csg_union calls store.csgUnion with correct args', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'csg_union', {
      entityIdA: 'ent-1',
      entityIdB: 'ent-2',
    });
    expect(result.success).toBe(true);
    expect(store.csgUnion).toHaveBeenCalledWith('ent-1', 'ent-2', true);
  });

  it('csg_union passes deleteSources=false when specified', async () => {
    const { store } = await invokeHandler(physicsJointHandlers, 'csg_union', {
      entityIdA: 'ent-1',
      entityIdB: 'ent-2',
      deleteSources: false,
    });
    expect(store.csgUnion).toHaveBeenCalledWith('ent-1', 'ent-2', false);
  });

  it('csg_subtract calls store.csgSubtract', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'csg_subtract', {
      entityIdA: 'ent-1',
      entityIdB: 'ent-2',
    });
    expect(result.success).toBe(true);
    expect(store.csgSubtract).toHaveBeenCalledWith('ent-1', 'ent-2', true);
  });

  it('csg_intersect calls store.csgIntersect', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'csg_intersect', {
      entityIdA: 'ent-1',
      entityIdB: 'ent-2',
    });
    expect(result.success).toBe(true);
    expect(store.csgIntersect).toHaveBeenCalledWith('ent-1', 'ent-2', true);
  });
});

// ===========================================================================
// spawn_terrain
// ===========================================================================

describe('spawn_terrain', () => {
  it('spawns terrain with empty args using defaults', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'spawn_terrain', {});
    expect(result.success).toBe(true);
    expect(store.spawnTerrain).toHaveBeenCalledTimes(1);
    const data = result.result as { message: string };
    expect(data.message).toBe('Terrain spawned');
  });

  it('passes all terrain parameters to spawnTerrain', async () => {
    const params = {
      noiseType: 'perlin',
      octaves: 6,
      frequency: 0.01,
      amplitude: 1.0,
      heightScale: 20,
      seed: 42,
      resolution: 128,
      size: 100.0,
    };
    const { store } = await invokeHandler(physicsJointHandlers, 'spawn_terrain', params);
    const [terrainArgs] = (store.spawnTerrain as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>];
    expect(terrainArgs).toMatchObject(params);
  });

  it('rejects invalid noiseType', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'spawn_terrain', {
      noiseType: 'fractal',
    });
    expect(result.success).toBe(false);
  });
});

// ===========================================================================
// update_terrain
// ===========================================================================

describe('update_terrain', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_terrain', {
      heightScale: 10,
    });
    expect(result.success).toBe(false);
  });

  it('returns error when entity is not a terrain', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'update_terrain', {
      entityId: 'ent-1',
      heightScale: 10,
    }, { terrainData: {} });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Entity is not a terrain');
  });

  it('merges provided fields with existing terrain data', async () => {
    const existingTerrain = {
      noiseType: 'perlin',
      octaves: 4,
      frequency: 0.02,
      amplitude: 1.0,
      heightScale: 10,
      seed: 0,
      resolution: 64,
      size: 50.0,
    };
    const { result, store } = await invokeHandler(physicsJointHandlers, 'update_terrain', {
      entityId: 'ent-1',
      heightScale: 25,
    }, { terrainData: { 'ent-1': existingTerrain } });
    expect(result.success).toBe(true);
    const [entityId, updated] = (store.updateTerrain as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { heightScale: number; octaves: number }];
    expect(entityId).toBe('ent-1');
    expect(updated.heightScale).toBe(25);
    expect(updated.octaves).toBe(4); // preserved
  });
});

// ===========================================================================
// sculpt_terrain
// ===========================================================================

describe('sculpt_terrain', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'sculpt_terrain', {
      position: [0, 0],
      radius: 5,
      strength: 1,
    });
    expect(result.success).toBe(false);
  });

  it('calls store.sculptTerrain with correct args', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'sculpt_terrain', {
      entityId: 'ent-1',
      position: [10, 20],
      radius: 5,
      strength: 0.5,
    });
    expect(result.success).toBe(true);
    expect(store.sculptTerrain).toHaveBeenCalledWith('ent-1', [10, 20], 5, 0.5);
  });
});

// ===========================================================================
// get_terrain
// ===========================================================================

describe('get_terrain', () => {
  it('returns error when entity is not a terrain', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'get_terrain', {
      entityId: 'ent-1',
    }, { terrainData: {} });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Entity is not a terrain');
  });

  it('returns terrain data when entity is a terrain', async () => {
    const terrainData = { noiseType: 'simplex', heightScale: 15 };
    const { result } = await invokeHandler(physicsJointHandlers, 'get_terrain', {
      entityId: 'ent-1',
    }, { terrainData: { 'ent-1': terrainData } });
    expect(result.success).toBe(true);
    const data = result.result as { terrainData: unknown };
    expect(data.terrainData).toEqual(terrainData);
  });
});

// ===========================================================================
// extrude_shape
// ===========================================================================

describe('extrude_shape', () => {
  it('returns error when shape is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'extrude_shape', {});
    expect(result.success).toBe(false);
  });

  it('rejects invalid shape', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'extrude_shape', {
      shape: 'triangle',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid shapes', async () => {
    const shapes = ['circle', 'square', 'hexagon', 'star'];
    for (const shape of shapes) {
      const { result } = await invokeHandler(physicsJointHandlers, 'extrude_shape', { shape });
      expect(result.success).toBe(true);
    }
  });

  it('calls store.extrudeShape with shape and opts', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'extrude_shape', {
      shape: 'circle',
      radius: 2.0,
      length: 5.0,
    });
    expect(result.success).toBe(true);
    const [shape, opts] = (store.extrudeShape as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(shape).toBe('circle');
    expect(opts.radius).toBe(2.0);
    expect(opts.length).toBe(5.0);
  });

  it('result message includes shape name', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'extrude_shape', {
      shape: 'hexagon',
    });
    const data = result.result as { message: string };
    expect(data.message).toContain('hexagon');
  });
});

// ===========================================================================
// lathe_shape
// ===========================================================================

describe('lathe_shape', () => {
  it('returns error when profile is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'lathe_shape', {});
    expect(result.success).toBe(false);
  });

  it('returns error when profile has fewer than 2 points', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'lathe_shape', {
      profile: [[0, 0]],
    });
    expect(result.success).toBe(false);
  });

  it('calls store.latheShape with profile and options', async () => {
    const profile = [[0, 0], [1, 0], [1, 2], [0, 2]];
    const { result, store } = await invokeHandler(physicsJointHandlers, 'lathe_shape', {
      profile,
      segments: 16,
      name: 'Vase',
    });
    expect(result.success).toBe(true);
    const [lProfile, opts] = (store.latheShape as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown[], Record<string, unknown>];
    expect(lProfile).toEqual(profile);
    expect(opts.segments).toBe(16);
    expect(opts.name).toBe('Vase');
  });
});

// ===========================================================================
// array_entity
// ===========================================================================

describe('array_entity', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'array_entity', {
      pattern: 'grid',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when pattern is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'array_entity', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid pattern', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'array_entity', {
      entityId: 'ent-1',
      pattern: 'spiral',
    });
    expect(result.success).toBe(false);
  });

  it('calls store.arrayEntity with pattern and opts', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'array_entity', {
      entityId: 'ent-1',
      pattern: 'grid',
      countX: 3,
      countY: 2,
      spacingX: 2.0,
    });
    expect(result.success).toBe(true);
    const [entityId, opts] = (store.arrayEntity as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(entityId).toBe('ent-1');
    expect(opts.pattern).toBe('grid');
    expect(opts.countX).toBe(3);
  });

  it('accepts circle pattern', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'array_entity', {
      entityId: 'ent-1',
      pattern: 'circle',
      circleCount: 8,
      circleRadius: 5.0,
    });
    expect(result.success).toBe(true);
    const data = result.result as { message: string };
    expect(data.message).toContain('circle');
  });
});

// ===========================================================================
// combine_meshes
// ===========================================================================

describe('combine_meshes', () => {
  it('returns error when entityIds is missing', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'combine_meshes', {});
    expect(result.success).toBe(false);
  });

  it('returns error when entityIds has fewer than 2 items', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'combine_meshes', {
      entityIds: ['ent-1'],
    });
    expect(result.success).toBe(false);
  });

  it('calls store.combineMeshes with correct args', async () => {
    const { result, store } = await invokeHandler(physicsJointHandlers, 'combine_meshes', {
      entityIds: ['ent-1', 'ent-2', 'ent-3'],
      deleteSources: true,
      name: 'Combined',
    });
    expect(result.success).toBe(true);
    expect(store.combineMeshes).toHaveBeenCalledWith(
      ['ent-1', 'ent-2', 'ent-3'],
      true,
      'Combined',
    );
  });

  it('result message includes count of entities', async () => {
    const { result } = await invokeHandler(physicsJointHandlers, 'combine_meshes', {
      entityIds: ['ent-1', 'ent-2'],
    });
    const data = result.result as { message: string };
    expect(data.message).toContain('2');
  });
});
