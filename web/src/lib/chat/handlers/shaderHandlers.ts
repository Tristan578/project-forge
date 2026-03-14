/**
 * Shader MCP Handlers
 * Handles shader graph creation and compilation commands.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';
import { useShaderEditorStore } from '@/stores/shaderEditorStore';
import { SHADER_NODE_DEFINITIONS } from '@/lib/shaders/shaderNodeTypes';
import { compileToWgsl, compileToMegaShaderSlot } from '@/lib/shaders/wgslCompiler';

const VALID_SHADER_TYPES = ['none', 'dissolve', 'hologram', 'force_field', 'lava_flow', 'toon', 'fresnel_glow'] as const;

const CUSTOM_SHADER_SLOT_COUNT = 8;

export const shaderHandlers: Record<string, ToolHandler> = {
  create_shader_graph: async (args) => {
    const p = parseArgs(z.object({ name: z.string().optional() }), args);
    if (p.error) return p.error;
    const name = p.data.name || 'Untitled Shader';
    const graphId = useShaderEditorStore.getState().createNewGraph(name);
    return {
      success: true,
      result: `Created shader graph "${name}" (ID: ${graphId})`,
    };
  },

  add_shader_node: async (args) => {
    const p = parseArgs(z.object({
      graphId: z.string().optional(),
      nodeType: z.string().min(1),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    }), args);
    if (p.error) return p.error;

    if (!SHADER_NODE_DEFINITIONS[p.data.nodeType]) {
      return {
        success: false,
        error: `Unknown node type: ${p.data.nodeType}. Available types: ${Object.keys(SHADER_NODE_DEFINITIONS).join(', ')}`,
      };
    }

    const store = useShaderEditorStore.getState();
    const targetGraphId = p.data.graphId || store.activeGraphId;

    if (!targetGraphId) {
      return { success: false, error: 'No active shader graph. Create one first with create_shader_graph.' };
    }

    if (store.activeGraphId !== targetGraphId) {
      store.loadGraph(targetGraphId);
    }

    const nodeId = store.addNode(
      p.data.nodeType,
      p.data.position || { x: 0, y: 0 },
      p.data.data || {}
    );

    const nodeDef = SHADER_NODE_DEFINITIONS[p.data.nodeType];
    return {
      success: true,
      result: `Added "${nodeDef.label}" node (ID: ${nodeId}) to graph`,
    };
  },

  connect_shader_nodes: async (args) => {
    const p = parseArgs(z.object({
      sourceNodeId: z.string().min(1),
      sourceHandle: z.string().min(1),
      targetNodeId: z.string().min(1),
      targetHandle: z.string().min(1),
    }), args);
    if (p.error) return p.error;

    const store = useShaderEditorStore.getState();
    const activeGraph = store.activeGraphId ? store.graphs[store.activeGraphId] : null;

    if (!activeGraph) {
      return { success: false, error: 'No active shader graph' };
    }

    const sourceNode = activeGraph.nodes.find((n) => n.id === p.data.sourceNodeId);
    const targetNode = activeGraph.nodes.find((n) => n.id === p.data.targetNodeId);

    if (!sourceNode || !targetNode) {
      return { success: false, error: 'Source or target node not found in active graph' };
    }

    store.addEdge({
      source: p.data.sourceNodeId,
      sourceHandle: p.data.sourceHandle,
      target: p.data.targetNodeId,
      targetHandle: p.data.targetHandle,
    });

    return {
      success: true,
      result: `Connected ${p.data.sourceNodeId}.${p.data.sourceHandle} -> ${p.data.targetNodeId}.${p.data.targetHandle}`,
    };
  },

  compile_shader: async (args) => {
    const p = parseArgs(z.object({ graphId: z.string().optional() }), args);
    if (p.error) return p.error;
    const store = useShaderEditorStore.getState();
    const targetGraphId = p.data.graphId || store.activeGraphId;

    if (!targetGraphId) {
      return { success: false, error: 'No active shader graph' };
    }

    const graph = store.graphs[targetGraphId];
    if (!graph) {
      return { success: false, error: `Shader graph not found: ${targetGraphId}` };
    }

    const result = compileToWgsl(graph);
    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      result: `Compiled shader graph "${graph.name}" successfully. WGSL code:\n${result.code}`,
    };
  },

  apply_shader_to_entity: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      graphId: z.string().optional(),
      shaderType: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    if (p.data.shaderType) {
      if (!VALID_SHADER_TYPES.includes(p.data.shaderType as typeof VALID_SHADER_TYPES[number])) {
        return { success: false, error: `Invalid shader type: ${p.data.shaderType}. Valid types: ${VALID_SHADER_TYPES.join(', ')}` };
      }
      ctx.store.updateShaderEffect(p.data.entityId, { shaderType: p.data.shaderType });
      return { success: true, result: `Applied "${p.data.shaderType}" shader effect to entity ${p.data.entityId}` };
    }

    const store = useShaderEditorStore.getState();
    const targetGraphId = p.data.graphId || store.activeGraphId;

    if (!targetGraphId) {
      return { success: false, error: 'No shader graph specified' };
    }

    const graph = store.graphs[targetGraphId];
    if (!graph) {
      return { success: false, error: `Shader graph not found: ${targetGraphId}` };
    }

    const wgslResult = compileToWgsl(graph);
    if (wgslResult.error) {
      return { success: false, error: `Compilation failed: ${wgslResult.error}` };
    }

    const inferred = inferShaderEffect(wgslResult.code ?? '');
    if (inferred) {
      // Map to a built-in effect (backward-compatible path).
      ctx.store.updateShaderEffect(p.data.entityId, { shaderType: inferred });
      return {
        success: true,
        result: `Applied "${inferred}" shader effect from graph "${graph.name}" to entity ${p.data.entityId}`,
      };
    }

    // No built-in match — compile to mega-shader slot and register.
    const slotResult = compileToMegaShaderSlot(graph);
    if (slotResult.error) {
      return { success: false, error: `Mega-shader compilation failed: ${slotResult.error}` };
    }

    // Use slot 0 (0-indexed) — the next available slot would require async registry query.
    // For deterministic behaviour we use a fixed slot derived from the graph name hash.
    const slot = Math.abs(hashString(graph.name)) % CUSTOM_SHADER_SLOT_COUNT;

    ctx.dispatchCommand('register_custom_shader', {
      slot,
      name: graph.name,
      wgslCode: slotResult.functionBody,
      paramNames: [],
    });

    ctx.dispatchCommand('apply_custom_shader', {
      entityId: p.data.entityId,
      slot: slot + 1, // 1-indexed for WGSL dispatch
      params: {},
    });

    return {
      success: true,
      result: `Compiled shader graph "${graph.name}" as mega-shader slot ${slot} and applied to entity ${p.data.entityId}`,
    };
  },

  remove_shader_from_entity: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.removeShaderEffect(p.data.entityId);
    return { success: true, result: `Removed shader effect from entity ${p.data.entityId}` };
  },

  // ── Mega-shader commands ──────────────────────────────────────────────

  register_custom_shader: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        slot: z.number().int().min(0).max(CUSTOM_SHADER_SLOT_COUNT - 1),
        name: z.string().min(1),
        wgslCode: z.string().min(1),
        paramNames: z.array(z.string()).max(16).optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    ctx.dispatchCommand('register_custom_shader', {
      slot: p.data.slot,
      name: p.data.name,
      wgslCode: p.data.wgslCode,
      paramNames: p.data.paramNames ?? [],
    });

    return {
      success: true,
      result: `Registered custom shader "${p.data.name}" in slot ${p.data.slot}`,
    };
  },

  apply_custom_shader: async (args, ctx) => {
    const MAX_PARAMS = 16;
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        slot: z.number().int().min(1).max(CUSTOM_SHADER_SLOT_COUNT),
        params: z.record(z.string(), z.number()).optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const params = p.data.params ?? {};
    if (Object.keys(params).length > MAX_PARAMS) {
      return {
        success: false,
        result: `Too many params (${Object.keys(params).length}) — mega-shader supports at most ${MAX_PARAMS}`,
      };
    }

    ctx.dispatchCommand('apply_custom_shader', {
      entityId: p.data.entityId,
      slot: p.data.slot,
      params,
    });

    return {
      success: true,
      result: `Applied custom shader slot ${p.data.slot} to entity ${p.data.entityId}`,
    };
  },

  remove_custom_shader_slot: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        slot: z.number().int().min(0).max(CUSTOM_SHADER_SLOT_COUNT - 1),
      }),
      args,
    );
    if (p.error) return p.error;

    ctx.dispatchCommand('remove_custom_shader_slot', { slot: p.data.slot });

    return {
      success: true,
      result: `Removed custom shader slot ${p.data.slot}`,
    };
  },

  list_shader_presets: async () => {
    const store = useShaderEditorStore.getState();
    const graphs = Object.values(store.graphs);

    if (graphs.length === 0) {
      return { success: true, result: 'No shader graphs created yet.' };
    }

    const list = graphs
      .map((g) => `- ${g.name} (ID: ${g.id}, ${g.nodes.length} nodes, ${g.edges.length} edges)`)
      .join('\n');

    return {
      success: true,
      result: `Shader Graphs:\n${list}`,
    };
  },
};

/**
 * Infer built-in shader effect type from compiled WGSL code.
 */
function inferShaderEffect(wgslCode: string): string | null {
  const code = wgslCode.toLowerCase();
  if (code.includes('dissolve_threshold') || code.includes('dissolve')) return 'dissolve';
  if (code.includes('scan_line_frequency') || code.includes('hologram')) return 'hologram';
  if (code.includes('force_field') || code.includes('intersection_width')) return 'force_field';
  if (code.includes('scroll_speed') && code.includes('distortion')) return 'lava_flow';
  if (code.includes('toon_bands') || code.includes('toon')) return 'toon';
  if (code.includes('fresnel_power') || code.includes('fresnel')) return 'fresnel_glow';
  return null;
}

/**
 * Simple deterministic string hash (djb2-like) for slot assignment.
 * Returns a non-negative integer in the range [0, 2^31).
 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h & 0x7fffffff;
}
