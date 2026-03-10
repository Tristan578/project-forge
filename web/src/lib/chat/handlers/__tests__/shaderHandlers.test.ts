import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStore } from './handlerTestUtils';
import type { ToolHandler, ToolCallContext, ExecutionResult } from '../types';

const mockGraphState = {
  activeGraphId: 'graph-1',
  graphs: {
    'graph-1': {
      id: 'graph-1',
      name: 'Test Shader',
      nodes: [
        { id: 'n1', type: 'output', data: {}, position: { x: 0, y: 0 } },
        { id: 'n2', type: 'color', data: {}, position: { x: -200, y: 0 } },
      ],
      edges: [],
    },
  },
  createNewGraph: vi.fn((_name: string) => 'graph-new'),
  loadGraph: vi.fn(),
  addNode: vi.fn((_type: string, _pos: unknown, _data: unknown) => 'node-new'),
  addEdge: vi.fn(),
};

vi.mock('@/stores/shaderEditorStore', () => ({
  useShaderEditorStore: {
    getState: vi.fn(() => mockGraphState),
  },
}));

vi.mock('@/lib/shaders/shaderNodeTypes', () => ({
  SHADER_NODE_DEFINITIONS: {
    output: { label: 'Output', inputs: [], outputs: [] },
    color: { label: 'Color', inputs: [], outputs: [{ name: 'color' }] },
    dissolve: { label: 'Dissolve', inputs: [], outputs: [] },
  } as Record<string, { label: string }>,
}));

vi.mock('@/lib/shaders/wgslCompiler', () => ({
  compileToWgsl: vi.fn((_graph: unknown) => ({
    code: '// compiled wgsl code with dissolve_threshold',
    error: null,
  })),
}));

type Handlers = Record<string, ToolHandler>;
let handlers: Handlers;

async function invoke(
  name: string,
  args: Record<string, unknown> = {},
  storeOverrides: Record<string, unknown> = {},
): Promise<{ result: ExecutionResult; store: ToolCallContext['store'] }> {
  const store = createMockStore(storeOverrides);
  const result = await handlers[name](args, { store, dispatchCommand: vi.fn() });
  return { result, store };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../shaderHandlers');
  handlers = mod.shaderHandlers;
});

describe('shaderHandlers', () => {
  describe('create_shader_graph', () => {
    it('creates graph with given name', async () => {
      const { result } = await invoke('create_shader_graph', { name: 'MyShader' });
      expect(result.success).toBe(true);
      expect(mockGraphState.createNewGraph).toHaveBeenCalledWith('MyShader');
    });

    it('creates graph with default name', async () => {
      const { result } = await invoke('create_shader_graph', {});
      expect(result.success).toBe(true);
      expect(mockGraphState.createNewGraph).toHaveBeenCalledWith('Untitled Shader');
    });
  });

  describe('add_shader_node', () => {
    it('adds known node type', async () => {
      const { result } = await invoke('add_shader_node', { nodeType: 'color' });
      expect(result.success).toBe(true);
      expect(mockGraphState.addNode).toHaveBeenCalledWith('color', { x: 0, y: 0 }, {});
    });

    it('rejects unknown node type', async () => {
      const { result } = await invoke('add_shader_node', { nodeType: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown node type');
    });

    it('fails without active graph', async () => {
      mockGraphState.activeGraphId = '';
      const { result } = await invoke('add_shader_node', { nodeType: 'color' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active shader graph');
      mockGraphState.activeGraphId = 'graph-1';
    });

    it('adds node with custom position', async () => {
      const { result } = await invoke('add_shader_node', {
        nodeType: 'color', position: { x: 100, y: 200 },
      });
      expect(result.success).toBe(true);
      expect(mockGraphState.addNode).toHaveBeenCalledWith('color', { x: 100, y: 200 }, {});
    });
  });

  describe('connect_shader_nodes', () => {
    it('connects two nodes', async () => {
      const { result } = await invoke('connect_shader_nodes', {
        sourceNodeId: 'n2', sourceHandle: 'color',
        targetNodeId: 'n1', targetHandle: 'color',
      });
      expect(result.success).toBe(true);
      expect(mockGraphState.addEdge).toHaveBeenCalled();
    });

    it('fails without active graph', async () => {
      mockGraphState.activeGraphId = '';
      const { result } = await invoke('connect_shader_nodes', {
        sourceNodeId: 'n1', sourceHandle: 'out',
        targetNodeId: 'n2', targetHandle: 'in',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active shader graph');
      mockGraphState.activeGraphId = 'graph-1';
    });

    it('fails when node not found', async () => {
      const { result } = await invoke('connect_shader_nodes', {
        sourceNodeId: 'nonexistent', sourceHandle: 'out',
        targetNodeId: 'n1', targetHandle: 'in',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('compile_shader', () => {
    it('compiles active graph', async () => {
      const { result } = await invoke('compile_shader', {});
      expect(result.success).toBe(true);
      expect(typeof result.result).toBe('string');
    });

    it('compiles specific graph', async () => {
      const { result } = await invoke('compile_shader', { graphId: 'graph-1' });
      expect(result.success).toBe(true);
    });

    it('fails without active graph', async () => {
      mockGraphState.activeGraphId = '';
      const { result } = await invoke('compile_shader', {});
      expect(result.success).toBe(false);
      mockGraphState.activeGraphId = 'graph-1';
    });

    it('fails for nonexistent graph', async () => {
      const { result } = await invoke('compile_shader', { graphId: 'nonexistent' });
      expect(result.success).toBe(false);
    });
  });

  describe('apply_shader_to_entity', () => {
    it('applies built-in shader type', async () => {
      const { result, store } = await invoke('apply_shader_to_entity', {
        entityId: 'e1', shaderType: 'dissolve',
      });
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('e1', { shaderType: 'dissolve' });
    });

    it('rejects invalid shader type', async () => {
      const { result } = await invoke('apply_shader_to_entity', {
        entityId: 'e1', shaderType: 'invalid_shader',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid shader type');
    });

    it('applies shader from graph with inferred type', async () => {
      // The mock compiler returns code with dissolve_threshold
      const { result, store } = await invoke('apply_shader_to_entity', {
        entityId: 'e1', graphId: 'graph-1',
      });
      expect(result.success).toBe(true);
      expect(store.updateShaderEffect).toHaveBeenCalledWith('e1', { shaderType: 'dissolve' });
    });

    it('fails without graph when no shader type', async () => {
      mockGraphState.activeGraphId = '';
      const { result } = await invoke('apply_shader_to_entity', {
        entityId: 'e1',
      });
      expect(result.success).toBe(false);
      mockGraphState.activeGraphId = 'graph-1';
    });
  });

  describe('remove_shader_from_entity', () => {
    it('removes shader effect', async () => {
      const { result, store } = await invoke('remove_shader_from_entity', { entityId: 'e1' });
      expect(result.success).toBe(true);
      expect(store.removeShaderEffect).toHaveBeenCalledWith('e1');
    });
  });

  describe('list_shader_presets', () => {
    it('lists created shader graphs', async () => {
      const { result } = await invoke('list_shader_presets', {});
      expect(result.success).toBe(true);
      expect(typeof result.result).toBe('string');
      expect((result.result as string)).toContain('Test Shader');
    });

    it('returns message when no graphs exist', async () => {
      const origGraphs = mockGraphState.graphs;
      mockGraphState.graphs = {} as typeof mockGraphState.graphs;
      const { result } = await invoke('list_shader_presets', {});
      expect(result.success).toBe(true);
      expect((result.result as string)).toContain('No shader graphs');
      mockGraphState.graphs = origGraphs;
    });
  });
});
