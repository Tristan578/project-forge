import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStore } from './handlerTestUtils';
import type { ToolHandler, ToolCallContext, ExecutionResult } from '../types';

function makeDefaultGraphState() {
  return {
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
    } as Record<string, unknown>,
    createNewGraph: vi.fn((_name: string) => 'graph-new'),
    loadGraph: vi.fn(),
    addNode: vi.fn((_type: string, _pos: unknown, _data: unknown) => 'node-new'),
    addEdge: vi.fn(),
    setCompilationError: vi.fn((_error: string | null) => undefined),
  };
}

let mockGraphState = makeDefaultGraphState();

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

const mockCompileToWgsl = vi.fn((_graph: unknown) => ({
  code: '// compiled wgsl code with dissolve_threshold',
  error: null as string | null,
}));

const mockCompileToMegaShaderSlot = vi.fn((_graph: unknown) => ({
  functionBody: '  return color;',
  error: undefined as string | undefined,
}));

vi.mock('@/lib/shaders/wgslCompiler', () => ({
  get compileToWgsl() { return mockCompileToWgsl; },
  get compileToMegaShaderSlot() { return mockCompileToMegaShaderSlot; },
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
  vi.resetModules();
  vi.clearAllMocks();
  mockGraphState = makeDefaultGraphState();
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
    });

    it('fails for nonexistent graph', async () => {
      const { result } = await invoke('compile_shader', { graphId: 'nonexistent' });
      expect(result.success).toBe(false);
    });

    it('sets compilationError on invalid graph', async () => {
      mockCompileToWgsl.mockReturnValueOnce({ code: '', error: 'No PBR Output node found.' });
      await invoke('compile_shader', {});
      expect(mockGraphState.setCompilationError).toHaveBeenCalledWith('No PBR Output node found.');
    });

    it('clears compilationError on successful compilation', async () => {
      mockCompileToWgsl.mockReturnValueOnce({ code: '// valid wgsl', error: null });
      await invoke('compile_shader', {});
      expect(mockGraphState.setCompilationError).toHaveBeenCalledWith(null);
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
    });

    it('sets compilationError and returns error result when WGSL compilation fails', async () => {
      mockCompileToWgsl.mockReturnValueOnce({ code: '', error: 'Cyclic dependency detected.' });
      const { result } = await invoke('apply_shader_to_entity', {
        entityId: 'e1', graphId: 'graph-1',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Compilation failed');
      expect(result.error).toContain('Cyclic dependency detected.');
      expect(mockGraphState.setCompilationError).toHaveBeenCalledWith('Cyclic dependency detected.');
    });

    it('clears compilationError on successful inferred-type apply', async () => {
      mockCompileToWgsl.mockReturnValueOnce({ code: '// code with dissolve_threshold', error: null });
      await invoke('apply_shader_to_entity', { entityId: 'e1', graphId: 'graph-1' });
      expect(mockGraphState.setCompilationError).toHaveBeenCalledWith(null);
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
      mockGraphState.graphs = {};
      const { result } = await invoke('list_shader_presets', {});
      expect(result.success).toBe(true);
      expect((result.result as string)).toContain('No shader graphs');
    });
  });

  describe('register_custom_shader', () => {
    it('dispatches register command with valid slot and code', async () => {
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['register_custom_shader'](
        { slot: 0, name: 'MyFx', wgslCode: 'return color;' },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('register_custom_shader', expect.objectContaining({
        slot: 0,
        name: 'MyFx',
        wgslCode: 'return color;',
        paramNames: [],
      }));
    });

    it('accepts slot 7 (max valid)', async () => {
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['register_custom_shader'](
        { slot: 7, name: 'Last', wgslCode: 'return color;' },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
    });

    it('accepts optional paramNames array', async () => {
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['register_custom_shader'](
        { slot: 2, name: 'Glow', wgslCode: 'return color;', paramNames: ['intensity', 'radius'] },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('register_custom_shader', expect.objectContaining({
        paramNames: ['intensity', 'radius'],
      }));
    });

    it('rejects slot out of range (slot 8)', async () => {
      const store = createMockStore({});
      const result = await handlers['register_custom_shader'](
        { slot: 8, name: 'Bad', wgslCode: 'return color;' },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });

    it('rejects negative slot', async () => {
      const store = createMockStore({});
      const result = await handlers['register_custom_shader'](
        { slot: -1, name: 'Bad', wgslCode: 'return color;' },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });

    it('rejects empty wgslCode', async () => {
      const store = createMockStore({});
      const result = await handlers['register_custom_shader'](
        { slot: 0, name: 'Bad', wgslCode: '' },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });

    it('rejects empty name', async () => {
      const store = createMockStore({});
      const result = await handlers['register_custom_shader'](
        { slot: 0, name: '', wgslCode: 'return color;' },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });
  });

  describe('apply_custom_shader', () => {
    it('dispatches apply command with valid slot', async () => {
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['apply_custom_shader'](
        { entityId: 'e1', slot: 1 },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('apply_custom_shader', expect.objectContaining({
        entityId: 'e1',
        slot: 1,
        params: {},
      }));
    });

    it('accepts slot 8 (max valid)', async () => {
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['apply_custom_shader'](
        { entityId: 'e1', slot: 8 },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
    });

    it('forwards optional params map', async () => {
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['apply_custom_shader'](
        { entityId: 'e1', slot: 3, params: { intensity: 0.5, radius: 2.0 } },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('apply_custom_shader', expect.objectContaining({
        params: { intensity: 0.5, radius: 2.0 },
      }));
    });

    it('rejects slot 0 (1-indexed API)', async () => {
      const store = createMockStore({});
      const result = await handlers['apply_custom_shader'](
        { entityId: 'e1', slot: 0 },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });

    it('rejects slot 9 (above max)', async () => {
      const store = createMockStore({});
      const result = await handlers['apply_custom_shader'](
        { entityId: 'e1', slot: 9 },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });

    it('rejects missing entityId', async () => {
      const store = createMockStore({});
      const result = await handlers['apply_custom_shader'](
        { slot: 1 },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });
  });

  describe('remove_custom_shader_slot', () => {
    it('dispatches remove command for valid slot', async () => {
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['remove_custom_shader_slot'](
        { slot: 3 },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('remove_custom_shader_slot', { slot: 3 });
    });

    it('accepts slot 0 (first)', async () => {
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['remove_custom_shader_slot'](
        { slot: 0 },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
    });

    it('accepts slot 7 (last)', async () => {
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['remove_custom_shader_slot'](
        { slot: 7 },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
    });

    it('rejects slot 8 (out of range)', async () => {
      const store = createMockStore({});
      const result = await handlers['remove_custom_shader_slot'](
        { slot: 8 },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });

    it('rejects negative slot', async () => {
      const store = createMockStore({});
      const result = await handlers['remove_custom_shader_slot'](
        { slot: -1 },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });

    it('rejects missing slot argument', async () => {
      const store = createMockStore({});
      const result = await handlers['remove_custom_shader_slot'](
        {},
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
    });
  });

  describe('apply_shader_to_entity (mega-shader fallback)', () => {
    it('falls back to mega-shader when WGSL does not match built-in', async () => {
      mockCompileToWgsl.mockReturnValueOnce({ code: '// custom fx with no known keywords', error: null });
      mockCompileToMegaShaderSlot.mockReturnValueOnce({ functionBody: '  return color * 0.5;', error: undefined });
      const dispatchCommand = vi.fn();
      const store = createMockStore({});
      const result = await handlers['apply_shader_to_entity'](
        { entityId: 'e1', graphId: 'graph-1' },
        { store, dispatchCommand },
      );
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('register_custom_shader', expect.objectContaining({
        wgslCode: '  return color * 0.5;',
      }));
      expect(dispatchCommand).toHaveBeenCalledWith('apply_custom_shader', expect.objectContaining({
        entityId: 'e1',
      }));
    });

    it('reports error when mega-shader compilation fails', async () => {
      mockCompileToWgsl.mockReturnValueOnce({ code: '// unknown', error: null });
      mockCompileToMegaShaderSlot.mockReturnValueOnce({ functionBody: '', error: 'Cyclic dependency' });
      const store = createMockStore({});
      const result = await handlers['apply_shader_to_entity'](
        { entityId: 'e1', graphId: 'graph-1' },
        { store, dispatchCommand: vi.fn() },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Mega-shader compilation failed');
    });
  });
});
