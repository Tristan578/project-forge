/**
 * Shader MCP Handlers
 * Handles shader graph creation and compilation commands.
 */

import type { ToolHandler } from './types';
import { useShaderEditorStore } from '@/stores/shaderEditorStore';
import { SHADER_NODE_DEFINITIONS } from '@/lib/shaders/shaderNodeTypes';
import { compileToWgsl } from '@/lib/shaders/wgslCompiler';

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

  apply_shader_to_entity: async (args) => {
    const { entityId, graphId } = args as {
      entityId: string;
      graphId?: string;
    };

    if (!entityId) {
      return { success: false, error: 'Missing required parameter: entityId' };
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

    // TODO: In future, this would apply the compiled WGSL to the entity's material
    // For now, just return success with the compiled code
    return {
      success: true,
      result: `Shader graph "${graph.name}" compiled and ready to apply to entity ${entityId}. (Note: Shader application not yet implemented in engine - this is a placeholder for Phase 23 MVP)`,
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
