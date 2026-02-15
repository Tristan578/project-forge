import { create } from 'zustand';

// ========== Type Definitions ==========

export type WidgetType =
  | 'text'
  | 'image'
  | 'button'
  | 'progress_bar'
  | 'panel'
  | 'grid'
  | 'scroll_view'
  | 'slider'
  | 'toggle'
  | 'minimap';

export type WidgetAnchor =
  | 'top_left' | 'top_center' | 'top_right'
  | 'center_left' | 'center' | 'center_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right';

export interface WidgetStyle {
  backgroundColor: string | null;
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
  padding: [number, number, number, number];
  opacity: number;
  overflow: 'visible' | 'hidden' | 'scroll';
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  textShadow: string | null;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface DataBinding {
  stateKey: string;
  direction: 'read' | 'write' | 'read_write';
  transform: BindingTransform | null;
}

export type BindingTransform =
  | { type: 'format'; template: string }
  | { type: 'map'; entries: Array<{ from: unknown; to: string }> }
  | { type: 'clamp'; min: number; max: number }
  | { type: 'multiply'; factor: number }
  | { type: 'round'; decimals: number };

export interface TextWidgetConfig {
  content: string;
  binding: DataBinding | null;
}

export interface ImageWidgetConfig {
  assetId: string | null;
  src: string | null;
  fit: 'contain' | 'cover' | 'fill' | 'none';
  alt: string;
}

export type ButtonAction =
  | { type: 'show_screen'; screenId: string }
  | { type: 'hide_screen'; screenId: string }
  | { type: 'toggle_screen'; screenId: string }
  | { type: 'set_state'; key: string; value: unknown }
  | { type: 'call_function'; functionName: string }
  | { type: 'scene_reset' }
  | { type: 'none' };

export interface ButtonWidgetConfig {
  label: string;
  hoverStyle: Partial<WidgetStyle>;
  activeStyle: Partial<WidgetStyle>;
  action: ButtonAction;
}

export interface ProgressBarWidgetConfig {
  valueBinding: DataBinding;
  min: number;
  max: number;
  direction: 'horizontal' | 'vertical' | 'radial';
  fillColor: string;
  trackColor: string;
  showLabel: boolean;
  labelFormat: string;
}

export interface PanelWidgetConfig {
  layout: 'free' | 'vertical' | 'horizontal';
  gap: number;
  alignItems: 'start' | 'center' | 'end' | 'stretch';
}

export interface GridWidgetConfig {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  itemBinding: DataBinding | null;
  cellTemplate: UIWidget | null;
}

export interface ScrollViewWidgetConfig {
  direction: 'vertical' | 'horizontal' | 'both';
  showScrollbar: boolean;
  scrollbarColor: string;
}

export interface SliderWidgetConfig {
  valueBinding: DataBinding;
  min: number;
  max: number;
  step: number;
  orientation: 'horizontal' | 'vertical';
  trackColor: string;
  thumbColor: string;
  fillColor: string;
}

export interface ToggleWidgetConfig {
  valueBinding: DataBinding;
  onLabel: string;
  offLabel: string;
  trackColorOn: string;
  trackColorOff: string;
  thumbColor: string;
}

export interface MinimapWidgetConfig {
  zoom: number;
  trackedEntityIds: string[];
  trackedEntityTags: string[];
  dotColor: string;
  dotSize: number;
  playerDotColor: string;
  backgroundColor: string;
  showBorder: boolean;
}

export interface UIWidgetBase {
  id: string;
  name: string;
  type: WidgetType;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: WidgetAnchor;
  style: WidgetStyle;
  visible: boolean;
  interactable: boolean;
  parentWidgetId: string | null;
  children: string[];
}

export type UIWidget = UIWidgetBase & (
  | { type: 'text'; config: TextWidgetConfig }
  | { type: 'image'; config: ImageWidgetConfig }
  | { type: 'button'; config: ButtonWidgetConfig }
  | { type: 'progress_bar'; config: ProgressBarWidgetConfig }
  | { type: 'panel'; config: PanelWidgetConfig }
  | { type: 'grid'; config: GridWidgetConfig }
  | { type: 'scroll_view'; config: ScrollViewWidgetConfig }
  | { type: 'slider'; config: SliderWidgetConfig }
  | { type: 'toggle'; config: ToggleWidgetConfig }
  | { type: 'minimap'; config: MinimapWidgetConfig }
);

export interface ScreenTransition {
  type: 'none' | 'fade' | 'slide_left' | 'slide_right' | 'slide_up' | 'slide_down' | 'scale';
  durationMs: number;
  easing: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';
}

export interface UIScreen {
  id: string;
  name: string;
  widgets: UIWidget[];
  visible: boolean;
  showOnStart: boolean;
  showOnKey: string | null;
  transition: ScreenTransition;
  zIndex: number;
  backgroundColor: string;
  blockInput: boolean;
}

export interface UITheme {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  borderRadius: number;
}

export interface GameUIData {
  version: 1;
  screens: UIScreen[];
  globalTheme: UITheme | null;
}

export type ScreenPreset = 'blank' | 'hud' | 'main_menu' | 'pause_menu' | 'game_over' | 'inventory' | 'dialog';

export type UIUndoAction =
  | { type: 'add_screen'; screen: UIScreen }
  | { type: 'delete_screen'; screen: UIScreen; index: number }
  | { type: 'update_screen'; screenId: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { type: 'add_widget'; screenId: string; widget: UIWidget }
  | { type: 'delete_widget'; screenId: string; widget: UIWidget; index: number }
  | { type: 'update_widget'; screenId: string; widgetId: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { type: 'move_widget'; screenId: string; widgetId: string; beforeX: number; beforeY: number; afterX: number; afterY: number }
  | { type: 'resize_widget'; screenId: string; widgetId: string; beforeW: number; beforeH: number; afterW: number; afterH: number };

// ========== Store ==========

interface UIBuilderState {
  screens: UIScreen[];
  activeScreenId: string | null;
  selectedWidgetId: string | null;
  hoveredWidgetId: string | null;
  copiedWidget: UIWidget | null;
  isUIEditorActive: boolean;
  previewMode: boolean;
  zoom: number;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  globalTheme: UITheme | null;
  undoStack: UIUndoAction[];
  redoStack: UIUndoAction[];

  createScreen: (name: string, preset?: ScreenPreset) => string;
  deleteScreen: (screenId: string) => void;
  renameScreen: (screenId: string, name: string) => void;
  duplicateScreen: (screenId: string) => string;
  setActiveScreen: (screenId: string | null) => void;
  reorderScreens: (fromIndex: number, toIndex: number) => void;
  updateScreen: (screenId: string, updates: Partial<UIScreen>) => void;

  addWidget: (screenId: string, type: WidgetType, position?: { x: number; y: number }) => string;
  removeWidget: (screenId: string, widgetId: string) => void;
  updateWidget: (screenId: string, widgetId: string, updates: Partial<UIWidget>) => void;
  moveWidget: (screenId: string, widgetId: string, x: number, y: number) => void;
  resizeWidget: (screenId: string, widgetId: string, width: number, height: number) => void;
  selectWidget: (widgetId: string | null) => void;
  duplicateWidget: (screenId: string, widgetId: string) => string;
  reparentWidget: (screenId: string, widgetId: string, newParentId: string | null) => void;
  reorderWidget: (screenId: string, widgetId: string, direction: 'up' | 'down') => void;

  setBinding: (screenId: string, widgetId: string, property: string, binding: DataBinding) => void;
  removeBinding: (screenId: string, widgetId: string, property: string) => void;

  updateWidgetStyle: (screenId: string, widgetId: string, style: Partial<WidgetStyle>) => void;
  applyTheme: (theme: UITheme) => void;

  copyWidget: (screenId: string, widgetId: string) => void;
  pasteWidget: (screenId: string, parentWidgetId?: string | null) => string | null;

  serialize: () => GameUIData;
  loadScreens: (data: GameUIData) => void;
  clearAll: () => void;

  uiUndo: () => void;
  uiRedo: () => void;
  pushUndoAction: (action: UIUndoAction) => void;

  handleRuntimeScreenAction: (action: string, target: string) => void;
  handleRuntimeWidgetAction: (msg: {
    action: string;
    screen: string;
    widget: string;
    text?: string;
    visible?: boolean;
    style?: Record<string, unknown>;
  }) => void;
}

const MAX_UNDO_STACK = 50;
let idCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

import { getWidgetDefaults, DEFAULT_WIDGET_STYLE } from '@/components/editor/ui-builder/widgetDefaults';

export const useUIBuilderStore = create<UIBuilderState>((set, get) => ({
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

  createScreen: (name: string, preset?: ScreenPreset) => {
    const screenId = nextId('screen');
    const screen: UIScreen = {
      id: screenId,
      name,
      widgets: [],
      visible: false,
      showOnStart: false,
      showOnKey: null,
      transition: { type: 'none', durationMs: 300, easing: 'ease_out' },
      zIndex: get().screens.length,
      backgroundColor: 'transparent',
      blockInput: false,
    };

    // Apply preset widgets if provided
    if (preset && preset !== 'blank') {
      screen.widgets = createPresetWidgets(preset);
    }

    set((state) => ({
      screens: [...state.screens, screen],
      activeScreenId: screenId,
    }));

    get().pushUndoAction({ type: 'add_screen', screen });
    return screenId;
  },

  deleteScreen: (screenId: string) => {
    const state = get();
    const index = state.screens.findIndex((s) => s.id === screenId);
    if (index === -1) return;

    const screen = state.screens[index];
    get().pushUndoAction({ type: 'delete_screen', screen, index });

    set((state) => ({
      screens: state.screens.filter((s) => s.id !== screenId),
      activeScreenId: state.activeScreenId === screenId ? null : state.activeScreenId,
    }));
  },

  renameScreen: (screenId: string, name: string) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const before = { name: screen.name };
    const after = { name };
    get().pushUndoAction({ type: 'update_screen', screenId, before, after });

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId ? { ...s, name } : s
      ),
    }));
  },

