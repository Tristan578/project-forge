/**
 * MCP handlers for edit mode (polygon modeling).
 */

import type { ToolHandler } from './types';

export const editModeHandlers: Record<string, ToolHandler> = {
  enter_edit_mode: async (args, ctx) => {
    ctx.store.enterEditMode(args.entityId as string);
    return { success: true, result: `Entered edit mode for entity ${args.entityId}` };
  },

  exit_edit_mode: async (_args, ctx) => {
    ctx.store.exitEditMode();
    return { success: true, result: 'Exited edit mode' };
  },

  set_selection_mode: async (args, ctx) => {
    ctx.store.setSelectionMode(args.mode as 'vertex' | 'edge' | 'face');
    return { success: true, result: `Selection mode set to ${args.mode}` };
  },

  mesh_extrude: async (args, ctx) => {
    const indices = args.indices as number[] | undefined;
    const distance = (args.distance as number | undefined) ?? 1.0;
    const direction = (args.direction as [number, number, number] | undefined) ?? [0, 1, 0];

    ctx.store.performMeshOperation('extrude', {
      indices: indices ?? [],
      distance,
      direction,
    });

    return { success: true, result: `Extruded ${indices?.length ?? 0} elements` };
  },

  mesh_inset: async (args, ctx) => {
    const indices = args.indices as number[] | undefined;
    const amount = (args.amount as number | undefined) ?? 0.1;

    ctx.store.performMeshOperation('inset', {
      indices: indices ?? [],
      amount,
    });

    return { success: true, result: `Inset ${indices?.length ?? 0} faces` };
  },

  mesh_bevel: async (args, ctx) => {
    const indices = args.indices as number[] | undefined;
    const width = (args.width as number | undefined) ?? 0.1;
    const segments = (args.segments as number | undefined) ?? 1;

    ctx.store.performMeshOperation('bevel', {
      indices: indices ?? [],
      width,
      segments,
    });

    return { success: true, result: 'Beveled edges' };
  },

  mesh_loop_cut: async (args, ctx) => {
    const edgeIndex = args.edgeIndex as number;
    const cuts = (args.cuts as number | undefined) ?? 1;

    ctx.store.performMeshOperation('loop_cut', {
      edgeIndex,
      cuts,
    });

    return { success: true, result: `Added ${cuts} loop cut(s)` };
  },

  mesh_subdivide: async (args, ctx) => {
    const indices = args.indices as number[] | undefined;
    const level = (args.level as number | undefined) ?? 1;

    ctx.store.performMeshOperation('subdivide', {
      indices: indices ?? [],
      level,
    });

    return { success: true, result: 'Subdivided mesh' };
  },

  mesh_delete: async (args, ctx) => {
    const indices = args.indices as number[] | undefined;
    const mode = (args.mode as string | undefined) ?? 'face';

    ctx.store.performMeshOperation('delete', {
      indices: indices ?? [],
      mode,
    });

    return { success: true, result: `Deleted ${indices?.length ?? 0} elements` };
  },

  recalc_normals: async (args, ctx) => {
    const smooth = (args.smooth as boolean | undefined) ?? true;
    ctx.store.recalcNormals(smooth);
    return { success: true, result: `Recalculated normals (${smooth ? 'smooth' : 'flat'})` };
  },
};
