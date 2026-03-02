/**
 * Physics, joint, CSG, terrain, and procedural mesh handlers for MCP commands.
 */

import { z } from 'zod';
import { zEntityId, zVec3, zVec2, parseArgs } from './types';
import type { ToolHandler } from './types';
import type { PhysicsData, JointData } from '@/stores/editorStore';

// ===== Shared Schemas =====

const zJointType = z.enum(['fixed', 'revolute', 'spherical', 'prismatic', 'rope', 'spring']);

const zNoiseType = z.enum(['perlin', 'simplex', 'value']);

const zExtrudeShape = z.enum(['circle', 'square', 'hexagon', 'star']);

const zArrayPattern = z.enum(['grid', 'circle']);

const zCsgPair = z.object({
  entityIdA: zEntityId,
  entityIdB: zEntityId,
  deleteSources: z.boolean().optional(),
});

const zLatheProfile = z.array(zVec2).min(2);

// ===== Handlers =====

export const physicsJointHandlers: Record<string, ToolHandler> = {
  update_physics: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        bodyType: z.enum(['dynamic', 'fixed', 'kinematic_position', 'kinematic_velocity']).optional(),
        colliderShape: z.enum(['cuboid', 'ball', 'cylinder', 'capsule', 'auto']).optional(),
        restitution: z.number().finite().optional(),
        friction: z.number().finite().optional(),
        density: z.number().finite().optional(),
        gravityScale: z.number().finite().optional(),
        lockTranslationX: z.boolean().optional(),
        lockTranslationY: z.boolean().optional(),
        lockTranslationZ: z.boolean().optional(),
        lockRotationX: z.boolean().optional(),
        lockRotationY: z.boolean().optional(),
        lockRotationZ: z.boolean().optional(),
        isSensor: z.boolean().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { entityId, ...physInput } = p.data;

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
      if (value !== undefined && key in merged) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }

    ctx.store.updatePhysics(entityId, merged);
    return { success: true };
  },

  toggle_physics: async (args, ctx) => {
    const p = parseArgs(
      z.object({ entityId: zEntityId, enabled: z.boolean() }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.togglePhysics(p.data.entityId, p.data.enabled);
    return { success: true, result: { message: `Physics ${p.data.enabled ? 'enabled' : 'disabled'}` } };
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
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.togglePhysics(p.data.entityId, true);
    return { success: true, result: { message: 'Force application queued (only takes effect during Play)' } };
  },

  create_joint: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        jointType: zJointType.optional(),
        connectedEntityId: z.string().optional(),
        anchorSelf: zVec3.optional(),
        anchorOther: zVec3.optional(),
        axis: zVec3.optional(),
        limits: z.object({ min: z.number().finite(), max: z.number().finite() }).nullable().optional(),
        motor: z.object({ targetVelocity: z.number().finite(), maxForce: z.number().finite() }).nullable().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { entityId, jointType, connectedEntityId, anchorSelf, anchorOther, axis, limits, motor } = p.data;
    const jointData: JointData = {
      jointType: jointType ?? 'revolute',
      connectedEntityId: connectedEntityId ?? '',
      anchorSelf: anchorSelf ?? [0, 0, 0],
      anchorOther: anchorOther ?? [0, 0, 0],
      axis: axis ?? [0, 1, 0],
      limits: limits ?? null,
      motor: motor ?? null,
    };
    ctx.store.createJoint(entityId, jointData);
    return { success: true, result: { message: `Created ${jointData.jointType} joint on ${entityId}` } };
  },

  update_joint: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        jointType: zJointType.optional(),
        connectedEntityId: z.string().optional(),
        anchorSelf: zVec3.optional(),
        anchorOther: zVec3.optional(),
        axis: zVec3.optional(),
        limits: z.object({ min: z.number().finite(), max: z.number().finite() }).nullable().optional(),
        motor: z.object({ targetVelocity: z.number().finite(), maxForce: z.number().finite() }).nullable().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { entityId, ...rest } = p.data;
    const updates: Partial<JointData> = {};
    if (rest.jointType !== undefined) updates.jointType = rest.jointType;
    if (rest.connectedEntityId !== undefined) updates.connectedEntityId = rest.connectedEntityId;
    if (rest.anchorSelf !== undefined) updates.anchorSelf = rest.anchorSelf;
    if (rest.anchorOther !== undefined) updates.anchorOther = rest.anchorOther;
    if (rest.axis !== undefined) updates.axis = rest.axis;
    if (rest.limits !== undefined) updates.limits = rest.limits;
    if (rest.motor !== undefined) updates.motor = rest.motor;

    ctx.store.updateJoint(entityId, updates);
    return { success: true, result: { message: `Updated joint on ${entityId}` } };
  },

  remove_joint: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.removeJoint(p.data.entityId);
    return { success: true, result: { message: `Removed joint from ${p.data.entityId}` } };
  },

  get_joint: async (_args, ctx) => {
    return { success: true, result: { joint: ctx.store.primaryJoint } };
  },

  csg_union: async (args, ctx) => {
    const p = parseArgs(zCsgPair, args);
    if (p.error) return p.error;
    ctx.store.csgUnion(p.data.entityIdA, p.data.entityIdB, p.data.deleteSources ?? true);
    return { success: true, result: { message: 'CSG union queued' } };
  },

  csg_subtract: async (args, ctx) => {
    const p = parseArgs(zCsgPair, args);
    if (p.error) return p.error;
    ctx.store.csgSubtract(p.data.entityIdA, p.data.entityIdB, p.data.deleteSources ?? true);
    return { success: true, result: { message: 'CSG subtract queued' } };
  },

  csg_intersect: async (args, ctx) => {
    const p = parseArgs(zCsgPair, args);
    if (p.error) return p.error;
    ctx.store.csgIntersect(p.data.entityIdA, p.data.entityIdB, p.data.deleteSources ?? true);
    return { success: true, result: { message: 'CSG intersect queued' } };
  },

  spawn_terrain: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        noiseType: zNoiseType.optional(),
        octaves: z.number().int().positive().optional(),
        frequency: z.number().finite().optional(),
        amplitude: z.number().finite().optional(),
        heightScale: z.number().finite().optional(),
        seed: z.number().int().optional(),
        resolution: z.number().int().positive().optional(),
        size: z.number().finite().positive().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.spawnTerrain(p.data);
    return { success: true, result: { message: 'Terrain spawned' } };
  },

  update_terrain: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        noiseType: zNoiseType.optional(),
        octaves: z.number().int().positive().optional(),
        frequency: z.number().finite().optional(),
        amplitude: z.number().finite().optional(),
        heightScale: z.number().finite().optional(),
        seed: z.number().int().optional(),
        resolution: z.number().int().positive().optional(),
        size: z.number().finite().positive().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { entityId, ...fields } = p.data;
    const terrainData = ctx.store.terrainData[entityId];
    if (!terrainData) return { success: false, error: 'Entity is not a terrain' };

    const updated = {
      noiseType: fields.noiseType ?? terrainData.noiseType,
      octaves: fields.octaves ?? terrainData.octaves,
      frequency: fields.frequency ?? terrainData.frequency,
      amplitude: fields.amplitude ?? terrainData.amplitude,
      heightScale: fields.heightScale ?? terrainData.heightScale,
      seed: fields.seed ?? terrainData.seed,
      resolution: fields.resolution ?? terrainData.resolution,
      size: fields.size ?? terrainData.size,
    };

    ctx.store.updateTerrain(entityId, updated);
    return { success: true, result: { message: 'Terrain updated' } };
  },

  sculpt_terrain: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        position: zVec2,
        radius: z.number().finite(),
        strength: z.number().finite(),
      }),
      args,
    );
    if (p.error) return p.error;
    ctx.store.sculptTerrain(p.data.entityId, p.data.position, p.data.radius, p.data.strength);
    return { success: true, result: { message: 'Terrain sculpted' } };
  },

  get_terrain: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const terrainData = ctx.store.terrainData[p.data.entityId];
    if (!terrainData) return { success: false, error: 'Entity is not a terrain' };
    return { success: true, result: { terrainData } };
  },

  extrude_shape: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        shape: zExtrudeShape,
        radius: z.number().finite().positive().optional(),
        length: z.number().finite().positive().optional(),
        segments: z.number().int().positive().optional(),
        innerRadius: z.number().finite().positive().optional(),
        starPoints: z.number().int().min(3).optional(),
        size: z.number().finite().positive().optional(),
        name: z.string().optional(),
        position: zVec3.optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { shape, ...opts } = p.data;
    ctx.store.extrudeShape(shape, opts);
    return { success: true, result: { message: `Extruding ${shape} shape` } };
  },

  lathe_shape: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        profile: zLatheProfile,
        segments: z.number().int().positive().optional(),
        name: z.string().optional(),
        position: zVec3.optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { profile, ...opts } = p.data;
    ctx.store.latheShape(profile, opts);
    return { success: true, result: { message: 'Lathing profile' } };
  },

  array_entity: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        pattern: zArrayPattern,
        countX: z.number().int().positive().optional(),
        countY: z.number().int().positive().optional(),
        countZ: z.number().int().positive().optional(),
        spacingX: z.number().finite().optional(),
        spacingY: z.number().finite().optional(),
        spacingZ: z.number().finite().optional(),
        circleCount: z.number().int().positive().optional(),
        circleRadius: z.number().finite().positive().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { entityId, pattern, ...opts } = p.data;
    ctx.store.arrayEntity(entityId, { pattern, ...opts });
    return { success: true, result: { message: `Creating ${pattern} array` } };
  },

  combine_meshes: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        entityIds: z.array(zEntityId).min(2),
        deleteSources: z.boolean().optional(),
        name: z.string().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    ctx.store.combineMeshes(p.data.entityIds, p.data.deleteSources, p.data.name);
    return { success: true, result: { message: `Combining ${p.data.entityIds.length} meshes` } };
  },
};
