/**
 * UI Builder handlers for MCP commands.
 * Manages UI screens and widgets via useUIBuilderStore.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { parseArgs } from './types';

const zScreenPreset = z.enum(['blank', 'hud', 'main_menu', 'pause_menu', 'game_over', 'inventory', 'dialog']);
const zWidgetType = z.enum(['text', 'image', 'button', 'progress_bar', 'panel', 'grid', 'scroll_view', 'slider', 'toggle', 'minimap']);

/**
 * Responsive layout constraints (ui.FR-1.OP-01). Mirrors the manual property
 * panel so the in-app AI path writes the SAME validated data contract: pixel
 * offsets from the anchor and non-negative pixel size bounds. A `min > max`
 * pair is rejected with an actionable error rather than silently producing a
 * collapsed/empty widget.
 */
const zBound = z.number().min(0, 'size bounds must be >= 0 px').nullable().optional();
const zConstraints = z
  .object({
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
    minWidth: zBound,
    maxWidth: zBound,
    minHeight: zBound,
    maxHeight: zBound,
  })
  .refine(
    (c) => c.minWidth == null || c.maxWidth == null || c.minWidth <= c.maxWidth,
    { message: 'minWidth cannot exceed maxWidth' }
  )
  .refine(
    (c) => c.minHeight == null || c.maxHeight == null || c.minHeight <= c.maxHeight,
    { message: 'minHeight cannot exceed maxHeight' }
  );

/** Fill a partial constraints payload into a complete, store-shaped object. */
function fullConstraints(c: z.infer<typeof zConstraints>) {
  return {
    offsetX: c.offsetX ?? 0,
    offsetY: c.offsetY ?? 0,
    minWidth: c.minWidth ?? null,
    maxWidth: c.maxWidth ?? null,
    minHeight: c.minHeight ?? null,
    maxHeight: c.maxHeight ?? null,
  };
}

