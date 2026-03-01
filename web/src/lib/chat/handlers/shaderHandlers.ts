/**
 * Shader MCP Handlers
 * Handles shader graph creation and compilation commands.
 */

import type { ToolHandler } from './types';
import { useShaderEditorStore } from '@/stores/shaderEditorStore';
import { SHADER_NODE_DEFINITIONS } from '@/lib/shaders/shaderNodeTypes';
import { compileToWgsl } from '@/lib/shaders/wgslCompiler';

const VALID_SHADER_TYPES = ['none', 'dissolve', 'hologram', 'force_field', 'lava_flow', 'toon', 'fresnel_glow'] as const;

export const shaderHandlers: Record<string, ToolHandler> = {
  create_shader_graph: async (args) => {
    const name = args.name as string || 'Untitled Shader';
    const graphId = useShaderEditorStore.getState().createNewGraph(name);
    return {
      success: true,
      result: `Created shader graph "${name}" (ID: ${graphId})`,
    };
  },

  add_shader_node: async (args) => {
    const { graphId, nodeType, position, data } = args as {
      graphId?: string;
      nodeType: string;
      position?: { x: number; y: number };
      data?: Record<string, unknown>;
    };

    // Validate node type
    if (!SHADER_NODE_DEFINITIONS[nodeType]) {
      return {
        success: false,
        error: `Unknown node type: ${nodeType}. Available types: ${Object.keys(SHADER_NODE_DEFINITIONS).join(', ')}`,
      };
    }

    const store = useShaderEditorStore.getState();
    const targetGraphId = graphId || store.activeGraphId;

    if (!targetGraphId) {
      return { success: false, error: 'No active shader graph. Create one first with create_shader_graph.' };
    }

    // Load the graph if not active
    if (store.activeGraphId !== targetGraphId) {
      store.loadGraph(targetGraphId);
    }

    const nodeId = store.addNode(
      nodeType,
      position || { x: 0, y: 0 },
      data || {}
    );

    const nodeDef = SHADER_NODE_DEFINITIONS[nodeType];
    return {
      success: true,
      result: `Added "${nodeDef.label}" node (ID: ${nodeId}) to graph`,
    };
  },

  connect_shader_nodes: async (args) => {
    const { sourceNodeId, sourceHandle, targetNodeId, targetHandle } = args as {
      sourceNodeId: string;
      sourceHandle: string;
      targetNodeId: string;
      targetHandle: string;
    };

    if (!sourceNodeId || !sourceHandle || !targetNodeId || !targetHandle) {
      return {
        success: false,
        error: 'Missing required parameters: sourceNodeId, sourceHandle, targetNodeId, targetHandle',
      };
    }

    const store = useShaderEditorStore.getState();
    const activeGraph = store.activeGraphId ? store.graphs[store.activeGraphId] : null;

    if (!activeGraph) {
      return { success: false, error: 'No active shader graph' };
    }

    // Validate nodes exist
    const sourceNode = activeGraph.nodes.find((n) => n.id === sourceNodeId);
    const targetNode = activeGraph.nodes.find((n) => n.id === targetNodeId);

    if (!sourceNode || !targetNode) {
      return { success: false, error: 'Source or target node not found in active graph' };
    }

    // Add the edge
    store.addEdge({
      source: sourceNodeId,
      sourceHandle,
      target: targetNodeId,
      targetHandle,
    });

    return {
      success: true,
      result: `Connected ${sourceNodeId}.${sourceHandle} -> ${targetNodeId}.${targetHandle}`,
    };
  },

  compile_shader: async (args) => {
    const graphId = args.graphId as string | undefined;
    const store = useShaderEditorStore.getState();
    const targetGraphId = graphId || store.activeGraphId;

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
    const { entityId, graphId, shaderType: explicitType } = args as {
      entityId: string;
      graphId?: string;
      shaderType?: string;
    };

    if (!entityId) {
      return { success: false, error: 'Missing required parameter: entityId' };
    }

    // If an explicit shader type is provided, apply it directly
    if (explicitType) {
      if (!VALID_SHADER_TYPES.includes(explicitType as typeof VALID_SHADER_TYPES[number])) {
        return { success: false, error: `Invalid shader type: ${explicitType}. Valid types: ${VALID_SHADER_TYPES.join(', ')}` };
      }
      ctx.store.updateShaderEffect(entityId, { shaderType: explicitType });
      return { success: true, result: `Applied "${explicitType}" shader effect to entity ${entityId}` };
    }

    const store = useShaderEditorStore.getState();
    const targetGraphId = graphId || store.activeGraphId;

    if (!targetGraphId) {
      return { success: false, error: 'No shader graph specified' };
    }

    const graph = store.graphs[targetGraphId];
    if (!graph) {
      return { success: false, error: `Shader graph not found: ${targetGraphId}` };
    }

    // Compile the shader
    const result = compileToWgsl(graph);
    if (result.error) {
      return { success: false, error: `Compilation failed: ${result.error}` };
    }

    // Infer effect type from compiled WGSL
    const inferred = inferShaderEffect(result.code ?? '');
    if (!inferred) {
      return {
        success: false,
        error: `Shader graph "${graph.name}" compiled successfully but could not be mapped to a built-in effect. Supported effects: ${VALID_SHADER_TYPES.filter(t => t !== 'none').join(', ')}. You can also pass shaderType directly.`,
      };
    }

    ctx.store.updateShaderEffect(entityId, { shaderType: inferred });

    return {
      success: true,
      result: `Applied "${inferred}" shader effect from graph "${graph.name}" to entity ${entityId}`,
    };
  },

  remove_shader_from_entity: async (args, ctx) => {
    const { entityId } = args as { entityId: string };
    if (!entityId) {
      return { success: false, error: 'Missing required parameter: entityId' };
    }
    ctx.store.removeShaderEffect(entityId);
    return { success: true, result: `Removed shader effect from entity ${entityId}` };
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
 * Each effect uses distinctive uniform names / patterns.
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
