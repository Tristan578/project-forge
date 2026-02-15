/**
 * Shader Editor Store
 * Manages shader graph state for visual shader authoring.
 */

import { create } from 'zustand';

export interface ShaderNode {
  id: string;
  type: string; // Node type (pbr_output, texture_sample, multiply, etc.)
  position: { x: number; y: number };
  data: Record<string, unknown>; // Node-specific parameters
}

export interface ShaderEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface ShaderGraph {
  id: string;
  name: string;
  nodes: ShaderNode[];
  edges: ShaderEdge[];
}

interface ShaderEditorState {
  isOpen: boolean;
  activeGraphId: string | null;
  graphs: Record<string, ShaderGraph>;
  selectedNodeIds: string[];

  // Actions
  openShaderEditor: (graphId?: string) => void;
  closeShaderEditor: () => void;
  setActiveGraph: (graphId: string | null) => void;
  addNode: (type: string, position: { x: number; y: number }, data?: Record<string, unknown>) => string;
  removeNodes: (ids: string[]) => void;
  updateNode: (id: string, updates: Partial<ShaderNode>) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  addEdge: (edge: Omit<ShaderEdge, 'id'>) => void;
  removeEdge: (id: string) => void;
  setSelectedNodes: (ids: string[]) => void;
  saveGraph: (name: string) => string; // Returns graph ID
  deleteGraph: (id: string) => void;
  renameGraph: (id: string, name: string) => void;
  loadGraph: (id: string) => void;
  createNewGraph: (name: string) => string; // Returns graph ID
  duplicateGraph: (id: string, newName: string) => string;
  importGraph: (graph: ShaderGraph) => void;
  exportGraph: (id: string) => ShaderGraph | null;
}

export const useShaderEditorStore = create<ShaderEditorState>((set, get) => ({
  isOpen: false,
  activeGraphId: null,
  graphs: {},
  selectedNodeIds: [],

  openShaderEditor: (graphId?: string) => {
    set({ isOpen: true });
    if (graphId) {
      get().loadGraph(graphId);
    } else if (!get().activeGraphId) {
      // Create a new default graph if none exists
      const newId = get().createNewGraph('Untitled Shader');
      set({ activeGraphId: newId });
    }
  },

  closeShaderEditor: () => set({ isOpen: false }),

  setActiveGraph: (graphId) => set({ activeGraphId: graphId }),

  addNode: (type, position, data = {}) => {
    const { activeGraphId, graphs } = get();
    if (!activeGraphId) return '';

    const newId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const newNode: ShaderNode = {
      id: newId,
      type,
      position,
      data,
    };

    set({
      graphs: {
        ...graphs,
        [activeGraphId]: {
          ...graphs[activeGraphId],
          nodes: [...graphs[activeGraphId].nodes, newNode],
        },
      },
    });

    return newId;
  },

  removeNodes: (ids) => {
    const { activeGraphId, graphs } = get();
    if (!activeGraphId) return;

    const graph = graphs[activeGraphId];
    const remainingNodes = graph.nodes.filter((n) => !ids.includes(n.id));
    const remainingEdges = graph.edges.filter(
      (e) => !ids.includes(e.source) && !ids.includes(e.target)
    );

    set({
      graphs: {
        ...graphs,
        [activeGraphId]: {
          ...graph,
          nodes: remainingNodes,
          edges: remainingEdges,
        },
      },
      selectedNodeIds: get().selectedNodeIds.filter((id) => !ids.includes(id)),
    });
  },

  updateNode: (id, updates) => {
    const { activeGraphId, graphs } = get();
    if (!activeGraphId) return;

    const graph = graphs[activeGraphId];
    const updatedNodes = graph.nodes.map((n) =>
      n.id === id ? { ...n, ...updates } : n
    );

    set({
      graphs: {
        ...graphs,
        [activeGraphId]: {
          ...graph,
          nodes: updatedNodes,
        },
      },
    });
  },

  updateNodeData: (id, data) => {
    get().updateNode(id, { data });
  },

  updateNodePosition: (id, position) => {
    get().updateNode(id, { position });
  },

  addEdge: (edge) => {
    const { activeGraphId, graphs } = get();
    if (!activeGraphId) return;

    const newEdge: ShaderEdge = {
      ...edge,
      id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    };

    set({
      graphs: {
        ...graphs,
        [activeGraphId]: {
          ...graphs[activeGraphId],
          edges: [...graphs[activeGraphId].edges, newEdge],
        },
      },
    });
  },

  removeEdge: (id) => {
    const { activeGraphId, graphs } = get();
    if (!activeGraphId) return;

    const graph = graphs[activeGraphId];
    const remainingEdges = graph.edges.filter((e) => e.id !== id);

    set({
      graphs: {
        ...graphs,
        [activeGraphId]: {
          ...graph,
          edges: remainingEdges,
        },
      },
    });
  },

  setSelectedNodes: (ids) => set({ selectedNodeIds: ids }),

  saveGraph: (name) => {
    const { activeGraphId, graphs } = get();
    if (!activeGraphId) {
      // Create new graph
      return get().createNewGraph(name);
    }

    // Update existing graph name
    set({
      graphs: {
        ...graphs,
        [activeGraphId]: {
          ...graphs[activeGraphId],
          name,
        },
      },
    });

    return activeGraphId;
  },

  deleteGraph: (id) => {
    const { graphs, activeGraphId } = get();
    const { [id]: _removed, ...remaining } = graphs;

    set({
      graphs: remaining,
      activeGraphId: activeGraphId === id ? null : activeGraphId,
    });
  },

  renameGraph: (id, name) => {
    const { graphs } = get();
    if (!graphs[id]) return;

    set({
      graphs: {
        ...graphs,
        [id]: {
          ...graphs[id],
          name,
        },
      },
    });
  },

  loadGraph: (id) => {
    const { graphs } = get();
    if (!graphs[id]) return;

    set({ activeGraphId: id, selectedNodeIds: [] });
  },

  createNewGraph: (name) => {
    const newId = `graph_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const newGraph: ShaderGraph = {
      id: newId,
      name,
      nodes: [],
      edges: [],
    };

    set((state) => ({
      graphs: {
        ...state.graphs,
        [newId]: newGraph,
      },
      activeGraphId: newId,
      selectedNodeIds: [],
    }));

    return newId;
  },

  duplicateGraph: (id, newName) => {
    const { graphs } = get();
    const sourceGraph = graphs[id];
    if (!sourceGraph) return '';

    const newId = `graph_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const newGraph: ShaderGraph = {
      ...sourceGraph,
      id: newId,
      name: newName,
    };

    set((state) => ({
      graphs: {
        ...state.graphs,
        [newId]: newGraph,
      },
    }));

    return newId;
  },

  importGraph: (graph) => {
    const newId = `graph_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const importedGraph: ShaderGraph = {
      ...graph,
      id: newId,
    };

    set((state) => ({
      graphs: {
        ...state.graphs,
        [newId]: importedGraph,
      },
      activeGraphId: newId,
    }));
  },

  exportGraph: (id) => {
    const { graphs } = get();
    return graphs[id] || null;
  },
}));
