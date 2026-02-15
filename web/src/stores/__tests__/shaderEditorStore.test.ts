/**
 * Unit tests for the shaderEditorStore Zustand store.
 *
 * Tests cover shader graph authoring, node management, edge management,
 * graph operations (save/load/delete/duplicate), and selection state.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useShaderEditorStore, type ShaderGraph } from '../shaderEditorStore';

describe('shaderEditorStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useShaderEditorStore.setState({
      isOpen: false,
      activeGraphId: null,
      graphs: {},
      selectedNodeIds: [],
    });
  });

  describe('Initial State', () => {
    it('should initialize with editor closed', () => {
      const state = useShaderEditorStore.getState();
      expect(state.isOpen).toBe(false);
    });

    it('should initialize with no active graph', () => {
      const state = useShaderEditorStore.getState();
      expect(state.activeGraphId).toBeNull();
    });

    it('should initialize with empty graphs', () => {
      const state = useShaderEditorStore.getState();
      expect(state.graphs).toEqual({});
    });

    it('should initialize with no selected nodes', () => {
      const state = useShaderEditorStore.getState();
      expect(state.selectedNodeIds).toEqual([]);
    });
  });

  describe('openShaderEditor', () => {
    it('should open editor', () => {
      const { openShaderEditor } = useShaderEditorStore.getState();

      openShaderEditor();

      const state = useShaderEditorStore.getState();
      expect(state.isOpen).toBe(true);
    });

    it('should create default graph if none exists', () => {
      const { openShaderEditor } = useShaderEditorStore.getState();

      openShaderEditor();

      const state = useShaderEditorStore.getState();
      expect(state.activeGraphId).not.toBeNull();
      expect(Object.keys(state.graphs)).toHaveLength(1);
      expect(state.graphs[state.activeGraphId!].name).toBe('Untitled Shader');
    });

    it('should load specified graph', () => {
      const { createNewGraph, openShaderEditor } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test Graph');
      useShaderEditorStore.setState({ isOpen: false, activeGraphId: null });

      openShaderEditor(graphId);

      const state = useShaderEditorStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.activeGraphId).toBe(graphId);
    });

    it('should not create new graph if one is already active', () => {
      const { createNewGraph, openShaderEditor } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Existing Graph');

      openShaderEditor();

      const state = useShaderEditorStore.getState();
      expect(state.activeGraphId).toBe(graphId);
      expect(Object.keys(state.graphs)).toHaveLength(1);
    });
  });

  describe('closeShaderEditor', () => {
    it('should close editor', () => {
      const { openShaderEditor, closeShaderEditor } = useShaderEditorStore.getState();

      openShaderEditor();
      closeShaderEditor();

      const state = useShaderEditorStore.getState();
      expect(state.isOpen).toBe(false);
    });
  });

  describe('Graph Management', () => {
    it('should create new graph', () => {
      const { createNewGraph } = useShaderEditorStore.getState();

      const graphId = createNewGraph('My Shader');

      const state = useShaderEditorStore.getState();
      expect(state.graphs[graphId]).toBeDefined();
      expect(state.graphs[graphId].name).toBe('My Shader');
      expect(state.graphs[graphId].nodes).toEqual([]);
      expect(state.graphs[graphId].edges).toEqual([]);
      expect(state.activeGraphId).toBe(graphId);
    });

    it('should set active graph', () => {
      const { createNewGraph, setActiveGraph } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      setActiveGraph(null);

      const state = useShaderEditorStore.getState();
      expect(state.activeGraphId).toBeNull();

      setActiveGraph(graphId);
      expect(useShaderEditorStore.getState().activeGraphId).toBe(graphId);
    });

    it('should load graph', () => {
      const { createNewGraph, loadGraph } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      useShaderEditorStore.setState({ selectedNodeIds: ['node1'] });

      loadGraph(graphId);

      const state = useShaderEditorStore.getState();
      expect(state.activeGraphId).toBe(graphId);
      expect(state.selectedNodeIds).toEqual([]);
    });

    it('should not crash when loading nonexistent graph', () => {
      const { loadGraph } = useShaderEditorStore.getState();

      loadGraph('nonexistent');

      const state = useShaderEditorStore.getState();
      expect(state.activeGraphId).toBeNull();
    });

    it('should rename graph', () => {
      const { createNewGraph, renameGraph } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Old Name');
      renameGraph(graphId, 'New Name');

      const state = useShaderEditorStore.getState();
      expect(state.graphs[graphId].name).toBe('New Name');
    });

    it('should not crash when renaming nonexistent graph', () => {
      const { renameGraph } = useShaderEditorStore.getState();

      renameGraph('nonexistent', 'New Name');

      const state = useShaderEditorStore.getState();
      expect(state.graphs).toEqual({});
    });

    it('should delete graph', () => {
      const { createNewGraph, deleteGraph } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      deleteGraph(graphId);

      const state = useShaderEditorStore.getState();
      expect(state.graphs[graphId]).toBeUndefined();
      expect(state.activeGraphId).toBeNull();
    });

    it('should delete graph without changing activeGraphId if not active', () => {
      const { createNewGraph, deleteGraph } = useShaderEditorStore.getState();

      const graphId1 = createNewGraph('Graph 1');
      const graphId2 = createNewGraph('Graph 2');
      deleteGraph(graphId1);

      const state = useShaderEditorStore.getState();
      expect(state.activeGraphId).toBe(graphId2);
    });

    it('should duplicate graph', () => {
      const { createNewGraph, addNode, duplicateGraph } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Original');
      addNode('pbr_output', { x: 100, y: 200 });

      const newId = duplicateGraph(graphId, 'Copy');

      const state = useShaderEditorStore.getState();
      expect(state.graphs[newId]).toBeDefined();
      expect(state.graphs[newId].name).toBe('Copy');
      expect(state.graphs[newId].nodes).toHaveLength(1);
      expect(state.graphs[newId].id).toBe(newId);
    });

    it('should return empty string when duplicating nonexistent graph', () => {
      const { duplicateGraph } = useShaderEditorStore.getState();

      const result = duplicateGraph('nonexistent', 'Copy');

      expect(result).toBe('');
    });

    it('should save graph with new name', () => {
      const { createNewGraph, saveGraph } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Old Name');
      saveGraph('New Name');

      const state = useShaderEditorStore.getState();
      expect(state.graphs[graphId].name).toBe('New Name');
    });

    it('should create new graph if no active graph when saving', () => {
      const { saveGraph } = useShaderEditorStore.getState();

      const graphId = saveGraph('My Shader');

      const state = useShaderEditorStore.getState();
      expect(state.graphs[graphId]).toBeDefined();
      expect(state.graphs[graphId].name).toBe('My Shader');
    });

    it('should export graph', () => {
      const { createNewGraph, exportGraph } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test Graph');

      const exported = exportGraph(graphId);

      expect(exported).not.toBeNull();
      expect(exported!.id).toBe(graphId);
      expect(exported!.name).toBe('Test Graph');
    });

    it('should return null when exporting nonexistent graph', () => {
      const { exportGraph } = useShaderEditorStore.getState();

      const result = exportGraph('nonexistent');

      expect(result).toBeNull();
    });

    it('should import graph', () => {
      const { importGraph } = useShaderEditorStore.getState();

      const externalGraph: ShaderGraph = {
        id: 'external-123',
        name: 'Imported Shader',
        nodes: [],
        edges: [],
      };

      importGraph(externalGraph);

      const state = useShaderEditorStore.getState();
      const imported = Object.values(state.graphs)[0];
      expect(imported.name).toBe('Imported Shader');
      expect(imported.id).not.toBe('external-123'); // Should get new ID
      expect(state.activeGraphId).toBe(imported.id);
    });
  });

  describe('Node Management', () => {
    it('should add node', () => {
      const { createNewGraph, addNode } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      const nodeId = addNode('pbr_output', { x: 100, y: 200 }, { color: 'red' });

      const state = useShaderEditorStore.getState();
      const node = state.graphs[graphId].nodes[0];
      expect(node.id).toBe(nodeId);
      expect(node.type).toBe('pbr_output');
      expect(node.position).toEqual({ x: 100, y: 200 });
      expect(node.data).toEqual({ color: 'red' });
    });

    it('should add node without data', () => {
      const { createNewGraph, addNode } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      addNode('texture_sample', { x: 50, y: 50 });

      const state = useShaderEditorStore.getState();
      const node = state.graphs[graphId].nodes[0];
      expect(node.data).toEqual({});
    });

    it('should return empty string if no active graph', () => {
      const { addNode } = useShaderEditorStore.getState();

      const nodeId = addNode('pbr_output', { x: 0, y: 0 });

      expect(nodeId).toBe('');
    });

    it('should update node', () => {
      const { createNewGraph, addNode, updateNode } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      const nodeId = addNode('pbr_output', { x: 100, y: 200 });

      updateNode(nodeId, { position: { x: 150, y: 250 } });

      const state = useShaderEditorStore.getState();
      const node = state.graphs[graphId].nodes[0];
      expect(node.position).toEqual({ x: 150, y: 250 });
    });

    it('should update node data', () => {
      const { createNewGraph, addNode, updateNodeData } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      const nodeId = addNode('pbr_output', { x: 0, y: 0 }, { color: 'red' });

      updateNodeData(nodeId, { color: 'blue', intensity: 1.0 });

      const state = useShaderEditorStore.getState();
      const node = state.graphs[graphId].nodes[0];
      expect(node.data).toEqual({ color: 'blue', intensity: 1.0 });
    });

    it('should update node position', () => {
      const { createNewGraph, addNode, updateNodePosition } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      const nodeId = addNode('pbr_output', { x: 0, y: 0 });

      updateNodePosition(nodeId, { x: 300, y: 400 });

      const state = useShaderEditorStore.getState();
      const node = state.graphs[graphId].nodes[0];
      expect(node.position).toEqual({ x: 300, y: 400 });
    });

    it('should remove nodes', () => {
      const { createNewGraph, addNode, removeNodes } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      const node1 = addNode('pbr_output', { x: 0, y: 0 });
      const node2 = addNode('texture_sample', { x: 100, y: 100 });

      removeNodes([node1]);

      const state = useShaderEditorStore.getState();
      expect(state.graphs[graphId].nodes).toHaveLength(1);
      expect(state.graphs[graphId].nodes[0].id).toBe(node2);
    });

    it('should remove edges connected to removed nodes', () => {
      const { createNewGraph, addNode, addEdge, removeNodes } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      const node1 = addNode('texture_sample', { x: 0, y: 0 });
      const node2 = addNode('pbr_output', { x: 100, y: 100 });
      addEdge({ source: node1, sourceHandle: 'color', target: node2, targetHandle: 'base_color' });

      removeNodes([node1]);

      const state = useShaderEditorStore.getState();
      expect(state.graphs[graphId].edges).toHaveLength(0);
    });

    it('should deselect removed nodes', () => {
      const { createNewGraph, addNode, removeNodes, setSelectedNodes } = useShaderEditorStore.getState();

      createNewGraph('Test');
      const node1 = addNode('pbr_output', { x: 0, y: 0 });
      const node2 = addNode('texture_sample', { x: 100, y: 100 });

      setSelectedNodes([node1, node2]);
      removeNodes([node1]);

      const state = useShaderEditorStore.getState();
      expect(state.selectedNodeIds).toEqual([node2]);
    });
  });

  describe('Edge Management', () => {
    it('should add edge', () => {
      const { createNewGraph, addNode, addEdge } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      const node1 = addNode('texture_sample', { x: 0, y: 0 });
      const node2 = addNode('pbr_output', { x: 100, y: 100 });

      addEdge({
        source: node1,
        sourceHandle: 'color',
        target: node2,
        targetHandle: 'base_color',
      });

      const state = useShaderEditorStore.getState();
      const edge = state.graphs[graphId].edges[0];
      expect(edge.source).toBe(node1);
      expect(edge.sourceHandle).toBe('color');
      expect(edge.target).toBe(node2);
      expect(edge.targetHandle).toBe('base_color');
      expect(edge.id).toBeDefined();
    });

    it('should remove edge', () => {
      const { createNewGraph, addNode, addEdge, removeEdge } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      const node1 = addNode('texture_sample', { x: 0, y: 0 });
      const node2 = addNode('pbr_output', { x: 100, y: 100 });
      addEdge({ source: node1, sourceHandle: 'color', target: node2, targetHandle: 'base_color' });

      const edgeId = useShaderEditorStore.getState().graphs[graphId].edges[0].id;
      removeEdge(edgeId);

      const state = useShaderEditorStore.getState();
      expect(state.graphs[graphId].edges).toHaveLength(0);
    });

    it('should handle removing nonexistent edge', () => {
      const { createNewGraph, removeEdge } = useShaderEditorStore.getState();

      createNewGraph('Test');
      removeEdge('nonexistent');

      const state = useShaderEditorStore.getState();
      expect(state.graphs[Object.keys(state.graphs)[0]].edges).toEqual([]);
    });
  });

  describe('Selection', () => {
    it('should set selected nodes', () => {
      const { setSelectedNodes } = useShaderEditorStore.getState();

      setSelectedNodes(['node1', 'node2']);

      const state = useShaderEditorStore.getState();
      expect(state.selectedNodeIds).toEqual(['node1', 'node2']);
    });

    it('should clear selection', () => {
      const { setSelectedNodes } = useShaderEditorStore.getState();

      setSelectedNodes(['node1', 'node2']);
      setSelectedNodes([]);

      const state = useShaderEditorStore.getState();
      expect(state.selectedNodeIds).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle operations without active graph', () => {
      const { updateNode, updateNodeData, updateNodePosition, addEdge, removeEdge } = useShaderEditorStore.getState();

      updateNode('node1', { position: { x: 0, y: 0 } });
      updateNodeData('node1', {});
      updateNodePosition('node1', { x: 0, y: 0 });
      addEdge({ source: 'n1', sourceHandle: 'out', target: 'n2', targetHandle: 'in' });
      removeEdge('edge1');

      const state = useShaderEditorStore.getState();
      expect(state.graphs).toEqual({});
    });

    it('should generate unique node IDs', () => {
      const { createNewGraph, addNode } = useShaderEditorStore.getState();

      createNewGraph('Test');
      const id1 = addNode('pbr_output', { x: 0, y: 0 });
      const id2 = addNode('pbr_output', { x: 0, y: 0 });

      expect(id1).not.toBe(id2);
    });

    it('should generate unique edge IDs', () => {
      const { createNewGraph, addNode, addEdge } = useShaderEditorStore.getState();

      const graphId = createNewGraph('Test');
      const node1 = addNode('texture', { x: 0, y: 0 });
      const node2 = addNode('pbr', { x: 100, y: 0 });
      const node3 = addNode('multiply', { x: 50, y: 50 });

      addEdge({ source: node1, sourceHandle: 'color', target: node2, targetHandle: 'base_color' });
      addEdge({ source: node1, sourceHandle: 'color', target: node3, targetHandle: 'a' });

      const state = useShaderEditorStore.getState();
      const edges = state.graphs[graphId].edges;
      expect(edges[0].id).not.toBe(edges[1].id);
    });

    it('should handle multiple graphs', () => {
      const { createNewGraph } = useShaderEditorStore.getState();

      const id1 = createNewGraph('Graph 1');
      const id2 = createNewGraph('Graph 2');

      const state = useShaderEditorStore.getState();
      expect(Object.keys(state.graphs)).toHaveLength(2);
      expect(state.graphs[id1].name).toBe('Graph 1');
      expect(state.graphs[id2].name).toBe('Graph 2');
    });

    it('should preserve graph data when switching active graph', () => {
      const { createNewGraph, addNode, setActiveGraph } = useShaderEditorStore.getState();

      const id1 = createNewGraph('Graph 1');
      addNode('pbr_output', { x: 0, y: 0 });

      const id2 = createNewGraph('Graph 2');
      addNode('texture_sample', { x: 100, y: 100 });

      setActiveGraph(id1);

      const state = useShaderEditorStore.getState();
      expect(state.graphs[id1].nodes).toHaveLength(1);
      expect(state.graphs[id2].nodes).toHaveLength(1);
    });
  });
});
