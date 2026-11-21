/**
 * Tests for uiBuilderHandlers — UI screen and widget management commands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { uiBuilderHandlers } from '../uiBuilderHandlers';

// ---------------------------------------------------------------------------
// Mock the uiBuilderStore
// ---------------------------------------------------------------------------

const mockCreateScreen = vi.fn();
const mockUpdateScreen = vi.fn();
const mockDeleteScreen = vi.fn();
const mockAddWidget = vi.fn();
const mockUpdateWidget = vi.fn();
const mockUpdateWidgetStyle = vi.fn();
const mockRemoveWidget = vi.fn();
const mockSetBinding = vi.fn();
const mockRemoveBinding = vi.fn();
const mockApplyTheme = vi.fn();
const mockDuplicateScreen = vi.fn();
const mockRenameScreen = vi.fn();
const mockDuplicateWidget = vi.fn();
const mockReorderWidget = vi.fn();

// Mutable store state shaped by individual tests
let mockScreens: Array<{
  id: string;
  name: string;
  widgets: Array<{ id: string; name?: string; type?: string }>;
  showOnStart?: boolean;
  showOnKey?: string;
}> = [];

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: {
    getState: () => ({
      screens: mockScreens,
      createScreen: (...args: unknown[]) => mockCreateScreen(...args),
      updateScreen: (...args: unknown[]) => mockUpdateScreen(...args),
      deleteScreen: (...args: unknown[]) => mockDeleteScreen(...args),
      addWidget: (...args: unknown[]) => mockAddWidget(...args),
      updateWidget: (...args: unknown[]) => mockUpdateWidget(...args),
      updateWidgetStyle: (...args: unknown[]) => mockUpdateWidgetStyle(...args),
      removeWidget: (...args: unknown[]) => mockRemoveWidget(...args),
      setBinding: (...args: unknown[]) => mockSetBinding(...args),
      removeBinding: (...args: unknown[]) => mockRemoveBinding(...args),
      applyTheme: (...args: unknown[]) => mockApplyTheme(...args),
      duplicateScreen: (...args: unknown[]) => mockDuplicateScreen(...args),
      renameScreen: (...args: unknown[]) => mockRenameScreen(...args),
      duplicateWidget: (...args: unknown[]) => mockDuplicateWidget(...args),
      reorderWidget: (...args: unknown[]) => mockReorderWidget(...args),
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockScreens = [];
  mockCreateScreen.mockReturnValue('screen_1');
  mockAddWidget.mockReturnValue('widget_1');
  mockDuplicateScreen.mockReturnValue('screen_copy_1');
  mockDuplicateWidget.mockReturnValue('widget_copy_1');
});

// ===========================================================================
// create_ui_screen
// ===========================================================================

describe('create_ui_screen', () => {
  it('returns error when name is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'create_ui_screen', {});
    expect(result.success).toBe(false);
  });

  it('returns error when name is empty string', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'create_ui_screen', { name: '' });
    expect(result.success).toBe(false);
  });

  it('creates screen and returns screenId', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'create_ui_screen', {
      name: 'Main Menu',
    });
    expect(result.success).toBe(true);
    const data = result.result as { screenId: string; message: string };
    expect(data.screenId).toBe('screen_1');
    expect(data.message).toContain('Main Menu');
    expect(mockCreateScreen).toHaveBeenCalledWith('Main Menu', undefined);
  });

  it('passes preset to createScreen when provided', async () => {
    await invokeHandler(uiBuilderHandlers, 'create_ui_screen', {
      name: 'HUD',
      preset: 'hud',
    });
    expect(mockCreateScreen).toHaveBeenCalledWith('HUD', 'hud');
  });

  it('accepts all valid screen presets', async () => {
    const presets = ['blank', 'hud', 'main_menu', 'pause_menu', 'game_over', 'inventory', 'dialog'];
    for (const preset of presets) {
      const { result } = await invokeHandler(uiBuilderHandlers, 'create_ui_screen', {
        name: 'Test',
        preset,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid preset', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'create_ui_screen', {
      name: 'Test',
      preset: 'splash_screen',
    });
    expect(result.success).toBe(false);
  });

  it('calls updateScreen for showOnStart when provided', async () => {
    await invokeHandler(uiBuilderHandlers, 'create_ui_screen', {
      name: 'HUD',
      showOnStart: true,
    });
    expect(mockUpdateScreen).toHaveBeenCalledWith('screen_1', { showOnStart: true });
  });

  it('calls updateScreen for backgroundColor when provided', async () => {
    await invokeHandler(uiBuilderHandlers, 'create_ui_screen', {
      name: 'Menu',
      backgroundColor: '#222222',
    });
    expect(mockUpdateScreen).toHaveBeenCalledWith('screen_1', { backgroundColor: '#222222' });
  });

  it('does not call updateScreen when optional fields are absent', async () => {
    await invokeHandler(uiBuilderHandlers, 'create_ui_screen', { name: 'Plain' });
    expect(mockUpdateScreen).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// delete_ui_screen
// ===========================================================================

describe('delete_ui_screen', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'delete_ui_screen', {});
    expect(result.success).toBe(false);
  });

  it('calls deleteScreen with the given screenId', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'delete_ui_screen', {
      screenId: 'screen_abc',
    });
    expect(result.success).toBe(true);
    expect(mockDeleteScreen).toHaveBeenCalledWith('screen_abc');
  });
});

// ===========================================================================
// list_ui_screens
// ===========================================================================

describe('list_ui_screens', () => {
  it('returns empty list when no screens exist', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'list_ui_screens', {});
    expect(result.success).toBe(true);
    const data = result.result as { screens: unknown[]; count: number };
    expect(data.screens).toHaveLength(0);
    expect(data.count).toBe(0);
  });

  it('returns screen summaries with correct fields', async () => {
    mockScreens = [
      { id: 's1', name: 'HUD', widgets: [{ id: 'w1' }, { id: 'w2' }], showOnStart: true, showOnKey: 'h' },
      { id: 's2', name: 'Menu', widgets: [] },
    ];
    const { result } = await invokeHandler(uiBuilderHandlers, 'list_ui_screens', {});
    const data = result.result as {
      screens: Array<{ id: string; name: string; widgetCount: number }>;
      count: number;
    };
    expect(data.screens).toHaveLength(2);
    expect(data.count).toBe(2);
    expect(data.screens[0].id).toBe('s1');
    expect(data.screens[0].widgetCount).toBe(2);
    expect(data.screens[1].widgetCount).toBe(0);
  });
});

// ===========================================================================
// get_ui_screen
// ===========================================================================

describe('get_ui_screen', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_screen', {});
    expect(result.success).toBe(false);
  });

  it('returns error when screen is not found by id', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_screen', {
      screenId: 'nonexistent',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Screen not found');
  });

  it('returns screen when found by id', async () => {
    const screen = { id: 's1', name: 'HUD', widgets: [] };
    mockScreens = [screen];
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_screen', {
      screenId: 's1',
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual(screen);
  });

  it('returns screen when found by name', async () => {
    const screen = { id: 's1', name: 'Main Menu', widgets: [] };
    mockScreens = [screen];
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_screen', {
      screenId: 'Main Menu',
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual(screen);
  });
});

// ===========================================================================
// update_ui_screen
// ===========================================================================

describe('update_ui_screen', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'update_ui_screen', {});
    expect(result.success).toBe(false);
  });

  it('calls updateScreen with only provided fields', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'update_ui_screen', {
      screenId: 's1',
      name: 'New Name',
      zIndex: 10,
    });
    expect(result.success).toBe(true);
    expect(mockUpdateScreen).toHaveBeenCalledWith('s1', { name: 'New Name', zIndex: 10 });
  });

  it('does not include undefined fields in updates', async () => {
    await invokeHandler(uiBuilderHandlers, 'update_ui_screen', {
      screenId: 's1',
      showOnStart: true,
    });
    const [, updates] = mockUpdateScreen.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(updates)).toEqual(['showOnStart']);
  });
});

// ===========================================================================
// add_ui_widget
// ===========================================================================

describe('add_ui_widget', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'add_ui_widget', {
      type: 'text',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when type is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'add_ui_widget', {
      screenId: 's1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid widget type', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'add_ui_widget', {
      screenId: 's1',
      type: 'fancy_chart',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid widget types', async () => {
    const types = ['text', 'image', 'button', 'progress_bar', 'panel', 'grid', 'scroll_view', 'slider', 'toggle', 'minimap'];
    for (const type of types) {
      mockAddWidget.mockReturnValue('w1');
      const { result } = await invokeHandler(uiBuilderHandlers, 'add_ui_widget', {
        screenId: 's1',
        type,
      });
      expect(result.success).toBe(true);
    }
  });

  it('returns widgetId and success message', async () => {
    mockAddWidget.mockReturnValue('widget_42');
    const { result } = await invokeHandler(uiBuilderHandlers, 'add_ui_widget', {
      screenId: 's1',
      type: 'button',
    });
    expect(result.success).toBe(true);
    const data = result.result as { widgetId: string; message: string };
    expect(data.widgetId).toBe('widget_42');
    expect(data.message).toContain('button');
  });

  it('passes position when x and y are both provided', async () => {
    await invokeHandler(uiBuilderHandlers, 'add_ui_widget', {
      screenId: 's1',
      type: 'text',
      x: 100,
      y: 200,
    });
    expect(mockAddWidget).toHaveBeenCalledWith('s1', 'text', { x: 100, y: 200 });
  });

  it('passes undefined position when only x is provided', async () => {
    await invokeHandler(uiBuilderHandlers, 'add_ui_widget', {
      screenId: 's1',
      type: 'text',
      x: 100,
    });
    expect(mockAddWidget).toHaveBeenCalledWith('s1', 'text', undefined);
  });

  it('calls updateWidget with name, width, height when provided', async () => {
    await invokeHandler(uiBuilderHandlers, 'add_ui_widget', {
      screenId: 's1',
      type: 'panel',
      name: 'MyPanel',
      width: 300,
      height: 200,
    });
    expect(mockUpdateWidget).toHaveBeenCalledWith('s1', 'widget_1', {
      name: 'MyPanel',
      width: 300,
      height: 200,
    });
  });

  it('calls updateWidgetStyle when style is provided', async () => {
    const style = { color: 'red', fontSize: 16 };
    await invokeHandler(uiBuilderHandlers, 'add_ui_widget', {
      screenId: 's1',
      type: 'text',
      style,
    });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('s1', 'widget_1', style);
  });
});

// ===========================================================================
// update_ui_widget
// ===========================================================================

describe('update_ui_widget', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'update_ui_widget', {
      widgetId: 'w1',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when widgetId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'update_ui_widget', {
      screenId: 's1',
    });
    expect(result.success).toBe(false);
  });

  it('calls updateWidget with only provided fields', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'update_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
      visible: false,
      x: 50,
    });
    expect(result.success).toBe(true);
    expect(mockUpdateWidget).toHaveBeenCalledWith('s1', 'w1', { visible: false, x: 50 });
  });

  it('calls updateWidgetStyle when style is provided', async () => {
    const style = { background: 'blue' };
    await invokeHandler(uiBuilderHandlers, 'update_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
      style,
    });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('s1', 'w1', style);
  });

  it('does not call updateWidget when no fields change', async () => {
    await invokeHandler(uiBuilderHandlers, 'update_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
    });
    expect(mockUpdateWidget).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// remove_ui_widget
// ===========================================================================

describe('remove_ui_widget', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'remove_ui_widget', {
      widgetId: 'w1',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when widgetId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'remove_ui_widget', {
      screenId: 's1',
    });
    expect(result.success).toBe(false);
  });

  it('calls removeWidget with correct args', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'remove_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
    });
    expect(result.success).toBe(true);
    expect(mockRemoveWidget).toHaveBeenCalledWith('s1', 'w1');
  });
});

// ===========================================================================
// set_ui_binding
// ===========================================================================

describe('set_ui_binding', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'set_ui_binding', {
      widgetId: 'w1',
      property: 'text',
      stateKey: 'score',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when stateKey is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'set_ui_binding', {
      screenId: 's1',
      widgetId: 'w1',
      property: 'text',
    });
    expect(result.success).toBe(false);
  });

  it('calls setBinding with read direction by default', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'set_ui_binding', {
      screenId: 's1',
      widgetId: 'w1',
      property: 'text',
      stateKey: 'playerScore',
    });
    expect(result.success).toBe(true);
    expect(mockSetBinding).toHaveBeenCalledWith('s1', 'w1', 'text', {
      stateKey: 'playerScore',
      direction: 'read',
      transform: null,
    });
  });

  it('passes custom direction when provided', async () => {
    await invokeHandler(uiBuilderHandlers, 'set_ui_binding', {
      screenId: 's1',
      widgetId: 'w1',
      property: 'value',
      stateKey: 'health',
      direction: 'read_write',
    });
    const [, , , binding] = mockSetBinding.mock.calls[0] as [string, string, string, { direction: string }];
    expect(binding.direction).toBe('read_write');
  });
});

// ===========================================================================
// remove_ui_binding
// ===========================================================================

describe('remove_ui_binding', () => {
  it('returns error when property is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'remove_ui_binding', {
      screenId: 's1',
      widgetId: 'w1',
    });
    expect(result.success).toBe(false);
  });

  it('calls removeBinding with correct args', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'remove_ui_binding', {
      screenId: 's1',
      widgetId: 'w1',
      property: 'text',
    });
    expect(result.success).toBe(true);
    expect(mockRemoveBinding).toHaveBeenCalledWith('s1', 'w1', 'text');
  });
});

// ===========================================================================
// set_ui_theme
// ===========================================================================

describe('set_ui_theme', () => {
  it('calls applyTheme with provided fields', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'set_ui_theme', {
      primaryColor: '#ff0000',
      fontSize: 14,
    });
    expect(result.success).toBe(true);
    expect(mockApplyTheme).toHaveBeenCalledTimes(1);
    const [theme] = mockApplyTheme.mock.calls[0] as [Record<string, unknown>];
    expect(theme.primaryColor).toBe('#ff0000');
    expect(theme.fontSize).toBe(14);
  });

  it('accepts empty args (all fields optional)', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'set_ui_theme', {});
    expect(result.success).toBe(true);
    expect(mockApplyTheme).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// duplicate_ui_screen
// ===========================================================================

describe('duplicate_ui_screen', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'duplicate_ui_screen', {});
    expect(result.success).toBe(false);
  });

  it('returns new screenId on success', async () => {
    mockDuplicateScreen.mockReturnValue('screen_copy_99');
    const { result } = await invokeHandler(uiBuilderHandlers, 'duplicate_ui_screen', {
      screenId: 's1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { screenId: string };
    expect(data.screenId).toBe('screen_copy_99');
  });

  it('renames screen when newName is provided', async () => {
    mockDuplicateScreen.mockReturnValue('screen_copy_1');
    await invokeHandler(uiBuilderHandlers, 'duplicate_ui_screen', {
      screenId: 's1',
      newName: 'HUD Copy',
    });
    expect(mockRenameScreen).toHaveBeenCalledWith('screen_copy_1', 'HUD Copy');
  });

  it('does not call renameScreen when newName is absent', async () => {
    await invokeHandler(uiBuilderHandlers, 'duplicate_ui_screen', {
      screenId: 's1',
    });
    expect(mockRenameScreen).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// duplicate_ui_widget
// ===========================================================================

describe('duplicate_ui_widget', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'duplicate_ui_widget', {
      widgetId: 'w1',
    });
    expect(result.success).toBe(false);
  });

  it('returns new widgetId on success', async () => {
    mockDuplicateWidget.mockReturnValue('w_copy_55');
    const { result } = await invokeHandler(uiBuilderHandlers, 'duplicate_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
    });
    expect(result.success).toBe(true);
    const data = result.result as { widgetId: string };
    expect(data.widgetId).toBe('w_copy_55');
    expect(mockDuplicateWidget).toHaveBeenCalledWith('s1', 'w1');
  });
});

// ===========================================================================
// reorder_ui_widget
// ===========================================================================

describe('reorder_ui_widget', () => {
  it('returns error when direction is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'reorder_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid direction', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'reorder_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
      direction: 'left',
    });
    expect(result.success).toBe(false);
  });

  it('calls reorderWidget with up direction', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'reorder_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
      direction: 'up',
    });
    expect(result.success).toBe(true);
    expect(mockReorderWidget).toHaveBeenCalledWith('s1', 'w1', 'up');
  });

  it('calls reorderWidget with down direction', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'reorder_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
      direction: 'down',
    });
    expect(result.success).toBe(true);
    expect(mockReorderWidget).toHaveBeenCalledWith('s1', 'w1', 'down');
  });
});

// ===========================================================================
// get_ui_widget
// ===========================================================================

describe('get_ui_widget', () => {
  it('returns error when screenId is missing', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_widget', {
      widgetId: 'w1',
    });
    expect(result.success).toBe(false);
  });

  it('returns error when screen is not found', async () => {
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_widget', {
      screenId: 'nonexistent',
      widgetId: 'w1',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Screen not found');
  });

  it('returns error when widget is not found in screen', async () => {
    mockScreens = [{ id: 's1', name: 'HUD', widgets: [{ id: 'w-other' }] }];
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_widget', {
      screenId: 's1',
      widgetId: 'w_missing',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Widget not found');
  });

  it('returns widget when found by id', async () => {
    const widget = { id: 'w1', name: 'Score', type: 'text' };
    mockScreens = [{ id: 's1', name: 'HUD', widgets: [widget] }];
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_widget', {
      screenId: 's1',
      widgetId: 'w1',
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual(widget);
  });

  it('returns widget when found by name', async () => {
    const widget = { id: 'w1', name: 'Score', type: 'text' };
    mockScreens = [{ id: 's1', name: 'HUD', widgets: [widget] }];
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_widget', {
      screenId: 's1',
      widgetId: 'Score',
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual(widget);
  });

  it('can find screen by name and widget by id', async () => {
    const widget = { id: 'w1', name: 'Health', type: 'progress_bar' };
    mockScreens = [{ id: 's1', name: 'HUD', widgets: [widget] }];
    const { result } = await invokeHandler(uiBuilderHandlers, 'get_ui_widget', {
      screenId: 'HUD',
      widgetId: 'w1',
    });
    expect(result.success).toBe(true);
  });
});
