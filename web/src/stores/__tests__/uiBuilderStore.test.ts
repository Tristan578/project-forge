/**
 * Unit tests for the uiBuilderStore Zustand store.
 *
 * Tests cover UI builder state: screens, widgets, data bindings, themes,
 * undo/redo, copy/paste, serialization, and runtime actions.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useUIBuilderStore,
  type UIScreen,
  type UIWidget,
  type UITheme,
  type DataBinding,
} from '../uiBuilderStore';

describe('uiBuilderStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useUIBuilderStore.setState({
      screens: [],
      activeScreenId: null,
      selectedWidgetId: null,
      hoveredWidgetId: null,
      copiedWidget: null,
      isUIEditorActive: false,
      previewMode: false,
      zoom: 1,
      showGrid: false,
      snapToGrid: false,
      gridSize: 5,
      globalTheme: null,
      undoStack: [],
      redoStack: [],
    });
  });

  describe('Initial State', () => {
    it('should initialize with empty screens', () => {
      const state = useUIBuilderStore.getState();
      expect(state.screens).toEqual([]);
    });

    it('should initialize with no active screen', () => {
      const state = useUIBuilderStore.getState();
      expect(state.activeScreenId).toBeNull();
    });

    it('should initialize with no selected widget', () => {
      const state = useUIBuilderStore.getState();
      expect(state.selectedWidgetId).toBeNull();
    });

    it('should initialize with zoom at 1', () => {
      const state = useUIBuilderStore.getState();
      expect(state.zoom).toBe(1);
    });

    it('should initialize with grid hidden', () => {
      const state = useUIBuilderStore.getState();
      expect(state.showGrid).toBe(false);
    });

    it('should initialize with snap disabled', () => {
      const state = useUIBuilderStore.getState();
      expect(state.snapToGrid).toBe(false);
    });

    it('should initialize with grid size 5', () => {
      const state = useUIBuilderStore.getState();
      expect(state.gridSize).toBe(5);
    });

    it('should initialize with empty undo/redo stacks', () => {
      const state = useUIBuilderStore.getState();
      expect(state.undoStack).toEqual([]);
      expect(state.redoStack).toEqual([]);
    });
  });

  describe('Screen Management', () => {
    it('should create blank screen', () => {
      const { createScreen } = useUIBuilderStore.getState();
      const screenId = createScreen('Test Screen');

      const state = useUIBuilderStore.getState();
      expect(state.screens).toHaveLength(1);
      expect(state.screens[0].name).toBe('Test Screen');
      expect(state.screens[0].id).toBe(screenId);
      expect(state.activeScreenId).toBe(screenId);
    });

    it('should create screen with preset', () => {
      const { createScreen } = useUIBuilderStore.getState();
      createScreen('HUD', 'hud');

      const state = useUIBuilderStore.getState();
      expect(state.screens).toHaveLength(1);
      expect(state.screens[0].widgets.length).toBeGreaterThan(0);
    });

    it('should delete screen', () => {
      const { createScreen, deleteScreen } = useUIBuilderStore.getState();
      const screenId = createScreen('Test Screen');
      deleteScreen(screenId);

      const state = useUIBuilderStore.getState();
      expect(state.screens).toHaveLength(0);
      expect(state.activeScreenId).toBeNull();
    });

    it('should rename screen', () => {
      const { createScreen, renameScreen } = useUIBuilderStore.getState();
      const screenId = createScreen('Old Name');
      renameScreen(screenId, 'New Name');

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].name).toBe('New Name');
    });

    it('should duplicate screen', () => {
      const { createScreen, duplicateScreen } = useUIBuilderStore.getState();
      const screenId = createScreen('Original');
      const newScreenId = duplicateScreen(screenId);

      const state = useUIBuilderStore.getState();
      expect(state.screens).toHaveLength(2);
      expect(state.screens[1].name).toBe('Original (copy)');
      expect(state.screens[1].id).toBe(newScreenId);
      expect(state.activeScreenId).toBe(newScreenId);
    });

    it('should set active screen', () => {
      const { createScreen, setActiveScreen } = useUIBuilderStore.getState();
      const screen1 = createScreen('Screen 1');
      const screen2 = createScreen('Screen 2');

      setActiveScreen(screen1);
      expect(useUIBuilderStore.getState().activeScreenId).toBe(screen1);

      setActiveScreen(screen2);
      expect(useUIBuilderStore.getState().activeScreenId).toBe(screen2);
    });

    it('should update screen properties', () => {
      const { createScreen, updateScreen } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');

      updateScreen(screenId, {
        visible: true,
        backgroundColor: '#ff0000',
        zIndex: 5,
      });

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].visible).toBe(true);
      expect(state.screens[0].backgroundColor).toBe('#ff0000');
      expect(state.screens[0].zIndex).toBe(5);
    });
  });

  describe('Widget Management', () => {
    it('should add text widget', () => {
      const { createScreen, addWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].widgets).toHaveLength(1);
      expect(state.screens[0].widgets[0].type).toBe('text');
      expect(state.selectedWidgetId).toBe(widgetId);
    });

    it('should add widget with custom position', () => {
      const { createScreen, addWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      addWidget(screenId, 'button', { x: 100, y: 200 });

      const state = useUIBuilderStore.getState();
      const widget = state.screens[0].widgets[0];
      expect(widget.x).toBe(100);
      expect(widget.y).toBe(200);
    });

    it('should enforce widget count limit', () => {
      const { createScreen, addWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');

      // Add 200 widgets
      for (let i = 0; i < 200; i++) {
        addWidget(screenId, 'text');
      }

      // 201st should fail
      const result = addWidget(screenId, 'text');

      expect(result).toBe('');
      expect(useUIBuilderStore.getState().screens[0].widgets).toHaveLength(200);
    });

    it('should remove widget', () => {
      const { createScreen, addWidget, removeWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      removeWidget(screenId, widgetId);

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].widgets).toHaveLength(0);
      expect(state.selectedWidgetId).toBeNull();
    });

    it('should update widget properties', () => {
      const { createScreen, addWidget, updateWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      updateWidget(screenId, widgetId, {
        name: 'CustomName',
        visible: false,
        interactable: false,
      });

      const state = useUIBuilderStore.getState();
      const widget = state.screens[0].widgets[0];
      expect(widget.name).toBe('CustomName');
      expect(widget.visible).toBe(false);
      expect(widget.interactable).toBe(false);
    });

    it('should move widget', () => {
      const { createScreen, addWidget, moveWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      moveWidget(screenId, widgetId, 150, 250);

      const state = useUIBuilderStore.getState();
      const widget = state.screens[0].widgets[0];
      expect(widget.x).toBe(150);
      expect(widget.y).toBe(250);
    });

    it('should resize widget', () => {
      const { createScreen, addWidget, resizeWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'button');

      resizeWidget(screenId, widgetId, 300, 100);

      const state = useUIBuilderStore.getState();
      const widget = state.screens[0].widgets[0];
      expect(widget.width).toBe(300);
      expect(widget.height).toBe(100);
    });

    it('should select widget', () => {
      const { createScreen, addWidget, selectWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      selectWidget(null);
      expect(useUIBuilderStore.getState().selectedWidgetId).toBeNull();

      selectWidget(widgetId);
      expect(useUIBuilderStore.getState().selectedWidgetId).toBe(widgetId);
    });

    it('should duplicate widget', () => {
      const { createScreen, addWidget, duplicateWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'image');

      const newWidgetId = duplicateWidget(screenId, widgetId);

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].widgets).toHaveLength(2);
      expect(state.screens[0].widgets[1].id).toBe(newWidgetId);
      expect(state.screens[0].widgets[1].name).toContain('_copy');
      expect(state.selectedWidgetId).toBe(newWidgetId);
    });

    it('should reorder widget up', () => {
      const { createScreen, addWidget, reorderWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widget1 = addWidget(screenId, 'text');
      const widget2 = addWidget(screenId, 'button');

      reorderWidget(screenId, widget2, 'up');

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].widgets[0].id).toBe(widget2);
      expect(state.screens[0].widgets[1].id).toBe(widget1);
    });

    it('should reorder widget down', () => {
      const { createScreen, addWidget, reorderWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widget1 = addWidget(screenId, 'text');
      const widget2 = addWidget(screenId, 'button');

      reorderWidget(screenId, widget1, 'down');

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].widgets[0].id).toBe(widget2);
      expect(state.screens[0].widgets[1].id).toBe(widget1);
    });

    it('should not reorder beyond boundaries', () => {
      const { createScreen, addWidget, reorderWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widget1 = addWidget(screenId, 'text');

      reorderWidget(screenId, widget1, 'up');

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].widgets[0].id).toBe(widget1);
    });
  });

  describe('Widget Styling', () => {
    it('should update widget style', () => {
      const { createScreen, addWidget, updateWidgetStyle } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      updateWidgetStyle(screenId, widgetId, {
        fontSize: 24,
        color: '#00ff00',
        backgroundColor: '#000000',
      });

      const state = useUIBuilderStore.getState();
      const widget = state.screens[0].widgets[0];
      expect(widget.style.fontSize).toBe(24);
      expect(widget.style.color).toBe('#00ff00');
      expect(widget.style.backgroundColor).toBe('#000000');
    });
  });

  describe('Data Bindings', () => {
    it('should set data binding', () => {
      const { createScreen, addWidget, setBinding } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      const binding: DataBinding = {
        stateKey: 'playerName',
        direction: 'read',
        transform: null,
      };

      setBinding(screenId, widgetId, 'binding', binding);

      const state = useUIBuilderStore.getState();
      const widget = state.screens[0].widgets[0] as UIWidget & { config: { binding?: DataBinding } };
      expect(widget.config.binding).toEqual(binding);
    });

    it('should remove data binding', () => {
      const { createScreen, addWidget, setBinding, removeBinding } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      const binding: DataBinding = {
        stateKey: 'score',
        direction: 'read_write',
        transform: null,
      };

      setBinding(screenId, widgetId, 'binding', binding);
      removeBinding(screenId, widgetId, 'binding');

      const state = useUIBuilderStore.getState();
      const widget = state.screens[0].widgets[0] as UIWidget & { config: { binding?: DataBinding } };
      expect(widget.config.binding).toBeNull();
    });
  });

  describe('Copy/Paste', () => {
    it('should copy widget', () => {
      const { createScreen, addWidget, copyWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'button');

      copyWidget(screenId, widgetId);

      const state = useUIBuilderStore.getState();
      expect(state.copiedWidget).not.toBeNull();
      expect(state.copiedWidget?.type).toBe('button');
    });

    it('should paste widget', () => {
      const { createScreen, addWidget, copyWidget, pasteWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'image');

      copyWidget(screenId, widgetId);
      const newWidgetId = pasteWidget(screenId);

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].widgets).toHaveLength(2);
      expect(newWidgetId).not.toBeNull();
      expect(state.screens[0].widgets[1].name).toContain('_paste');
      expect(state.selectedWidgetId).toBe(newWidgetId);
    });

    it('should return null when pasting without copied widget', () => {
      const { createScreen, pasteWidget } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');

      const result = pasteWidget(screenId);

      expect(result).toBeNull();
    });
  });

  describe('Theme Management', () => {
    it('should apply global theme', () => {
      const theme: UITheme = {
        primaryColor: '#3b82f6',
        secondaryColor: '#10b981',
        backgroundColor: '#1f2937',
        textColor: '#f9fafb',
        fontFamily: 'Inter',
        fontSize: 16,
        borderRadius: 8,
      };

      const { applyTheme } = useUIBuilderStore.getState();
      applyTheme(theme);

      const state = useUIBuilderStore.getState();
      expect(state.globalTheme).toEqual(theme);
    });
  });

  describe('Serialization', () => {
    it('should serialize UI data', () => {
      const { createScreen, addWidget, serialize } = useUIBuilderStore.getState();
      const screenId = createScreen('Game HUD');
      addWidget(screenId, 'text');
      addWidget(screenId, 'progress_bar');

      const data = serialize();

      expect(data.version).toBe(1);
      expect(data.screens).toHaveLength(1);
      expect(data.screens[0].widgets).toHaveLength(2);
    });

    it('should load screens from data', () => {
      const mockScreen: UIScreen = {
        id: 'screen-1',
        name: 'Mock Screen',
        widgets: [],
        visible: false,
        showOnStart: false,
        showOnKey: null,
        transition: { type: 'none', durationMs: 300, easing: 'ease_out' },
        zIndex: 0,
        backgroundColor: 'transparent',
        blockInput: false,
      };

      const { loadScreens } = useUIBuilderStore.getState();
      loadScreens({
        version: 1,
        screens: [mockScreen],
        globalTheme: null,
      });

      const state = useUIBuilderStore.getState();
      expect(state.screens).toHaveLength(1);
      expect(state.screens[0].name).toBe('Mock Screen');
      expect(state.undoStack).toEqual([]);
      expect(state.redoStack).toEqual([]);
    });

    it('should clear all UI data', () => {
      const { createScreen, addWidget, clearAll } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      addWidget(screenId, 'button');

      clearAll();

      const state = useUIBuilderStore.getState();
      expect(state.screens).toEqual([]);
      expect(state.activeScreenId).toBeNull();
      expect(state.selectedWidgetId).toBeNull();
      expect(state.globalTheme).toBeNull();
      expect(state.undoStack).toEqual([]);
    });
  });

  describe('Undo/Redo', () => {
    it('should push undo action', () => {
      const { pushUndoAction } = useUIBuilderStore.getState();
      pushUndoAction({
        type: 'add_screen',
        screen: {
          id: 'test',
          name: 'Test',
          widgets: [],
          visible: false,
          showOnStart: false,
          showOnKey: null,
          transition: { type: 'none', durationMs: 300, easing: 'ease_out' },
          zIndex: 0,
          backgroundColor: 'transparent',
          blockInput: false,
        },
      });

      const state = useUIBuilderStore.getState();
      expect(state.undoStack).toHaveLength(1);
      expect(state.redoStack).toEqual([]);
    });

    it('should undo add screen', () => {
      const { createScreen, uiUndo } = useUIBuilderStore.getState();
      createScreen('Test Screen');

      uiUndo();

      const state = useUIBuilderStore.getState();
      expect(state.screens).toHaveLength(0);
      expect(state.redoStack).toHaveLength(1);
    });

    it('should redo add screen', () => {
      const { createScreen, uiUndo, uiRedo } = useUIBuilderStore.getState();
      createScreen('Test Screen');
      uiUndo();
      uiRedo();

      const state = useUIBuilderStore.getState();
      expect(state.screens).toHaveLength(1);
      expect(state.screens[0].name).toBe('Test Screen');
    });

    it('should handle undo on delete screen', () => {
      const { createScreen, deleteScreen, uiUndo } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      deleteScreen(screenId);

      uiUndo();

      const state = useUIBuilderStore.getState();
      expect(state.screens).toHaveLength(1);
      expect(state.screens[0].name).toBe('Test');
    });

    it('should limit undo stack to 50 items', () => {
      const { pushUndoAction } = useUIBuilderStore.getState();

      for (let i = 0; i < 60; i++) {
        pushUndoAction({
          type: 'add_screen',
          screen: {
            id: `test-${i}`,
            name: `Test ${i}`,
            widgets: [],
            visible: false,
            showOnStart: false,
            showOnKey: null,
            transition: { type: 'none', durationMs: 300, easing: 'ease_out' },
            zIndex: 0,
            backgroundColor: 'transparent',
            blockInput: false,
          },
        });
      }

      const state = useUIBuilderStore.getState();
      expect(state.undoStack.length).toBeLessThanOrEqual(50);
    });
  });

  describe('Runtime Actions', () => {
    it('should show screen by ID', () => {
      const { createScreen, handleRuntimeScreenAction } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');

      handleRuntimeScreenAction('show', screenId);

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].visible).toBe(true);
    });

    it('should hide screen by name', () => {
      const { createScreen, updateScreen, handleRuntimeScreenAction } = useUIBuilderStore.getState();
      const screenId = createScreen('MainMenu');
      updateScreen(screenId, { visible: true });

      handleRuntimeScreenAction('hide', 'MainMenu');

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].visible).toBe(false);
    });

    it('should toggle screen visibility', () => {
      const { createScreen, handleRuntimeScreenAction } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');

      handleRuntimeScreenAction('toggle', screenId);
      expect(useUIBuilderStore.getState().screens[0].visible).toBe(true);

      handleRuntimeScreenAction('toggle', screenId);
      expect(useUIBuilderStore.getState().screens[0].visible).toBe(false);
    });

    it('should hide all screens', () => {
      const { createScreen, handleRuntimeScreenAction } = useUIBuilderStore.getState();
      const screen1 = createScreen('Screen 1');
      createScreen('Screen 2');

      // First show both screens
      handleRuntimeScreenAction('show', screen1);
      handleRuntimeScreenAction('show', 'Screen 2');

      // Verify they are visible
      let state = useUIBuilderStore.getState();
      expect(state.screens[0].visible).toBe(true);
      expect(state.screens[1].visible).toBe(true);

      // Now hide all (needs to match a screen for the find to work)
      handleRuntimeScreenAction('hide_all', screen1);

      state = useUIBuilderStore.getState();
      expect(state.screens[0].visible).toBe(false);
      expect(state.screens[1].visible).toBe(false);
    });

    it('should set widget text', () => {
      const { createScreen, addWidget, handleRuntimeWidgetAction } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      handleRuntimeWidgetAction({
        action: 'set_text',
        screen: screenId,
        widget: widgetId,
        text: 'Hello World',
      });

      const state = useUIBuilderStore.getState();
      const widget = state.screens[0].widgets[0] as UIWidget & { config: { content?: string } };
      expect(widget.config.content).toBe('Hello World');
    });

    it('should set widget visibility', () => {
      const { createScreen, addWidget, handleRuntimeWidgetAction } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'button');

      handleRuntimeWidgetAction({
        action: 'set_visible',
        screen: screenId,
        widget: widgetId,
        visible: false,
      });

      const state = useUIBuilderStore.getState();
      expect(state.screens[0].widgets[0].visible).toBe(false);
    });

    it('should set widget style', () => {
      const { createScreen, addWidget, handleRuntimeWidgetAction } = useUIBuilderStore.getState();
      const screenId = createScreen('Test');
      const widgetId = addWidget(screenId, 'text');

      handleRuntimeWidgetAction({
        action: 'set_style',
        screen: screenId,
        widget: widgetId,
        style: { color: '#ff0000', fontSize: 32 },
      });

      const state = useUIBuilderStore.getState();
      const widget = state.screens[0].widgets[0];
      expect(widget.style.color).toBe('#ff0000');
      expect(widget.style.fontSize).toBe(32);
    });
  });
});
