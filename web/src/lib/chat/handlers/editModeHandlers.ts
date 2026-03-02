/**
 * MCP handlers for edit mode (polygon modeling).
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, zVec3, parseArgs } from './types';

export const editModeHandlers: Record<string, ToolHandler> = {
  enter_edit_mode: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.enterEditMode(p.data.entityId);
    return { success: true, result: `Entered edit mode for entity ${p.data.entityId}` };
  },

  exit_edit_mode: async (_args, ctx) => {
    ctx.store.exitEditMode();
    return { success: true, result: 'Exited edit mode' };
  },

  set_selection_mode: async (args, ctx) => {
    const p = parseArgs(z.object({ mode: z.enum(['vertex', 'edge', 'face']) }), args);
    if (p.error) return p.error;
    ctx.store.setSelectionMode(p.data.mode);
    return { success: true, result: `Selection mode set to ${p.data.mode}` };
  },

  mesh_extrude: async (args, ctx) => {
    const p = parseArgs(z.object({
      indices: z.array(z.number().int().nonnegative()).optional(),
      distance: z.number().optional(),
      direction: zVec3.optional(),
    }), args);
    if (p.error) return p.error;
    const indices = p.data.indices ?? [];
    const distance = p.data.distance ?? 1.0;
    const direction = p.data.direction ?? [0, 1, 0];

    ctx.store.performMeshOperation('extrude', { indices, distance, direction });
    return { success: true, result: `Extruded ${indices.length} elements` };
  },

  mesh_inset: async (args, ctx) => {
    const p = parseArgs(z.object({
      indices: z.array(z.number().int().nonnegative()).optional(),
      amount: z.number().optional(),
    }), args);
    if (p.error) return p.error;
    const indices = p.data.indices ?? [];
    ctx.store.performMeshOperation('inset', { indices, amount: p.data.amount ?? 0.1 });
    return { success: true, result: `Inset ${indices.length} faces` };
  },

  mesh_bevel: async (args, ctx) => {
    const p = parseArgs(z.object({
      indices: z.array(z.number().int().nonnegative()).optional(),
      width: z.number().optional(),
      segments: z.number().int().positive().optional(),
    }), args);
    if (p.error) return p.error;
    const indices = p.data.indices ?? [];
    ctx.store.performMeshOperation('bevel', {
      indices,
      width: p.data.width ?? 0.1,
      segments: p.data.segments ?? 1,
    });
    return { success: true, result: 'Beveled edges' };
  },

  mesh_loop_cut: async (args, ctx) => {
    const p = parseArgs(z.object({
      edgeIndex: z.number().int().nonnegative(),
      cuts: z.number().int().positive().optional(),
    }), args);
    if (p.error) return p.error;
    const cuts = p.data.cuts ?? 1;
    ctx.store.performMeshOperation('loop_cut', { edgeIndex: p.data.edgeIndex, cuts });
    return { success: true, result: `Added ${cuts} loop cut(s)` };
  },

  mesh_subdivide: async (args, ctx) => {
    const p = parseArgs(z.object({
      indices: z.array(z.number().int().nonnegative()).optional(),
      level: z.number().int().positive().optional(),
    }), args);
    if (p.error) return p.error;
    ctx.store.performMeshOperation('subdivide', {
      indices: p.data.indices ?? [],
      level: p.data.level ?? 1,
    });
    return { success: true, result: 'Subdivided mesh' };
  },

  mesh_delete: async (args, ctx) => {
    const p = parseArgs(z.object({
      indices: z.array(z.number().int().nonnegative()).optional(),
      mode: z.string().optional(),
    }), args);
    if (p.error) return p.error;
    const indices = p.data.indices ?? [];
    ctx.store.performMeshOperation('delete', {
      indices,
      mode: p.data.mode ?? 'face',
    });
    return { success: true, result: `Deleted ${indices.length} elements` };
  },

  recalc_normals: async (args, ctx) => {
    const p = parseArgs(z.object({ smooth: z.boolean().optional() }), args);
    if (p.error) return p.error;
    const smooth = p.data.smooth ?? true;
    ctx.store.recalcNormals(smooth);
    return { success: true, result: `Recalculated normals (${smooth ? 'smooth' : 'flat'})` };
  },
};
