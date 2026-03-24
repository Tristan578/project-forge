/**
 * Tests for scriptLibraryHandlers — script entity management, script library
 * CRUD, visual scripting, tokens, and publishing commands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler, createMockStore } from './handlerTestUtils';
import { scriptLibraryHandlers } from '../scriptLibraryHandlers';

// ---------------------------------------------------------------------------
// Script library store mock
// ---------------------------------------------------------------------------

const mockSaveScript = vi.fn();
const mockGetScript = vi.fn();
const mockUpdateScript = vi.fn();
const mockDeleteScript = vi.fn();
const mockSearchScripts = vi.fn();

vi.mock('@/stores/scriptLibraryStore', () => ({
  saveScript: (...args: unknown[]) => mockSaveScript(...args),
  getScript: (...args: unknown[]) => mockGetScript(...args),
  updateScript: (...args: unknown[]) => mockUpdateScript(...args),
  deleteScript: (...args: unknown[]) => mockDeleteScript(...args),
  searchScripts: (...args: unknown[]) => mockSearchScripts(...args),
}));

// ---------------------------------------------------------------------------
// Graph compiler mock
// ---------------------------------------------------------------------------

const mockCompileGraph = vi.fn();

vi.mock('@/lib/scripting/graphCompiler', () => ({
  compileGraph: (...args: unknown[]) => mockCompileGraph(...args),
}));

// ---------------------------------------------------------------------------
// User store mock
// ---------------------------------------------------------------------------

const mockUserStore = vi.fn();

vi.mock('@/stores/userStore', () => ({
  useUserStore: {
    getState: () => mockUserStore(),
  },
}));

// ---------------------------------------------------------------------------
// Publish store mock
// ---------------------------------------------------------------------------

const mockPublishGame = vi.fn();
const mockUnpublishGame = vi.fn();
const mockFetchPublications = vi.fn();

let mockPublications: Array<{
  title: string;
  slug: string;
  url: string;
  status: string;
}> = [];

vi.mock('@/stores/publishStore', () => ({
  usePublishStore: {
    getState: () => ({
      publications: mockPublications,
      publishGame: (...args: unknown[]) => mockPublishGame(...args),
      unpublishGame: (...args: unknown[]) => mockUnpublishGame(...args),
      fetchPublications: (...args: unknown[]) => mockFetchPublications(...args),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Token pricing mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/tokens/pricing', () => ({
  TOKEN_COSTS: { generate: 10, chat: 1 },
  TIER_MONTHLY_TOKENS: { free: 1000, pro: 50000 },
  TOKEN_PACKAGES: [{ id: 'pkg_100', tokens: 100, price: 0.99 }],
}));

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockPublications = [];
  mockSearchScripts.mockReturnValue([]);
  mockUserStore.mockReturnValue({ tokenBalance: { total: 5000, used: 200 } });
  mockFetchPublications.mockResolvedValue(undefined);
  mockCompileGraph.mockReturnValue({ success: true, code: 'function update() {}', errors: [] });
});

// ===========================================================================
// create_script (PF-855)
// ===========================================================================

describe('create_script', () => {
  it('returns error when source is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'create_script', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when no entityId and no primaryId in store', async () => {
    const store = createMockStore({ setScript: vi.fn(), primaryId: null });
    const result = await scriptLibraryHandlers.create_script(
      { source: 'function onStart() {}' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('No entity selected');
  });

  it('calls store.setScript with explicit entityId', async () => {
    const store = createMockStore({ setScript: vi.fn() });
    const result = await scriptLibraryHandlers.create_script(
      { entityId: 'ent-1', source: 'function onStart() {}' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(true);
    expect(store.setScript).toHaveBeenCalledWith('ent-1', 'function onStart() {}', true, undefined);
  });

  it('falls back to primaryId when no entityId provided', async () => {
    const store = createMockStore({ setScript: vi.fn(), primaryId: 'ent-42' });
    const result = await scriptLibraryHandlers.create_script(
      { source: 'const x = 1;' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(true);
    expect(store.setScript).toHaveBeenCalledWith('ent-42', 'const x = 1;', true, undefined);
  });

  it('passes enabled=false when provided', async () => {
    const store = createMockStore({ setScript: vi.fn() });
    await scriptLibraryHandlers.create_script(
      { entityId: 'ent-1', source: 'code', enabled: false },
      { store, dispatchCommand: vi.fn() },
    );
    expect(store.setScript).toHaveBeenCalledWith('ent-1', 'code', false, undefined);
  });

  it('passes template hint when provided', async () => {
    const store = createMockStore({ setScript: vi.fn() });
    await scriptLibraryHandlers.create_script(
      { entityId: 'ent-1', source: 'code', template: 'character_controller' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(store.setScript).toHaveBeenCalledWith('ent-1', 'code', true, 'character_controller');
  });

  it('result message includes entityId', async () => {
    const store = createMockStore({ setScript: vi.fn() });
    const result = await scriptLibraryHandlers.create_script(
      { entityId: 'ent-99', source: 'code' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(true);
    const data = result.result as { message: string };
    expect(data.message).toContain('ent-99');
  });
});

// ===========================================================================
// set_script
// ===========================================================================

describe('set_script', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'set_script', {
      source: 'console.log("hi")',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when source is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'set_script', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(false);
  });

  it('calls store.setScript with correct args', async () => {
    const store = createMockStore({
      setScript: vi.fn(),
    });
    const result = await scriptLibraryHandlers.set_script(
      { entityId: 'ent-1', source: 'const x = 1;' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(true);
    expect(store.setScript).toHaveBeenCalledWith('ent-1', 'const x = 1;', true, undefined);
  });

  it('passes enabled=false when provided', async () => {
    const store = createMockStore({ setScript: vi.fn() });
    await scriptLibraryHandlers.set_script(
      { entityId: 'ent-1', source: 'code', enabled: false },
      { store, dispatchCommand: vi.fn() },
    );
    expect(store.setScript).toHaveBeenCalledWith('ent-1', 'code', false, undefined);
  });

  it('passes template when provided', async () => {
    const store = createMockStore({ setScript: vi.fn() });
    await scriptLibraryHandlers.set_script(
      { entityId: 'ent-1', source: 'code', template: 'character_controller' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(store.setScript).toHaveBeenCalledWith('ent-1', 'code', true, 'character_controller');
  });

  it('result message includes entityId', async () => {
    const { result } = await invokeHandler(
      scriptLibraryHandlers,
      'set_script',
      { entityId: 'ent-42', source: '' },
      { setScript: vi.fn() },
    );
    const data = result.result as { message: string };
    expect(data.message).toContain('ent-42');
  });
});

// ===========================================================================
// remove_script
// ===========================================================================

describe('remove_script', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'remove_script', {});
    expect(result.success).toBe(false);
  });

  it('calls store.removeScript with entityId', async () => {
    const store = createMockStore({ removeScript: vi.fn() });
    const result = await scriptLibraryHandlers.remove_script(
      { entityId: 'ent-1' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(true);
    expect(store.removeScript).toHaveBeenCalledWith('ent-1');
  });
});

// ===========================================================================
// get_script
// ===========================================================================

describe('get_script', () => {
  it('returns hasScript=false when no script exists', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'get_script', {
      entityId: 'ent-1',
    }, { allScripts: {} });
    expect(result.success).toBe(true);
    const data = result.result as { hasScript: boolean };
    expect(data.hasScript).toBe(false);
  });

  it('returns script data when entity has a script', async () => {
    const script = { source: 'const x = 1;', enabled: true, template: 'basic' };
    const { result } = await invokeHandler(scriptLibraryHandlers, 'get_script', {
      entityId: 'ent-1',
    }, { allScripts: { 'ent-1': script } });
    expect(result.success).toBe(true);
    const data = result.result as { hasScript: boolean; source: string; enabled: boolean };
    expect(data.hasScript).toBe(true);
    expect(data.source).toBe('const x = 1;');
    expect(data.enabled).toBe(true);
  });
});

// ===========================================================================
// list_script_templates
// ===========================================================================

describe('list_script_templates', () => {
  it('returns a list of script templates', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'list_script_templates', {});
    expect(result.success).toBe(true);
    const data = result.result as { templates: Array<{ id: string; name: string }> };
    expect(data.templates.length).toBeGreaterThan(0);
    expect(data.templates[0].id).not.toBeNull();
    expect(data.templates[0].name).not.toBeNull();
  });

  it('includes character_controller template', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'list_script_templates', {});
    const data = result.result as { templates: Array<{ id: string }> };
    const ids = data.templates.map((t) => t.id);
    expect(ids).toContain('character_controller');
  });
});

// ===========================================================================
// apply_script_template
// ===========================================================================

describe('apply_script_template', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'apply_script_template', {
      template: 'basic',
      source: 'code',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when template is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'apply_script_template', {
      entityId: 'ent-1',
      source: 'code',
    });
    expect(result.success).toBe(false);
  });

  it('calls store.applyScriptTemplate with correct args', async () => {
    const store = createMockStore({ applyScriptTemplate: vi.fn() });
    const result = await scriptLibraryHandlers.apply_script_template(
      { entityId: 'ent-1', template: 'collectible', source: 'function update() {}' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(true);
    expect(store.applyScriptTemplate).toHaveBeenCalledWith(
      'ent-1', 'collectible', 'function update() {}'
    );
  });
});

// ===========================================================================
// create_library_script
// ===========================================================================

describe('create_library_script', () => {
  it('returns error when name is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'create_library_script', {
      source: 'code',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when source is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'create_library_script', {
      name: 'My Script',
    });
    expect(result.success).toBe(false);
  });

  it('creates script and returns id and name', async () => {
    mockSaveScript.mockReturnValue({ id: 'lib_1', name: 'Platformer Move' });
    const { result } = await invokeHandler(scriptLibraryHandlers, 'create_library_script', {
      name: 'Platformer Move',
      source: 'function update() {}',
      description: 'Basic movement',
      tags: ['movement', 'platformer'],
    });
    expect(result.success).toBe(true);
    const data = result.result as { id: string; name: string };
    expect(data.id).toBe('lib_1');
    expect(data.name).toBe('Platformer Move');
    expect(mockSaveScript).toHaveBeenCalledWith(
      'Platformer Move', 'function update() {}', 'Basic movement', ['movement', 'platformer']
    );
  });

  it('passes empty description and tags as defaults', async () => {
    mockSaveScript.mockReturnValue({ id: 'lib_2', name: 'Script' });
    await invokeHandler(scriptLibraryHandlers, 'create_library_script', {
      name: 'Script',
      source: 'code',
    });
    expect(mockSaveScript).toHaveBeenCalledWith('Script', 'code', '', []);
  });
});

// ===========================================================================
// update_library_script
// ===========================================================================

describe('update_library_script', () => {
  it('returns error when scriptId is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'update_library_script', {
      name: 'New Name',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when script is not found', async () => {
    mockGetScript.mockReturnValue(null);
    const { result } = await invokeHandler(scriptLibraryHandlers, 'update_library_script', {
      scriptId: 'nonexistent',
      name: 'New Name',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Script not found');
  });

  it('updates script with provided fields', async () => {
    mockGetScript.mockReturnValue({ id: 'lib_1', name: 'Old Name', source: 'old code' });
    const { result } = await invokeHandler(scriptLibraryHandlers, 'update_library_script', {
      scriptId: 'lib_1',
      name: 'New Name',
      source: 'new code',
    });
    expect(result.success).toBe(true);
    expect(mockUpdateScript).toHaveBeenCalledWith('lib_1', { name: 'New Name', source: 'new code' });
  });

  it('includes description when provided (even empty string)', async () => {
    mockGetScript.mockReturnValue({ id: 'lib_1', name: 'Script', source: 'code' });
    await invokeHandler(scriptLibraryHandlers, 'update_library_script', {
      scriptId: 'lib_1',
      description: '',
    });
    const [, updates] = mockUpdateScript.mock.calls[0] as [string, Record<string, unknown>];
    expect(updates.description).toBe('');
  });
});

// ===========================================================================
// delete_library_script
// ===========================================================================

describe('delete_library_script', () => {
  it('returns error when scriptId is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'delete_library_script', {});
    expect(result.success).toBe(false);
  });

  it('returns error when script is not found', async () => {
    mockGetScript.mockReturnValue(null);
    const { result } = await invokeHandler(scriptLibraryHandlers, 'delete_library_script', {
      scriptId: 'nope',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Script not found');
  });

  it('deletes script and returns name', async () => {
    mockGetScript.mockReturnValue({ id: 'lib_1', name: 'My Script' });
    const { result } = await invokeHandler(scriptLibraryHandlers, 'delete_library_script', {
      scriptId: 'lib_1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { deleted: string };
    expect(data.deleted).toBe('My Script');
    expect(mockDeleteScript).toHaveBeenCalledWith('lib_1');
  });
});

// ===========================================================================
// list_library_scripts
// ===========================================================================

describe('list_library_scripts', () => {
  it('returns empty list when no scripts', async () => {
    mockSearchScripts.mockReturnValue([]);
    const { result } = await invokeHandler(scriptLibraryHandlers, 'list_library_scripts', {});
    expect(result.success).toBe(true);
    const data = result.result as unknown[];
    expect(data).toHaveLength(0);
    expect(mockSearchScripts).toHaveBeenCalledWith('');
  });

  it('searches by query when provided', async () => {
    await invokeHandler(scriptLibraryHandlers, 'list_library_scripts', { query: 'movement' });
    expect(mockSearchScripts).toHaveBeenCalledWith('movement');
  });

  it('returns script summary with sourceLength', async () => {
    mockSearchScripts.mockReturnValue([
      { id: 's1', name: 'Script A', description: 'Desc', tags: ['tag1'], source: 'function x() {}' },
    ]);
    const { result } = await invokeHandler(scriptLibraryHandlers, 'list_library_scripts', {});
    const data = result.result as Array<{ id: string; sourceLength: number }>;
    expect(data[0].id).toBe('s1');
    expect(data[0].sourceLength).toBe('function x() {}'.length);
  });
});

// ===========================================================================
// attach_script_to_entity
// ===========================================================================

describe('attach_script_to_entity', () => {
  it('returns error when scriptId is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'attach_script_to_entity', {
      entityId: 'ent-1',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when library script is not found', async () => {
    mockGetScript.mockReturnValue(null);
    const { result } = await invokeHandler(scriptLibraryHandlers, 'attach_script_to_entity', {
      scriptId: 'nope',
      entityId: 'ent-1',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Library script not found');
  });

  it('attaches library script to entity', async () => {
    mockGetScript.mockReturnValue({ id: 'lib_1', name: 'Mover', source: 'function update() {}' });
    const store = createMockStore({ setScript: vi.fn() });
    const result = await scriptLibraryHandlers.attach_script_to_entity(
      { scriptId: 'lib_1', entityId: 'ent-1' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(true);
    expect(store.setScript).toHaveBeenCalledWith('ent-1', 'function update() {}', true);
    const data = result.result as { entityId: string; scriptName: string };
    expect(data.entityId).toBe('ent-1');
    expect(data.scriptName).toBe('Mover');
  });
});

// ===========================================================================
// detach_script_from_entity
// ===========================================================================

describe('detach_script_from_entity', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'detach_script_from_entity', {});
    expect(result.success).toBe(false);
  });

  it('calls store.removeScript and returns entityId', async () => {
    const store = createMockStore({ removeScript: vi.fn() });
    const result = await scriptLibraryHandlers.detach_script_from_entity(
      { entityId: 'ent-1' },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(true);
    expect(store.removeScript).toHaveBeenCalledWith('ent-1');
    const data = result.result as { entityId: string };
    expect(data.entityId).toBe('ent-1');
  });
});

// ===========================================================================
// set_visual_script
// ===========================================================================

describe('set_visual_script', () => {
  it('returns error when entityId is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'set_visual_script', {
      graph: { nodes: [], edges: [] },
    });
    expect(result.success).toBe(false);
  });

  it('compiles graph and sets script on success', async () => {
    mockCompileGraph.mockReturnValue({ success: true, code: 'function update() {}', errors: [] });
    const store = createMockStore({ setScript: vi.fn() });
    const result = await scriptLibraryHandlers.set_visual_script(
      { entityId: 'ent-1', graph: { nodes: [], edges: [] } },
      { store, dispatchCommand: vi.fn() },
    );
    expect(result.success).toBe(true);
    expect(store.setScript).toHaveBeenCalledWith('ent-1', 'function update() {}', true);
  });

  it('returns error when compilation fails', async () => {
    mockCompileGraph.mockReturnValue({
      success: false,
      code: '',
      errors: [{ message: 'Undefined variable x' }, { message: 'Missing return' }],
    });
    const { result } = await invokeHandler(scriptLibraryHandlers, 'set_visual_script', {
      entityId: 'ent-1',
      graph: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Undefined variable x');
    expect(result.error).toContain('Missing return');
  });
});

// ===========================================================================
// get_visual_script
// ===========================================================================

describe('get_visual_script', () => {
  it('returns success with empty nodes and edges', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'get_visual_script', {});
    expect(result.success).toBe(true);
    const data = result.result as { nodes: unknown[]; edges: unknown[] };
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });
});

// ===========================================================================
// compile_visual_script
// ===========================================================================

describe('compile_visual_script', () => {
  it('returns code on successful compilation of empty graph', async () => {
    mockCompileGraph.mockReturnValue({ success: true, code: '// empty', errors: [] });
    const { result } = await invokeHandler(scriptLibraryHandlers, 'compile_visual_script', {});
    expect(result.success).toBe(true);
    const data = result.result as { code: string };
    expect(data.code).toBe('// empty');
  });

  it('returns error when compilation fails', async () => {
    mockCompileGraph.mockReturnValue({
      success: false,
      code: '',
      errors: [{ message: 'Syntax error' }],
    });
    const { result } = await invokeHandler(scriptLibraryHandlers, 'compile_visual_script', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Syntax error');
  });
});

// ===========================================================================
// add_visual_script_node
// ===========================================================================

describe('add_visual_script_node', () => {
  it('returns error when nodeType is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'add_visual_script_node', {});
    expect(result.success).toBe(false);
  });

  it('returns success with message including nodeType', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'add_visual_script_node', {
      nodeType: 'math_add',
    });
    expect(result.success).toBe(true);
    const data = result.result as { message: string };
    expect(data.message).toContain('math_add');
  });
});

// ===========================================================================
// connect_visual_script_nodes
// ===========================================================================

describe('connect_visual_script_nodes', () => {
  it('returns error when sourceNodeId is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'connect_visual_script_nodes', {
      sourcePort: 'out',
      targetNodeId: 'node_2',
      targetPort: 'in',
    });
    expect(result.success).toBe(false);
  });

  it('returns success with connection message', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'connect_visual_script_nodes', {
      sourceNodeId: 'node_1',
      sourcePort: 'output',
      targetNodeId: 'node_2',
      targetPort: 'input',
    });
    expect(result.success).toBe(true);
    const data = result.result as { message: string };
    expect(data.message).toContain('node_1');
    expect(data.message).toContain('node_2');
  });
});

// ===========================================================================
// get_token_balance
// ===========================================================================

describe('get_token_balance', () => {
  it('returns token balance from userStore', async () => {
    mockUserStore.mockReturnValue({ tokenBalance: { total: 9999, used: 100 } });
    const { result } = await invokeHandler(scriptLibraryHandlers, 'get_token_balance', {});
    expect(result.success).toBe(true);
    const data = result.result as { total: number };
    expect(data.total).toBe(9999);
  });

  it('returns fallback message when balance is null', async () => {
    mockUserStore.mockReturnValue({ tokenBalance: null });
    const { result } = await invokeHandler(scriptLibraryHandlers, 'get_token_balance', {});
    expect(result.success).toBe(true);
    const data = result.result as { message: string };
    expect(data.message).toBe('Balance not loaded');
  });
});

// ===========================================================================
// get_token_pricing
// ===========================================================================

describe('get_token_pricing', () => {
  it('returns costs, monthly allocations, and packages', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'get_token_pricing', {});
    expect(result.success).toBe(true);
    const data = result.result as { costs: unknown; monthlyAllocations: unknown; packages: unknown };
    expect(data.costs).not.toBeUndefined();
    expect(data.monthlyAllocations).not.toBeUndefined();
    expect(data.packages).not.toBeUndefined();
  });
});

// ===========================================================================
// publish_game
// ===========================================================================

describe('publish_game', () => {
  it('returns error when title is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'publish_game', {
      slug: 'my-game',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when slug is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'publish_game', {
      title: 'My Game',
    });
    expect(result.success).toBe(false);
  });

  it('returns success with url when publish succeeds', async () => {
    mockPublishGame.mockResolvedValue({ url: 'https://play.spawnforge.ai/my-game' });
    const { result } = await invokeHandler(scriptLibraryHandlers, 'publish_game', {
      title: 'My Game',
      slug: 'my-game',
    });
    expect(result.success).toBe(true);
    const data = result.result as { message: string; url: string };
    expect(data.url).toBe('https://play.spawnforge.ai/my-game');
    expect(data.message).toContain('https://play.spawnforge.ai/my-game');
  });

  it('returns error when publish fails (returns null)', async () => {
    mockPublishGame.mockResolvedValue(null);
    const { result } = await invokeHandler(scriptLibraryHandlers, 'publish_game', {
      title: 'My Game',
      slug: 'my-game',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Publish failed');
  });
});

// ===========================================================================
// unpublish_game
// ===========================================================================

describe('unpublish_game', () => {
  it('returns error when id is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'unpublish_game', {});
    expect(result.success).toBe(false);
  });

  it('returns success when unpublish succeeds', async () => {
    mockUnpublishGame.mockResolvedValue(true);
    const { result } = await invokeHandler(scriptLibraryHandlers, 'unpublish_game', {
      id: 'pub_1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { message: string };
    expect(data.message).toBe('Game unpublished');
  });

  it('returns error when unpublish fails', async () => {
    mockUnpublishGame.mockResolvedValue(false);
    const { result } = await invokeHandler(scriptLibraryHandlers, 'unpublish_game', {
      id: 'pub_1',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unpublish failed');
  });
});

// ===========================================================================
// list_publications
// ===========================================================================

describe('list_publications', () => {
  it('returns empty list when no publications', async () => {
    mockPublications = [];
    const { result } = await invokeHandler(scriptLibraryHandlers, 'list_publications', {});
    expect(result.success).toBe(true);
    const data = result.result as unknown[];
    expect(data).toHaveLength(0);
    expect(mockFetchPublications).toHaveBeenCalledTimes(1);
  });

  it('returns publication summaries', async () => {
    mockPublications = [
      { title: 'Game 1', slug: 'game-1', url: 'https://play.spawnforge.ai/game-1', status: 'published' },
    ];
    const { result } = await invokeHandler(scriptLibraryHandlers, 'list_publications', {});
    const data = result.result as Array<{ title: string; slug: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Game 1');
    expect(data[0].slug).toBe('game-1');
  });
});

// ===========================================================================
// get_publish_url
// ===========================================================================

describe('get_publish_url', () => {
  it('returns error when slug is missing', async () => {
    const { result } = await invokeHandler(scriptLibraryHandlers, 'get_publish_url', {});
    expect(result.success).toBe(false);
  });

  it('returns error when publication is not found', async () => {
    mockPublications = [];
    const { result } = await invokeHandler(scriptLibraryHandlers, 'get_publish_url', {
      slug: 'not-found',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Publication not found');
  });

  it('returns url when publication is found', async () => {
    mockPublications = [
      { title: 'Game', slug: 'my-game', url: 'https://play.spawnforge.ai/my-game', status: 'published' },
    ];
    const { result } = await invokeHandler(scriptLibraryHandlers, 'get_publish_url', {
      slug: 'my-game',
    });
    expect(result.success).toBe(true);
    const data = result.result as { url: string };
    expect(data.url).toBe('https://play.spawnforge.ai/my-game');
  });
});