  duplicateScreen: (screenId: string) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return '';

    const newScreenId = nextId('screen');
    const newScreen: UIScreen = {
      ...screen,
      id: newScreenId,
      name: `${screen.name} (copy)`,
      widgets: screen.widgets.map((w) => ({
        ...w,
        id: nextId('widget'),
      })),
    };

    set((state) => ({
      screens: [...state.screens, newScreen],
      activeScreenId: newScreenId,
    }));

    get().pushUndoAction({ type: 'add_screen', screen: newScreen });
    return newScreenId;
  },

  setActiveScreen: (screenId: string | null) => set({ activeScreenId: screenId }),

  reorderScreens: (_fromIndex: number, _toIndex: number) => {
    // TODO: Implement screen reordering if needed
  },

  updateScreen: (screenId: string, updates: Partial<UIScreen>) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key in updates) {
      before[key] = screen[key as keyof UIScreen];
      after[key] = updates[key as keyof UIScreen];
    }
    get().pushUndoAction({ type: 'update_screen', screenId, before, after });

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId ? { ...s, ...updates } : s
      ),
    }));
  },

  addWidget: (screenId: string, type: WidgetType, position?: { x: number; y: number }) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return '';
    if (screen.widgets.length >= 200) {
      console.warn('Maximum widget count (200) reached');
      return '';
    }

    const widgetId = nextId('widget');
    const defaults = getWidgetDefaults(type);

    const baseWidget: UIWidgetBase = {
      id: widgetId,
      name: `${type}_${widgetId.slice(-4)}`,
      type,
      x: position?.x ?? 50,
      y: position?.y ?? 50,
      width: defaults.width,
      height: defaults.height,
      anchor: 'top_left',
      style: { ...DEFAULT_WIDGET_STYLE, ...defaults.style },
      visible: true,
      interactable: true,
      parentWidgetId: null,
      children: [],
    };

    // Type-safe widget creation with discriminated union (use unknown for intermediate step)
    const widget = { ...baseWidget, type, config: defaults.config } as unknown as UIWidget;

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId ? { ...s, widgets: [...s.widgets, widget] } : s
      ),
      selectedWidgetId: widgetId,
    }));

    get().pushUndoAction({ type: 'add_widget', screenId, widget });
    return widgetId;
  },

  removeWidget: (screenId: string, widgetId: string) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const index = screen.widgets.findIndex((w) => w.id === widgetId);
    if (index === -1) return;

    const widget = screen.widgets[index];
    get().pushUndoAction({ type: 'delete_widget', screenId, widget, index });

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId
          ? { ...s, widgets: s.widgets.filter((w) => w.id !== widgetId) }
          : s
      ),
      selectedWidgetId: state.selectedWidgetId === widgetId ? null : state.selectedWidgetId,
    }));
  },

  updateWidget: (screenId: string, widgetId: string, updates: Partial<UIWidget>) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const widget = screen.widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key in updates) {
      before[key] = widget[key as keyof UIWidget];
      after[key] = updates[key as keyof UIWidget];
    }
    get().pushUndoAction({ type: 'update_widget', screenId, widgetId, before, after });

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId
          ? {
              ...s,
              widgets: s.widgets.map((w) =>
                w.id === widgetId ? ({ ...w, ...updates } as UIWidget) : w
              ),
            }
          : s
      ),
    }));
  },

  moveWidget: (screenId: string, widgetId: string, x: number, y: number) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const widget = screen.widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    get().pushUndoAction({
      type: 'move_widget',
      screenId,
      widgetId,
      beforeX: widget.x,
      beforeY: widget.y,
      afterX: x,
      afterY: y,
    });

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId
          ? {
              ...s,
              widgets: s.widgets.map((w) =>
                w.id === widgetId ? { ...w, x, y } : w
              ),
            }
          : s
      ),
    }));
  },

  resizeWidget: (screenId: string, widgetId: string, width: number, height: number) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const widget = screen.widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    get().pushUndoAction({
      type: 'resize_widget',
      screenId,
      widgetId,
      beforeW: widget.width,
      beforeH: widget.height,
      afterW: width,
      afterH: height,
    });

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId
          ? {
              ...s,
              widgets: s.widgets.map((w) =>
                w.id === widgetId ? { ...w, width, height } : w
              ),
            }
          : s
      ),
    }));
  },

  selectWidget: (widgetId: string | null) => set({ selectedWidgetId: widgetId }),

  duplicateWidget: (screenId: string, widgetId: string) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return '';

    const widget = screen.widgets.find((w) => w.id === widgetId);
    if (!widget) return '';

    const newWidgetId = nextId('widget');
    const newWidget: UIWidget = {
      ...widget,
      id: newWidgetId,
      name: `${widget.name}_copy`,
      x: widget.x + 2,
      y: widget.y + 2,
    };

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId ? { ...s, widgets: [...s.widgets, newWidget] } : s
      ),
      selectedWidgetId: newWidgetId,
    }));

    get().pushUndoAction({ type: 'add_widget', screenId, widget: newWidget });
    return newWidgetId;
  },

  reparentWidget: (_screenId: string, _widgetId: string, _newParentId: string | null) => {
    // TODO: Implement widget reparenting with circular reference check
  },

  reorderWidget: (screenId: string, widgetId: string, direction: 'up' | 'down') => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const index = screen.widgets.findIndex((w) => w.id === widgetId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= screen.widgets.length) return;

    const newWidgets = [...screen.widgets];
    [newWidgets[index], newWidgets[newIndex]] = [newWidgets[newIndex], newWidgets[index]];

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId ? { ...s, widgets: newWidgets } : s
      ),
    }));
  },

  setBinding: (screenId: string, widgetId: string, property: string, binding: DataBinding) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const widget = screen.widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    // Update the config property with the binding
    const updatedConfig = { ...widget.config, [property]: binding };

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId
          ? {
              ...s,
              widgets: s.widgets.map((w) =>
                w.id === widgetId ? ({ ...w, config: updatedConfig } as UIWidget) : w
              ),
            }
          : s
      ),
    }));
  },

  removeBinding: (screenId: string, widgetId: string, property: string) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const widget = screen.widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    const updatedConfig = { ...widget.config, [property]: null };

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId
          ? {
              ...s,
              widgets: s.widgets.map((w) =>
                w.id === widgetId ? ({ ...w, config: updatedConfig } as UIWidget) : w
              ),
            }
          : s
      ),
    }));
  },

  updateWidgetStyle: (screenId: string, widgetId: string, style: Partial<WidgetStyle>) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const widget = screen.widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    const updatedStyle = { ...widget.style, ...style };

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId
          ? {
              ...s,
              widgets: s.widgets.map((w) =>
                w.id === widgetId ? { ...w, style: updatedStyle } : w
              ),
            }
          : s
      ),
    }));
  },

  applyTheme: (theme: UITheme) => {
    set({ globalTheme: theme });
    // TODO: Apply theme to all widgets
  },

  copyWidget: (screenId: string, widgetId: string) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const widget = screen.widgets.find((w) => w.id === widgetId);
    if (widget) {
      set({ copiedWidget: widget });
    }
  },

  pasteWidget: (screenId: string, parentWidgetId?: string | null) => {
    const state = get();
    const { copiedWidget } = state;
    if (!copiedWidget) return null;

    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return null;

    const newWidgetId = nextId('widget');
    const newWidget: UIWidget = {
      ...copiedWidget,
      id: newWidgetId,
      name: `${copiedWidget.name}_paste`,
      x: copiedWidget.x + 5,
      y: copiedWidget.y + 5,
      parentWidgetId: parentWidgetId ?? null,
    };

    set((state) => ({
      screens: state.screens.map((s) =>
        s.id === screenId ? { ...s, widgets: [...s.widgets, newWidget] } : s
      ),
      selectedWidgetId: newWidgetId,
    }));

    get().pushUndoAction({ type: 'add_widget', screenId, widget: newWidget });
    return newWidgetId;
  },

  serialize: () => {
    const { screens, globalTheme } = get();
    return {
      version: 1 as const,
      screens,
      globalTheme,
    };
  },

  loadScreens: (data: GameUIData) => {
    set({
      screens: data.screens || [],
      globalTheme: data.globalTheme,
      activeScreenId: null,
      selectedWidgetId: null,
      undoStack: [],
      redoStack: [],
    });
  },

  clearAll: () => {
    set({
      screens: [],
      activeScreenId: null,
      selectedWidgetId: null,
      copiedWidget: null,
      globalTheme: null,
      undoStack: [],
      redoStack: [],
    });
  },

  uiUndo: () => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return;

    const action = undoStack[undoStack.length - 1];
    const newUndoStack = undoStack.slice(0, -1);

    // Apply undo
    switch (action.type) {
      case 'add_screen':
        set((state) => ({
          screens: state.screens.filter((s) => s.id !== action.screen.id),
          undoStack: newUndoStack,
          redoStack: [...redoStack, action],
        }));
        break;
      case 'delete_screen':
        set((state) => {
          const newScreens = [...state.screens];
          newScreens.splice(action.index, 0, action.screen);
          return {
            screens: newScreens,
            undoStack: newUndoStack,
            redoStack: [...redoStack, action],
          };
        });
        break;
      // TODO: Implement other undo types
      default:
        set({ undoStack: newUndoStack, redoStack: [...redoStack, action] });
    }
  },

  uiRedo: () => {
    const { undoStack, redoStack } = get();
    if (redoStack.length === 0) return;

    const action = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);

    // Apply redo
    switch (action.type) {
      case 'add_screen':
        set((state) => ({
          screens: [...state.screens, action.screen],
          undoStack: [...undoStack, action],
          redoStack: newRedoStack,
        }));
        break;
      case 'delete_screen':
        set((state) => ({
          screens: state.screens.filter((s) => s.id !== action.screen.id),
          undoStack: [...undoStack, action],
          redoStack: newRedoStack,
        }));
        break;
      // TODO: Implement other redo types
      default:
        set({ undoStack: [...undoStack, action], redoStack: newRedoStack });
    }
  },

  pushUndoAction: (action: UIUndoAction) => {
    set((state) => ({
      undoStack: [...state.undoStack.slice(-MAX_UNDO_STACK + 1), action],
      redoStack: [],
    }));
  },

  handleRuntimeScreenAction: (action: string, target: string) => {
    const { screens } = get();
    const screen = screens.find((s) => s.id === target || s.name === target);
    if (!screen) return;

    switch (action) {
      case 'show':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === screen.id ? { ...s, visible: true } : s
          ),
        }));
        break;
      case 'hide':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === screen.id ? { ...s, visible: false } : s
          ),
        }));
        break;
      case 'toggle':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === screen.id ? { ...s, visible: !s.visible } : s
          ),
        }));
        break;
      case 'hide_all':
        set((state) => ({
          screens: state.screens.map((s) => ({ ...s, visible: false })),
        }));
        break;
    }
  },

  handleRuntimeWidgetAction: (msg) => {
    const { screens } = get();
    const screen = screens.find((s) => s.id === msg.screen || s.name === msg.screen);
    if (!screen) return;

    const widget = screen.widgets.find((w) => w.id === msg.widget || w.name === msg.widget);
    if (!widget) return;

    switch (msg.action) {
      case 'set_text':
        if (widget.type === 'text' && msg.text !== undefined) {
          set((state) => ({
            screens: state.screens.map((s) =>
              s.id === screen.id
                ? {
                    ...s,
                    widgets: s.widgets.map((w) =>
                      w.id === widget.id
                        ? ({ ...w, config: { ...w.config, content: msg.text as string } } as UIWidget)
                        : w
                    ),
                  }
                : s
            ),
          }));
        }
        break;
      case 'set_visible':
        if (msg.visible !== undefined) {
          set((state) => ({
            screens: state.screens.map((s) =>
              s.id === screen.id
                ? {
                    ...s,
                    widgets: s.widgets.map((w) =>
                      w.id === widget.id ? { ...w, visible: msg.visible as boolean } : w
                    ),
                  }
                : s
            ),
          }));
        }
        break;
      case 'set_style':
        if (msg.style) {
          set((state) => ({
            screens: state.screens.map((s) =>
              s.id === screen.id
                ? {
                    ...s,
                    widgets: s.widgets.map((w) =>
                      w.id === widget.id
                        ? { ...w, style: { ...w.style, ...msg.style } as WidgetStyle }
                        : w
                    ),
                  }
                : s
            ),
          }));
        }
        break;
    }
  },
}));

