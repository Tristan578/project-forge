// @vitest-environment jsdom
/**
 * Tests for scriptLibraryHandlers, uiBuilderHandlers, and performanceHandlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStore } from './handlerTestUtils';
import { scriptLibraryHandlers } from '../scriptLibraryHandlers';
import { uiBuilderHandlers } from '../uiBuilderHandlers';
import { performanceHandlers } from '../performanceHandlers';

// ---------------------------------------------------------------------------
// scriptLibraryStore mock (dynamic import in handlers)
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
// graph compiler mock (for visual script handlers)
// ---------------------------------------------------------------------------
const mockCompileGraph = vi.fn();
vi.mock('@/lib/scripting/graphCompiler', () => ({
  compileGraph: (...args: unknown[]) => mockCompileGraph(...args),
}));

// ---------------------------------------------------------------------------
// publishStore mock
// ---------------------------------------------------------------------------
const mockPublishGame = vi.fn();
const mockUnpublishGame = vi.fn();
const mockFetchPublications = vi.fn();
const mockPublishStoreState = {
  publishGame: mockPublishGame,
  unpublishGame: mockUnpublishGame,
  fetchPublications: mockFetchPublications,
  publications: [] as { title: string; slug: string; url: string; status: string }[],
};
vi.mock('@/stores/publishStore', () => ({
  usePublishStore: {
    getState: () => mockPublishStoreState,
  },
}));

// ---------------------------------------------------------------------------
// userStore mock
// ---------------------------------------------------------------------------
const mockUserStoreState = { tokenBalance: { tokens: 1000, tier: 'hobbyist' } };
vi.mock('@/stores/userStore', () => ({
  useUserStore: {
    getState: () => mockUserStoreState,
  },
}));

// ---------------------------------------------------------------------------
// token pricing mock
// ---------------------------------------------------------------------------
vi.mock('@/lib/tokens/pricing', () => ({
  TOKEN_COSTS: { model: 5, texture: 3 },
  TIER_MONTHLY_TOKENS: { starter: 100, hobbyist: 500 },
  TOKEN_PACKAGES: [{ tokens: 100, price: 5 }],
}));

// ---------------------------------------------------------------------------
// uiBuilderStore mock
// ---------------------------------------------------------------------------
const mockCreateScreen = vi.fn().mockReturnValue('screen-1');
const mockDeleteScreen = vi.fn();
const mockUpdateScreen = vi.fn();
const mockAddWidget = vi.fn().mockReturnValue('widget-1');
const mockUpdateWidget = vi.fn();
const mockUpdateWidgetStyle = vi.fn();
const mockRemoveWidget = vi.fn();
const mockSetBinding = vi.fn();
const mockRemoveBinding = vi.fn();
const mockApplyTheme = vi.fn();
const mockDuplicateScreen = vi.fn().mockReturnValue('screen-dup');
const mockRenameScreen = vi.fn();
const mockDuplicateWidget = vi.fn().mockReturnValue('widget-dup');
const mockReorderWidget = vi.fn();

const mockUIScreens: { id: string; name: string; widgets: { id: string; name: string }[]; showOnStart: boolean; showOnKey: string | null }[] = [];

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: {
    getState: () => ({
      screens: mockUIScreens,
      createScreen: mockCreateScreen,
      deleteScreen: mockDeleteScreen,
      updateScreen: mockUpdateScreen,
      addWidget: mockAddWidget,
      updateWidget: mockUpdateWidget,
      updateWidgetStyle: mockUpdateWidgetStyle,
      removeWidget: mockRemoveWidget,
      setBinding: mockSetBinding,
      removeBinding: mockRemoveBinding,
      applyTheme: mockApplyTheme,
      duplicateScreen: mockDuplicateScreen,
      renameScreen: mockRenameScreen,
      duplicateWidget: mockDuplicateWidget,
      reorderWidget: mockReorderWidget,
    }),
  },
}));

// ---------------------------------------------------------------------------
// performanceStore mock
// ---------------------------------------------------------------------------
const mockPerformanceBudget = vi.fn();
const mockPerformanceStats = { fps: 60, drawCalls: 100, triangles: 50000 };

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: {
    getState: () => ({
      setBudget: mockPerformanceBudget,
      stats: mockPerformanceStats,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeScriptStore(overrides: Record<string, unknown> = {}) {
  return {
    setScript: vi.fn(),
    removeScript: vi.fn(),
    allScripts: {} as Record<string, { source: string; enabled: boolean; template?: string }>,
    applyScriptTemplate: vi.fn(),
    projectId: 'test-project',
    ...overrides,
  };
}

async function invokeScript(
  name: string,
  args: Record<string, unknown> = {},
  storeOverrides: Record<string, unknown> = {},
) {
  const store = createMockStore({ ...makeScriptStore(), ...storeOverrides });
  const result = await scriptLibraryHandlers[name](args, {
    store,
    dispatchCommand: vi.fn(),
  });
  return { result, store };
}

async function invokeUI(
  name: string,
  args: Record<string, unknown> = {},
) {
  const store = createMockStore();
  const result = await uiBuilderHandlers[name](args, {
    store,
    dispatchCommand: vi.fn(),
  });
  return { result, store };
}

async function invokePerf(
  name: string,
  args: Record<string, unknown> = {},
) {
  const dispatchCommand = vi.fn();
  const store = createMockStore();
  const result = await performanceHandlers[name](args, {
    store,
    dispatchCommand,
  });
  return { result, store, dispatchCommand };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUIScreens.length = 0;
});

// ===========================================================================
// SCRIPT LIBRARY HANDLERS
// ===========================================================================
describe('scriptLibraryHandlers', () => {
  describe('set_script', () => {
    it('sets script on entity', async () => {
      const { result, store } = await invokeScript('set_script', {
        entityId: 'ent-1',
        source: 'forge.log("hello");',
      });
      expect(result.success).toBe(true);
      expect(store.setScript).toHaveBeenCalledWith('ent-1', 'forge.log("hello");', true, undefined);
    });

    it('sets script with enabled=false and template', async () => {
      const { result, store } = await invokeScript('set_script', {
        entityId: 'ent-1',
        source: 'code',
        enabled: false,
        template: 'character_controller',
      });
      expect(result.success).toBe(true);
      expect(store.setScript).toHaveBeenCalledWith('ent-1', 'code', false, 'character_controller');
    });

    it('fails without entityId', async () => {
      const { result } = await invokeScript('set_script', { source: 'code' });
      expect(result.success).toBe(false);
    });

    it('fails without source', async () => {
      const { result } = await invokeScript('set_script', { entityId: 'ent-1' });
      expect(result.success).toBe(false);
    });
  });

  describe('remove_script', () => {
    it('removes script', async () => {
      const { result, store } = await invokeScript('remove_script', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.removeScript).toHaveBeenCalledWith('ent-1');
    });

    it('fails without entityId', async () => {
      const { result } = await invokeScript('remove_script', {});
      expect(result.success).toBe(false);
    });
  });

  describe('get_script', () => {
    it('returns hasScript false when no script', async () => {
      const { result } = await invokeScript('get_script', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).hasScript).toBe(false);
    });

    it('returns script data when present', async () => {
      const scripts = {
        'ent-1': { source: 'code', enabled: true, template: 'collectible' },
      };
      const { result } = await invokeScript('get_script', { entityId: 'ent-1' }, { allScripts: scripts });
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.hasScript).toBe(true);
      expect(r.source).toBe('code');
      expect(r.template).toBe('collectible');
    });
  });

  describe('list_script_templates', () => {
    it('returns predefined templates', async () => {
      const { result } = await invokeScript('list_script_templates');
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect((r.templates as unknown[]).length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('apply_script_template', () => {
    it('applies template to entity', async () => {
      const { result, store } = await invokeScript('apply_script_template', {
        entityId: 'ent-1',
        template: 'collectible',
        source: 'template-code',
      });
      expect(result.success).toBe(true);
      expect(store.applyScriptTemplate).toHaveBeenCalledWith('ent-1', 'collectible', 'template-code');
    });

    it('fails without template', async () => {
      const { result } = await invokeScript('apply_script_template', {
        entityId: 'ent-1',
        source: 'code',
      });
      expect(result.success).toBe(false);
    });

    it('fails without source', async () => {
      const { result } = await invokeScript('apply_script_template', {
        entityId: 'ent-1',
        template: 'character_controller',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('create_library_script', () => {
    it('saves script to library', async () => {
      mockSaveScript.mockReturnValue({ id: 'lib-1', name: 'Jump Logic' });
      const { result } = await invokeScript('create_library_script', {
        name: 'Jump Logic',
        source: 'forge.jump();',
        description: 'Makes things jump',
        tags: ['movement'],
      });
      expect(result.success).toBe(true);
      expect(mockSaveScript).toHaveBeenCalledWith('Jump Logic', 'forge.jump();', 'Makes things jump', ['movement']);
      const r = result.result as Record<string, unknown>;
      expect(r.id).toBe('lib-1');
    });

    it('uses defaults for optional fields', async () => {
      mockSaveScript.mockReturnValue({ id: 'lib-2', name: 'Test' });
      await invokeScript('create_library_script', { name: 'Test', source: 'code' });
      expect(mockSaveScript).toHaveBeenCalledWith('Test', 'code', '', []);
    });

    it('fails without name', async () => {
      const { result } = await invokeScript('create_library_script', { source: 'code' });
      expect(result.success).toBe(false);
    });
  });

  describe('update_library_script', () => {
    it('updates existing script', async () => {
      mockGetScript.mockReturnValue({ id: 'lib-1', name: 'Old', source: 'old', description: '', tags: [] });
      const { result } = await invokeScript('update_library_script', {
        scriptId: 'lib-1',
        name: 'New Name',
        source: 'new code',
      });
      expect(result.success).toBe(true);
      expect(mockUpdateScript).toHaveBeenCalledWith('lib-1', { name: 'New Name', source: 'new code' });
    });

    it('returns error for non-existent script', async () => {
      mockGetScript.mockReturnValue(undefined);
      const { result } = await invokeScript('update_library_script', { scriptId: 'missing' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('delete_library_script', () => {
    it('deletes existing script', async () => {
      mockGetScript.mockReturnValue({ id: 'lib-1', name: 'ToDelete' });
      const { result } = await invokeScript('delete_library_script', { scriptId: 'lib-1' });
      expect(result.success).toBe(true);
      expect(mockDeleteScript).toHaveBeenCalledWith('lib-1');
      expect((result.result as Record<string, unknown>).deleted).toBe('ToDelete');
    });

    it('returns error for non-existent script', async () => {
      mockGetScript.mockReturnValue(undefined);
      const { result } = await invokeScript('delete_library_script', { scriptId: 'missing' });
      expect(result.success).toBe(false);
    });
  });

  describe('list_library_scripts', () => {
    it('returns search results', async () => {
      mockSearchScripts.mockReturnValue([
        { id: 'lib-1', name: 'Jump', description: 'jumps', tags: ['movement'], source: 'code' },
      ]);
      const { result } = await invokeScript('list_library_scripts', { query: 'jump' });
      expect(result.success).toBe(true);
      expect(mockSearchScripts).toHaveBeenCalledWith('jump');
      const items = result.result as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Jump');
    });

    it('returns all scripts when no query', async () => {
      mockSearchScripts.mockReturnValue([]);
      const { result } = await invokeScript('list_library_scripts', {});
      expect(result.success).toBe(true);
      expect(mockSearchScripts).toHaveBeenCalledWith('');
    });
  });

  describe('attach_script_to_entity', () => {
    it('attaches library script to entity', async () => {
      mockGetScript.mockReturnValue({ id: 'lib-1', name: 'Jump', source: 'forge.jump();' });
      const { result, store } = await invokeScript('attach_script_to_entity', {
        scriptId: 'lib-1',
        entityId: 'ent-1',
      });
      expect(result.success).toBe(true);
      expect(store.setScript).toHaveBeenCalledWith('ent-1', 'forge.jump();', true);
      const r = result.result as Record<string, unknown>;
      expect(r.scriptName).toBe('Jump');
    });

    it('returns error if script not found', async () => {
      mockGetScript.mockReturnValue(undefined);
      const { result } = await invokeScript('attach_script_to_entity', {
        scriptId: 'missing',
        entityId: 'ent-1',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('detach_script_from_entity', () => {
    it('removes script from entity', async () => {
      const { result, store } = await invokeScript('detach_script_from_entity', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(store.removeScript).toHaveBeenCalledWith('ent-1');
    });
  });

  describe('set_visual_script', () => {
    it('compiles and sets visual script', async () => {
      mockCompileGraph.mockReturnValue({ success: true, code: 'compiled code' });
      const { result, store } = await invokeScript('set_visual_script', {
        entityId: 'ent-1',
        graph: { nodes: [], edges: [] },
      });
      expect(result.success).toBe(true);
      expect(store.setScript).toHaveBeenCalledWith('ent-1', 'compiled code', true);
    });

    it('returns errors on compile failure', async () => {
      mockCompileGraph.mockReturnValue({ success: false, errors: [{ message: 'bad node' }] });
      const { result } = await invokeScript('set_visual_script', {
        entityId: 'ent-1',
        graph: { nodes: [], edges: [] },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('bad node');
    });
  });

  describe('get_visual_script', () => {
    it('returns empty graph', async () => {
      const { result } = await invokeScript('get_visual_script');
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.nodes).toEqual([]);
      expect(r.edges).toEqual([]);
    });
  });

  describe('get_token_balance', () => {
    it('returns balance from user store', async () => {
      const { result } = await invokeScript('get_token_balance');
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.tokens).toBe(1000);
    });
  });

  describe('get_token_pricing', () => {
    it('returns pricing data', async () => {
      const { result } = await invokeScript('get_token_pricing');
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.costs).not.toBeUndefined();
      expect(r.monthlyAllocations).not.toBeUndefined();
      expect(r.packages).not.toBeUndefined();
    });
  });

  describe('publish_game', () => {
    it('publishes game successfully', async () => {
      mockPublishGame.mockResolvedValue({ url: 'https://example.com/game' });
      const { result } = await invokeScript('publish_game', {
        title: 'My Game',
        slug: 'my-game',
        description: 'Cool game',
      }, { projectId: 'proj-1' });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).url).toBe('https://example.com/game');
    });

    it('returns error on failure', async () => {
      mockPublishGame.mockResolvedValue(null);
      const { result } = await invokeScript('publish_game', {
        title: 'My Game',
        slug: 'my-game',
      });
      expect(result.success).toBe(false);
    });

    it('fails without title', async () => {
      const { result } = await invokeScript('publish_game', { slug: 'x' });
      expect(result.success).toBe(false);
    });
  });

  describe('unpublish_game', () => {
    it('unpublishes successfully', async () => {
      mockUnpublishGame.mockResolvedValue(true);
      const { result } = await invokeScript('unpublish_game', { id: 'pub-1' });
      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      mockUnpublishGame.mockResolvedValue(false);
      const { result } = await invokeScript('unpublish_game', { id: 'pub-1' });
      expect(result.success).toBe(false);
    });
  });
});

// ===========================================================================
// UI BUILDER HANDLERS
// ===========================================================================
describe('uiBuilderHandlers', () => {
  describe('create_ui_screen', () => {
    it('creates screen with name', async () => {
      const { result } = await invokeUI('create_ui_screen', { name: 'HUD' });
      expect(result.success).toBe(true);
      expect(mockCreateScreen).toHaveBeenCalledWith('HUD', undefined);
      expect((result.result as Record<string, unknown>).screenId).toBe('screen-1');
    });

    it('creates screen with preset and options', async () => {
      const { result } = await invokeUI('create_ui_screen', {
        name: 'Pause Menu',
        preset: 'pause_menu',
        showOnStart: false,
        showOnKey: 'Escape',
        backgroundColor: '#000000',
        blockInput: true,
      });
      expect(result.success).toBe(true);
      expect(mockCreateScreen).toHaveBeenCalledWith('Pause Menu', 'pause_menu');
      expect(mockUpdateScreen).toHaveBeenCalledWith('screen-1', { showOnStart: false });
      expect(mockUpdateScreen).toHaveBeenCalledWith('screen-1', { showOnKey: 'Escape' });
      expect(mockUpdateScreen).toHaveBeenCalledWith('screen-1', { backgroundColor: '#000000' });
      expect(mockUpdateScreen).toHaveBeenCalledWith('screen-1', { blockInput: true });
    });

    it('fails without name', async () => {
      const { result } = await invokeUI('create_ui_screen', {});
      expect(result.success).toBe(false);
    });

    it('fails with invalid preset', async () => {
      const { result } = await invokeUI('create_ui_screen', { name: 'X', preset: 'invalid_preset' });
      expect(result.success).toBe(false);
    });
  });

  describe('delete_ui_screen', () => {
    it('deletes screen', async () => {
      const { result } = await invokeUI('delete_ui_screen', { screenId: 'screen-1' });
      expect(result.success).toBe(true);
      expect(mockDeleteScreen).toHaveBeenCalledWith('screen-1');
    });

    it('fails without screenId', async () => {
      const { result } = await invokeUI('delete_ui_screen', {});
      expect(result.success).toBe(false);
    });
  });

  describe('list_ui_screens', () => {
    it('returns empty list', async () => {
      const { result } = await invokeUI('list_ui_screens');
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(0);
    });

    it('returns populated list', async () => {
      mockUIScreens.push({
        id: 's1', name: 'HUD', widgets: [{ id: 'w1', name: 'Health' }],
        showOnStart: true, showOnKey: null,
      });
      const { result } = await invokeUI('list_ui_screens');
      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.count).toBe(1);
      expect((r.screens as Record<string, unknown>[])[0].widgetCount).toBe(1);
    });
  });

  describe('get_ui_screen', () => {
    it('returns screen by id', async () => {
      mockUIScreens.push({
        id: 's1', name: 'HUD', widgets: [],
        showOnStart: true, showOnKey: null,
      });
      const { result } = await invokeUI('get_ui_screen', { screenId: 's1' });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).name).toBe('HUD');
    });

    it('returns screen by name', async () => {
      mockUIScreens.push({
        id: 's1', name: 'HUD', widgets: [],
        showOnStart: true, showOnKey: null,
      });
      const { result } = await invokeUI('get_ui_screen', { screenId: 'HUD' });
      expect(result.success).toBe(true);
    });

    it('returns error for missing screen', async () => {
      const { result } = await invokeUI('get_ui_screen', { screenId: 'missing' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('update_ui_screen', () => {
    it('updates screen properties', async () => {
      const { result } = await invokeUI('update_ui_screen', {
        screenId: 's1',
        name: 'New Name',
        showOnStart: true,
        zIndex: 10,
      });
      expect(result.success).toBe(true);
      expect(mockUpdateScreen).toHaveBeenCalledWith('s1', expect.objectContaining({
        name: 'New Name',
        showOnStart: true,
        zIndex: 10,
      }));
    });

    it('fails without screenId', async () => {
      const { result } = await invokeUI('update_ui_screen', { name: 'X' });
      expect(result.success).toBe(false);
    });
  });

  describe('add_ui_widget', () => {
    it('adds widget with type', async () => {
      const { result } = await invokeUI('add_ui_widget', {
        screenId: 's1',
        type: 'text',
      });
      expect(result.success).toBe(true);
      expect(mockAddWidget).toHaveBeenCalledWith('s1', 'text', undefined);
      expect((result.result as Record<string, unknown>).widgetId).toBe('widget-1');
    });

    it('adds widget with position', async () => {
      await invokeUI('add_ui_widget', { screenId: 's1', type: 'button', x: 100, y: 200 });
      expect(mockAddWidget).toHaveBeenCalledWith('s1', 'button', { x: 100, y: 200 });
    });

    it('applies name, size, and style', async () => {
      await invokeUI('add_ui_widget', {
        screenId: 's1',
        type: 'panel',
        name: 'Stats Panel',
        width: 300,
        height: 200,
        style: { backgroundColor: '#333' },
      });
      expect(mockUpdateWidget).toHaveBeenCalledWith('s1', 'widget-1', expect.objectContaining({
        name: 'Stats Panel',
        width: 300,
        height: 200,
      }));
      expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('s1', 'widget-1', { backgroundColor: '#333' });
    });

    it('fails with invalid widget type', async () => {
      const { result } = await invokeUI('add_ui_widget', { screenId: 's1', type: 'invalid_type' });
      expect(result.success).toBe(false);
    });

    it('fails without screenId', async () => {
      const { result } = await invokeUI('add_ui_widget', { type: 'text' });
      expect(result.success).toBe(false);
    });
  });

  describe('update_ui_widget', () => {
    it('updates widget properties', async () => {
      const { result } = await invokeUI('update_ui_widget', {
        screenId: 's1',
        widgetId: 'w1',
        name: 'Updated',
        x: 50,
        visible: false,
      });
      expect(result.success).toBe(true);
      expect(mockUpdateWidget).toHaveBeenCalledWith('s1', 'w1', expect.objectContaining({
        name: 'Updated',
        x: 50,
        visible: false,
      }));
    });

    it('updates style separately', async () => {
      await invokeUI('update_ui_widget', {
        screenId: 's1',
        widgetId: 'w1',
        style: { color: 'red' },
      });
      expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('s1', 'w1', { color: 'red' });
    });

    it('fails without widgetId', async () => {
      const { result } = await invokeUI('update_ui_widget', { screenId: 's1' });
      expect(result.success).toBe(false);
    });
  });

  describe('remove_ui_widget', () => {
    it('removes widget', async () => {
      const { result } = await invokeUI('remove_ui_widget', { screenId: 's1', widgetId: 'w1' });
      expect(result.success).toBe(true);
      expect(mockRemoveWidget).toHaveBeenCalledWith('s1', 'w1');
    });

    it('fails without widgetId', async () => {
      const { result } = await invokeUI('remove_ui_widget', { screenId: 's1' });
      expect(result.success).toBe(false);
    });
  });

  describe('set_ui_binding', () => {
    it('sets data binding', async () => {
      const { result } = await invokeUI('set_ui_binding', {
        screenId: 's1',
        widgetId: 'w1',
        property: 'text',
        stateKey: 'player.health',
      });
      expect(result.success).toBe(true);
      expect(mockSetBinding).toHaveBeenCalledWith('s1', 'w1', 'text', expect.objectContaining({
        stateKey: 'player.health',
        direction: 'read',
      }));
    });

    it('sets read_write binding', async () => {
      await invokeUI('set_ui_binding', {
        screenId: 's1',
        widgetId: 'w1',
        property: 'value',
        stateKey: 'volume',
        direction: 'read_write',
      });
      expect(mockSetBinding).toHaveBeenCalledWith('s1', 'w1', 'value', expect.objectContaining({
        direction: 'read_write',
      }));
    });

    it('fails without stateKey', async () => {
      const { result } = await invokeUI('set_ui_binding', {
        screenId: 's1',
        widgetId: 'w1',
        property: 'text',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('remove_ui_binding', () => {
    it('removes binding', async () => {
      const { result } = await invokeUI('remove_ui_binding', {
        screenId: 's1',
        widgetId: 'w1',
        property: 'text',
      });
      expect(result.success).toBe(true);
      expect(mockRemoveBinding).toHaveBeenCalledWith('s1', 'w1', 'text');
    });
  });

  describe('set_ui_theme', () => {
    it('applies theme', async () => {
      const { result } = await invokeUI('set_ui_theme', {
        primaryColor: '#ff0000',
        fontSize: 14,
      });
      expect(result.success).toBe(true);
      expect(mockApplyTheme).toHaveBeenCalledWith(expect.objectContaining({
        primaryColor: '#ff0000',
        fontSize: 14,
      }));
    });

    it('succeeds with empty args', async () => {
      const { result } = await invokeUI('set_ui_theme', {});
      expect(result.success).toBe(true);
    });
  });

  describe('duplicate_ui_screen', () => {
    it('duplicates screen', async () => {
      const { result } = await invokeUI('duplicate_ui_screen', { screenId: 's1' });
      expect(result.success).toBe(true);
      expect(mockDuplicateScreen).toHaveBeenCalledWith('s1');
      expect((result.result as Record<string, unknown>).screenId).toBe('screen-dup');
    });

    it('renames duplicated screen', async () => {
      await invokeUI('duplicate_ui_screen', { screenId: 's1', newName: 'Copy' });
      expect(mockRenameScreen).toHaveBeenCalledWith('screen-dup', 'Copy');
    });
  });

  describe('duplicate_ui_widget', () => {
    it('duplicates widget', async () => {
      const { result } = await invokeUI('duplicate_ui_widget', { screenId: 's1', widgetId: 'w1' });
      expect(result.success).toBe(true);
      expect(mockDuplicateWidget).toHaveBeenCalledWith('s1', 'w1');
      expect((result.result as Record<string, unknown>).widgetId).toBe('widget-dup');
    });
  });

  describe('reorder_ui_widget', () => {
    it('reorders widget up', async () => {
      const { result } = await invokeUI('reorder_ui_widget', {
        screenId: 's1', widgetId: 'w1', direction: 'up',
      });
      expect(result.success).toBe(true);
      expect(mockReorderWidget).toHaveBeenCalledWith('s1', 'w1', 'up');
    });

    it('fails with invalid direction', async () => {
      const { result } = await invokeUI('reorder_ui_widget', {
        screenId: 's1', widgetId: 'w1', direction: 'left',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('get_ui_widget', () => {
    it('returns widget by id', async () => {
      mockUIScreens.push({
        id: 's1',
        name: 'HUD',
        widgets: [{ id: 'w1', name: 'Health' }],
        showOnStart: true,
        showOnKey: null,
      });
      const { result } = await invokeUI('get_ui_widget', { screenId: 's1', widgetId: 'w1' });
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).name).toBe('Health');
    });

    it('returns error for missing screen', async () => {
      const { result } = await invokeUI('get_ui_widget', { screenId: 'missing', widgetId: 'w1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Screen not found');
    });

    it('returns error for missing widget', async () => {
      mockUIScreens.push({
        id: 's1', name: 'HUD', widgets: [],
        showOnStart: true, showOnKey: null,
      });
      const { result } = await invokeUI('get_ui_widget', { screenId: 's1', widgetId: 'missing' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Widget not found');
    });
  });
});

// ===========================================================================
// PERFORMANCE HANDLERS
// ===========================================================================
describe('performanceHandlers', () => {
  describe('set_entity_lod', () => {
    it('dispatches set_lod with defaults', async () => {
      const { result, dispatchCommand } = await invokePerf('set_entity_lod', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('set_lod', {
        entityId: 'ent-1',
        lodDistances: [20, 50, 100],
        autoGenerate: false,
        lodRatios: [0.5, 0.25, 0.1],
      });
    });

    it('dispatches set_lod with custom values', async () => {
      const { result, dispatchCommand } = await invokePerf('set_entity_lod', {
        entityId: 'ent-1',
        lodDistances: [10, 30],
        autoGenerate: true,
        lodRatios: [0.7, 0.3],
      });
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('set_lod', {
        entityId: 'ent-1',
        lodDistances: [10, 30],
        autoGenerate: true,
        lodRatios: [0.7, 0.3],
      });
    });

    it('fails without entityId', async () => {
      const { result } = await invokePerf('set_entity_lod', {});
      expect(result.success).toBe(false);
    });
  });

  describe('generate_lods', () => {
    it('dispatches generate_lods', async () => {
      const { result, dispatchCommand } = await invokePerf('generate_lods', { entityId: 'ent-1' });
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('generate_lods', { entityId: 'ent-1' });
    });

    it('fails without entityId', async () => {
      const { result } = await invokePerf('generate_lods', {});
      expect(result.success).toBe(false);
    });
  });

  describe('set_performance_budget', () => {
    it('sets budget with defaults', async () => {
      const { result, dispatchCommand } = await invokePerf('set_performance_budget', {});
      expect(result.success).toBe(true);
      expect(mockPerformanceBudget).toHaveBeenCalledWith({
        maxTriangles: 500_000,
        maxDrawCalls: 200,
        targetFps: 60,
        warningThreshold: 0.8,
      });
      expect(dispatchCommand).toHaveBeenCalledWith('set_performance_budget', expect.objectContaining({
        maxTriangles: 500_000,
      }));
    });

    it('sets budget with custom values', async () => {
      const { result } = await invokePerf('set_performance_budget', {
        maxTriangles: 1_000_000,
        targetFps: 30,
      });
      expect(result.success).toBe(true);
      expect(mockPerformanceBudget).toHaveBeenCalledWith(expect.objectContaining({
        maxTriangles: 1_000_000,
        targetFps: 30,
      }));
    });
  });

  describe('get_performance_stats', () => {
    it('retrieves stats', async () => {
      const { result, dispatchCommand } = await invokePerf('get_performance_stats');
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('get_performance_stats', {});
      const r = result.result as Record<string, unknown>;
      expect(r.stats).toEqual(mockPerformanceStats);
    });
  });

  describe('optimize_scene', () => {
    it('dispatches optimize_scene', async () => {
      const { result, dispatchCommand } = await invokePerf('optimize_scene');
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('optimize_scene', {});
    });
  });

  describe('set_lod_distances', () => {
    it('dispatches with defaults', async () => {
      const { result, dispatchCommand } = await invokePerf('set_lod_distances', {});
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('set_lod_distances', {
        distances: [20, 50, 100],
      });
    });

    it('dispatches with custom distances', async () => {
      const { result, dispatchCommand } = await invokePerf('set_lod_distances', {
        distances: [15, 40, 80],
      });
      expect(result.success).toBe(true);
      expect(dispatchCommand).toHaveBeenCalledWith('set_lod_distances', {
        distances: [15, 40, 80],
      });
    });
  });
});
