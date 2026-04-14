import { create } from 'zustand';
import { createPresetWidgets } from './uiBuilderPresets';
import { getWidgetDefaults, DEFAULT_WIDGET_STYLE } from '@/components/editor/ui-builder/widgetDefaults';

// Re-export all types so existing consumers don't break
export type {
  WidgetType,
  WidgetAnchor,
  WidgetStyle,
  DataBinding,
  BindingTransform,
  TextWidgetConfig,
  ImageWidgetConfig,
  ButtonAction,
  ButtonWidgetConfig,
  ProgressBarWidgetConfig,
  PanelWidgetConfig,
  GridWidgetConfig,
  ScrollViewWidgetConfig,
  SliderWidgetConfig,
  ToggleWidgetConfig,
  MinimapWidgetConfig,
  UIWidgetBase,
  UIWidget,
  ScreenTransition,
  UIScreen,
  UITheme,
  GameUIData,
  ScreenPreset,
  UIUndoAction,
} from './uiBuilderTypes';

import type {
  WidgetType,
  WidgetStyle,
  DataBinding,
  UIWidgetBase,
  UIWidget,
  UIScreen,
  UITheme,
  GameUIData,
  ScreenPreset,
  UIUndoAction,
} from './uiBuilderTypes';

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

  reorderScreens: (fromIndex: number, toIndex: number) => {
    set((state) => {
      const screens = [...state.screens];
      if (fromIndex < 0 || fromIndex >= screens.length || toIndex < 0 || toIndex >= screens.length) return state;
      if (fromIndex === toIndex) return state;
      const [moved] = screens.splice(fromIndex, 1);
      screens.splice(toIndex, 0, moved);
      return { screens };
    });
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

  reparentWidget: (screenId: string, widgetId: string, newParentId: string | null) => {
    const state = get();
    const screen = state.screens.find((s) => s.id === screenId);
    if (!screen) return;

    const widget = screen.widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    // No-op if already has the same parent
    if (widget.parentWidgetId === newParentId) return;

    // Prevent reparenting to self
    if (newParentId === widgetId) return;

    // Circular reference check: newParentId must not be a descendant of widgetId
    if (newParentId !== null) {
      const isDescendant = (ancestorId: string, targetId: string): boolean => {
        const ancestor = screen.widgets.find((w) => w.id === ancestorId);
        if (!ancestor) return false;
        for (const childId of ancestor.children) {
          if (childId === targetId) return true;
          if (isDescendant(childId, targetId)) return true;
        }
        return false;
      };
      if (isDescendant(widgetId, newParentId)) return;
    }

    const oldParentId = widget.parentWidgetId;

    set((state) => ({
      screens: state.screens.map((s) => {
        if (s.id !== screenId) return s;
        return {
          ...s,
          widgets: s.widgets.map((w) => {
            if (w.id === widgetId) {
              return { ...w, parentWidgetId: newParentId };
            }
            // Remove from old parent's children
            if (oldParentId !== null && w.id === oldParentId) {
              return { ...w, children: w.children.filter((c) => c !== widgetId) };
            }
            // Add to new parent's children
            if (newParentId !== null && w.id === newParentId) {
              return { ...w, children: [...w.children, widgetId] };
            }
            return w;
          }),
        };
      }),
    }));
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
    set((state) => ({
      globalTheme: theme,
      screens: state.screens.map((screen) => ({
        ...screen,
        widgets: screen.widgets.map((widget) => ({
          ...widget,
          style: {
            ...widget.style,
            color: theme.textColor,
            fontFamily: theme.fontFamily,
            fontSize: theme.fontSize,
            borderRadius: theme.borderRadius,
            backgroundColor:
              widget.type === 'button' || widget.type === 'panel'
                ? theme.secondaryColor
                : widget.style.backgroundColor,
          },
        })),
      })),
    }));
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
      case 'update_screen':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId ? { ...s, ...action.before } : s
          ),
          undoStack: newUndoStack,
          redoStack: [...redoStack, action],
        }));
        break;
      case 'add_widget':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId
              ? { ...s, widgets: s.widgets.filter((w) => w.id !== action.widget.id) }
              : s
          ),
          undoStack: newUndoStack,
          redoStack: [...redoStack, action],
        }));
        break;
      case 'delete_widget':
        set((state) => ({
          screens: state.screens.map((s) => {
            if (s.id !== action.screenId) return s;
            const newWidgets = [...s.widgets];
            newWidgets.splice(action.index, 0, action.widget);
            return { ...s, widgets: newWidgets };
          }),
          undoStack: newUndoStack,
          redoStack: [...redoStack, action],
        }));
        break;
      case 'update_widget':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId
              ? {
                  ...s,
                  widgets: s.widgets.map((w) =>
                    w.id === action.widgetId ? ({ ...w, ...action.before } as UIWidget) : w
                  ),
                }
              : s
          ),
          undoStack: newUndoStack,
          redoStack: [...redoStack, action],
        }));
        break;
      case 'move_widget':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId
              ? {
                  ...s,
                  widgets: s.widgets.map((w) =>
                    w.id === action.widgetId ? { ...w, x: action.beforeX, y: action.beforeY } : w
                  ),
                }
              : s
          ),
          undoStack: newUndoStack,
          redoStack: [...redoStack, action],
        }));
        break;
      case 'resize_widget':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId
              ? {
                  ...s,
                  widgets: s.widgets.map((w) =>
                    w.id === action.widgetId
                      ? { ...w, width: action.beforeW, height: action.beforeH }
                      : w
                  ),
                }
              : s
          ),
          undoStack: newUndoStack,
          redoStack: [...redoStack, action],
        }));
        break;
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
      case 'update_screen':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId ? { ...s, ...action.after } : s
          ),
          undoStack: [...undoStack, action],
          redoStack: newRedoStack,
        }));
        break;
      case 'add_widget':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId
              ? { ...s, widgets: [...s.widgets, action.widget] }
              : s
          ),
          undoStack: [...undoStack, action],
          redoStack: newRedoStack,
        }));
        break;
      case 'delete_widget':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId
              ? { ...s, widgets: s.widgets.filter((w) => w.id !== action.widget.id) }
              : s
          ),
          undoStack: [...undoStack, action],
          redoStack: newRedoStack,
        }));
        break;
      case 'update_widget':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId
              ? {
                  ...s,
                  widgets: s.widgets.map((w) =>
                    w.id === action.widgetId ? ({ ...w, ...action.after } as UIWidget) : w
                  ),
                }
              : s
          ),
          undoStack: [...undoStack, action],
          redoStack: newRedoStack,
        }));
        break;
      case 'move_widget':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId
              ? {
                  ...s,
                  widgets: s.widgets.map((w) =>
                    w.id === action.widgetId ? { ...w, x: action.afterX, y: action.afterY } : w
                  ),
                }
              : s
          ),
          undoStack: [...undoStack, action],
          redoStack: newRedoStack,
        }));
        break;
      case 'resize_widget':
        set((state) => ({
          screens: state.screens.map((s) =>
            s.id === action.screenId
              ? {
                  ...s,
                  widgets: s.widgets.map((w) =>
                    w.id === action.widgetId
                      ? { ...w, width: action.afterW, height: action.afterH }
                      : w
                  ),
                }
              : s
          ),
          undoStack: [...undoStack, action],
          redoStack: newRedoStack,
        }));
        break;
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
