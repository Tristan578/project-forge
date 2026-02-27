/**
 * UI Builder handlers for MCP commands.
 * Manages UI screens and widgets via useUIBuilderStore.
 */

import type { ToolHandler } from './types';

export const uiBuilderHandlers: Record<string, ToolHandler> = {
  create_ui_screen: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const uiStore = useUIBuilderStore.getState();
    type ScreenPreset = 'blank' | 'hud' | 'main_menu' | 'pause_menu' | 'game_over' | 'inventory' | 'dialog';
    const screenId = uiStore.createScreen(args.name as string, (args.preset as unknown) as ScreenPreset | undefined);
    if (args.showOnStart !== undefined) uiStore.updateScreen(screenId, { showOnStart: args.showOnStart as boolean });
    if (args.showOnKey !== undefined) uiStore.updateScreen(screenId, { showOnKey: args.showOnKey as string });
    if (args.backgroundColor !== undefined) uiStore.updateScreen(screenId, { backgroundColor: args.backgroundColor as string });
    if (args.blockInput !== undefined) uiStore.updateScreen(screenId, { blockInput: args.blockInput as boolean });
    return { success: true, result: { screenId, message: `Created UI screen "${args.name}"` } };
  },

  delete_ui_screen: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    useUIBuilderStore.getState().deleteScreen(args.screenId as string);
    return { success: true };
  },

  list_ui_screens: async (_args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const screens = useUIBuilderStore.getState().screens.map(s => ({
      id: s.id, name: s.name, widgetCount: s.widgets.length,
      showOnStart: s.showOnStart, showOnKey: s.showOnKey,
    }));
    return { success: true, result: { screens, count: screens.length } };
  },

  get_ui_screen: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const screen = useUIBuilderStore.getState().screens.find(
      s => s.id === args.screenId || s.name === args.screenId
    );
    if (!screen) return { success: false, error: `Screen not found: ${args.screenId}` };
    return { success: true, result: screen };
  },

  update_ui_screen: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const updates: Record<string, unknown> = {};
    for (const key of ['name', 'showOnStart', 'showOnKey', 'backgroundColor', 'blockInput', 'transition', 'zIndex']) {
      if (args[key] !== undefined) updates[key] = args[key];
    }
    useUIBuilderStore.getState().updateScreen(args.screenId as string, updates);
    return { success: true };
  },

  add_ui_widget: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    type WidgetType = 'text' | 'image' | 'button' | 'progress_bar' | 'panel' | 'grid' | 'scroll_view' | 'slider' | 'toggle' | 'minimap';
    const widgetId = useUIBuilderStore.getState().addWidget(
      args.screenId as string,
      (args.type as unknown) as WidgetType,
      args.x !== undefined && args.y !== undefined ? { x: args.x as number, y: args.y as number } : undefined
    );
    const uiStore = useUIBuilderStore.getState();
    const updates: Record<string, unknown> = {};
    if (args.name) updates.name = args.name;
    if (args.width) updates.width = args.width;
    if (args.height) updates.height = args.height;
    if (args.anchor) updates.anchor = args.anchor;
    if (args.parentWidgetId) updates.parentWidgetId = args.parentWidgetId;
    if (args.config) updates.config = args.config;
    if (args.style) uiStore.updateWidgetStyle(args.screenId as string, widgetId, args.style as Record<string, unknown>);
    if (Object.keys(updates).length > 0) uiStore.updateWidget(args.screenId as string, widgetId, updates);
    return { success: true, result: { widgetId, message: `Added ${args.type} widget` } };
  },

  update_ui_widget: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const uiStore = useUIBuilderStore.getState();
    const updates: Record<string, unknown> = {};
    for (const key of ['name', 'x', 'y', 'width', 'height', 'anchor', 'visible', 'config']) {
      if (args[key] !== undefined) updates[key] = args[key];
    }
    if (Object.keys(updates).length > 0) uiStore.updateWidget(args.screenId as string, args.widgetId as string, updates);
    if (args.style) uiStore.updateWidgetStyle(args.screenId as string, args.widgetId as string, args.style as Record<string, unknown>);
    return { success: true };
  },

  remove_ui_widget: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    useUIBuilderStore.getState().removeWidget(args.screenId as string, args.widgetId as string);
    return { success: true };
  },

  set_ui_binding: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    type BindingTransform =
      | { type: 'format'; template: string }
      | { type: 'map'; entries: Array<{ from: unknown; to: string }> }
      | { type: 'clamp'; min: number; max: number }
      | { type: 'multiply'; factor: number }
      | { type: 'round'; decimals: number };
    type DataBinding = {
      stateKey: string;
      direction: 'read' | 'write' | 'read_write';
      transform: BindingTransform | null;
    };
    const binding: DataBinding = {
      stateKey: args.stateKey as string,
      direction: ((args.direction as string) ?? 'read') as 'read' | 'write' | 'read_write',
      transform: (args.transform as unknown) as BindingTransform | null,
    };
    useUIBuilderStore.getState().setBinding(args.screenId as string, args.widgetId as string, args.property as string, binding);
    return { success: true };
  },

  remove_ui_binding: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    useUIBuilderStore.getState().removeBinding(args.screenId as string, args.widgetId as string, args.property as string);
    return { success: true };
  },

  set_ui_theme: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    type UITheme = {
      primaryColor: string;
      secondaryColor: string;
      backgroundColor: string;
      textColor: string;
      fontFamily: string;
      fontSize: number;
      borderRadius: number;
    };
    useUIBuilderStore.getState().applyTheme((args as unknown) as UITheme);
    return { success: true };
  },

  duplicate_ui_screen: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const newId = useUIBuilderStore.getState().duplicateScreen(args.screenId as string);
    if (args.newName) useUIBuilderStore.getState().renameScreen(newId, args.newName as string);
    return { success: true, result: { screenId: newId } };
  },

  duplicate_ui_widget: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const newId = useUIBuilderStore.getState().duplicateWidget(args.screenId as string, args.widgetId as string);
    return { success: true, result: { widgetId: newId } };
  },

  reorder_ui_widget: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    useUIBuilderStore.getState().reorderWidget(args.screenId as string, args.widgetId as string, (args.direction as string) as 'up' | 'down');
    return { success: true };
  },

  get_ui_widget: async (args, _ctx) => {
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const screen = useUIBuilderStore.getState().screens.find(
      s => s.id === args.screenId || s.name === args.screenId
    );
    if (!screen) return { success: false, error: 'Screen not found' };
    const widget = screen.widgets.find(w => w.id === args.widgetId || w.name === args.widgetId);
    if (!widget) return { success: false, error: 'Widget not found' };
    return { success: true, result: widget };
  },
};