export const uiBuilderHandlers: Record<string, ToolHandler> = {
  create_ui_screen: async (args, _ctx) => {
    const p = parseArgs(z.object({
      name: z.string().min(1),
      preset: zScreenPreset.optional(),
      showOnStart: z.boolean().optional(),
      showOnKey: z.string().optional(),
      backgroundColor: z.string().optional(),
      blockInput: z.boolean().optional(),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const uiStore = useUIBuilderStore.getState();
    const screenId = uiStore.createScreen(p.data.name, p.data.preset);
    if (p.data.showOnStart !== undefined) uiStore.updateScreen(screenId, { showOnStart: p.data.showOnStart });
    if (p.data.showOnKey !== undefined) uiStore.updateScreen(screenId, { showOnKey: p.data.showOnKey });
    if (p.data.backgroundColor !== undefined) uiStore.updateScreen(screenId, { backgroundColor: p.data.backgroundColor });
    if (p.data.blockInput !== undefined) uiStore.updateScreen(screenId, { blockInput: p.data.blockInput });
    return { success: true, result: { screenId, message: `Created UI screen "${p.data.name}"` } };
  },

  delete_ui_screen: async (args, _ctx) => {
    const p = parseArgs(z.object({ screenId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    useUIBuilderStore.getState().deleteScreen(p.data.screenId);
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
    const p = parseArgs(z.object({ screenId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const screen = useUIBuilderStore.getState().screens.find(
      s => s.id === p.data.screenId || s.name === p.data.screenId
    );
    if (!screen) return { success: false, error: `Screen not found: ${p.data.screenId}` };
    return { success: true, result: screen };
  },

  update_ui_screen: async (args, _ctx) => {
    const p = parseArgs(z.object({
      screenId: z.string().min(1),
      name: z.string().optional(),
      showOnStart: z.boolean().optional(),
      showOnKey: z.string().optional(),
      backgroundColor: z.string().optional(),
      blockInput: z.boolean().optional(),
      transition: z.string().optional(),
      zIndex: z.number().optional(),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const updates: Record<string, unknown> = {};
    for (const key of ['name', 'showOnStart', 'showOnKey', 'backgroundColor', 'blockInput', 'transition', 'zIndex'] as const) {
      if (p.data[key] !== undefined) updates[key] = p.data[key];
    }
    useUIBuilderStore.getState().updateScreen(p.data.screenId, updates);
    return { success: true };
  },

  add_ui_widget: async (args, _ctx) => {
    const p = parseArgs(z.object({
      screenId: z.string().min(1),
      type: zWidgetType,
      x: z.number().optional(),
      y: z.number().optional(),
      name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      anchor: z.string().optional(),
      constraints: zConstraints.optional(),
      parentWidgetId: z.string().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      style: z.record(z.string(), z.unknown()).optional(),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const widgetId = useUIBuilderStore.getState().addWidget(
      p.data.screenId,
      p.data.type,
      p.data.x !== undefined && p.data.y !== undefined ? { x: p.data.x, y: p.data.y } : undefined
    );
    const uiStore = useUIBuilderStore.getState();
    const updates: Record<string, unknown> = {};
    if (p.data.name) updates.name = p.data.name;
    if (p.data.width) updates.width = p.data.width;
    if (p.data.height) updates.height = p.data.height;
    if (p.data.anchor) updates.anchor = p.data.anchor;
    if (p.data.constraints) updates.constraints = fullConstraints(p.data.constraints);
    if (p.data.parentWidgetId) updates.parentWidgetId = p.data.parentWidgetId;
    if (p.data.config) updates.config = p.data.config;
    if (p.data.style) uiStore.updateWidgetStyle(p.data.screenId, widgetId, p.data.style as Record<string, unknown>);
    if (Object.keys(updates).length > 0) uiStore.updateWidget(p.data.screenId, widgetId, updates);
    return { success: true, result: { widgetId, message: `Added ${p.data.type} widget` } };
  },

  update_ui_widget: async (args, _ctx) => {
    const p = parseArgs(z.object({
      screenId: z.string().min(1),
      widgetId: z.string().min(1),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      anchor: z.string().optional(),
      constraints: zConstraints.nullable().optional(),
      visible: z.boolean().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      style: z.record(z.string(), z.unknown()).optional(),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const uiStore = useUIBuilderStore.getState();
    const updates: Record<string, unknown> = {};
    for (const key of ['name', 'x', 'y', 'width', 'height', 'anchor', 'visible', 'config'] as const) {
      if (p.data[key] !== undefined) updates[key] = p.data[key];
    }
    // `constraints: null` clears them (back to pure percentage/anchor); an object
    // is normalized into the full store shape.
    if (p.data.constraints !== undefined) {
      updates.constraints = p.data.constraints === null ? null : fullConstraints(p.data.constraints);
    }
    if (Object.keys(updates).length > 0) uiStore.updateWidget(p.data.screenId, p.data.widgetId, updates);
    if (p.data.style) uiStore.updateWidgetStyle(p.data.screenId, p.data.widgetId, p.data.style as Record<string, unknown>);
    return { success: true };
  },

  remove_ui_widget: async (args, _ctx) => {
    const p = parseArgs(z.object({ screenId: z.string().min(1), widgetId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    useUIBuilderStore.getState().removeWidget(p.data.screenId, p.data.widgetId);
    return { success: true };
  },

  set_ui_binding: async (args, _ctx) => {
    const p = parseArgs(z.object({
      screenId: z.string().min(1),
      widgetId: z.string().min(1),
      property: z.string().min(1),
      stateKey: z.string().min(1),
      direction: z.enum(['read', 'write', 'read_write']).optional(),
      transform: z.unknown().optional(),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const binding = {
      stateKey: p.data.stateKey,
      direction: p.data.direction ?? 'read',
      transform: (p.data.transform ?? null) as Parameters<ReturnType<typeof useUIBuilderStore.getState>['setBinding']>[3]['transform'],
    };
    useUIBuilderStore.getState().setBinding(p.data.screenId, p.data.widgetId, p.data.property, binding);
    return { success: true };
  },

  remove_ui_binding: async (args, _ctx) => {
    const p = parseArgs(z.object({
      screenId: z.string().min(1),
      widgetId: z.string().min(1),
      property: z.string().min(1),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    useUIBuilderStore.getState().removeBinding(p.data.screenId, p.data.widgetId, p.data.property);
    return { success: true };
  },

  set_ui_theme: async (args, _ctx) => {
    const p = parseArgs(z.object({
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
      fontFamily: z.string().optional(),
      fontSize: z.number().optional(),
      borderRadius: z.number().optional(),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    useUIBuilderStore.getState().applyTheme(p.data as Parameters<ReturnType<typeof useUIBuilderStore.getState>['applyTheme']>[0]);
    return { success: true };
  },

  duplicate_ui_screen: async (args, _ctx) => {
    const p = parseArgs(z.object({
      screenId: z.string().min(1),
      newName: z.string().optional(),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const newId = useUIBuilderStore.getState().duplicateScreen(p.data.screenId);
    if (p.data.newName) useUIBuilderStore.getState().renameScreen(newId, p.data.newName);
    return { success: true, result: { screenId: newId } };
  },

  duplicate_ui_widget: async (args, _ctx) => {
    const p = parseArgs(z.object({
      screenId: z.string().min(1),
      widgetId: z.string().min(1),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const newId = useUIBuilderStore.getState().duplicateWidget(p.data.screenId, p.data.widgetId);
    return { success: true, result: { widgetId: newId } };
  },

  reorder_ui_widget: async (args, _ctx) => {
    const p = parseArgs(z.object({
      screenId: z.string().min(1),
      widgetId: z.string().min(1),
      direction: z.enum(['up', 'down']),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    useUIBuilderStore.getState().reorderWidget(p.data.screenId, p.data.widgetId, p.data.direction);
    return { success: true };
  },

  get_ui_widget: async (args, _ctx) => {
    const p = parseArgs(z.object({
      screenId: z.string().min(1),
      widgetId: z.string().min(1),
    }), args);
    if (p.error) return p.error;
    const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
    const screen = useUIBuilderStore.getState().screens.find(
      s => s.id === p.data.screenId || s.name === p.data.screenId
    );
    if (!screen) return { success: false, error: 'Screen not found' };
    const widget = screen.widgets.find(w => w.id === p.data.widgetId || w.name === p.data.widgetId);
    if (!widget) return { success: false, error: 'Widget not found' };
    return { success: true, result: widget };
  },
};
