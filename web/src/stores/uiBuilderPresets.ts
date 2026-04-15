import type { WidgetType, WidgetStyle, UIWidgetBase, UIWidget, ScreenPreset } from './uiBuilderTypes';
import { getWidgetDefaults, DEFAULT_WIDGET_STYLE } from '@/components/editor/ui-builder/widgetDefaults';

let presetIdCounter = 0;

function nextPresetId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++presetIdCounter}`;
}

export function createWidget(
  type: WidgetType,
  overrides: Partial<Omit<UIWidgetBase, 'style' | 'type' | 'config'>> & { config?: Record<string, unknown>; style?: Partial<WidgetStyle> }
): UIWidget {
  const defaults = getWidgetDefaults(type);
  const baseWidget: UIWidgetBase = {
    id: nextPresetId('widget'),
    name: overrides.name || `${type}_${nextPresetId('widget').slice(-4)}`,
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

export function createPresetWidgets(preset: ScreenPreset): UIWidget[] {
  const widgets: UIWidget[] = [];

  switch (preset) {
    case 'hud':
      widgets.push(createWidget('text', {
        name: 'score_text',
        x: 2,
        y: 2,
        width: 15,
        height: 5,
        config: { content: 'Score: {{score}}', binding: null },
      }));
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
      widgets.push(createWidget('text', {
        name: 'title',
        x: 35,
        y: 20,
        width: 30,
        height: 10,
        config: { content: 'Game Title', binding: null },
        style: { fontSize: 48, textAlign: 'center' as const, fontWeight: 'bold' as const },
      }));
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
      widgets.push(createWidget('panel', {
        name: 'backdrop',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        config: { layout: 'free', gap: 0, alignItems: 'center' as const },
        style: { backgroundColor: 'rgba(0,0,0,0.7)' },
      }));
      widgets.push(createWidget('text', {
        name: 'paused_title',
        x: 40,
        y: 30,
        width: 20,
        height: 8,
        config: { content: 'Paused', binding: null },
        style: { fontSize: 36, textAlign: 'center' as const, fontWeight: 'bold' as const },
      }));
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

    case 'game_over':
      widgets.push(createWidget('panel', {
        name: 'overlay',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        config: { layout: 'free', gap: 0, alignItems: 'center' as const },
        style: { backgroundColor: 'rgba(0,0,0,0.8)' },
      }));
      widgets.push(createWidget('text', {
        name: 'game_over_title',
        x: 30,
        y: 25,
        width: 40,
        height: 10,
        config: { content: 'Game Over', binding: null },
        style: { fontSize: 48, textAlign: 'center' as const, fontWeight: 'bold' as const, color: '#ef4444' },
      }));
      widgets.push(createWidget('text', {
        name: 'final_score',
        x: 35,
        y: 40,
        width: 30,
        height: 6,
        config: { content: 'Score: {{score}}', binding: null },
        style: { fontSize: 24, textAlign: 'center' as const },
      }));
      widgets.push(createWidget('button', {
        name: 'retry_button',
        x: 40,
        y: 55,
        width: 20,
        height: 6,
        config: {
          label: 'Retry',
          hoverStyle: { opacity: 0.8 },
          activeStyle: { opacity: 0.6 },
          action: { type: 'scene_reset' },
        },
      }));
      widgets.push(createWidget('button', {
        name: 'menu_button',
        x: 40,
        y: 65,
        width: 20,
        height: 6,
        config: {
          label: 'Main Menu',
          hoverStyle: { opacity: 0.8 },
          activeStyle: { opacity: 0.6 },
          action: { type: 'none' },
        },
      }));
      break;

    case 'inventory':
      widgets.push(createWidget('panel', {
        name: 'inventory_bg',
        x: 10,
        y: 5,
        width: 80,
        height: 90,
        config: { layout: 'vertical', gap: 4, alignItems: 'stretch' as const },
        style: { backgroundColor: 'rgba(24,24,27,0.95)', borderWidth: 1, borderColor: '#3f3f46' },
      }));
      widgets.push(createWidget('text', {
        name: 'inventory_title',
        x: 12,
        y: 8,
        width: 76,
        height: 5,
        config: { content: 'Inventory', binding: null },
        style: { fontSize: 24, fontWeight: 'bold' as const },
      }));
      widgets.push(createWidget('grid', {
        name: 'item_grid',
        x: 12,
        y: 16,
        width: 76,
        height: 65,
        config: {
          columns: 6,
          rows: 4,
          cellWidth: 64,
          cellHeight: 64,
          gap: 4,
          itemBinding: null,
          cellTemplate: null,
        },
      }));
      widgets.push(createWidget('button', {
        name: 'close_button',
        x: 82,
        y: 6,
        width: 6,
        height: 4,
        config: {
          label: 'X',
          hoverStyle: { opacity: 0.8 },
          activeStyle: { opacity: 0.6 },
          action: { type: 'none' },
        },
      }));
      break;

    case 'dialog':
      widgets.push(createWidget('panel', {
        name: 'dialog_box',
        x: 10,
        y: 70,
        width: 80,
        height: 25,
        config: { layout: 'vertical', gap: 2, alignItems: 'start' as const },
        style: { backgroundColor: 'rgba(24,24,27,0.95)', borderWidth: 1, borderColor: '#3f3f46', borderRadius: 8 },
      }));
      widgets.push(createWidget('text', {
        name: 'speaker_name',
        x: 12,
        y: 72,
        width: 20,
        height: 4,
        config: { content: 'Speaker', binding: null },
        style: { fontSize: 16, fontWeight: 'bold' as const, color: '#60a5fa' },
      }));
      widgets.push(createWidget('text', {
        name: 'dialog_text',
        x: 12,
        y: 77,
        width: 76,
        height: 12,
        config: { content: 'Dialog text goes here...', binding: null },
        style: { fontSize: 14, lineHeight: 1.5 },
      }));
      widgets.push(createWidget('text', {
        name: 'continue_hint',
        x: 75,
        y: 90,
        width: 14,
        height: 3,
        config: { content: 'Click to continue ▶', binding: null },
        style: { fontSize: 12, textAlign: 'right' as const, color: '#a1a1aa' },
      }));
      break;
  }

  return widgets;
}
