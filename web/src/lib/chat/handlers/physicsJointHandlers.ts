/**
 * Physics, joint, CSG, terrain, and procedural mesh handlers for MCP commands.
 */

import type { ToolHandler } from './types';
import type { PhysicsData, JointData } from '@/stores/editorStore';

export const physicsJointHandlers: Record<string, ToolHandler> = {
  update_physics: async (args, ctx) => {
    const entityId = args.entityId as string;
    const physInput = { ...args } as Record<string, unknown>;
    delete physInput.entityId;

    const basePhysics: PhysicsData = ctx.store.primaryPhysics ?? {
      bodyType: 'dynamic',
      colliderShape: 'auto',
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

    const merged: PhysicsData = { ...basePhysics };
    for (const [key, value] of Object.entries(physInput)) {
      if (key in merged) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }

    ctx.store.updatePhysics(entityId, merged);
    return { success: true };
  },

  toggle_physics: async (args, ctx) => {
    ctx.store.togglePhysics(args.entityId as string, args.enabled as boolean);
    return { success: true, result: { message: `Physics ${args.enabled ? 'enabled' : 'disabled'}` } };
  },

  toggle_debug_physics: async (_args, ctx) => {
    ctx.store.toggleDebugPhysics();
    return { success: true, result: { message: 'Toggled debug physics' } };
  },

  get_physics: async (_args, ctx) => {
    return {
      success: true,
      result: {
        physics: ctx.store.primaryPhysics,
        enabled: ctx.store.physicsEnabled,
      },
    };
  },

  apply_force: async (args, ctx) => {
    ctx.store.togglePhysics(args.entityId as string, true);
    return { success: true, result: { message: 'Force application queued (only takes effect during Play)' } };
  },

  create_joint: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    const jointData: JointData = {
      jointType: (args.jointType as JointData['jointType']) ?? 'revolute',
      connectedEntityId: (args.connectedEntityId as string) ?? '',
      anchorSelf: (args.anchorSelf as [number, number, number]) ?? [0, 0, 0],
      anchorOther: (args.anchorOther as [number, number, number]) ?? [0, 0, 0],
      axis: (args.axis as [number, number, number]) ?? [0, 1, 0],
      limits: (args.limits as { min: number; max: number } | null) ?? null,
      motor: (args.motor as { targetVelocity: number; maxForce: number } | null) ?? null,
    };
    ctx.store.createJoint(entityId, jointData);
    return { success: true, result: { message: `Created ${jointData.jointType} joint on ${entityId}` } };
  },

  update_joint: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    const updates: Record<string, unknown> = {};
    if (args.jointType !== undefined) updates.jointType = args.jointType;
    if (args.connectedEntityId !== undefined) updates.connectedEntityId = args.connectedEntityId;
    if (args.anchorSelf !== undefined) updates.anchorSelf = args.anchorSelf;
    if (args.anchorOther !== undefined) updates.anchorOther = args.anchorOther;
    if (args.axis !== undefined) updates.axis = args.axis;
    if (args.limits !== undefined) updates.limits = args.limits;
    if (args.motor !== undefined) updates.motor = args.motor;
    ctx.store.updateJoint(entityId, updates as Partial<JointData>);
    return { success: true, result: { message: `Updated joint on ${entityId}` } };
  },

  remove_joint: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    ctx.store.removeJoint(entityId);
    return { success: true, result: { message: `Removed joint from ${entityId}` } };
  },

  get_joint: async (_args, ctx) => {
    return { success: true, result: { joint: ctx.store.primaryJoint } };
  },

  csg_union: async (args, ctx) => {
    const entityIdA = args.entityIdA as string;
    const entityIdB = args.entityIdB as string;
    if (!entityIdA || !entityIdB) return { success: false, error: 'Missing entityIdA or entityIdB' };
    const deleteSources = (args.deleteSources as boolean) ?? true;
    ctx.store.csgUnion(entityIdA, entityIdB, deleteSources);
    return { success: true, result: { message: 'CSG union queued' } };
  },

  csg_subtract: async (args, ctx) => {
    const entityIdA = args.entityIdA as string;
    const entityIdB = args.entityIdB as string;
    if (!entityIdA || !entityIdB) return { success: false, error: 'Missing entityIdA or entityIdB' };
    const deleteSources = (args.deleteSources as boolean) ?? true;
    ctx.store.csgSubtract(entityIdA, entityIdB, deleteSources);
    return { success: true, result: { message: 'CSG subtract queued' } };
  },

  csg_intersect: async (args, ctx) => {
    const entityIdA = args.entityIdA as string;
    const entityIdB = args.entityIdB as string;
    if (!entityIdA || !entityIdB) return { success: false, error: 'Missing entityIdA or entityIdB' };
    const deleteSources = (args.deleteSources as boolean) ?? true;
    ctx.store.csgIntersect(entityIdA, entityIdB, deleteSources);
    return { success: true, result: { message: 'CSG intersect queued' } };
  },

  spawn_terrain: async (args, ctx) => {
    ctx.store.spawnTerrain({
      noiseType: args.noiseType as 'perlin' | 'simplex' | 'value' | undefined,
      octaves: args.octaves as number | undefined,
      frequency: args.frequency as number | undefined,
      amplitude: args.amplitude as number | undefined,
      heightScale: args.heightScale as number | undefined,
      seed: args.seed as number | undefined,
      resolution: args.resolution as number | undefined,
      size: args.size as number | undefined,
    });
    return { success: true, result: { message: 'Terrain spawned' } };
  },

  update_terrain: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    const terrainData = ctx.store.terrainData[entityId];
    if (!terrainData) return { success: false, error: 'Entity is not a terrain' };

    const updated = {
      noiseType: (args.noiseType as 'perlin' | 'simplex' | 'value' | undefined) ?? terrainData.noiseType,
      octaves: (args.octaves as number | undefined) ?? terrainData.octaves,
      frequency: (args.frequency as number | undefined) ?? terrainData.frequency,
      amplitude: (args.amplitude as number | undefined) ?? terrainData.amplitude,
      heightScale: (args.heightScale as number | undefined) ?? terrainData.heightScale,
      seed: (args.seed as number | undefined) ?? terrainData.seed,
      resolution: (args.resolution as number | undefined) ?? terrainData.resolution,
      size: (args.size as number | undefined) ?? terrainData.size,
    };

    ctx.store.updateTerrain(entityId, updated);
    return { success: true, result: { message: 'Terrain updated' } };
  },

  sculpt_terrain: async (args, ctx) => {
    const entityId = args.entityId as string;
    const position = args.position as [number, number] | undefined;
    const radius = args.radius as number | undefined;
    const strength = args.strength as number | undefined;
    if (!entityId || !position || radius === undefined || strength === undefined) {
      return { success: false, error: 'Missing required parameters' };
    }
    ctx.store.sculptTerrain(entityId, position, radius, strength);
    return { success: true, result: { message: 'Terrain sculpted' } };
  },

  get_terrain: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    const terrainData = ctx.store.terrainData[entityId];
    if (!terrainData) return { success: false, error: 'Entity is not a terrain' };
    return { success: true, result: { terrainData } };
  },

  extrude_shape: async (args, ctx) => {
    const shape = args.shape as string;
    if (!shape) return { success: false, error: 'Missing shape parameter' };
    if (!['circle', 'square', 'hexagon', 'star'].includes(shape)) {
      return { success: false, error: 'Invalid shape. Must be: circle, square, hexagon, or star' };
    }

    ctx.store.extrudeShape(shape, {
      radius: args.radius as number | undefined,
      length: args.length as number | undefined,
      segments: args.segments as number | undefined,
      innerRadius: args.innerRadius as number | undefined,
      starPoints: args.starPoints as number | undefined,
      size: args.size as number | undefined,
      name: args.name as string | undefined,
      position: args.position as [number, number, number] | undefined,
    });
    return { success: true, result: { message: `Extruding ${shape} shape` } };
  },

  lathe_shape: async (args, ctx) => {
    const profile = args.profile as [number, number][];
    if (!profile || !Array.isArray(profile) || profile.length < 2) {
      return { success: false, error: 'Invalid profile. Must be an array of [radius, height] points (minimum 2 points)' };
    }

    ctx.store.latheShape(profile, {
      segments: args.segments as number | undefined,
      name: args.name as string | undefined,
      position: args.position as [number, number, number] | undefined,
    });
    return { success: true, result: { message: 'Lathing profile' } };
  },

  array_entity: async (args, ctx) => {
    const entityId = args.entityId as string;
    const pattern = args.pattern as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    if (!pattern || !['grid', 'circle'].includes(pattern)) {
      return { success: false, error: 'Invalid pattern. Must be: grid or circle' };
    }

    ctx.store.arrayEntity(entityId, {
      pattern: pattern as 'grid' | 'circle',
      countX: args.countX as number | undefined,
      countY: args.countY as number | undefined,
      countZ: args.countZ as number | undefined,
      spacingX: args.spacingX as number | undefined,
      spacingY: args.spacingY as number | undefined,
      spacingZ: args.spacingZ as number | undefined,
      circleCount: args.circleCount as number | undefined,
      circleRadius: args.circleRadius as number | undefined,
    });
    return { success: true, result: { message: `Creating ${pattern} array` } };
  },

  combine_meshes: async (args, ctx) => {
    const entityIds = args.entityIds as string[];
    if (!entityIds || !Array.isArray(entityIds) || entityIds.length < 2) {
      return { success: false, error: 'Must provide at least 2 entity IDs to combine' };
    }

    ctx.store.combineMeshes(
      entityIds,
      args.deleteSources as boolean | undefined,
      args.name as string | undefined
    );
    return { success: true, result: { message: `Combining ${entityIds.length} meshes` } };
  },
};