// ========== Preset Helpers ==========

function createPresetWidgets(preset: ScreenPreset): UIWidget[] {
  const widgets: UIWidget[] = [];

  switch (preset) {
    case 'hud':
      // Top-left score
      widgets.push(createWidget('text', {
        name: 'score_text',
        x: 2,
        y: 2,
        width: 15,
        height: 5,
        config: { content: 'Score: {{score}}', binding: null },
      }));
      // Top-right health bar
      widgets.push(createWidget('progress_bar', {
        name: 'health_bar',
        x: 80,
        y: 2,
        width: 18,
        height: 3,
        config: {
          valueBinding: { stateKey: 'health', direction: 'read', transform: null },
          min: 0,
          max: 100,
          direction: 'horizontal',
          fillColor: '#22c55e',
          trackColor: '#374151',
          showLabel: true,
          labelFormat: '{percent}%',
        },
      }));
      // Bottom-center ammo text
      widgets.push(createWidget('text', {
        name: 'ammo_text',
        x: 45,
        y: 90,
        width: 10,
        height: 5,
        config: { content: 'Ammo: {{ammo}}', binding: null },
      }));
      break;

    case 'main_menu':
      // Centered title
      widgets.push(createWidget('text', {
        name: 'title',
        x: 35,
        y: 20,
        width: 30,
        height: 10,
        config: { content: 'Game Title', binding: null },
        style: { fontSize: 48, textAlign: 'center' as const, fontWeight: 'bold' as const },
      }));
      // Play button
      widgets.push(createWidget('button', {
        name: 'play_button',
        x: 40,
        y: 45,
        width: 20,
        height: 6,
        config: {
          label: 'Play',
          hoverStyle: { opacity: 0.8 },
          activeStyle: { opacity: 0.6 },
          action: { type: 'none' },
        },
      }));
      // Settings button
      widgets.push(createWidget('button', {
        name: 'settings_button',
        x: 40,
        y: 55,
        width: 20,
        height: 6,
        config: {
          label: 'Settings',
          hoverStyle: { opacity: 0.8 },
          activeStyle: { opacity: 0.6 },
          action: { type: 'none' },
        },
      }));
      // Quit button
      widgets.push(createWidget('button', {
        name: 'quit_button',
        x: 40,
        y: 65,
        width: 20,
        height: 6,
        config: {
          label: 'Quit',
          hoverStyle: { opacity: 0.8 },
          activeStyle: { opacity: 0.6 },
          action: { type: 'scene_reset' },
        },
      }));
      break;

    case 'pause_menu':
      // Semi-transparent backdrop
      widgets.push(createWidget('panel', {
        name: 'backdrop',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        config: { layout: 'free', gap: 0, alignItems: 'center' as const },
        style: { backgroundColor: 'rgba(0,0,0,0.7)' },
      }));
      // Paused title
      widgets.push(createWidget('text', {
        name: 'paused_title',
        x: 40,
        y: 30,
        width: 20,
        height: 8,
        config: { content: 'Paused', binding: null },
        style: { fontSize: 36, textAlign: 'center' as const, fontWeight: 'bold' as const },
      }));
      // Resume button
      widgets.push(createWidget('button', {
        name: 'resume_button',
        x: 40,
        y: 45,
        width: 20,
        height: 6,
        config: {
          label: 'Resume',
          hoverStyle: { opacity: 0.8 },
          activeStyle: { opacity: 0.6 },
          action: { type: 'none' },
        },
      }));
      // Quit button
      widgets.push(createWidget('button', {
        name: 'quit_button',
        x: 40,
        y: 55,
        width: 20,
        height: 6,
        config: {
          label: 'Quit',
          hoverStyle: { opacity: 0.8 },
          activeStyle: { opacity: 0.6 },
          action: { type: 'scene_reset' },
        },
      }));
      break;

    // TODO: Implement other presets (game_over, inventory, dialog)
  }

  return widgets;
}

function createWidget(
  type: WidgetType,
  overrides: Partial<Omit<UIWidgetBase, 'style' | 'type' | 'config'>> & { config?: Record<string, unknown>; style?: Partial<WidgetStyle> }
): UIWidget {
  const defaults = getWidgetDefaults(type);
  const baseWidget: UIWidgetBase = {
    id: nextId('widget'),
    name: overrides.name || `${type}_${nextId('widget').slice(-4)}`,
    type,
    x: overrides.x ?? 50,
    y: overrides.y ?? 50,
    width: overrides.width ?? defaults.width,
    height: overrides.height ?? defaults.height,
    anchor: overrides.anchor ?? 'top_left',
    style: { ...DEFAULT_WIDGET_STYLE, ...defaults.style, ...(overrides.style || {}) } as WidgetStyle,
    visible: overrides.visible ?? true,
    interactable: overrides.interactable ?? true,
    parentWidgetId: overrides.parentWidgetId ?? null,
    children: overrides.children ?? [],
  };

  const config = { ...defaults.config, ...overrides.config };

  return { ...baseWidget, type, config } as unknown as UIWidget;
}
