/**
 * Unit tests for the workspaceStore Zustand store.
 *
 * Tests cover Dockview workspace management: layout presets, custom presets,
 * panel operations, chat overlay, docs navigation, and localStorage persistence.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspaceStore } from '../workspaceStore';
import type { DockviewApi, SerializedDockview } from 'dockview-react';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', { value: mockLocalStorage });

// Helper to create mock SerializedDockview data
const mockLayout = (): SerializedDockview =>
  ({ panels: {}, groups: {}, activePanel: null, grid: { root: {}, width: 0, height: 0, orientation: 'HORIZONTAL' } }) as unknown as SerializedDockview;

// Mock Dockview API
const createMockApi = () => ({
  clear: vi.fn(),
  toJSON: vi.fn(() => mockLayout()),
  fromJSON: vi.fn(),
  addPanel: vi.fn(() => ({
    api: { setActive: vi.fn(), setTitle: vi.fn(), moveTo: vi.fn(), group: {} },
  })),
  getPanel: vi.fn(() => undefined),
  panels: [] as { id: string }[],
});

describe('workspaceStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useWorkspaceStore.setState({
      api: null,
      activePreset: 'default',
      chatOverlayOpen: false,
      customPresets: [],
      docsPath: null,
    });
    // Clear localStorage
    mockLocalStorage.clear();
  });

  describe('Initial State', () => {
    it('should initialize with no API', () => {
      const state = useWorkspaceStore.getState();
      expect(state.api).toBeNull();
    });

    it('should initialize with default preset', () => {
      const state = useWorkspaceStore.getState();
      expect(state.activePreset).toBe('default');
    });

    it('should initialize with chat overlay closed', () => {
      const state = useWorkspaceStore.getState();
      expect(state.chatOverlayOpen).toBe(false);
    });

    it('should initialize with empty custom presets', () => {
      const state = useWorkspaceStore.getState();
      expect(state.customPresets).toEqual([]);
    });

    it('should initialize with no docs path', () => {
      const state = useWorkspaceStore.getState();
      expect(state.docsPath).toBeNull();
    });
  });

  describe('API Management', () => {
    it('should set API instance', () => {
      const mockApi = createMockApi() as unknown as DockviewApi;
      const { setApi } = useWorkspaceStore.getState();
      setApi(mockApi);

      const state = useWorkspaceStore.getState();
      expect(state.api).toBe(mockApi);
    });
  });

  describe('Layout Presets', () => {
    it('should apply preset when API is set', () => {
      const mockApi = createMockApi() as unknown as DockviewApi;
      useWorkspaceStore.setState({ api: mockApi });

      const { applyPreset } = useWorkspaceStore.getState();
      applyPreset('scripting');

      expect(mockApi.clear).toHaveBeenCalled();
      const state = useWorkspaceStore.getState();
      expect(state.activePreset).toBe('scripting');
    });

    it('should not apply preset when API is null', () => {
      const { applyPreset } = useWorkspaceStore.getState();
      applyPreset('presentation');

      const state = useWorkspaceStore.getState();
      // State should remain unchanged (API is null)
      expect(state.activePreset).toBe('default');
    });

    it('should save layout to localStorage after applying preset', () => {
      const mockApi = createMockApi() as unknown as DockviewApi;
      useWorkspaceStore.setState({ api: mockApi });

      const { applyPreset } = useWorkspaceStore.getState();
      applyPreset('default');

      expect(mockApi.toJSON).toHaveBeenCalled();
      expect(mockLocalStorage.getItem('forge-workspace-layout')).toBeTruthy();
    });
  });

  describe('Save/Load Layout', () => {
    it('should save current layout', () => {
      const mockApi = createMockApi() as unknown as DockviewApi;
      useWorkspaceStore.setState({ api: mockApi, activePreset: 'scripting' });

      const { saveLayout } = useWorkspaceStore.getState();
      saveLayout();

      expect(mockApi.toJSON).toHaveBeenCalled();
      expect(mockLocalStorage.getItem('forge-workspace-layout')).toBeTruthy();
      // Should clear active preset indicator
      expect(useWorkspaceStore.getState().activePreset).toBeNull();
    });

    it('should not save when API is null', () => {
      const { saveLayout } = useWorkspaceStore.getState();
      saveLayout();

      expect(mockLocalStorage.getItem('forge-workspace-layout')).toBeNull();
    });

    it('should load saved layout successfully', () => {
      const layoutData = mockLayout();
      mockLocalStorage.setItem('forge-workspace-layout', JSON.stringify(layoutData));

      const mockApi = createMockApi() as unknown as DockviewApi;
      useWorkspaceStore.setState({ api: mockApi });

      const { loadSavedLayout } = useWorkspaceStore.getState();
      const result = loadSavedLayout();

      expect(result).toBe(true);
      expect(mockApi.fromJSON).toHaveBeenCalledWith(layoutData);
    });

    it('should return false when no saved layout exists', () => {
      const mockApi = createMockApi() as unknown as DockviewApi;
      useWorkspaceStore.setState({ api: mockApi });

      const { loadSavedLayout } = useWorkspaceStore.getState();
      const result = loadSavedLayout();

      expect(result).toBe(false);
    });

    it('should return false when API is null', () => {
      const { loadSavedLayout } = useWorkspaceStore.getState();
      const result = loadSavedLayout();

      expect(result).toBe(false);
    });
  });

  describe('Custom Presets', () => {
    it('should save custom preset', () => {
      const mockApi = createMockApi() as unknown as DockviewApi;
      useWorkspaceStore.setState({ api: mockApi });

      const { saveCustomPreset } = useWorkspaceStore.getState();
      saveCustomPreset('My Layout');

      const state = useWorkspaceStore.getState();
      expect(state.customPresets).toHaveLength(1);
      expect(state.customPresets[0].name).toBe('My Layout');
      expect(mockLocalStorage.getItem('forge-workspace-custom-presets')).toBeTruthy();
    });

    it('should limit custom presets to 5', () => {
      const mockApi = createMockApi() as unknown as DockviewApi;
      useWorkspaceStore.setState({ api: mockApi });

      const { saveCustomPreset } = useWorkspaceStore.getState();
      for (let i = 0; i < 7; i++) {
        saveCustomPreset(`Layout ${i}`);
      }

      const state = useWorkspaceStore.getState();
      expect(state.customPresets).toHaveLength(5);
      // First two should be dropped (FIFO)
      expect(state.customPresets[0].name).toBe('Layout 2');
      expect(state.customPresets[4].name).toBe('Layout 6');
    });

    it('should delete custom preset', () => {
      useWorkspaceStore.setState({
        customPresets: [
          { name: 'Layout 1', layout: mockLayout() },
          { name: 'Layout 2', layout: mockLayout() },
        ],
      });

      const { deleteCustomPreset } = useWorkspaceStore.getState();
      deleteCustomPreset(0);

      const state = useWorkspaceStore.getState();
      expect(state.customPresets).toHaveLength(1);
      expect(state.customPresets[0].name).toBe('Layout 2');
    });

    it('should load custom preset', () => {
      const layoutData = mockLayout();
      const mockApi = createMockApi() as unknown as DockviewApi;
      useWorkspaceStore.setState({
        api: mockApi,
        customPresets: [{ name: 'My Layout', layout: layoutData }],
      });

      const { loadCustomPreset } = useWorkspaceStore.getState();
      loadCustomPreset(0);

      expect(mockApi.fromJSON).toHaveBeenCalledWith(layoutData);
      expect(useWorkspaceStore.getState().activePreset).toBeNull();
    });

    it('should not load invalid preset index', () => {
      const mockApi = createMockApi() as unknown as DockviewApi;
      useWorkspaceStore.setState({ api: mockApi, customPresets: [] });

      const { loadCustomPreset } = useWorkspaceStore.getState();
      loadCustomPreset(0);

      expect(mockApi.fromJSON).not.toHaveBeenCalled();
    });
  });

  describe('Chat Overlay', () => {
    it('should toggle chat overlay on', () => {
      useWorkspaceStore.setState({ chatOverlayOpen: false });
      const { toggleChatOverlay } = useWorkspaceStore.getState();
      toggleChatOverlay();

      expect(useWorkspaceStore.getState().chatOverlayOpen).toBe(true);
    });

    it('should toggle chat overlay off', () => {
      useWorkspaceStore.setState({ chatOverlayOpen: true });
      const { toggleChatOverlay } = useWorkspaceStore.getState();
      toggleChatOverlay();

      expect(useWorkspaceStore.getState().chatOverlayOpen).toBe(false);
    });

    it('should set chat overlay state directly', () => {
      const { setChatOverlayOpen } = useWorkspaceStore.getState();
      setChatOverlayOpen(true);
      expect(useWorkspaceStore.getState().chatOverlayOpen).toBe(true);

      setChatOverlayOpen(false);
      expect(useWorkspaceStore.getState().chatOverlayOpen).toBe(false);
    });
  });

  describe('Panel Management', () => {
    it('should open existing panel by activating it', () => {
      const mockPanel = { api: { setActive: vi.fn() } };
      const mockApi = {
        ...createMockApi(),
        getPanel: vi.fn(() => mockPanel),
      } as unknown as DockviewApi;

      useWorkspaceStore.setState({ api: mockApi });

      const { openPanel } = useWorkspaceStore.getState();
      openPanel('inspector');

      expect(mockPanel.api.setActive).toHaveBeenCalled();
    });

    it('should get open panel IDs', () => {
      const mockApi = {
        ...createMockApi(),
        panels: [{ id: 'scene-viewport' }, { id: 'inspector' }, { id: 'assets' }],
      } as unknown as DockviewApi;

      useWorkspaceStore.setState({ api: mockApi });

      const { getOpenPanelIds } = useWorkspaceStore.getState();
      const ids = getOpenPanelIds();

      expect(ids).toEqual(['scene-viewport', 'inspector', 'assets']);
    });

    it('should return empty array when API is null', () => {
      const { getOpenPanelIds } = useWorkspaceStore.getState();
      const ids = getOpenPanelIds();

      expect(ids).toEqual([]);
    });
  });

  describe('Docs Navigation', () => {
    it('should navigate to docs path', () => {
      const mockApi = {
        ...createMockApi(),
        getPanel: vi.fn(() => null),
        addPanel: vi.fn(),
      } as unknown as DockviewApi;

      useWorkspaceStore.setState({ api: mockApi });

      const { navigateDocs } = useWorkspaceStore.getState();
      navigateDocs('/getting-started');

      const state = useWorkspaceStore.getState();
      expect(state.docsPath).toBe('/getting-started');
    });

    it('should clear docs path', () => {
      useWorkspaceStore.setState({ docsPath: '/some-path' });

      const mockApi = {
        ...createMockApi(),
        getPanel: vi.fn(() => null),
        addPanel: vi.fn(),
      } as unknown as DockviewApi;

      useWorkspaceStore.setState({ api: mockApi });

      const { navigateDocs } = useWorkspaceStore.getState();
      navigateDocs('');

      const state = useWorkspaceStore.getState();
      expect(state.docsPath).toBe('');
    });
  });

  describe('Script Editor', () => {
    it('should open script editor for entity', () => {
      const mockApi = {
        ...createMockApi(),
        getPanel: vi.fn(() => null),
        addPanel: vi.fn(),
      } as unknown as DockviewApi;

      useWorkspaceStore.setState({ api: mockApi });

      const { openScriptEditor } = useWorkspaceStore.getState();
      openScriptEditor('entity-123', 'Player');

      expect(mockApi.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'script-editor',
          title: 'Script: Player',
        })
      );
    });

    it('should update existing script editor title', () => {
      const mockPanel = {
        api: {
          setTitle: vi.fn(),
          moveTo: vi.fn(),
          group: {},
        },
      };

      const mockApi = {
        ...createMockApi(),
        getPanel: vi.fn(() => mockPanel),
      } as unknown as DockviewApi;

      useWorkspaceStore.setState({ api: mockApi });

      const { openScriptEditor } = useWorkspaceStore.getState();
      openScriptEditor('entity-456', 'Enemy');

      expect(mockPanel.api.setTitle).toHaveBeenCalledWith('Script: Enemy');
      expect(mockPanel.api.moveTo).toHaveBeenCalled();
    });
  });
});
